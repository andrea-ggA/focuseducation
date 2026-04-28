-- Cross-flow hardening

-- 1) Prevent duplicate XP awards in concurrent/multi-tab flows.
CREATE UNIQUE INDEX IF NOT EXISTS xp_log_user_source_source_id_uniq
  ON public.xp_log(user_id, source, source_id)
  WHERE source_id IS NOT NULL;

-- 2) Atomic increment for daily objectives question counter.
CREATE OR REPLACE FUNCTION public.increment_daily_questions_completed(
  _user_id uuid,
  _objective_date date
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.daily_objectives (user_id, objective_date, target_questions, target_focus_minutes, questions_completed, focus_completed)
  VALUES (_user_id, _objective_date, 20, 30, 1, 0)
  ON CONFLICT (user_id, objective_date)
  DO UPDATE SET questions_completed = public.daily_objectives.questions_completed + 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_daily_questions_completed(uuid, date) TO authenticated;

-- 3) Streak update can receive client-local date to avoid UTC day-boundary drift.
CREATE OR REPLACE FUNCTION public.update_daily_streak(_user_id uuid, _today date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_last_active date;
  v_streak integer;
  v_today date := COALESCE(_today, (now() AT TIME ZONE 'UTC')::date);
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

GRANT EXECUTE ON FUNCTION public.update_daily_streak(uuid, date) TO authenticated;
