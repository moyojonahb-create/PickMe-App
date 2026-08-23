-- ride_passenger_contacts was defined in an earlier migration
-- (20260805150308) but was never actually applied to this project — the
-- table didn't exist. Creating it now (with the two 4n additions: payer,
-- notify_booker) so passenger contact PII has a properly RLS-restricted
-- home instead of living only on the broadly-readable
-- rides.passenger_name / rides.passenger_phone columns.

CREATE TABLE IF NOT EXISTS public.ride_passenger_contacts (
  ride_id uuid PRIMARY KEY REFERENCES public.rides(id) ON DELETE CASCADE,
  passenger_name text,
  passenger_phone text,
  payer text NOT NULL DEFAULT 'booker' CHECK (payer IN ('booker', 'passenger')),
  notify_booker boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.ride_passenger_contacts TO authenticated;
GRANT ALL ON public.ride_passenger_contacts TO service_role;

ALTER TABLE public.ride_passenger_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Ride participants can view passenger contact"
ON public.ride_passenger_contacts FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.rides r
    WHERE r.id = ride_passenger_contacts.ride_id
      AND (
        r.user_id = auth.uid()
        OR (r.driver_id IS NOT NULL AND public.is_ride_driver(auth.uid(), r.driver_id))
      )
  )
  OR public.has_role(auth.uid(), 'admin'::public.app_role)
);

CREATE POLICY "Riders can add passenger contact for own ride"
ON public.ride_passenger_contacts FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (SELECT 1 FROM public.rides r WHERE r.id = ride_id AND r.user_id = auth.uid())
);

CREATE POLICY "Riders can update passenger contact for own ride"
ON public.ride_passenger_contacts FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM public.rides r WHERE r.id = ride_id AND r.user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.rides r WHERE r.id = ride_id AND r.user_id = auth.uid()));

CREATE TRIGGER trg_ride_passenger_contacts_updated_at
BEFORE UPDATE ON public.ride_passenger_contacts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Backfill any existing third-party bookings that only ever made it onto
-- the open rides.passenger_name/phone columns, so in-flight rides benefit too.
INSERT INTO public.ride_passenger_contacts (ride_id, passenger_name, passenger_phone)
SELECT id, passenger_name, passenger_phone
FROM public.rides
WHERE passenger_name IS NOT NULL OR passenger_phone IS NOT NULL
ON CONFLICT (ride_id) DO NOTHING;
