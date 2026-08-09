-- Replaces idx_driver_sessions_driver_updated from 20260619113000, which is
-- broken: driver_sessions has no updated_at column (it's a fatigue-session
-- log — went_online_at/went_offline_at/forced_break_until only). Driver
-- presence actually lives on drivers and live_locations (both is_online +
-- updated_at, keyed by user_id), which is what the cleanup worker and the
-- GET /drivers/nearby query now target.

CREATE INDEX IF NOT EXISTS idx_drivers_online_updated
  ON public.drivers (updated_at)
  WHERE is_online = true;

CREATE INDEX IF NOT EXISTS idx_live_locations_online_updated
  ON public.live_locations (updated_at)
  WHERE is_online = true;
