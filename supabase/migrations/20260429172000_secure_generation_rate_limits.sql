ALTER TABLE public.generation_rate_limits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role can manage generation rate limits"
ON public.generation_rate_limits;

CREATE POLICY "Service role can manage generation rate limits"
ON public.generation_rate_limits
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');
