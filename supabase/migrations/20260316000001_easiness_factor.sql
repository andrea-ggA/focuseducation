-- SM-2 fix: add easiness_factor column to flashcards
-- Previously the algorithm restarted from EF=2.5 on every review,
-- making hard cards converge to the same interval as easy ones.
ALTER TABLE public.flashcards
  ADD COLUMN IF NOT EXISTS easiness_factor FLOAT NOT NULL DEFAULT 2.5;

COMMENT ON COLUMN public.flashcards.easiness_factor IS
  'SM-2 easiness factor (1.3–4.0). Updated after each review. Default 2.5 per Wozniak 1987.';
