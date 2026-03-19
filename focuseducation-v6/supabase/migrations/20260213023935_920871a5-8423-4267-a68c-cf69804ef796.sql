
-- Allow all authenticated users to view leaderboard data (XP and names)
CREATE POLICY "Anyone can view XP for leaderboard"
ON public.user_xp
FOR SELECT
USING (true);

CREATE POLICY "Anyone can view profiles for leaderboard"
ON public.profiles
FOR SELECT
USING (true);

-- Drop the old restrictive policies that are now redundant
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
