-- Task 4: a rider-visible "driver has arrived, waiting Xm" banner needs one
-- number both the rider and driver can agree on. Today, arrival is a client-
-- side Haversine check (useArrivalDetection.ts) that's dead code anyway —
-- the live flow is the driver tapping an explicit "arrived" button in
-- FullScreenNavigation.tsx, which POSTs status='arrived' to the Go backend.
-- Nothing persists *when* that happened, so each phone would compute its
-- own arrival moment and it resets on every reload.
--
-- driver_arrived_at is derived purely from the status transition itself,
-- never from a client-supplied value — the app never sends this column in
-- an UPDATE payload, so there is no path for a rider, a stale client, or a
-- replayed request to set or move it. It fires regardless of which
-- connection performs the UPDATE (the Go backend's privileged connection,
-- or a hypothetical authenticated-driver fallback), since both hit this
-- same table and trigger.

ALTER TABLE public.rides
  ADD COLUMN driver_arrived_at timestamptz;

CREATE OR REPLACE FUNCTION public.set_driver_arrived_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Only stamps on the transition INTO 'arrived', and only if it isn't
  -- already set — this is the idempotency guarantee. A later update to the
  -- same row (in_progress, completed, even a bounce back through arrived
  -- somehow) can never move or clear it once written.
  IF NEW.status = 'arrived' AND NEW.driver_arrived_at IS NULL THEN
    NEW.driver_arrived_at := now();
  END IF;
  RETURN NEW;
END;
$$;

-- Trigger name deliberately sorts after "guard_rides_update" (Postgres fires
-- same-event BEFORE triggers alphabetically by name) — guard_rides_update
-- validates the incoming status transition first; this one only stamps the
-- timestamp once that's already passed.
CREATE TRIGGER trg_set_driver_arrived_at
  BEFORE UPDATE ON public.rides
  FOR EACH ROW
  EXECUTE FUNCTION public.set_driver_arrived_at();

-- Defense in depth, matching the existing driver_collected_at clause in
-- guard_rides_update (20260823120000_lock_down_rides_writes.sql): even
-- though no app code ever sends this column today, close the same gap for
-- it that already exists for every other guarded column, rather than
-- leaving it as the one field a direct client PATCH could still slip past.
CREATE OR REPLACE FUNCTION public.guard_rides_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  is_service boolean;
  is_rider boolean;
  is_driver boolean;
BEGIN
  is_service := current_user IN ('postgres', 'service_role', 'supabase_admin')
             OR auth.role() = 'service_role'
             OR public.has_role(auth.uid(), 'admin'::app_role);
  IF is_service THEN
    RETURN NEW;
  END IF;

  is_rider := auth.uid() = OLD.user_id;
  is_driver := OLD.driver_id IS NOT NULL AND auth.uid() = OLD.driver_id;

  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.pickup_address IS DISTINCT FROM OLD.pickup_address
     OR NEW.pickup_lat IS DISTINCT FROM OLD.pickup_lat
     OR NEW.pickup_lon IS DISTINCT FROM OLD.pickup_lon
     OR NEW.dropoff_address IS DISTINCT FROM OLD.dropoff_address
     OR NEW.dropoff_lat IS DISTINCT FROM OLD.dropoff_lat
     OR NEW.dropoff_lon IS DISTINCT FROM OLD.dropoff_lon
     OR NEW.distance_km IS DISTINCT FROM OLD.distance_km
     OR NEW.duration_minutes IS DISTINCT FROM OLD.duration_minutes
     OR NEW.vehicle_type IS DISTINCT FROM OLD.vehicle_type
     OR NEW.route_polyline IS DISTINCT FROM OLD.route_polyline
     OR NEW.passenger_count IS DISTINCT FROM OLD.passenger_count
     OR NEW.payment_method IS DISTINCT FROM OLD.payment_method
     OR NEW.town_id IS DISTINCT FROM OLD.town_id
     OR NEW.gender_preference IS DISTINCT FROM OLD.gender_preference
     OR NEW.passenger_name IS DISTINCT FROM OLD.passenger_name
     OR NEW.passenger_phone IS DISTINCT FROM OLD.passenger_phone
     OR NEW.locked_price IS DISTINCT FROM OLD.locked_price
     OR NEW.cancellation_fee IS DISTINCT FROM OLD.cancellation_fee
     OR NEW.wallet_paid IS DISTINCT FROM OLD.wallet_paid
     OR NEW.wallet_paid_at IS DISTINCT FROM OLD.wallet_paid_at
     OR NEW.payment_failed IS DISTINCT FROM OLD.payment_failed
     OR NEW.payment_failure_reason IS DISTINCT FROM OLD.payment_failure_reason
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'rides: this field can only be changed by the platform, not directly by a client';
  END IF;

  IF NEW.driver_id IS DISTINCT FROM OLD.driver_id THEN
    RAISE EXCEPTION 'rides: driver_id can only be assigned by dispatch';
  END IF;

  IF NEW.fare IS DISTINCT FROM OLD.fare THEN
    IF NOT (is_rider AND OLD.status = 'pending' AND NEW.status = 'pending') THEN
      RAISE EXCEPTION 'rides: fare can only be raised by the rider while the ride is still pending';
    END IF;
  END IF;

  IF NEW.driver_collected_at IS DISTINCT FROM OLD.driver_collected_at THEN
    IF NOT (is_driver AND OLD.driver_collected_at IS NULL AND NEW.driver_collected_at IS NOT NULL) THEN
      RAISE EXCEPTION 'rides: driver_collected_at can only be set once, by the assigned driver';
    END IF;
  END IF;

  -- driver_arrived_at: same shape as driver_collected_at above — settable
  -- exactly once, forward from NULL, by the assigned driver. In practice
  -- this is always the trigger above doing it (current_user = the Go
  -- backend's service connection, short-circuited by is_service), but a
  -- driver-authenticated fallback path reaching this column directly is
  -- held to the identical rule rather than left unguarded.
  IF NEW.driver_arrived_at IS DISTINCT FROM OLD.driver_arrived_at THEN
    IF NOT (is_driver AND OLD.driver_arrived_at IS NULL AND NEW.driver_arrived_at IS NOT NULL) THEN
      RAISE EXCEPTION 'rides: driver_arrived_at can only be set once, by the assigned driver';
    END IF;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF is_rider THEN
      IF NOT (OLD.status IN ('pending', 'scheduled', 'accepted') AND NEW.status = 'cancelled') THEN
        RAISE EXCEPTION 'rides: riders may only cancel a pending, scheduled, or just-accepted ride';
      END IF;
    ELSIF is_driver THEN
      IF NOT (
        (OLD.status = 'accepted' AND NEW.status IN ('arrived', 'cancelled'))
        OR (OLD.status = 'arrived' AND NEW.status IN ('in_progress', 'cancelled'))
        OR (OLD.status = 'in_progress' AND NEW.status = 'completed')
      ) THEN
        RAISE EXCEPTION 'rides: not a valid driver status transition';
      END IF;
    ELSE
      RAISE EXCEPTION 'rides: not authorized to change status';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
