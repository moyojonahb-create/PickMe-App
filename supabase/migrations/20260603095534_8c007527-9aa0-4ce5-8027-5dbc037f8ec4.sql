
-- 1. Restrict drivers UPDATE on rides to post-acceptance statuses only,
--    so they can't read passenger_phone/passenger_name on pending rides
--    via the UPDATE policy USING clause.
DROP POLICY IF EXISTS "Drivers can update rides assigned to them" ON public.rides;
CREATE POLICY "Drivers can update rides assigned to them"
ON public.rides
FOR UPDATE
USING (
  driver_id IS NOT NULL
  AND is_ride_driver(auth.uid(), driver_id)
  AND status = ANY (ARRAY['accepted','in_progress','arrived','completed'])
)
WITH CHECK (
  driver_id IS NOT NULL
  AND is_ride_driver(auth.uid(), driver_id)
  AND status = ANY (ARRAY['accepted','in_progress','arrived','completed'])
);

-- 2. Scope "nearby driver" location discovery to drivers within ~5km
--    bounding box of the rider's active ride pickup. Previously every
--    online driver's coordinates were readable to any rider with an
--    active ride.
DROP POLICY IF EXISTS "Riders can view nearby drivers for ride matching" ON public.live_locations;
CREATE POLICY "Riders can view nearby drivers for ride matching"
ON public.live_locations
FOR SELECT
USING (
  user_type = 'driver'
  AND is_online = true
  AND EXISTS (
    SELECT 1 FROM public.rides r
    WHERE r.user_id = auth.uid()
      AND r.status = ANY (ARRAY['pending','accepted','in_progress','arrived'])
      AND r.pickup_lat IS NOT NULL
      AND r.pickup_lon IS NOT NULL
      AND live_locations.latitude  BETWEEN r.pickup_lat - 0.05 AND r.pickup_lat + 0.05
      AND live_locations.longitude BETWEEN r.pickup_lon - 0.05 AND r.pickup_lon + 0.05
  )
);

-- 3. Tighten ride_requests SELECT: only the requesting rider, admins,
--    or drivers who have actually submitted an offer on that request.
--    Removes the blanket exposure to every online driver.
DROP POLICY IF EXISTS "Online drivers can view negotiating requests" ON public.ride_requests;
CREATE POLICY "Drivers with an offer can view the request"
ON public.ride_requests
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.ride_offers o
    JOIN public.drivers d ON d.id = o.driver_id
    WHERE o.request_id = ride_requests.id
      AND d.user_id = auth.uid()
  )
);
