
CREATE OR REPLACE FUNCTION public.xp_to_level(_xp INTEGER)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT GREATEST(1, floor(_xp / 500)::INTEGER + 1);
$$;

COMMENT ON FUNCTION public.xp_to_level(INTEGER) IS
  'Centralized XP-to-level formula: GREATEST(1, floor(xp/500)+1).';

DROP POLICY IF EXISTS "Authenticated can view profiles for leaderboard" ON public.profiles;
DROP POLICY IF EXISTS "Authenticated can view all XP for leaderboard" ON public.user_xp;
DROP POLICY IF EXISTS "Authenticated users can view profiles for leaderboard" ON public.profiles;
DROP POLICY IF EXISTS "Authenticated users can view all XP for leaderboard" ON public.user_xp;
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can view own XP" ON public.user_xp;

CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can view own XP" ON public.user_xp
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP VIEW IF EXISTS public.leaderboard_view;

CREATE VIEW public.leaderboard_view
WITH (security_invoker = off)
AS
SELECT
  p.user_id,
  p.full_name,
  p.avatar_url,
  p.streak_count,
  COALESCE(x.total_xp, 0) AS total_xp,
  COALESCE(x.level, 1) AS level,
  COALESCE(x.quizzes_completed, 0) AS quizzes_completed,
  COALESCE(x.current_streak, 0) AS current_streak
FROM profiles p
LEFT JOIN user_xp x ON p.user_id = x.user_id
WHERE p.leaderboard_visible = true;

GRANT SELECT ON public.leaderboard_view TO authenticated;
GRANT SELECT ON public.leaderboard_view TO anon;

CREATE OR REPLACE FUNCTION public.fortune_wheel_spin(_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_today       DATE := current_date;
  v_has_respin  BOOLEAN := false;
  v_prize_idx   INTEGER;
  v_prize_type  TEXT;
  v_prize_value INTEGER;
  v_prize_label TEXT;
BEGIN
  PERFORM 1 FROM user_credits WHERE user_id = _user_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO user_credits (user_id) VALUES (_user_id);
  END IF;

  IF EXISTS (
    SELECT 1 FROM fortune_wheel_spins
    WHERE user_id = _user_id AND spin_date = v_today
  ) THEN
    IF EXISTS (
      SELECT 1 FROM user_powerups
      WHERE user_id = _user_id AND powerup_type = 'fortune_respin' AND quantity > 0
    ) THEN
      UPDATE user_powerups
      SET quantity = quantity - 1, updated_at = now()
      WHERE user_id = _user_id AND powerup_type = 'fortune_respin';
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
  VALUES (_user_id, v_today, v_prize_type, v_prize_label);

  IF v_prize_type = 'credits' AND v_prize_value > 0 THEN
    UPDATE user_credits SET balance = balance + v_prize_value, updated_at = now()
    WHERE user_id = _user_id;
    INSERT INTO credit_transactions (user_id, amount, action, description)
    VALUES (_user_id, v_prize_value, 'fortune_wheel', 'Ruota della Fortuna: ' || v_prize_label);
  ELSIF v_prize_type = 'xp' AND v_prize_value > 0 THEN
    UPDATE user_xp
    SET total_xp = total_xp + v_prize_value,
        level    = public.xp_to_level(total_xp + v_prize_value),
        updated_at = now()
    WHERE user_id = _user_id;
    INSERT INTO xp_log (user_id, xp_amount, source)
    VALUES (_user_id, v_prize_value, 'fortune_wheel');
  ELSIF v_prize_type = 'badge' THEN
    PERFORM award_achievement(_user_id, 'fortune_winner');
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

COMMENT ON FUNCTION public.fortune_wheel_spin(UUID) IS
  'Fix: acquires FOR UPDATE lock on user_credits before checking spin status. Uses centralized xp_to_level().';
