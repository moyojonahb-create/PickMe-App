
-- =============================================================
-- Security hardening: limit exposure of sensitive driver and
-- student fields, and lock down luggage-photos storage reads.
-- =============================================================

-- 1) DRIVERS: drop the broad "offered" rider visibility policy.
--    Riders can still see offers via the `offers` table joined to
--    `profiles`. The drivers row (which includes ecocash_number,
--    plate_number, etc.) should only be visible during an active
--    assigned trip.
DROP POLICY IF EXISTS "Riders can view drivers who offered on their rides" ON public.drivers;

-- 2) LUGGAGE PHOTOS: replace the "any approved driver" read policy
--    with one that requires the driver be assigned to the ride
--    that the luggage request belongs to (or the ride is still
--    pending, so dispatched drivers can preview cargo).
DROP POLICY IF EXISTS "Approved drivers read luggage photos" ON storage.objects;

CREATE POLICY "Approved drivers read luggage photos for relevant rides"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'luggage-photos'
  AND public.is_user_driver(auth.uid())
  AND EXISTS (
    SELECT 1
    FROM public.luggage_requests lr
    LEFT JOIN public.rides r ON r.id = lr.ride_id
    LEFT JOIN public.drivers d ON d.id = r.driver_id
    WHERE storage.objects.name = ANY (lr.image_paths)
      AND (
        lr.ride_id IS NULL                          -- not yet attached
        OR r.status = 'pending'                     -- open for dispatch
        OR d.user_id = auth.uid()                   -- assigned driver
      )
  )
);

-- 3) STUDENT PROFILES: keep RLS row policy (user sees own row,
--    admin sees all) but revoke client access to internal
--    anti-fraud signals so the owner cannot tune submissions.
REVOKE SELECT (fraud_score, device_id, attempt_count, face_match_score)
  ON public.student_profiles FROM anon, authenticated;

-- 4) Provide an admin-only RPC that returns the full row, so the
--    admin verification UI keeps working without the revoked
--    columns blocking SELECT *.
CREATE OR REPLACE FUNCTION public.admin_list_student_profiles(p_status text DEFAULT NULL)
RETURNS SETOF public.student_profiles
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  RETURN QUERY
    SELECT sp.*
    FROM public.student_profiles sp
    WHERE p_status IS NULL OR sp.verification_status = p_status
    ORDER BY sp.created_at DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_list_student_profiles(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_student_profiles(text) TO authenticated;
