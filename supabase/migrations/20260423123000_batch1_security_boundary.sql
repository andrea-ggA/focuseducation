-- Batch 1: security boundary hardening
-- Goals:
-- 1) Stop trusting caller-supplied user ids inside SECURITY DEFINER functions.
-- 2) Validate client-local date hints before using them.

CREATE OR REPLACE FUNCTION public.count_due_cards(_user_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(f.id)::INTEGER
  FROM flashcards f
  JOIN flashcard_decks fd ON fd.id = f.deck_id
  WHERE auth.uid() IS NOT NULL
    AND fd.user_id = auth.uid()
    AND (f.next_review_at IS NULL OR f.next_review_at <= now());
$$;

GRANT EXECUTE ON FUNCTION public.count_due_cards(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_due_cards(
  _user_id UUID,
  _limit   INTEGER DEFAULT 20
)
RETURNS TABLE (
  id              UUID,
  front           TEXT,
  back            TEXT,
  topic           TEXT,
  mastery_level   INTEGER,
  easiness_factor FLOAT,
  next_review_at  TIMESTAMPTZ,
  deck_id         UUID,
  deck_title      TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    f.id, f.front, f.back, f.topic,
    f.mastery_level, f.easiness_factor, f.next_review_at,
    f.deck_id, fd.title AS deck_title
  FROM flashcards f
  JOIN flashcard_decks fd ON fd.id = f.deck_id
  WHERE auth.uid() IS NOT NULL
    AND fd.user_id = auth.uid()
    AND (f.next_review_at IS NULL OR f.next_review_at <= now())
  ORDER BY f.easiness_factor ASC NULLS LAST, f.next_review_at ASC NULLS FIRST
  LIMIT GREATEST(COALESCE(_limit, 20), 1);
$$;

GRANT EXECUTE ON FUNCTION public.get_due_cards(UUID, INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.increment_daily_questions_completed(
  _user_id uuid,
  _objective_date date
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_utc_today date := (now() AT TIME ZONE 'UTC')::date;
  v_objective_date date := COALESCE(_objective_date, v_utc_today);
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Accept only a narrow client-local window to avoid arbitrary backfilling.
  IF v_objective_date < v_utc_today - 1 OR v_objective_date > v_utc_today + 1 THEN
    v_objective_date := v_utc_today;
  END IF;

  INSERT INTO public.daily_objectives (user_id, objective_date, target_questions, target_focus_minutes, questions_completed, focus_completed)
  VALUES (v_user_id, v_objective_date, 20, 30, 1, 0)
  ON CONFLICT (user_id, objective_date)
  DO UPDATE SET questions_completed = public.daily_objectives.questions_completed + 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_daily_questions_completed(uuid, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_daily_streak(_user_id uuid, _today date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_last_active date;
  v_streak integer;
  v_utc_today date := (now() AT TIME ZONE 'UTC')::date;
  v_today date := COALESCE(_today, v_utc_today);
  v_used_freeze boolean := false;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Only accept a near-current local-day hint from the client.
  IF v_today < v_utc_today - 1 OR v_today > v_utc_today + 1 THEN
    v_today := v_utc_today;
  END IF;

  SELECT last_active_date::date, streak_count
    INTO v_last_active, v_streak
    FROM profiles
   WHERE user_id = v_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('streak', 0, 'updated', false, 'used_freeze', false);
  END IF;

  IF v_last_active = v_today THEN
    RETURN jsonb_build_object('streak', v_streak, 'updated', false, 'used_freeze', false);
  END IF;

  IF v_last_active = v_today - 1 THEN
    v_streak := v_streak + 1;
  ELSIF v_last_active = v_today - 2 THEN
    UPDATE user_powerups
       SET quantity = quantity - 1,
           updated_at = now()
     WHERE user_id = v_user_id
       AND powerup_type = 'streak_freeze'
       AND quantity > 0;

    IF FOUND THEN
      v_streak := v_streak + 1;
      v_used_freeze := true;
    ELSE
      UPDATE profiles
         SET streak_shield_active = false
       WHERE user_id = v_user_id
         AND streak_shield_active = true;
      IF FOUND THEN
        v_streak := v_streak + 1;
        v_used_freeze := true;
      ELSE
        v_streak := 1;
      END IF;
    END IF;
  ELSE
    v_streak := 1;
  END IF;

  UPDATE profiles
     SET streak_count = v_streak,
         last_active_date = v_today,
         updated_at = now()
   WHERE user_id = v_user_id;

  RETURN jsonb_build_object('streak', v_streak, 'updated', true, 'used_freeze', v_used_freeze);
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_daily_streak(uuid, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.fortune_wheel_spin(_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id     UUID := auth.uid();
  v_today       DATE := current_date;
  v_has_respin  BOOLEAN := false;
  v_prize_idx   INTEGER;
  v_prize_type  TEXT;
  v_prize_value INTEGER;
  v_prize_label TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  PERFORM 1 FROM user_credits WHERE user_id = v_user_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO user_credits (user_id) VALUES (v_user_id);
  END IF;

  IF EXISTS (
    SELECT 1 FROM fortune_wheel_spins
    WHERE user_id = v_user_id AND spin_date = v_today
  ) THEN
    IF EXISTS (
      SELECT 1 FROM user_powerups
      WHERE user_id = v_user_id AND powerup_type = 'fortune_respin' AND quantity > 0
    ) THEN
      UPDATE user_powerups
      SET quantity = quantity - 1, updated_at = now()
      WHERE user_id = v_user_id AND powerup_type = 'fortune_respin';
      v_has_respin := true;
    ELSE
      RETURN jsonb_build_object('success', false, 'error', 'already_spun');
    END IF;
  END IF;

  v_prize_idx := floor(random() * 8)::integer;

  CASE v_prize_idx
    WHEN 0 THEN v_prize_type := 'credits'; v_prize_value := 50;  v_prize_label := '+50 Crediti';
    WHEN 1 THEN v_prize_type := 'xp';      v_prize_value := 200; v_prize_label := '+200 XP';
    WHEN 2 THEN v_prize_type := 'credits'; v_prize_value := 100; v_prize_label := '+100 Crediti';
    WHEN 3 THEN v_prize_type := 'retry';   v_prize_value := 0;   v_prize_label := 'Riprova!';
    WHEN 4 THEN v_prize_type := 'credits'; v_prize_value := 200; v_prize_label := '+200 Crediti';
    WHEN 5 THEN v_prize_type := 'xp';      v_prize_value := 500; v_prize_label := '+500 XP';
    WHEN 6 THEN v_prize_type := 'badge';   v_prize_value := 0;   v_prize_label := 'Badge Raro!';
    WHEN 7 THEN v_prize_type := 'credits'; v_prize_value := 50;  v_prize_label := '+50 Crediti';
  END CASE;

  INSERT INTO fortune_wheel_spins (user_id, spin_date, prize_type, prize_value)
  VALUES (v_user_id, v_today, v_prize_type, v_prize_label);

  IF v_prize_type = 'credits' AND v_prize_value > 0 THEN
    UPDATE user_credits SET balance = balance + v_prize_value, updated_at = now()
    WHERE user_id = v_user_id;
    INSERT INTO credit_transactions (user_id, amount, action, description)
    VALUES (v_user_id, v_prize_value, 'fortune_wheel', 'Ruota della Fortuna: ' || v_prize_label);
  ELSIF v_prize_type = 'xp' AND v_prize_value > 0 THEN
    UPDATE user_xp
    SET total_xp = total_xp + v_prize_value,
        level    = public.xp_to_level(total_xp + v_prize_value),
        updated_at = now()
    WHERE user_id = v_user_id;
    INSERT INTO xp_log (user_id, xp_amount, source)
    VALUES (v_user_id, v_prize_value, 'fortune_wheel');
  ELSIF v_prize_type = 'badge' THEN
    PERFORM award_achievement(v_user_id, 'fortune_winner');
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'prize_idx', v_prize_idx,
    'prize_type', v_prize_type,
    'prize_value', v_prize_value,
    'prize_label', v_prize_label,
    'used_respin', v_has_respin
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fortune_wheel_spin(UUID) TO authenticated;
