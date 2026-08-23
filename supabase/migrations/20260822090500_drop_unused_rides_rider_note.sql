-- Superseded before use: the rider note is logged as a trip_events row
-- (event_type = 'rider_note'), the same source RideMatching.tsx and
-- FullScreenNavigation.tsx already read, not a column on rides.
ALTER TABLE public.rides DROP COLUMN IF EXISTS rider_note;
