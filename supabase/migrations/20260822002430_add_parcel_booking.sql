-- Parcel booking (4m): package size, delivery note, who-pays, photo, and
-- recipient details for vehicle_type='parcel' rides.
--
-- Split into two tables, same reasoning as ride_passenger_contacts
-- (20260805150308): rides is broadly readable (any authenticated user —
-- see policy "allow_authenticated_read_rides"), and a driver browsing the
-- open market needs to judge package_size/delivery_note/who_pays/photo
-- before accepting. Only the recipient's *phone number* is PII a browsing
-- driver has no business seeing before they're matched — that stays
-- restricted to the ride owner and the assigned driver, same pattern as
-- ride_passenger_contacts.

CREATE TABLE IF NOT EXISTS public.ride_parcel_details (
  ride_id uuid PRIMARY KEY REFERENCES public.rides(id) ON DELETE CASCADE,
  package_size text NOT NULL CHECK (package_size IN ('small', 'medium', 'large')),
  recipient_name text NOT NULL,
  delivery_note text,
  who_pays text NOT NULL DEFAULT 'sender' CHECK (who_pays IN ('sender', 'recipient')),
  photo_path text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.ride_parcel_details TO authenticated;
GRANT ALL ON public.ride_parcel_details TO service_role;

ALTER TABLE public.ride_parcel_details ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can view parcel details"
ON public.ride_parcel_details FOR SELECT TO authenticated
USING (true);

CREATE POLICY "Riders can add parcel details for own ride"
ON public.ride_parcel_details FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (SELECT 1 FROM public.rides r WHERE r.id = ride_id AND r.user_id = auth.uid())
);

CREATE POLICY "Riders can update parcel details for own ride"
ON public.ride_parcel_details FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM public.rides r WHERE r.id = ride_id AND r.user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.rides r WHERE r.id = ride_id AND r.user_id = auth.uid()));

CREATE TRIGGER trg_ride_parcel_details_updated_at
BEFORE UPDATE ON public.ride_parcel_details
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Recipient phone — the one genuinely private field. Owner + matched driver only.
CREATE TABLE IF NOT EXISTS public.ride_parcel_contacts (
  ride_id uuid PRIMARY KEY REFERENCES public.rides(id) ON DELETE CASCADE,
  recipient_phone text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.ride_parcel_contacts TO authenticated;
GRANT ALL ON public.ride_parcel_contacts TO service_role;

ALTER TABLE public.ride_parcel_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Ride participants can view parcel recipient phone"
ON public.ride_parcel_contacts FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.rides r
    WHERE r.id = ride_parcel_contacts.ride_id
      AND (
        r.user_id = auth.uid()
        OR (r.driver_id IS NOT NULL AND public.is_ride_driver(auth.uid(), r.driver_id))
      )
  )
  OR public.has_role(auth.uid(), 'admin'::public.app_role)
);

CREATE POLICY "Riders can add parcel recipient phone for own ride"
ON public.ride_parcel_contacts FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (SELECT 1 FROM public.rides r WHERE r.id = ride_id AND r.user_id = auth.uid())
);

CREATE POLICY "Riders can update parcel recipient phone for own ride"
ON public.ride_parcel_contacts FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM public.rides r WHERE r.id = ride_id AND r.user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.rides r WHERE r.id = ride_id AND r.user_id = auth.uid()));

CREATE TRIGGER trg_ride_parcel_contacts_updated_at
BEFORE UPDATE ON public.ride_parcel_contacts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Parcel photo storage — mirrors luggage-photos, but readable by any
-- authenticated user (matching ride_parcel_details' own openness) since a
-- browsing driver needs to see the photo to judge the parcel, not just an
-- already-assigned one.
INSERT INTO storage.buckets (id, name, public)
VALUES ('parcel-photos', 'parcel-photos', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Riders upload own parcel photos"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'parcel-photos' AND (auth.uid())::text = (storage.foldername(name))[1]);

CREATE POLICY "Riders delete own parcel photos"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'parcel-photos' AND (auth.uid())::text = (storage.foldername(name))[1]);

CREATE POLICY "Authenticated can view referenced parcel photos"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'parcel-photos'
  AND EXISTS (SELECT 1 FROM public.ride_parcel_details pd WHERE pd.photo_path = objects.name)
);
