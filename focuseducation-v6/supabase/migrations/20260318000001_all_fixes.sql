-- ============================================================
-- MIGRATION: All Security & Bug Fixes — v7
-- ============================================================

-- ── 1. Fix PayPal status case mismatch (all existing rows) ──
UPDATE public.subscriptions
  SET status = lower(status)
  WHERE status != lower(status);

-- ── 2. Add INTERNAL_SECRET column tracking for edge functions ──
-- (no schema change needed — handled via env var)

-- ── 3. Add progress fields to generation_jobs ──
ALTER TABLE public.generation_jobs
  ADD COLUMN IF NOT EXISTS progress_message TEXT,
  ADD COLUMN IF NOT EXISTS progress_pct     SMALLINT DEFAULT 0;

-- ── 4. Add leaderboard opt-in to profiles ──
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS leaderboard_opt_in   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS leaderboard_nickname TEXT;

-- Update leaderboard_view to respect opt-in
-- (Drop & recreate — adjust if your view exists with different name)
DROP VIEW IF EXISTS public.leaderboard_view;
CREATE OR REPLACE VIEW public.leaderboard_view AS
  SELECT
    p.user_id,
    COALESCE(p.leaderboard_nickname, 'Studente #' || upper(substr(p.user_id::text, 1, 4))) AS full_name,
    p.avatar_url,
    p.streak_count,
    x.total_xp,
    x.level,
    x.quizzes_completed
  FROM public.profiles p
  JOIN public.user_xp x ON x.user_id = p.user_id
  WHERE p.leaderboard_opt_in = true;

-- ── 5. Rate limiting for AI generation ──
CREATE TABLE IF NOT EXISTS public.generation_rate_limits (
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  window_start TIMESTAMPTZ NOT NULL,
  req_count    INTEGER     NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, window_start)
);

CREATE OR REPLACE FUNCTION public.check_and_increment_rate_limit(
  _user_id      UUID,
  _max_per_min  INTEGER DEFAULT 5
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window TIMESTAMPTZ := date_trunc('minute', now());
  v_count  INTEGER;
BEGIN
  -- Upsert: create or increment counter for current minute
  INSERT INTO generation_rate_limits (user_id, window_start, req_count)
  VALUES (_user_id, v_window, 1)
  ON CONFLICT (user_id, window_start)
  DO UPDATE SET req_count = generation_rate_limits.req_count + 1
  RETURNING req_count INTO v_count;

  -- Clean old windows (older than 5 minutes)
  DELETE FROM generation_rate_limits
  WHERE user_id = _user_id AND window_start < now() - INTERVAL '5 minutes';

  RETURN v_count <= _max_per_min;
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_and_increment_rate_limit(UUID, INTEGER) TO authenticated;

-- ── 6. Atomic purchase_powerup RPC ──
CREATE OR REPLACE FUNCTION public.purchase_powerup(
  _user_id      UUID,
  _powerup_type TEXT,
  _max_qty      INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_xp_cost INTEGER;
  v_current_xp INTEGER;
  v_current_level INTEGER;
  v_current_qty INTEGER;
BEGIN
  -- Server-side price whitelist (prevents client price manipulation)
  v_xp_cost := CASE _powerup_type
    WHEN 'streak_freeze'      THEN 200
    WHEN 'xp_boost_2x'        THEN 300
    WHEN 'extra_time'         THEN 150
    WHEN 'streak_multiplier'  THEN 400
    WHEN 'fortune_respin'     THEN 250
    ELSE -1
  END;

  IF v_xp_cost = -1 THEN
    RETURN jsonb_build_object('success', false, 'error', 'unknown_powerup');
  END IF;

  -- Lock XP row for atomic update
  SELECT total_xp, level INTO v_current_xp, v_current_level
  FROM user_xp WHERE user_id = _user_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_xp_row');
  END IF;

  IF v_current_xp < v_xp_cost THEN
    RETURN jsonb_build_object('success', false, 'error', 'insufficient_xp', 'xp', v_current_xp);
  END IF;

  -- Check current quantity
  SELECT COALESCE(quantity, 0) INTO v_current_qty
  FROM user_powerups WHERE user_id = _user_id AND powerup_type = _powerup_type;

  IF COALESCE(v_current_qty, 0) >= _max_qty THEN
    RETURN jsonb_build_object('success', false, 'error', 'max_reached');
  END IF;

  -- Deduct XP atomically
  UPDATE user_xp
  SET total_xp = v_current_xp - v_xp_cost,
      level    = GREATEST(1, floor((v_current_xp - v_xp_cost) / 500) + 1)
  WHERE user_id = _user_id;

  -- Add powerup
  INSERT INTO user_powerups (user_id, powerup_type, quantity)
  VALUES (_user_id, _powerup_type, 1)
  ON CONFLICT (user_id, powerup_type)
  DO UPDATE SET quantity = user_powerups.quantity + 1;

  -- Log
  INSERT INTO xp_log (user_id, source, xp_amount)
  VALUES (_user_id, 'powerup_purchase', -v_xp_cost);

  INSERT INTO powerup_purchases (user_id, powerup_type, xp_cost)
  VALUES (_user_id, _powerup_type, v_xp_cost);

  RETURN jsonb_build_object(
    'success',   true,
    'xp_cost',   v_xp_cost,
    'xp_after',  v_current_xp - v_xp_cost
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.purchase_powerup(UUID, TEXT, INTEGER) TO authenticated;

-- ── 7. Atomic XP→Credits conversion RPC ──
CREATE OR REPLACE FUNCTION public.convert_xp_to_credits(
  _user_id       UUID,
  _xp_cost       INTEGER DEFAULT 1000,
  _credits_gain  INTEGER DEFAULT 10
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_xp INTEGER;
BEGIN
  SELECT total_xp INTO v_xp FROM user_xp WHERE user_id = _user_id FOR UPDATE;

  IF NOT FOUND OR v_xp < _xp_cost THEN
    RETURN jsonb_build_object('success', false, 'error', 'insufficient_xp');
  END IF;

  UPDATE user_xp
  SET total_xp = v_xp - _xp_cost,
      level    = GREATEST(1, floor((v_xp - _xp_cost) / 500) + 1)
  WHERE user_id = _user_id;

  UPDATE user_credits
  SET balance = balance + _credits_gain
  WHERE user_id = _user_id;

  INSERT INTO credit_transactions (user_id, amount, action, description)
  VALUES (_user_id, _credits_gain, 'xp_conversion',
          'Convertiti ' || _xp_cost || ' XP in ' || _credits_gain || ' NeuroCredits');

  INSERT INTO xp_log (user_id, source, xp_amount)
  VALUES (_user_id, 'xp_to_credits', -_xp_cost);

  RETURN jsonb_build_object('success', true, 'credits_added', _credits_gain);
END;
$$;

GRANT EXECUTE ON FUNCTION public.convert_xp_to_credits(UUID, INTEGER, INTEGER) TO authenticated;

-- ── 8. Atomic claim_weekly_challenge RPC ──
CREATE OR REPLACE FUNCTION public.claim_weekly_challenge(
  _user_id     UUID,
  _challenge_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_progress  user_challenge_progress%ROWTYPE;
  v_challenge weekly_challenges%ROWTYPE;
  v_new_xp    INTEGER;
  v_new_level INTEGER;
BEGIN
  SELECT * INTO v_challenge FROM weekly_challenges WHERE id = _challenge_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'challenge_not_found');
  END IF;

  SELECT * INTO v_progress
  FROM user_challenge_progress
  WHERE user_id = _user_id AND challenge_id = _challenge_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_progress');
  END IF;

  IF NOT v_progress.completed THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_completed');
  END IF;

  IF v_progress.reward_claimed THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_claimed');
  END IF;

  -- Mark claimed
  UPDATE user_challenge_progress
  SET reward_claimed = true
  WHERE user_id = _user_id AND challenge_id = _challenge_id;

  -- Award XP
  UPDATE user_xp
  SET total_xp = total_xp + v_challenge.xp_reward,
      level    = GREATEST(1, floor((total_xp + v_challenge.xp_reward) / 500) + 1)
  WHERE user_id = _user_id
  RETURNING total_xp, level INTO v_new_xp, v_new_level;

  INSERT INTO xp_log (user_id, source, xp_amount)
  VALUES (_user_id, 'weekly_challenge', v_challenge.xp_reward);

  RETURN jsonb_build_object(
    'success',    true,
    'xp_awarded', v_challenge.xp_reward,
    'new_xp',     v_new_xp,
    'new_level',  v_new_level
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_weekly_challenge(UUID, UUID) TO authenticated;

-- ── 9. Atomic update_daily_streak RPC ──
CREATE OR REPLACE FUNCTION public.update_daily_streak(_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile    profiles%ROWTYPE;
  v_freeze     user_powerups%ROWTYPE;
  v_today      DATE := CURRENT_DATE;
  v_yesterday  DATE := CURRENT_DATE - 1;
  v_new_streak INTEGER;
BEGIN
  SELECT * INTO v_profile
  FROM profiles WHERE user_id = _user_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('changed', false, 'reason', 'no_profile');
  END IF;

  -- Already updated today
  IF v_profile.last_active_date = v_today THEN
    RETURN jsonb_build_object('changed', false, 'streak', v_profile.streak_count);
  END IF;

  IF v_profile.last_active_date = v_yesterday THEN
    -- Consecutive day: increment
    v_new_streak := COALESCE(v_profile.streak_count, 0) + 1;
  ELSE
    -- Gap: check streak_freeze power-up
    SELECT * INTO v_freeze
    FROM user_powerups
    WHERE user_id = _user_id AND powerup_type = 'streak_freeze' AND quantity > 0
    FOR UPDATE;

    IF FOUND THEN
      -- Consume one freeze, keep streak
      UPDATE user_powerups
        SET quantity = quantity - 1
        WHERE user_id = _user_id AND powerup_type = 'streak_freeze';
      v_new_streak := COALESCE(v_profile.streak_count, 0);
    ELSE
      -- Reset streak to 0; set to 1 after this active day below
      v_new_streak := 0;
    END IF;
  END IF;

  -- This day counts as active: ensure streak >= 1
  v_new_streak := GREATEST(1, v_new_streak);

  UPDATE profiles
  SET streak_count     = v_new_streak,
      last_active_date = v_today
  WHERE user_id = _user_id;

  RETURN jsonb_build_object('changed', true, 'streak', v_new_streak);
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_daily_streak(UUID) TO authenticated;

-- ── 10. get_due_counts_by_deck RPC ──
CREATE OR REPLACE FUNCTION public.get_due_counts_by_deck(_user_id UUID)
RETURNS TABLE (deck_id UUID, due_count INTEGER)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT f.deck_id, COUNT(*)::INTEGER AS due_count
  FROM flashcards f
  JOIN flashcard_decks fd ON fd.id = f.deck_id
  WHERE fd.user_id = _user_id
    AND (f.next_review_at IS NULL OR f.next_review_at <= now())
  GROUP BY f.deck_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_due_counts_by_deck(UUID) TO authenticated;

-- ── 11. Fortune wheel: server-side spin RPC ──
CREATE OR REPLACE FUNCTION public.fortune_wheel_spin(_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today      DATE := CURRENT_DATE;
  v_already    BOOLEAN;
  v_roll       FLOAT;
  v_prize_idx  INTEGER;
  v_prize_type TEXT;
  v_prize_val  INTEGER;
  v_prize_id   TEXT;
BEGIN
  -- Check if already spun today (using DB date, no client timezone tricks)
  SELECT EXISTS(
    SELECT 1 FROM fortune_wheel_spins
    WHERE user_id = _user_id AND spin_date = v_today
  ) INTO v_already;

  -- Also allow if user has a fortune_respin powerup
  IF v_already THEN
    DECLARE
      v_respin_qty INTEGER;
    BEGIN
      SELECT COALESCE(quantity, 0) INTO v_respin_qty
      FROM user_powerups WHERE user_id = _user_id AND powerup_type = 'fortune_respin';

      IF COALESCE(v_respin_qty, 0) > 0 THEN
        -- Consume the respin
        UPDATE user_powerups SET quantity = quantity - 1
        WHERE user_id = _user_id AND powerup_type = 'fortune_respin';
      ELSE
        RETURN jsonb_build_object('success', false, 'error', 'already_spun');
      END IF;
    END;
  END IF;

  -- Server-side weighted random prize selection
  v_roll := random();
  IF    v_roll < 0.0625 THEN v_prize_idx := 6; v_prize_id := 'badge';       v_prize_type := 'badge';   v_prize_val := 0;
  ELSIF v_roll < 0.125  THEN v_prize_idx := 4; v_prize_id := 'credits_200'; v_prize_type := 'credits'; v_prize_val := 200;
  ELSIF v_roll < 0.25   THEN v_prize_idx := 5; v_prize_id := 'xp_500';      v_prize_type := 'xp';      v_prize_val := 500;
  ELSIF v_roll < 0.375  THEN v_prize_idx := 2; v_prize_id := 'credits_100'; v_prize_type := 'credits'; v_prize_val := 100;
  ELSIF v_roll < 0.5    THEN v_prize_idx := 1; v_prize_id := 'xp_200';      v_prize_type := 'xp';      v_prize_val := 200;
  ELSIF v_roll < 0.625  THEN v_prize_idx := 3; v_prize_id := 'retry';       v_prize_type := 'retry';   v_prize_val := 0;
  ELSE                       v_prize_idx := 0; v_prize_id := 'credits_50';  v_prize_type := 'credits'; v_prize_val := 50;
  END IF;

  -- Record the spin
  INSERT INTO fortune_wheel_spins (user_id, prize_type, prize_value, spin_date)
  VALUES (_user_id, v_prize_type, v_prize_val::TEXT, v_today);

  -- Apply prize immediately server-side
  IF v_prize_type = 'credits' AND v_prize_val > 0 THEN
    UPDATE user_credits SET balance = balance + v_prize_val WHERE user_id = _user_id;
    INSERT INTO credit_transactions (user_id, amount, action, description)
    VALUES (_user_id, v_prize_val, 'fortune_wheel',
            '+' || v_prize_val || ' NeuroCredits dalla Ruota della Fortuna');
  ELSIF v_prize_type = 'xp' AND v_prize_val > 0 THEN
    UPDATE user_xp
    SET total_xp = total_xp + v_prize_val,
        level    = GREATEST(1, floor((total_xp + v_prize_val) / 500) + 1)
    WHERE user_id = _user_id;
    INSERT INTO xp_log (user_id, source, xp_amount)
    VALUES (_user_id, 'fortune_wheel', v_prize_val);
  ELSIF v_prize_type = 'badge' THEN
    -- award_achievement handles duplicates internally
    PERFORM award_achievement(_user_id, 'fortune_winner');
  END IF;

  RETURN jsonb_build_object(
    'success',    true,
    'prize_idx',  v_prize_idx,
    'prize_id',   v_prize_id,
    'prize_type', v_prize_type,
    'prize_val',  v_prize_val
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fortune_wheel_spin(UUID) TO authenticated;

-- ── 12. Add xp_conversion to allowed add-credits actions (handled in edge fn) ──
-- (No DB change needed — handled in add-credits edge function whitelist update)

-- ── 13. Add index for generation_rate_limits cleanup ──
CREATE INDEX IF NOT EXISTS idx_gen_rate_limits_window
  ON public.generation_rate_limits (user_id, window_start);

-- ── 14. Add missing indexes ──
CREATE INDEX IF NOT EXISTS idx_quiz_questions_quiz_id
  ON public.quiz_questions (quiz_id);

CREATE INDEX IF NOT EXISTS idx_flashcards_deck_id
  ON public.flashcards (deck_id);

CREATE INDEX IF NOT EXISTS idx_credit_tx_user_date
  ON public.credit_transactions (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_gen_jobs_user_status
  ON public.generation_jobs (user_id, status);

-- ── 15. Atomic apply_referral_code_atomic RPC ──
CREATE OR REPLACE FUNCTION public.apply_referral_code_atomic(
  _code    TEXT,
  _user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_referral referral_codes%ROWTYPE;
BEGIN
  -- Lock the referral code row to prevent concurrent use
  SELECT * INTO v_referral
  FROM referral_codes
  WHERE code = _code
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;

  IF v_referral.user_id = _user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'self_use');
  END IF;

  IF v_referral.times_used >= v_referral.max_uses THEN
    RETURN jsonb_build_object('success', false, 'error', 'exhausted');
  END IF;

  -- Check if user already used a referral
  IF EXISTS (SELECT 1 FROM referral_uses WHERE referred_user_id = _user_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_used');
  END IF;

  -- Atomically increment usage
  UPDATE referral_codes SET times_used = times_used + 1 WHERE id = v_referral.id;

  -- Record the use
  INSERT INTO referral_uses (referral_code_id, referred_user_id, referrer_user_id, discount_applied)
  VALUES (v_referral.id, _user_id, v_referral.user_id, v_referral.discount_percent);

  -- Give 5 bonus credits to both users atomically
  UPDATE user_credits SET balance = balance + 5 WHERE user_id = _user_id;
  UPDATE user_credits SET balance = balance + 5 WHERE user_id = v_referral.user_id;

  INSERT INTO credit_transactions (user_id, amount, action, description)
  VALUES (_user_id, 5, 'referral_bonus', 'Bonus per utilizzo codice referral');

  INSERT INTO credit_transactions (user_id, amount, action, description)
  VALUES (v_referral.user_id, 5, 'referral_bonus', 'Bonus per invito amico');

  RETURN jsonb_build_object(
    'success',  true,
    'discount', v_referral.discount_percent
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_referral_code_atomic(TEXT, UUID) TO authenticated;

-- ─── Admin RLS: allow users with role='admin' to delete any user's data ────────
-- This is needed for the Admin panel deleteUser function to work
-- The deleteUser in Admin.tsx uses the client (anon key) not service role

CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = auth.uid() AND role = 'admin'
  );
$$;

-- Allow admins to read all profiles (already needed for Admin tab)
DROP POLICY IF EXISTS "admin_read_profiles" ON profiles;
CREATE POLICY "admin_read_profiles" ON profiles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR is_admin());

-- Allow admins to delete any user's data across key tables
-- (for deleteUser function in Admin page)
CREATE POLICY "admin_delete_profiles" ON profiles
  FOR DELETE TO authenticated
  USING (is_admin());

CREATE POLICY "admin_delete_subscriptions" ON subscriptions
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR is_admin());

CREATE POLICY "admin_delete_user_credits" ON user_credits
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR is_admin());

-- Note: tables like quizzes, flashcard_decks, tasks already have
-- user_id = auth.uid() RLS — admin delete goes through service role
-- in production. For client-side admin delete, RLS must also allow admins.
