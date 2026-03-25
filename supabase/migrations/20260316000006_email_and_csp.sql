-- ════════════════════════════════════════════════════════════════════
-- Migration 006 — Email transazionali & supporto cron trial
-- ════════════════════════════════════════════════════════════════════

-- Track which welcome emails have been sent (avoid duplicates)
CREATE TABLE IF NOT EXISTS public.email_log (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email_type   TEXT        NOT NULL,
  sent_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, email_type)   -- prevent sending same type twice
);

ALTER TABLE public.email_log ENABLE ROW LEVEL SECURITY;
-- Only service role can read/write (emails are internal)
CREATE POLICY "Service role only"
  ON public.email_log FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Index for fast lookups by user + type
CREATE INDEX IF NOT EXISTS idx_email_log_user
  ON public.email_log (user_id, email_type);

-- ── pg_cron setup instructions ───────────────────────────────────────
-- Enable pg_cron from: Supabase → Database → Extensions → pg_cron
-- Then run this in SQL Editor (replace YOUR_SERVICE_ROLE_KEY and PROJECT_REF):
--
-- SELECT cron.schedule(
--   'trial-expiry-daily',
--   '0 9 * * *',   -- every day at 9:00 UTC
--   $$
--     SELECT net.http_post(
--       url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/trial-expiry-check',
--       headers := '{"Authorization": "Bearer YOUR_SERVICE_ROLE_KEY", "Content-Type": "application/json"}',
--       body := '{}'
--     );
--   $$
-- );
