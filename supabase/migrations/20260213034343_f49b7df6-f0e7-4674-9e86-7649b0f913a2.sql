
-- 1. Create a secure leaderboard view exposing ONLY non-sensitive data
CREATE OR REPLACE VIEW public.leaderboard_view AS
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

-- 2. Drop overly permissive policies
DROP POLICY IF EXISTS "Anyone can view profiles for leaderboard" ON public.profiles;
DROP POLICY IF EXISTS "Anyone can view XP for leaderboard" ON public.user_xp;

-- 3. Restore owner-only profile SELECT (keep admin policy)
CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = user_id);

-- 4. Restore owner-only XP SELECT
CREATE POLICY "Users can view own XP" ON public.user_xp
  FOR SELECT USING (auth.uid() = user_id);

-- 5. Grant access to the leaderboard view for authenticated users
GRANT SELECT ON public.leaderboard_view TO authenticated;
GRANT SELECT ON public.leaderboard_view TO anon;
