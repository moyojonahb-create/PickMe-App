CREATE OR REPLACE FUNCTION public.request_cash_ride(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_client_fare numeric;
  v_server_fare numeric;
  v_distance_km numeric;
  v_duration_minutes numeric;
  v_town_id text;
  v_ride_id uuid;
  v_town_pricing public.town_pricing%ROWTYPE;
  v_global_pricing public.pricing_settings%ROWTYPE;
  v_status text;
  v_payment_method text;
  v_passenger_count integer;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Not authenticated');
  END IF;

  BEGIN
    v_client_fare := NULLIF(p_payload->>'fare', '')::numeric;
    v_distance_km := NULLIF(p_payload->>'distance_km', '')::numeric;
    v_duration_minutes := NULLIF(p_payload->>'duration_minutes', '')::numeric;
    v_passenger_count := COALESCE(NULLIF(p_payload->>'passenger_count', '')::integer, 1);
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Invalid numeric ride payload');
  END;

  v_status := COALESCE(NULLIF(p_payload->>'status', ''), 'pending');
  v_payment_method := COALESCE(NULLIF(p_payload->>'payment_method', ''), 'cash');
  v_town_id := NULLIF(p_payload->>'town_id', '');

  IF v_payment_method <> 'cash' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Invalid payment method for cash ride');
  END IF;

  IF v_status NOT IN ('pending', 'scheduled') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Invalid ride status');
  END IF;

  IF v_client_fare IS NULL OR v_client_fare <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Invalid fare quote');
  END IF;

  IF v_distance_km IS NULL OR v_distance_km <= 0 OR v_distance_km > 500 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Invalid ride distance');
  END IF;

  IF v_duration_minutes IS NULL OR v_duration_minutes <= 0 OR v_duration_minutes > 720 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Invalid ride duration');
  END IF;

  IF v_passenger_count < 1 OR v_passenger_count > 6 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Invalid passenger count');
  END IF;

  IF NULLIF(p_payload->>'pickup_address', '') IS NULL OR NULLIF(p_payload->>'dropoff_address', '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Pickup and dropoff are required');
  END IF;

  BEGIN
    PERFORM
      NULLIF(p_payload->>'pickup_lat', '')::double precision,
      NULLIF(p_payload->>'pickup_lon', '')::double precision,
      NULLIF(p_payload->>'dropoff_lat', '')::double precision,
      NULLIF(p_payload->>'dropoff_lon', '')::double precision;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Invalid ride coordinates');
  END;

  IF v_town_id IS NOT NULL THEN
    SELECT * INTO v_town_pricing
    FROM public.town_pricing
    WHERE town_id = v_town_id;
  END IF;

  IF v_town_pricing.id IS NOT NULL THEN
    IF v_distance_km <= v_town_pricing.short_trip_km THEN
      v_server_fare := v_town_pricing.short_trip_fare;
    ELSE
      v_server_fare :=
        v_town_pricing.base_fare +
        (v_distance_km * v_town_pricing.per_km_rate) +
        (v_duration_minutes * 0.03);
    END IF;

    v_server_fare := v_server_fare * GREATEST(1, COALESCE(v_town_pricing.demand_multiplier, 1));
    v_server_fare := LEAST(
      GREATEST(v_server_fare, v_town_pricing.minimum_fare, v_town_pricing.offer_floor),
      v_town_pricing.offer_ceiling
    );
  ELSE
    SELECT * INTO v_global_pricing
    FROM public.pricing_settings
    ORDER BY updated_at DESC
    LIMIT 1;

    IF v_global_pricing.id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'Pricing is not configured');
    END IF;

    v_server_fare := GREATEST(
      v_global_pricing.min_fare,
      v_global_pricing.base_fare + (v_distance_km * v_global_pricing.per_km_rate)
    );
  END IF;

  v_server_fare := ROUND(v_server_fare * 100) / 100;

  IF ABS(v_server_fare - v_client_fare) > GREATEST(0.50, v_server_fare * 0.20) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'Fare quote expired. Please refresh and request again.',
      'server_fare', v_server_fare
    );
  END IF;

  INSERT INTO public.rides (
    user_id, status, pickup_address, dropoff_address,
    pickup_lat, pickup_lon, dropoff_lat, dropoff_lon,
    fare, distance_km, duration_minutes,
    vehicle_type, route_polyline, passenger_count,
    payment_method, town_id, gender_preference,
    passenger_name, passenger_phone, scheduled_at
  )
  VALUES (
    v_user,
    v_status,
    p_payload->>'pickup_address',
    p_payload->>'dropoff_address',
    NULLIF(p_payload->>'pickup_lat', '')::double precision,
    NULLIF(p_payload->>'pickup_lon', '')::double precision,
    NULLIF(p_payload->>'dropoff_lat', '')::double precision,
    NULLIF(p_payload->>'dropoff_lon', '')::double precision,
    v_server_fare,
    v_distance_km,
    v_duration_minutes,
    COALESCE(NULLIF(p_payload->>'vehicle_type', ''), 'economy'),
    NULLIF(p_payload->>'route_polyline', ''),
    v_passenger_count,
    'cash',
    v_town_id,
    COALESCE(NULLIF(p_payload->>'gender_preference', ''), 'any'),
    NULLIF(p_payload->>'passenger_name', ''),
    NULLIF(p_payload->>'passenger_phone', ''),
    NULLIF(p_payload->>'scheduled_at', '')::timestamptz
  )
  RETURNING id INTO v_ride_id;

  RETURN jsonb_build_object('ok', true, 'ride_id', v_ride_id, 'fare', v_server_fare);
END;
$$;

REVOKE ALL ON FUNCTION public.request_cash_ride(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.request_cash_ride(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.request_cash_ride(jsonb) TO authenticated;
