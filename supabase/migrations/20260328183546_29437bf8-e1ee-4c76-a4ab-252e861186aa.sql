CREATE POLICY "Admins can insert credits for any user"
ON public.user_credits
FOR INSERT
TO authenticated
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));