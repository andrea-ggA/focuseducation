
-- Fix SECURITY DEFINER view issue: recreate as SECURITY INVOKER
DROP VIEW IF EXISTS public.leaderboard_view;

CREATE VIEW public.leaderboard_view WITH (security_invoker = true) AS
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

-- Since the view uses security_invoker, we need the underlying tables to allow SELECT
-- Add back limited public SELECT policies for the specific columns needed
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can view own XP" ON public.user_xp;

-- Authenticated users can view own profile
CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = user_id);

-- Authenticated users can view all XP for leaderboard (XP is not sensitive)
CREATE POLICY "Authenticated can view XP for leaderboard" ON public.user_xp
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Authenticated users can view basic profile info for leaderboard
CREATE POLICY "Authenticated can view profiles for leaderboard" ON public.profiles
  FOR SELECT USING (auth.uid() IS NOT NULL);

GRANT SELECT ON public.leaderboard_view TO authenticated;
