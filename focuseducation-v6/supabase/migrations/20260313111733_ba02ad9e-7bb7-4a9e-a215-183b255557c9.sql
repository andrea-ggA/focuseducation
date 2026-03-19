-- Weekly challenges table
CREATE TABLE public.weekly_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text NOT NULL,
  challenge_type text NOT NULL,
  target_value integer NOT NULL,
  xp_reward integer NOT NULL DEFAULT 100,
  icon text NOT NULL DEFAULT '🏆',
  week_start date NOT NULL,
  week_end date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- User challenge progress table
CREATE TABLE public.user_challenge_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  challenge_id uuid NOT NULL REFERENCES public.weekly_challenges(id) ON DELETE CASCADE,
  current_value integer NOT NULL DEFAULT 0,
  completed boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  reward_claimed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, challenge_id)
);

-- Enable RLS
ALTER TABLE public.weekly_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_challenge_progress ENABLE ROW LEVEL SECURITY;

-- Everyone can read challenges
CREATE POLICY "Anyone authenticated can view challenges"
  ON public.weekly_challenges FOR SELECT TO authenticated
  USING (true);

-- Only admins can manage challenges
CREATE POLICY "Admins can manage challenges"
  ON public.weekly_challenges FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Users can CRUD own progress
CREATE POLICY "Users can CRUD own challenge progress"
  ON public.user_challenge_progress FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Enable realtime for progress tracking
ALTER PUBLICATION supabase_realtime ADD TABLE public.user_challenge_progress;