-- 4w "Note to driver": the note attached to a specific ride, and the
-- rider's optional saved default (the "use this note every trip" toggle).
-- rides is already broadly readable to authenticated users (see
-- allow_authenticated_read_rides), so no new RLS policy is needed for
-- rider_note to reach the driver's incoming-request card before they accept.

ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS rider_note text;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS default_ride_note text;
