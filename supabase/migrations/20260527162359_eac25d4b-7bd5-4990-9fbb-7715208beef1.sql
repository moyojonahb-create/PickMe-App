
-- ============================================================
-- Security hardening: fix 4 scanner findings
-- ============================================================

-- (1) student_profiles: revoke column-level SELECT on PII (national_id_number, registration_number)
-- RLS lets riders read their own row, but they should never see these raw ID fields.
-- Admins still get full access via service_role / admin RPCs.
REVOKE SELECT (national_id_number, registration_number) ON public.student_profiles FROM authenticated;
REVOKE SELECT (national_id_number, registration_number) ON public.student_profiles FROM anon;

-- (2) luggage_requests: tighten driver SELECT to ONLY assigned driver
-- (was: any approved driver could read luggage for any 'pending' ride)
DROP POLICY IF EXISTS "Approved drivers view luggage for assigned rides" ON public.luggage_requests;
CREATE POLICY "Approved drivers view luggage for assigned rides"
ON public.luggage_requests
FOR SELECT
TO authenticated
USING (
  is_user_driver(auth.uid())
  AND ride_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.rides r
    JOIN public.drivers d ON d.id = r.driver_id
    WHERE r.id = luggage_requests.ride_id
      AND d.user_id = auth.uid()
  )
);

-- (3) rides: prevent driver from reading passenger_phone/passenger_name on PENDING rides
-- Drop 'pending' from the driver SELECT array. Drivers only see assigned rides after they accept.
DROP POLICY IF EXISTS "Drivers can view rides assigned to them" ON public.rides;
CREATE POLICY "Drivers can view rides assigned to them"
ON public.rides
FOR SELECT
TO authenticated
USING (
  driver_id IS NOT NULL
  AND is_ride_driver(auth.uid(), driver_id)
  AND status = ANY (ARRAY['accepted','in_progress','arrived','completed'])
);

-- (4) phone_verifications: re-confirm no client grants (defense in depth — last migration revoked, this is idempotent)
REVOKE ALL ON public.phone_verifications FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.phone_verifications TO service_role;
