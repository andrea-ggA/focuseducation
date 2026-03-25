CREATE OR REPLACE FUNCTION public.check_and_increment_rate_limit(_user_id uuid, _max_per_min integer DEFAULT 10)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _count integer;
BEGIN
  SELECT COUNT(*) INTO _count
  FROM credit_transactions
  WHERE user_id = _user_id
    AND created_at > now() - interval '1 minute';
  RETURN _count < _max_per_min;
END;
$$;