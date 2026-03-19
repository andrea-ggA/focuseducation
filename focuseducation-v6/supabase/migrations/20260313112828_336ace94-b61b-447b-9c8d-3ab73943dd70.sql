-- Allow anyone authenticated to look up referral codes by code value (for validation during registration)
CREATE POLICY "Anyone can look up referral codes by code"
ON public.referral_codes
FOR SELECT
TO authenticated
USING (true);

-- Drop the old select policy since the new one is more permissive
DROP POLICY IF EXISTS "Users can view own referral codes" ON public.referral_codes;
