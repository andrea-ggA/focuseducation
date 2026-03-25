
-- Admin can update all subscriptions
CREATE POLICY "Admins can update all subscriptions"
ON public.subscriptions
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Admin can insert subscriptions for any user
CREATE POLICY "Admins can insert all subscriptions"
ON public.subscriptions
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Admin can view all credits
CREATE POLICY "Admins can view all credits"
ON public.user_credits
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Admin can update all credits
CREATE POLICY "Admins can update all credits"
ON public.user_credits
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Admin can insert credit transactions for any user
CREATE POLICY "Admins can insert transactions for any user"
ON public.credit_transactions
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Admin can view all credit transactions
CREATE POLICY "Admins can view all transactions"
ON public.credit_transactions
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));
