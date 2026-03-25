
-- Background generation jobs
CREATE TABLE public.generation_jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  content_type text NOT NULL,
  title text,
  document_id uuid REFERENCES public.documents(id),
  result_id text,
  total_items integer DEFAULT 0,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
ALTER TABLE public.generation_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can CRUD own jobs" ON public.generation_jobs FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Daily objectives
CREATE TABLE public.daily_objectives (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  objective_date date NOT NULL DEFAULT CURRENT_DATE,
  target_questions integer NOT NULL DEFAULT 20,
  target_focus_minutes integer NOT NULL DEFAULT 30,
  questions_completed integer NOT NULL DEFAULT 0,
  focus_completed integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, objective_date)
);
ALTER TABLE public.daily_objectives ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can CRUD own objectives" ON public.daily_objectives FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Fortune wheel spins
CREATE TABLE public.fortune_wheel_spins (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  spin_date date NOT NULL DEFAULT CURRENT_DATE,
  prize_type text NOT NULL,
  prize_value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, spin_date)
);
ALTER TABLE public.fortune_wheel_spins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can CRUD own spins" ON public.fortune_wheel_spins FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
