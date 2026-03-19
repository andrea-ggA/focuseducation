
-- Referral codes system
CREATE TABLE public.referral_codes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  code TEXT NOT NULL UNIQUE,
  discount_percent INTEGER NOT NULL DEFAULT 20,
  max_uses INTEGER NOT NULL DEFAULT 5,
  times_used INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.referral_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own referral codes"
ON public.referral_codes FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own referral codes"
ON public.referral_codes FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Referral usage tracking
CREATE TABLE public.referral_uses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  referral_code_id UUID NOT NULL REFERENCES public.referral_codes(id),
  referred_user_id UUID NOT NULL,
  referrer_user_id UUID NOT NULL,
  discount_applied INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.referral_uses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own referral uses as referrer"
ON public.referral_uses FOR SELECT
USING (auth.uid() = referrer_user_id);

CREATE POLICY "Users can insert referral uses"
ON public.referral_uses FOR INSERT
WITH CHECK (auth.uid() = referred_user_id);

-- Service role can update referral_codes (for incrementing times_used)
CREATE POLICY "Service role can update referral codes"
ON public.referral_codes FOR UPDATE
USING (auth.uid() = user_id);
