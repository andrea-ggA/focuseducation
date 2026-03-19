
-- Add energy_level column to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS energy_level TEXT NOT NULL DEFAULT 'balanced';

-- Add xp_bet column to quiz_attempts
ALTER TABLE public.quiz_attempts ADD COLUMN IF NOT EXISTS xp_bet INTEGER DEFAULT NULL;
