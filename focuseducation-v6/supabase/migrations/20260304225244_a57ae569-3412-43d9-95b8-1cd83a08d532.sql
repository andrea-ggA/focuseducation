-- Add constraints using DO block to skip existing ones

DO $$ BEGIN
  -- user_xp constraints
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'level_reasonable') THEN
    ALTER TABLE public.user_xp ADD CONSTRAINT level_reasonable CHECK (level >= 1 AND level <= 200);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quizzes_non_negative') THEN
    ALTER TABLE public.user_xp ADD CONSTRAINT quizzes_non_negative CHECK (quizzes_completed >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'perfect_non_negative') THEN
    ALTER TABLE public.user_xp ADD CONSTRAINT perfect_non_negative CHECK (perfect_scores >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'streak_non_negative') THEN
    ALTER TABLE public.user_xp ADD CONSTRAINT streak_non_negative CHECK (current_streak >= 0);
  END IF;

  -- xp_log
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'xp_amount_reasonable') THEN
    ALTER TABLE public.xp_log ADD CONSTRAINT xp_amount_reasonable CHECK (xp_amount >= -5000 AND xp_amount <= 5000);
  END IF;

  -- quiz_attempts
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'score_non_negative') THEN
    ALTER TABLE public.quiz_attempts ADD CONSTRAINT score_non_negative CHECK (score >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'total_points_non_negative') THEN
    ALTER TABLE public.quiz_attempts ADD CONSTRAINT total_points_non_negative CHECK (total_points >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'correct_within_total') THEN
    ALTER TABLE public.quiz_attempts ADD CONSTRAINT correct_within_total CHECK (correct_answers >= 0 AND correct_answers <= total_answered);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'xp_earned_reasonable') THEN
    ALTER TABLE public.quiz_attempts ADD CONSTRAINT xp_earned_reasonable CHECK (xp_earned >= 0 AND xp_earned <= 5000);
  END IF;

  -- achievements
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'achievement_type_length') THEN
    ALTER TABLE public.achievements ADD CONSTRAINT achievement_type_length CHECK (char_length(achievement_type) <= 50);
  END IF;

  -- powerup_purchases
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'xp_cost_positive') THEN
    ALTER TABLE public.powerup_purchases ADD CONSTRAINT xp_cost_positive CHECK (xp_cost > 0 AND xp_cost <= 10000);
  END IF;
END $$;

-- Validation trigger for XP updates
CREATE OR REPLACE FUNCTION public.validate_xp_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD IS NOT NULL AND (NEW.total_xp - OLD.total_xp) > 5000 THEN
    RAISE EXCEPTION 'XP increase too large in single update';
  END IF;
  IF OLD IS NOT NULL AND (NEW.level - OLD.level) > 5 THEN
    RAISE EXCEPTION 'Level increase too large in single update';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_xp_before_update ON public.user_xp;
CREATE TRIGGER validate_xp_before_update
  BEFORE UPDATE ON public.user_xp
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_xp_update();