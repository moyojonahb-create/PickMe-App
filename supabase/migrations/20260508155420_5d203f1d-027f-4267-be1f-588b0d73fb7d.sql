
-- Remove tables that should never broadcast over Realtime to clients
ALTER PUBLICATION supabase_realtime DROP TABLE public.admin_earnings;
ALTER PUBLICATION supabase_realtime DROP TABLE public.driver_wallets;
ALTER PUBLICATION supabase_realtime DROP TABLE public.call_sessions;
ALTER PUBLICATION supabase_realtime DROP TABLE public.town_pricing;
ALTER PUBLICATION supabase_realtime DROP TABLE public.disputes;

-- Re-publish rides with an explicit column list that EXCLUDES passenger_phone
-- and passenger_name. Drivers subscribed to open-rides / driver-ride-requests
-- channels will no longer receive PII for rides not assigned to them.
-- (The assigned driver still fetches these fields via a direct SELECT, which
-- is gated by RLS to the active trip context.)
ALTER PUBLICATION supabase_realtime DROP TABLE public.rides;
ALTER PUBLICATION supabase_realtime ADD TABLE public.rides (
  id, user_id, driver_id, status,
  pickup_address, dropoff_address,
  pickup_lat, pickup_lon, dropoff_lat, dropoff_lon,
  fare, distance_km, duration_minutes,
  vehicle_type, route_polyline, passenger_count,
  payment_method, town_id, gender_preference,
  scheduled_at, expires_at,
  wallet_paid, wallet_paid_at,
  payment_failed, payment_failure_reason,
  created_at, updated_at
);
