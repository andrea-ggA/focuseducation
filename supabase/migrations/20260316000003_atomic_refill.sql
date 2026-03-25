-- Atomic monthly credits refill using FOR UPDATE row-level lock.
-- Fixes race condition: previously the refill was done client-side with a
-- read→write sequence. Two tabs open at month boundary = double refill.
-- This function runs in a single transaction and acquires an exclusive row
-- lock so only one caller per user can execute the refill at a time.

CREATE OR REPLACE FUNCTION public.maybe_refill_credits(_user_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_record    user_credits%ROWTYPE;
  v_plan      TEXT;
  v_allowance INTEGER;
  v_rollover  INTEGER;
  v_now       TIMESTAMPTZ := now();
BEGIN
  -- Acquire exclusive lock — concurrent calls from multiple tabs will wait here
  SELECT * INTO v_record
  FROM user_credits
  WHERE user_id = _user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('refilled', false, 'reason', 'no_record');
  END IF;

  -- Already refilled this month → return current balance, no action
  IF date_trunc('month', v_record.last_refill_at) = date_trunc('month', v_now) THEN
    RETURN json_build_object(
      'refilled',          false,
      'balance',           v_record.balance,
      'rollover_balance',  v_record.rollover_balance
    );
  END IF;

  -- Get current plan
  SELECT plan_name INTO v_plan
  FROM subscriptions
  WHERE user_id = _user_id AND status IN ('active', 'trialing')
  LIMIT 1;

  v_allowance := CASE v_plan
    WHEN 'Focus Pro'          THEN 250
    WHEN 'Hyperfocus Master'  THEN 700
    ELSE 15
  END;

  -- Rollover: paid plans keep up to 50% of new allowance from unused balance
  v_rollover := CASE
    WHEN v_plan IN ('Focus Pro', 'Hyperfocus Master')
    THEN LEAST(v_record.balance + v_record.rollover_balance, v_allowance / 2)
    ELSE 0
  END;

  -- Atomic update in same transaction as the FOR UPDATE lock
  UPDATE user_credits
  SET balance          = v_allowance,
      rollover_balance = v_rollover,
      last_refill_at   = v_now
  WHERE user_id = _user_id;

  INSERT INTO credit_transactions (user_id, amount, action, description)
  VALUES (_user_id, v_allowance, 'monthly_refill',
          'Ricarica mensile: ' || v_allowance || ' NeuroCredits');

  RETURN json_build_object(
    'refilled',         true,
    'balance',          v_allowance,
    'rollover_balance', v_rollover
  );
END;
$$;

-- Grant execute to authenticated users (they can only touch their own row
-- because the function reads user_id = _user_id and _user_id comes from the
-- caller's validated session in useCredits.ts)
GRANT EXECUTE ON FUNCTION public.maybe_refill_credits(UUID) TO authenticated;
