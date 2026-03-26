
-- 1) update_daily_streak: atomically updates streak on daily login
CREATE OR REPLACE FUNCTION public.update_daily_streak(_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_last_active date;
  v_streak integer;
  v_today date := current_date;
  v_shield boolean;
BEGIN
  SELECT last_active_date::date, streak_count, streak_shield_active
    INTO v_last_active, v_streak, v_shield
    FROM profiles
   WHERE user_id = _user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('streak', 0, 'updated', false);
  END IF;

  -- Already visited today
  IF v_last_active = v_today THEN
    RETURN jsonb_build_object('streak', v_streak, 'updated', false);
  END IF;

  IF v_last_active = v_today - 1 THEN
    -- Consecutive day
    v_streak := v_streak + 1;
  ELSIF v_last_active = v_today - 2 AND v_shield THEN
    -- Missed 1 day but shield active
    v_streak := v_streak + 1;
    UPDATE profiles SET streak_shield_active = false WHERE user_id = _user_id;
  ELSE
    -- Streak broken
    v_streak := 1;
  END IF;

  UPDATE profiles
     SET streak_count = v_streak,
         last_active_date = v_today::text,
         updated_at = now()
   WHERE user_id = _user_id;

  RETURN jsonb_build_object('streak', v_streak, 'updated', true);
END;
$$;

-- 2) fortune_wheel_spin: atomically picks prize and awards it
CREATE OR REPLACE FUNCTION public.fortune_wheel_spin(_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_today date := current_date;
  v_has_respin boolean := false;
  v_prize_idx integer;
  v_prize_type text;
  v_prize_value integer;
  v_prize_label text;
BEGIN
  -- Check if already spun today
  IF EXISTS (SELECT 1 FROM fortune_wheel_spins WHERE user_id = _user_id AND spin_date = v_today) THEN
    -- Check for respin powerup
    IF EXISTS (SELECT 1 FROM user_powerups WHERE user_id = _user_id AND powerup_type = 'fortune_respin' AND quantity > 0) THEN
      UPDATE user_powerups SET quantity = quantity - 1, updated_at = now()
       WHERE user_id = _user_id AND powerup_type = 'fortune_respin';
      v_has_respin := true;
    ELSE
      RETURN jsonb_build_object('success', false, 'error', 'already_spun');
    END IF;
  END IF;

  -- Pick random prize (8 slices, weighted by index)
  v_prize_idx := floor(random() * 8)::integer;

  -- Map index to prize
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

  -- Record spin
  INSERT INTO fortune_wheel_spins (user_id, spin_date, prize_type, prize_value)
  VALUES (_user_id, v_today, v_prize_type, v_prize_label);

  -- Award prize
  IF v_prize_type = 'credits' AND v_prize_value > 0 THEN
    UPDATE user_credits SET balance = balance + v_prize_value, updated_at = now()
     WHERE user_id = _user_id;
    INSERT INTO credit_transactions (user_id, amount, action, description)
    VALUES (_user_id, v_prize_value, 'fortune_wheel', 'Ruota della Fortuna: ' || v_prize_label);
  ELSIF v_prize_type = 'xp' AND v_prize_value > 0 THEN
    UPDATE user_xp SET total_xp = total_xp + v_prize_value, updated_at = now()
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
