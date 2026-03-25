-- Fix: set view security to invoker (default, respects RLS of querying user)
ALTER VIEW public.leaderboard_view SET (security_invoker = on);