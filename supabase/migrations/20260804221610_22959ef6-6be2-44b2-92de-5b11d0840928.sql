-- Approved, online drivers can see pending unexpired ride requests (dispatch feed)
DROP POLICY IF EXISTS "Approved drivers can view open pending rides" ON public.rides;
CREATE POLICY "Approved drivers can view open pending rides"
ON public.rides FOR SELECT TO authenticated
USING (
  status = 'pending'
  AND driver_id IS NULL
  AND (expires_at IS NULL OR expires_at > now())
  AND public.is_online_driver(auth.uid())
);

-- Rider accepts a driver's offer: assigns driver + flips ride to accepted atomically.
CREATE OR REPLACE FUNCTION public.accept_ride_offer(p_ride_id uuid, p_offer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ride rides%ROWTYPE;
  v_offer offers%ROWTYPE;
  v_driver_id uuid;
BEGIN
  SELECT * INTO v_ride FROM rides WHERE id = p_ride_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'Ride not found'); END IF;
  IF v_ride.user_id <> auth.uid() THEN RETURN jsonb_build_object('ok', false, 'reason', 'Not authorized'); END IF;
  IF v_ride.status NOT IN ('pending','scheduled') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Ride is no longer pending');
  END IF;

  SELECT * INTO v_offer FROM offers WHERE id = p_offer_id AND ride_id = p_ride_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'Offer not found'); END IF;

  SELECT id INTO v_driver_id FROM drivers WHERE user_id = v_offer.driver_id AND status = 'approved';
  IF v_driver_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'Driver is not approved'); END IF;

  UPDATE offers SET status = 'accepted' WHERE id = p_offer_id;
  UPDATE offers SET status = 'rejected'
    WHERE ride_id = p_ride_id AND id <> p_offer_id AND status = 'pending';

  UPDATE rides
    SET driver_id = v_driver_id,
        status = 'accepted',
        fare = v_offer.price,
        locked_price = v_offer.price,
        updated_at = now()
    WHERE id = p_ride_id;

  RETURN jsonb_build_object('ok', true, 'driver_id', v_driver_id);
END;
$$;

REVOKE ALL ON FUNCTION public.accept_ride_offer(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_ride_offer(uuid, uuid) TO authenticated;