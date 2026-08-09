
-- Scope update policies to authenticated users only
DROP POLICY IF EXISTS "Riders can update offers on their rides" ON public.offers;
CREATE POLICY "Riders can update offers on their rides"
ON public.offers
FOR UPDATE
TO authenticated
USING (EXISTS (SELECT 1 FROM public.rides r WHERE r.id = offers.ride_id AND r.user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.rides r WHERE r.id = offers.ride_id AND r.user_id = auth.uid()));

DROP POLICY IF EXISTS "Rider updates adjustment status" ON public.fare_adjustments;
CREATE POLICY "Ride parties update adjustment status"
ON public.fare_adjustments
FOR UPDATE
TO authenticated
USING (
  auth.uid() = driver_id
  OR EXISTS (SELECT 1 FROM public.rides r WHERE r.id = fare_adjustments.ride_id AND r.user_id = auth.uid())
)
WITH CHECK (
  auth.uid() = driver_id
  OR EXISTS (SELECT 1 FROM public.rides r WHERE r.id = fare_adjustments.ride_id AND r.user_id = auth.uid())
);

-- Column-level immutability enforcement (WITH CHECK cannot reference OLD)
CREATE OR REPLACE FUNCTION public.enforce_offer_status_only_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW; -- service role / backend jobs
  END IF;

  IF NEW.ride_id IS DISTINCT FROM OLD.ride_id
     OR NEW.driver_id IS DISTINCT FROM OLD.driver_id
     OR NEW.price IS DISTINCT FROM OLD.price
     OR NEW.eta_minutes IS DISTINCT FROM OLD.eta_minutes
     OR NEW.message IS DISTINCT FROM OLD.message
     OR NEW.counter_offer IS DISTINCT FROM OLD.counter_offer
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Only the status of an offer may be changed';
  END IF;

  IF NEW.status NOT IN ('pending','accepted','rejected','cancelled','expired') THEN
    RAISE EXCEPTION 'Invalid offer status';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_offer_status_only_update ON public.offers;
CREATE TRIGGER trg_enforce_offer_status_only_update
BEFORE UPDATE ON public.offers
FOR EACH ROW EXECUTE FUNCTION public.enforce_offer_status_only_update();

CREATE OR REPLACE FUNCTION public.enforce_fare_adjustment_status_only_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.ride_id IS DISTINCT FROM OLD.ride_id
     OR NEW.driver_id IS DISTINCT FROM OLD.driver_id
     OR NEW.old_price IS DISTINCT FROM OLD.old_price
     OR NEW.new_price IS DISTINCT FROM OLD.new_price
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Only the status of a fare adjustment may be changed';
  END IF;

  IF NEW.status NOT IN ('pending','accepted','rejected','cancelled','expired') THEN
    RAISE EXCEPTION 'Invalid fare adjustment status';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_fare_adjustment_status_only_update ON public.fare_adjustments;
CREATE TRIGGER trg_enforce_fare_adjustment_status_only_update
BEFORE UPDATE ON public.fare_adjustments
FOR EACH ROW EXECUTE FUNCTION public.enforce_fare_adjustment_status_only_update();

REVOKE EXECUTE ON FUNCTION public.enforce_offer_status_only_update() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_fare_adjustment_status_only_update() FROM anon, authenticated;
