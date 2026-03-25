
-- Drop the overly permissive policy
DROP POLICY "Service role can manage all subscriptions" ON public.subscriptions;

-- Recreate with proper service role check
CREATE POLICY "Service role can manage all subscriptions"
  ON public.subscriptions FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
