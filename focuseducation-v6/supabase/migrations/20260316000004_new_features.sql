-- Add exam tracking and study subject to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS exam_date       DATE,
  ADD COLUMN IF NOT EXISTS exam_subject    TEXT,
  ADD COLUMN IF NOT EXISTS study_subject   TEXT,
  ADD COLUMN IF NOT EXISTS weekly_goal_minutes INTEGER NOT NULL DEFAULT 120;

-- Flashcard review log: track each review outcome for analytics
CREATE TABLE IF NOT EXISTS public.flashcard_reviews (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  card_id     UUID    NOT NULL REFERENCES public.flashcards(id) ON DELETE CASCADE,
  deck_id     UUID    NOT NULL,
  quality     INTEGER NOT NULL,   -- 0,2,4,5
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.flashcard_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can CRUD own reviews" ON public.flashcard_reviews
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Quiz question feedback (thumbs up/down)
CREATE TABLE IF NOT EXISTS public.quiz_question_feedback (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  question_id UUID    NOT NULL REFERENCES public.quiz_questions(id) ON DELETE CASCADE,
  rating      SMALLINT NOT NULL CHECK (rating IN (-1, 1)),  -- -1 = thumbs down, 1 = thumbs up
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, question_id)
);

ALTER TABLE public.quiz_question_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can CRUD own feedback" ON public.quiz_question_feedback
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Index for fast due-card queries
CREATE INDEX IF NOT EXISTS idx_flashcards_review
  ON public.flashcards (deck_id, next_review_at)
  WHERE next_review_at IS NOT NULL;

-- Function: count cards due for review for a given user
CREATE OR REPLACE FUNCTION public.count_due_cards(_user_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(f.id)::INTEGER
  FROM flashcards f
  JOIN flashcard_decks fd ON fd.id = f.deck_id
  WHERE fd.user_id = _user_id
    AND (f.next_review_at IS NULL OR f.next_review_at <= now());
$$;

GRANT EXECUTE ON FUNCTION public.count_due_cards(UUID) TO authenticated;

-- BUG FIX: get_due_cards companion function for useDueCards hook.
-- Replaces the unreliable .eq("flashcard_decks.user_id") join filter
-- which behaves inconsistently across PostgREST versions.
CREATE OR REPLACE FUNCTION public.get_due_cards(
  _user_id UUID,
  _limit   INTEGER DEFAULT 20
)
RETURNS TABLE (
  id              UUID,
  front           TEXT,
  back            TEXT,
  topic           TEXT,
  mastery_level   INTEGER,
  easiness_factor FLOAT,
  next_review_at  TIMESTAMPTZ,
  deck_id         UUID,
  deck_title      TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    f.id, f.front, f.back, f.topic,
    f.mastery_level, f.easiness_factor, f.next_review_at,
    f.deck_id, fd.title AS deck_title
  FROM flashcards f
  JOIN flashcard_decks fd ON fd.id = f.deck_id
  WHERE fd.user_id = _user_id
    AND (f.next_review_at IS NULL OR f.next_review_at <= now())
  ORDER BY f.easiness_factor ASC NULLS LAST, f.next_review_at ASC NULLS FIRST
  LIMIT _limit;
$$;

GRANT EXECUTE ON FUNCTION public.get_due_cards(UUID, INTEGER) TO authenticated;
