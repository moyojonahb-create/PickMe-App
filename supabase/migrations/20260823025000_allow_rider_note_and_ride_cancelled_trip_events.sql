-- The app has been writing event_type 'rider_note' (RideMatching.tsx,
-- RideView.tsx) and 'ride_cancelled' (rideMatching.ts, FullScreenNavigation.tsx)
-- to trip_events for a while, but trip_events_event_type_check never allowed
-- either value — every one of those inserts has been silently failing (caught
-- by try/catch), so notes never actually reached a driver and cancellation
-- reasons were never logged. Extend the constraint to match what the app
-- actually writes.
ALTER TABLE public.trip_events DROP CONSTRAINT trip_events_event_type_check;
ALTER TABLE public.trip_events ADD CONSTRAINT trip_events_event_type_check
  CHECK (event_type = ANY (ARRAY[
    'created', 'accepted', 'started', 'completed', 'cancelled', 'admin_cancelled',
    'driver_assigned', 'location_update', 'rider_note', 'ride_cancelled'
  ]));
