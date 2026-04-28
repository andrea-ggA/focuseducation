-- Batch 3: align due-card retrieval paths so deck-filtered and unfiltered
-- queries use the same server-side due-date logic.

CREATE OR REPLACE FUNCTION public.get_due_cards_for_deck(
  _deck_id UUID,
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
  WHERE auth.uid() IS NOT NULL
    AND fd.user_id = auth.uid()
    AND fd.id = _deck_id
    AND (f.next_review_at IS NULL OR f.next_review_at <= now())
  ORDER BY f.easiness_factor ASC NULLS LAST, f.next_review_at ASC NULLS FIRST
  LIMIT GREATEST(COALESCE(_limit, 20), 1);
$$;

GRANT EXECUTE ON FUNCTION public.get_due_cards_for_deck(UUID, INTEGER) TO authenticated;
