
-- Add share_token to flashcard_decks
ALTER TABLE public.flashcard_decks ADD COLUMN IF NOT EXISTS share_token text UNIQUE;

-- Add share_token to generated_content
ALTER TABLE public.generated_content ADD COLUMN IF NOT EXISTS share_token text UNIQUE;

-- RLS: Anyone can view shared flashcard decks by token
CREATE POLICY "Anyone can view shared decks by token"
ON public.flashcard_decks
FOR SELECT
TO anon, authenticated
USING (share_token IS NOT NULL);

-- RLS: Anyone can view flashcards of shared decks
CREATE POLICY "Anyone can view flashcards of shared decks"
ON public.flashcards
FOR SELECT
TO anon, authenticated
USING (EXISTS (
  SELECT 1 FROM flashcard_decks
  WHERE flashcard_decks.id = flashcards.deck_id
  AND flashcard_decks.share_token IS NOT NULL
));

-- RLS: Anyone can view shared generated_content by token
CREATE POLICY "Anyone can view shared content by token"
ON public.generated_content
FOR SELECT
TO anon, authenticated
USING (share_token IS NOT NULL);
