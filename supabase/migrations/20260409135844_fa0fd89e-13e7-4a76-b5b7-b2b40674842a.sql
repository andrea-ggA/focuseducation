
CREATE OR REPLACE FUNCTION public.xp_to_level(_xp INTEGER)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT GREATEST(1, floor(_xp / 500)::INTEGER + 1);
$$;
