-- 1. Passenger contact PII moved out of broadly-readable rides table
CREATE TABLE IF NOT EXISTS public.ride_passenger_contacts (
  ride_id uuid PRIMARY KEY REFERENCES public.rides(id) ON DELETE CASCADE,
  passenger_name text,
  passenger_phone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.ride_passenger_contacts TO authenticated;
GRANT ALL ON public.ride_passenger_contacts TO service_role;

ALTER TABLE public.ride_passenger_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Ride participants can view passenger contact"
ON public.ride_passenger_contacts FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.rides r
    WHERE r.id = ride_passenger_contacts.ride_id
      AND (
        r.user_id = auth.uid()
        OR (r.driver_id IS NOT NULL AND public.is_ride_driver(auth.uid(), r.driver_id))
      )
  )
  OR public.has_role(auth.uid(), 'admin'::public.app_role)
);

CREATE POLICY "Riders can add passenger contact for own ride"
ON public.ride_passenger_contacts FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (SELECT 1 FROM public.rides r WHERE r.id = ride_id AND r.user_id = auth.uid())
);

CREATE POLICY "Riders can update passenger contact for own ride"
ON public.ride_passenger_contacts FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM public.rides r WHERE r.id = ride_id AND r.user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.rides r WHERE r.id = ride_id AND r.user_id = auth.uid()));

CREATE TRIGGER trg_ride_passenger_contacts_updated_at
BEFORE UPDATE ON public.ride_passenger_contacts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- migrate existing data
INSERT INTO public.ride_passenger_contacts (ride_id, passenger_name, passenger_phone)
SELECT id, passenger_name, passenger_phone
FROM public.rides
WHERE passenger_name IS NOT NULL OR passenger_phone IS NOT NULL
ON CONFLICT (ride_id) DO NOTHING;

ALTER TABLE public.rides DROP COLUMN IF EXISTS passenger_name;
ALTER TABLE public.rides DROP COLUMN IF EXISTS passenger_phone;

-- keep wallet ride RPC working without the dropped columns
CREATE OR REPLACE FUNCTION public.request_wallet_ride(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_fare numeric;
  v_balance numeric;
  v_locked boolean;
  v_ride_id uuid;
  v_name text;
  v_phone text;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Not authenticated');
  END IF;

  v_fare := (p_payload->>'fare')::numeric;
  IF v_fare IS NULL OR v_fare <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Invalid fare');
  END IF;

  SELECT balance, COALESCE(is_locked, false) INTO v_balance, v_locked
  FROM wallets WHERE user_id = v_user;

  IF v_balance IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Wallet not found. Please top up first.');
  END IF;

  IF v_locked THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Your wallet is locked. Contact support.');
  END IF;

  IF v_balance < v_fare THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Wallet balance too low for this ride',
      'balance', v_balance, 'fare', v_fare);
  END IF;

  INSERT INTO rides (
    user_id, status, pickup_address, dropoff_address,
    pickup_lat, pickup_lon, dropoff_lat, dropoff_lon,
    fare, distance_km, duration_minutes,
    vehicle_type, route_polyline, passenger_count,
    payment_method, town_id, gender_preference, scheduled_at
  )
  VALUES (
    v_user,
    COALESCE(p_payload->>'status', 'pending'),
    p_payload->>'pickup_address',
    p_payload->>'dropoff_address',
    (p_payload->>'pickup_lat')::double precision,
    (p_payload->>'pickup_lon')::double precision,
    (p_payload->>'dropoff_lat')::double precision,
    (p_payload->>'dropoff_lon')::double precision,
    v_fare,
    (p_payload->>'distance_km')::numeric,
    (p_payload->>'duration_minutes')::numeric,
    COALESCE(p_payload->>'vehicle_type', 'economy'),
    NULLIF(p_payload->>'route_polyline', ''),
    COALESCE((p_payload->>'passenger_count')::int, 1),
    'wallet',
    NULLIF(p_payload->>'town_id', ''),
    COALESCE(p_payload->>'gender_preference', 'any'),
    NULLIF(p_payload->>'scheduled_at', '')::timestamptz
  )
  RETURNING id INTO v_ride_id;

  v_name := NULLIF(p_payload->>'passenger_name', '');
  v_phone := NULLIF(p_payload->>'passenger_phone', '');
  IF v_name IS NOT NULL OR v_phone IS NOT NULL THEN
    INSERT INTO ride_passenger_contacts (ride_id, passenger_name, passenger_phone)
    VALUES (v_ride_id, v_name, v_phone)
    ON CONFLICT (ride_id) DO UPDATE
      SET passenger_name = EXCLUDED.passenger_name,
          passenger_phone = EXCLUDED.passenger_phone,
          updated_at = now();
  END IF;

  RETURN jsonb_build_object('ok', true, 'ride_id', v_ride_id);
END;
$function$;

-- 2. Notification spoofing: remove the permissive insert policy
DROP POLICY IF EXISTS "Service can insert notifications" ON public.notifications;
