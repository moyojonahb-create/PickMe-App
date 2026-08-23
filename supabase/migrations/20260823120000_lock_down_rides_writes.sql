-- Pre-launch audit P0-01 / P0-03: "Users can update their own rides" had no
-- column or status restriction at all, and rides.status had no CHECK
-- constraint — a rider's own session could set fare = 0.01, flip status to
-- completed without paying, or reassign driver_id, with one PostgREST call.
-- The Go backend's own validation doesn't help, because nothing stops a
-- client from writing the row directly (and the app already does, in its
-- own 401/unavailable fallback path).
--
-- This does not touch RLS row-ownership (already correct — a rider can only
-- ever reach their own row). It adds a second, independent layer: a trigger
-- that constrains which *columns* a non-privileged client may change and
-- what state transitions are legal, regardless of which policy let the
-- UPDATE reach the table. The Go backend and any admin/RPC path (which all
-- run as the `postgres` role, or as an authenticated admin) bypass it
-- entirely; only direct rider/driver PostgREST writes are constrained.

ALTER TABLE public.rides
  ADD CONSTRAINT rides_status_check
  CHECK (status IN ('pending', 'scheduled', 'accepted', 'arrived', 'in_progress', 'completed', 'cancelled'));

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
  -- The Go backend connects with the `postgres` role directly (bypassing
  -- PostgREST/RLS entirely); privileged RPCs like accept_ride_offer are
  -- SECURITY DEFINER owned by postgres, so current_user reads 'postgres'
  -- while they run. Admin staff are a separate, deliberate escape hatch
  -- already granted "Admins can manage all rides" at the RLS layer.
  is_service := current_user IN ('postgres', 'service_role', 'supabase_admin')
             OR auth.role() = 'service_role'
             OR public.has_role(auth.uid(), 'admin'::app_role);
  IF is_service THEN
    RETURN NEW;
  END IF;

  is_rider := auth.uid() = OLD.user_id;
  is_driver := OLD.driver_id IS NOT NULL AND auth.uid() = OLD.driver_id;

  -- Columns no end-user client may ever change directly — legitimate only
  -- as the outcome of ride creation, dispatch, or payment settlement, never
  -- a raw client PATCH.
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

  -- driver_id: only ever assigned by dispatch/accept_ride_offer.
  IF NEW.driver_id IS DISTINCT FROM OLD.driver_id THEN
    RAISE EXCEPTION 'rides: driver_id can only be assigned by dispatch';
  END IF;

  -- fare: a rider may raise their own still-searching offer; nobody may
  -- touch it once a driver is engaged or the ride has moved past pending.
  IF NEW.fare IS DISTINCT FROM OLD.fare THEN
    IF NOT (is_rider AND OLD.status = 'pending' AND NEW.status = 'pending') THEN
      RAISE EXCEPTION 'rides: fare can only be raised by the rider while the ride is still pending';
    END IF;
  END IF;

  -- driver_collected_at: only the assigned driver marks cash collected,
  -- and only once, forward from unset.
  IF NEW.driver_collected_at IS DISTINCT FROM OLD.driver_collected_at THEN
    IF NOT (is_driver AND OLD.driver_collected_at IS NULL AND NEW.driver_collected_at IS NOT NULL) THEN
      RAISE EXCEPTION 'rides: driver_collected_at can only be set once, by the assigned driver';
    END IF;
  END IF;

  -- status: the one column both sides may move, only along real transitions.
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

CREATE TRIGGER guard_rides_update
  BEFORE UPDATE ON public.rides
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_rides_update();

-- The Supabase-fallback accept path (src/lib/offerHelpers.ts → acceptOffer)
-- already calls supabase.rpc('accept_ride_offer', ...) — that function does
-- not exist in this database, so every fallback acceptance has been failing
-- with "function does not exist". Locking down direct rides writes above
-- makes this the *only* remaining way a rider can accept an offer when the
-- Go backend is unavailable, so it has to actually exist. Row-locks both
-- the ride and the offer to make concurrent-accept races resolve safely
-- (the loser sees status != 'pending' and reports "no longer available").
CREATE OR REPLACE FUNCTION public.accept_ride_offer(p_ride_id uuid, p_offer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rider uuid := auth.uid();
  v_ride public.rides%ROWTYPE;
  v_offer public.offers%ROWTYPE;
  v_driver_row_id uuid;
BEGIN
  IF v_rider IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Not authenticated');
  END IF;

  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Ride not found');
  END IF;
  IF v_ride.user_id != v_rider THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Not your ride');
  END IF;
  IF v_ride.status != 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'This ride is no longer accepting offers');
  END IF;

  SELECT * INTO v_offer FROM public.offers WHERE id = p_offer_id FOR UPDATE;
  IF NOT FOUND OR v_offer.ride_id != p_ride_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Offer not found for this ride');
  END IF;
  IF v_offer.status != 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'That offer is no longer available');
  END IF;

  -- offers.driver_id is the auth user id; rides.driver_id is drivers.id —
  -- same mismatch get_driver_id()/is_ride_driver() already bridge elsewhere.
  SELECT id INTO v_driver_row_id FROM public.drivers WHERE user_id = v_offer.driver_id LIMIT 1;
  IF v_driver_row_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Driver profile not found');
  END IF;

  UPDATE public.rides
     SET driver_id = v_driver_row_id,
         status = 'accepted',
         fare = v_offer.price
   WHERE id = p_ride_id;

  UPDATE public.offers SET status = 'accepted' WHERE id = p_offer_id;
  UPDATE public.offers SET status = 'rejected' WHERE ride_id = p_ride_id AND id != p_offer_id AND status = 'pending';

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_ride_offer(uuid, uuid) TO authenticated;

-- P2-14: duplicate triggers, same function, same timing — harmless but
-- confusing forever. Keep one of each.
DROP TRIGGER IF EXISTS tr_set_ride_expiry ON public.rides;
DROP TRIGGER IF EXISTS update_rides_updated_at ON public.rides;
