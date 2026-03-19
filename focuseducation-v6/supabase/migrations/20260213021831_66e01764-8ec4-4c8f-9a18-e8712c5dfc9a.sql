
-- Add source_reference column to quiz_questions for showing source text on wrong answers
ALTER TABLE public.quiz_questions ADD COLUMN IF NOT EXISTS source_reference text;

-- Add source_reference to flashcards too
ALTER TABLE public.flashcards ADD COLUMN IF NOT EXISTS source_reference text;
