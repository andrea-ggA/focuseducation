ALTER TABLE public.quizzes ADD COLUMN share_token text UNIQUE DEFAULT NULL;
CREATE INDEX idx_quizzes_share_token ON public.quizzes(share_token) WHERE share_token IS NOT NULL;
CREATE POLICY "Anyone can view shared quizzes by token" ON public.quizzes FOR SELECT TO anon, authenticated USING (share_token IS NOT NULL);