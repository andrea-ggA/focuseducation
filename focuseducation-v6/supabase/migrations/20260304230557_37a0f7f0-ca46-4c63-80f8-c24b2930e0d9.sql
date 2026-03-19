
-- Recreate leaderboard_view with security_invoker so RLS applies
DROP VIEW IF EXISTS public.leaderboard_view;

CREATE VIEW public.leaderboard_view
WITH (security_invoker = on) AS
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
LEFT JOIN user_xp x ON p.user_id = x.user_id;

-- Allow authenticated users to read profiles for leaderboard
CREATE POLICY "Authenticated users can view profiles for leaderboard"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (true);

-- Allow authenticated users to read user_xp for leaderboard
CREATE POLICY "Authenticated users can view all XP for leaderboard"
  ON public.user_xp
  FOR SELECT
  TO authenticated
  USING (true);
