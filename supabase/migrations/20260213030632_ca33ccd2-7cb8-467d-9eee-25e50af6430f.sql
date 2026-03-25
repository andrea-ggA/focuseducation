
-- Add notification sound and focus mode columns
ALTER TABLE public.notification_preferences 
  ADD COLUMN IF NOT EXISTS notification_sound_url text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS focus_mode_enabled boolean NOT NULL DEFAULT false;

-- Create support tickets table
CREATE TABLE public.support_tickets (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  subject text NOT NULL,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  priority text NOT NULL DEFAULT 'normal',
  ai_response text DEFAULT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own tickets"
  ON public.support_tickets FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own tickets"
  ON public.support_tickets FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own tickets"
  ON public.support_tickets FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all tickets"
  ON public.support_tickets FOR SELECT
  USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update all tickets"
  ON public.support_tickets FOR UPDATE
  USING (has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_support_tickets_updated_at
  BEFORE UPDATE ON public.support_tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Create notification-sounds storage bucket
INSERT INTO storage.buckets (id, name, public) VALUES ('notification-sounds', 'notification-sounds', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Users can upload own notification sounds"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'notification-sounds' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can update own notification sounds"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'notification-sounds' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Notification sounds are publicly accessible"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'notification-sounds');

CREATE POLICY "Users can delete own notification sounds"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'notification-sounds' AND auth.uid()::text = (storage.foldername(name))[1]);
