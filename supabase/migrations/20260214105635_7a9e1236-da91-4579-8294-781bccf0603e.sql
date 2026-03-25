
-- Fix 1: Remove overly permissive profile policy that exposes sensitive data (adhd_traits, goals, etc.)
DROP POLICY IF EXISTS "Authenticated can view profiles for leaderboard" ON public.profiles;

-- Recreate leaderboard_view as a standard view (NOT security_invoker) 
-- so it runs as the view owner and doesn't need public SELECT on underlying tables
DROP VIEW IF EXISTS public.leaderboard_view;
CREATE VIEW public.leaderboard_view AS
SELECT 
  p.user_id,
  p.full_name,
  p.avatar_url,
  p.streak_count,
  COALESCE(x.total_xp, 0) as total_xp,
  COALESCE(x.level, 1) as level,
  COALESCE(x.quizzes_completed, 0) as quizzes_completed,
  COALESCE(x.current_streak, 0) as current_streak
FROM public.profiles p
LEFT JOIN public.user_xp x ON p.user_id = x.user_id;

GRANT SELECT ON public.leaderboard_view TO authenticated;

-- Remove overly permissive XP policy
DROP POLICY IF EXISTS "Authenticated can view XP for leaderboard" ON public.user_xp;

-- Fix 2: Add CHECK constraints on gamification tables (with values matching existing data)
ALTER TABLE public.user_xp ADD CONSTRAINT xp_non_negative CHECK (total_xp >= 0 AND total_xp <= 10000000);
ALTER TABLE public.user_xp ADD CONSTRAINT level_reasonable CHECK (level >= 1 AND level <= 200);
ALTER TABLE public.user_xp ADD CONSTRAINT streak_non_negative CHECK (current_streak >= 0);
ALTER TABLE public.user_xp ADD CONSTRAINT quizzes_non_negative CHECK (quizzes_completed >= 0);
ALTER TABLE public.user_xp ADD CONSTRAINT perfect_non_negative CHECK (perfect_scores >= 0);

-- xp_log: allow negative for deductions, but cap magnitude
ALTER TABLE public.xp_log ADD CONSTRAINT xp_amount_reasonable CHECK (xp_amount >= -10000 AND xp_amount <= 10000 AND xp_amount != 0);

ALTER TABLE public.powerup_purchases ADD CONSTRAINT xp_cost_positive CHECK (xp_cost > 0 AND xp_cost <= 100000);
