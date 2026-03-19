-- Security fix: prevent users from self-awarding badges they haven't earned.
-- The old policy allowed INSERT with only auth.uid() = user_id check,
-- meaning any authenticated user could grant themselves any badge from DevTools.

-- Remove permissive insert policy
DROP POLICY IF EXISTS "Users can insert own achievements" ON public.achievements;

-- New server-side validation function (SECURITY DEFINER bypasses RLS to read other tables)
CREATE OR REPLACE FUNCTION public.award_achievement(
  _user_id         UUID,
  _achievement_type TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_xp      user_xp%ROWTYPE;
  v_profile profiles%ROWTYPE;
BEGIN
  -- Prevent duplicate badges
  IF EXISTS (
    SELECT 1 FROM achievements
    WHERE user_id = _user_id AND achievement_type = _achievement_type
  ) THEN
    RETURN FALSE;
  END IF;

  SELECT * INTO v_xp      FROM user_xp   WHERE user_id = _user_id;
  SELECT * INTO v_profile FROM profiles  WHERE user_id = _user_id;

  CASE _achievement_type
    WHEN 'first_quiz'     THEN IF COALESCE(v_xp.quizzes_completed, 0)  < 1  THEN RETURN FALSE; END IF;
    WHEN 'quiz_5'         THEN IF COALESCE(v_xp.quizzes_completed, 0)  < 5  THEN RETURN FALSE; END IF;
    WHEN 'quiz_20'        THEN IF COALESCE(v_xp.quizzes_completed, 0)  < 20 THEN RETURN FALSE; END IF;
    WHEN 'perfect_score'  THEN IF COALESCE(v_xp.perfect_scores, 0)     < 1  THEN RETURN FALSE; END IF;
    WHEN 'perfect_5'      THEN IF COALESCE(v_xp.perfect_scores, 0)     < 5  THEN RETURN FALSE; END IF;
    WHEN 'streak_3'       THEN IF COALESCE(v_profile.streak_count, 0)  < 3  THEN RETURN FALSE; END IF;
    WHEN 'streak_7'       THEN IF COALESCE(v_profile.streak_count, 0)  < 7  THEN RETURN FALSE; END IF;
    WHEN 'streak_30'      THEN IF COALESCE(v_profile.streak_count, 0)  < 30 THEN RETURN FALSE; END IF;
    WHEN 'level_5'        THEN IF COALESCE(v_xp.level, 1)              < 5  THEN RETURN FALSE; END IF;
    WHEN 'level_10'       THEN IF COALESCE(v_xp.level, 1)              < 10 THEN RETURN FALSE; END IF;
    -- Fortune wheel badges: conditions verified elsewhere, allow through
    WHEN 'streak_shield', 'fortune_winner', 'rare_collector', 'focus_60', 'focus_300', 'tasks_10', 'tasks_50' THEN NULL;
    ELSE RETURN FALSE; -- unknown type: reject
  END CASE;

  INSERT INTO achievements (user_id, achievement_type)
  VALUES (_user_id, _achievement_type);

  RETURN TRUE;
END;
$$;

-- Only service_role (Edge Functions) can insert directly
CREATE POLICY "Service role insert achievements"
  ON public.achievements FOR INSERT
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
