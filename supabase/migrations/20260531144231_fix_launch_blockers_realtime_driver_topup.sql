-- Launch blocker fixes:
-- 1. Restore Realtime publication for tables the app subscribes to.
-- 2. Provide a driver_locations compatibility view backed by live_locations.
-- 3. Add audited admin_topup_driver RPC for driver wallet support operations.

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.rides;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.driver_wallets;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.call_sessions;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.disputes;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;
  END;
END $$;

CREATE OR REPLACE VIEW public.driver_locations
WITH (security_invoker = true)
AS
SELECT
  user_id AS driver_user_id,
  latitude,
  longitude,
  is_online,
  updated_at
FROM public.live_locations
WHERE user_type = 'driver';

REVOKE ALL ON public.driver_locations FROM PUBLIC, anon;
GRANT SELECT ON public.driver_locations TO authenticated;

CREATE TABLE IF NOT EXISTS public.driver_wallet_topups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount_usd numeric NOT NULL CHECK (amount_usd > 0),
  reference text,
  note text,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reference)
);

ALTER TABLE public.driver_wallet_topups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage driver wallet topups" ON public.driver_wallet_topups;
CREATE POLICY "Admins can manage driver wallet topups"
  ON public.driver_wallet_topups
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE OR REPLACE FUNCTION public.admin_topup_driver(
  p_driver_id uuid,
  p_amount_usd numeric,
  p_reference text DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reference text := NULLIF(BTRIM(p_reference), '');
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Not admin');
  END IF;

  IF p_amount_usd IS NULL OR p_amount_usd <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Invalid amount');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.drivers WHERE user_id = p_driver_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Driver not found');
  END IF;

  INSERT INTO public.driver_wallet_topups (
    driver_id,
    amount_usd,
    reference,
    note,
    created_by
  )
  VALUES (
    p_driver_id,
    p_amount_usd,
    v_reference,
    p_note,
    auth.uid()
  );

  INSERT INTO public.driver_wallets (driver_id, balance_usd)
  VALUES (p_driver_id, p_amount_usd)
  ON CONFLICT (driver_id) DO UPDATE
    SET balance_usd = public.driver_wallets.balance_usd + EXCLUDED.balance_usd,
        updated_at = now();

  INSERT INTO public.system_events (
    actor_id,
    event_type,
    entity_type,
    entity_id,
    details
  )
  VALUES (
    auth.uid(),
    'driver_wallet_topup',
    'driver_wallet',
    p_driver_id,
    jsonb_build_object(
      'amount_usd', p_amount_usd,
      'reference', v_reference,
      'note', p_note
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'driver_id', p_driver_id,
    'amount_usd', p_amount_usd,
    'reference', v_reference
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_topup_driver(uuid, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_topup_driver(uuid, numeric, text, text) TO authenticated;
