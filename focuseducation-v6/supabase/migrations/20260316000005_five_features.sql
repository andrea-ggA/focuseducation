-- ═══════════════════════════════════════════════════════════════════
-- Migration: 5 new features
-- 1. Referral rewards tracking
-- 2. Trial period support
-- 3. Focus Burst sessions
-- 4. Crisis mode sessions
-- 5. Smart paywall context
-- ═══════════════════════════════════════════════════════════════════

-- 1. Track referral rewards earned
ALTER TABLE public.referral_codes
  ADD COLUMN IF NOT EXISTS credits_earned  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS friends_joined  INTEGER NOT NULL DEFAULT 0;

-- 2. Trial period: add trial_end_at to subscriptions
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS trial_end_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_trial     BOOLEAN NOT NULL DEFAULT false;

-- 3. Focus Burst sessions log
CREATE TABLE IF NOT EXISTS public.focus_burst_sessions (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cards_reviewed INTEGER     NOT NULL DEFAULT 0,
  questions_answered INTEGER NOT NULL DEFAULT 0,
  duration_seconds INTEGER   NOT NULL DEFAULT 0,
  completed     BOOLEAN     NOT NULL DEFAULT false,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.focus_burst_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can CRUD own burst sessions"
  ON public.focus_burst_sessions FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 4. Crisis mode sessions
CREATE TABLE IF NOT EXISTS public.crisis_sessions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  exam_subject    TEXT,
  hours_available INTEGER     NOT NULL DEFAULT 48,
  plan_content    JSONB       NOT NULL DEFAULT '{}',
  completed_steps INTEGER     NOT NULL DEFAULT 0,
  total_steps     INTEGER     NOT NULL DEFAULT 0,
  activated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '48 hours')
);
ALTER TABLE public.crisis_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can CRUD own crisis sessions"
  ON public.crisis_sessions FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Function to activate trial for a user (called from Edge Function or admin)
CREATE OR REPLACE FUNCTION public.activate_trial(
  _user_id UUID,
  _plan_name TEXT DEFAULT 'Hyperfocus Master',
  _days INTEGER DEFAULT 7
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only activate if no active subscription or trial exists
  IF EXISTS (
    SELECT 1 FROM subscriptions
    WHERE user_id = _user_id
      AND status IN ('active', 'trialing')
      AND (trial_end_at IS NULL OR trial_end_at > now())
  ) THEN
    RETURN FALSE;
  END IF;

  INSERT INTO subscriptions (user_id, plan_name, status, is_trial, trial_end_at,
                              current_period_start, current_period_end)
  VALUES (_user_id, _plan_name, 'trialing', true,
          now() + (_days || ' days')::INTERVAL,
          now(),
          now() + (_days || ' days')::INTERVAL)
  ON CONFLICT DO NOTHING;

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.activate_trial(UUID, TEXT, INTEGER) TO authenticated;
