-- rides_status_check (added in 20260823120000_lock_down_rides_writes.sql)
-- only allowed the statuses the Go backend's dispatch/accept flow
-- normalizer produces, missing 'expired' — which the pre-existing
-- expire_old_rides() SECURITY DEFINER function sets on stale pending rides,
-- and which the rider frontend already explicitly checks for
-- (RideMatching.tsx routes ride.status === 'expired' back to /ride, same as
-- 'cancelled'). Every call to expire-old-rides has been failing with a
-- constraint violation since that migration landed. Add the missing value
-- rather than remove the legitimate sweep.
ALTER TABLE public.rides DROP CONSTRAINT rides_status_check;
ALTER TABLE public.rides ADD CONSTRAINT rides_status_check
  CHECK (status IN ('pending', 'scheduled', 'accepted', 'arrived', 'in_progress', 'completed', 'cancelled', 'expired'));
