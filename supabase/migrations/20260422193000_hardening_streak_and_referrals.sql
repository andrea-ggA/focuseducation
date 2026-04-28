-- Security hardening: tighten referral code read policy
DROP POLICY IF EXISTS "Anyone can look up referral codes by code" ON public.referral_codes;

CREATE POLICY "Users can view own referral codes"
ON public.referral_codes
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- Logic hardening: deterministic daily streak update + one-time freeze consumption
CREATE OR REPLACE FUNCTION public.update_daily_streak(_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_last_active date;
  v_streak integer;
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_used_freeze boolean := false;
BEGIN
  SELECT last_active_date::date, streak_count
    INTO v_last_active, v_streak
    FROM profiles
   WHERE user_id = _user_id
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
    -- First try consuming a stored freeze power-up (legacy + current flow compatibility)
    UPDATE user_powerups
       SET quantity = quantity - 1,
           updated_at = now()
     WHERE user_id = _user_id
       AND powerup_type = 'streak_freeze'
       AND quantity > 0;

    IF FOUND THEN
      v_streak := v_streak + 1;
      v_used_freeze := true;
    ELSE
      UPDATE profiles
         SET streak_shield_active = false
       WHERE user_id = _user_id
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
   WHERE user_id = _user_id;

  RETURN jsonb_build_object('streak', v_streak, 'updated', true, 'used_freeze', v_used_freeze);
END;
$$;
