-- Add leaderboard visibility column to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS leaderboard_visible boolean NOT NULL DEFAULT true;

-- Recreate leaderboard_view to filter out opted-out users
CREATE OR REPLACE VIEW public.leaderboard_view AS
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