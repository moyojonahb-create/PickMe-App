-- 4r: driver trip-complete/collect screen.
--
-- 1. rides.driver_collected_at — set when the driver taps "Cash received /
--    Payment confirmed · go online" on the collect screen. Lets the driver
--    app detect "I have a completed ride I never confirmed collection for"
--    on relaunch (force-quit recovery), independent of local React state.
--    Covered by the existing "Drivers can update rides assigned to them"
--    policy (already allows UPDATE while status IN (...,'completed')) —
--    no new RLS needed.
ALTER TABLE public.rides ADD COLUMN IF NOT EXISTS driver_collected_at timestamptz;

-- 2. Driver-rates-passenger. Nothing existed for this direction before —
-- src/lib/businessApi.ts's submitDriverRating is the rider rating the
-- driver, the opposite of what 4r needs.
CREATE TABLE IF NOT EXISTS public.ride_passenger_ratings (
  ride_id uuid PRIMARY KEY REFERENCES public.rides(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL,
  rating int NOT NULL CHECK (rating BETWEEN 1 AND 5),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.ride_passenger_ratings TO authenticated;
GRANT ALL ON public.ride_passenger_ratings TO service_role;

ALTER TABLE public.ride_passenger_ratings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Ride participants can view passenger rating"
ON public.ride_passenger_ratings FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.rides r
    WHERE r.id = ride_passenger_ratings.ride_id
      AND (r.user_id = auth.uid() OR public.is_ride_driver(auth.uid(), r.driver_id))
  )
  OR public.has_role(auth.uid(), 'admin'::public.app_role)
);

CREATE POLICY "Assigned driver can rate the passenger once"
ON public.ride_passenger_ratings FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.rides r
    WHERE r.id = ride_id
      AND r.status = 'completed'
      AND public.is_ride_driver(auth.uid(), r.driver_id)
  )
);
