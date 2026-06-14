-- PickMe Phase B1 Option A
-- Canonical Go-owned offer storage aligned with public.rides.
--
-- This migration is intentionally limited to offer storage.
-- It does not modify wallets, app.ride_requests, app.ride_offers, app.rides,
-- public.active_driver_offers, or frontend behavior.

BEGIN;

CREATE TABLE IF NOT EXISTS public.ride_offers (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	ride_id uuid NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
	driver_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
	offered_fare numeric NOT NULL,
	offer_price numeric NOT NULL,
	eta_minutes integer,
	status text NOT NULL DEFAULT 'pending',
	expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 seconds'),
	accepted_at timestamptz,
	declined_at timestamptz,
	expired_at timestamptz,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),

	CONSTRAINT ride_offers_status_check
		CHECK (status IN ('pending', 'accepted', 'declined', 'expired', 'cancelled')),

	CONSTRAINT ride_offers_positive_fare_check
		CHECK (offered_fare > 0 AND offer_price > 0),

	CONSTRAINT ride_offers_eta_non_negative_check
		CHECK (eta_minutes IS NULL OR eta_minutes >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS ride_offers_one_active_driver_offer_per_ride_idx
	ON public.ride_offers (ride_id, driver_id)
	WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS ride_offers_ride_pending_expires_idx
	ON public.ride_offers (ride_id, status, expires_at);

CREATE INDEX IF NOT EXISTS ride_offers_driver_created_idx
	ON public.ride_offers (driver_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.set_ride_offers_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	NEW.updated_at = now();
	RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ride_offers_updated_at ON public.ride_offers;

CREATE TRIGGER trg_ride_offers_updated_at
	BEFORE UPDATE ON public.ride_offers
	FOR EACH ROW
	EXECUTE FUNCTION public.set_ride_offers_updated_at();

COMMIT;
