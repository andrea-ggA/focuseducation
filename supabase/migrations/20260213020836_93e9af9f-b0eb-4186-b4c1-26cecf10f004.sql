
-- Table: user_question_progress - tracks individual question answers per user
CREATE TABLE public.user_question_progress (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  question_id UUID NOT NULL REFERENCES public.quiz_questions(id) ON DELETE CASCADE,
  quiz_id UUID NOT NULL REFERENCES public.quizzes(id) ON DELETE CASCADE,
  is_correct BOOLEAN NOT NULL,
  selected_answer INTEGER NOT NULL,
  time_taken_seconds INTEGER,
  answered_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Table: xp_log - logs each XP gain event
CREATE TABLE public.xp_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  xp_amount INTEGER NOT NULL,
  source TEXT NOT NULL, -- 'question', 'chapter_complete', 'streak_bonus'
  source_id UUID,
  earned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.user_question_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.xp_log ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can CRUD own progress" ON public.user_question_progress
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can CRUD own xp_log" ON public.xp_log
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Index for fast lookups
CREATE INDEX idx_uqp_user_quiz ON public.user_question_progress(user_id, quiz_id);
CREATE INDEX idx_uqp_user_question ON public.user_question_progress(user_id, question_id);
CREATE INDEX idx_xp_log_user ON public.xp_log(user_id);
