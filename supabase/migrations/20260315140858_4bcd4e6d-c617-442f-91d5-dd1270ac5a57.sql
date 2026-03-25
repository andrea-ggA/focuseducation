
CREATE OR REPLACE FUNCTION public.spend_credits(
  _user_id uuid,
  _cost integer,
  _action text,
  _description text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _balance integer;
  _rollover integer;
  _new_balance integer;
  _new_rollover integer;
  _remaining integer;
  _from_rollover integer;
BEGIN
  SELECT balance, rollover_balance
    INTO _balance, _rollover
    FROM public.user_credits
   WHERE user_id = _user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_credits_row');
  END IF;

  IF (_balance + _rollover) < _cost THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'insufficient_credits',
      'balance', _balance,
      'rollover_balance', _rollover
    );
  END IF;

  _remaining := _cost;
  _new_rollover := _rollover;
  _new_balance := _balance;

  IF _new_rollover > 0 THEN
    _from_rollover := LEAST(_new_rollover, _remaining);
    _new_rollover := _new_rollover - _from_rollover;
    _remaining := _remaining - _from_rollover;
  END IF;
  _new_balance := _new_balance - _remaining;

  UPDATE public.user_credits
     SET balance = _new_balance,
         rollover_balance = _new_rollover,
         updated_at = now()
   WHERE user_id = _user_id;

  INSERT INTO public.credit_transactions (user_id, amount, action, description)
  VALUES (_user_id, -_cost, _action, COALESCE(_description, 'Speso ' || _cost || ' NeuroCredits per ' || _action));

  RETURN jsonb_build_object(
    'success', true,
    'balance', _new_balance,
    'rollover_balance', _new_rollover
  );
END;
$$;
