
-- Power-ups inventory table
CREATE TABLE public.user_powerups (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  powerup_type TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, powerup_type)
);

ALTER TABLE public.user_powerups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own powerups"
ON public.user_powerups FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own powerups"
ON public.user_powerups FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own powerups"
ON public.user_powerups FOR UPDATE
USING (auth.uid() = user_id);

-- Purchase log
CREATE TABLE public.powerup_purchases (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  powerup_type TEXT NOT NULL,
  xp_cost INTEGER NOT NULL,
  purchased_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.powerup_purchases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own purchases"
ON public.powerup_purchases FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own purchases"
ON public.powerup_purchases FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Add streak_shield_active to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS streak_shield_active BOOLEAN NOT NULL DEFAULT false;
