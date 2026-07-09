
-- 1. driver_feedback: clarify ownership policies
DROP POLICY IF EXISTS "Drivers can insert their own feedback" ON public.driver_feedback;
DROP POLICY IF EXISTS "Drivers can view their own feedback" ON public.driver_feedback;

CREATE POLICY "Drivers can insert their own feedback"
  ON public.driver_feedback FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = driver_id AND public.is_user_driver(auth.uid()));

CREATE POLICY "Drivers can view their own feedback"
  ON public.driver_feedback FOR SELECT TO authenticated
  USING (auth.uid() = driver_id);

-- 2. luggage_requests: drivers only see luggage tied to a ride they can see
DROP POLICY IF EXISTS "Approved drivers view luggage for pending/assigned rides" ON public.luggage_requests;

CREATE POLICY "Approved drivers view luggage for assigned rides"
  ON public.luggage_requests FOR SELECT TO authenticated
  USING (
    public.is_user_driver(auth.uid())
    AND ride_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.rides r
      LEFT JOIN public.drivers d ON d.id = r.driver_id
      WHERE r.id = luggage_requests.ride_id
        AND (r.status = 'pending' OR d.user_id = auth.uid())
    )
  );

-- 3. rides: drivers only see passenger PII for active rides (drop 24h post-trip window)
DROP POLICY IF EXISTS "Drivers can view rides assigned to them" ON public.rides;

CREATE POLICY "Drivers can view rides assigned to them"
  ON public.rides FOR SELECT TO authenticated
  USING (
    driver_id IS NOT NULL
    AND public.is_ride_driver(auth.uid(), driver_id)
    AND status = ANY (ARRAY['accepted','in_progress','arrived','pending'])
  );

-- 4. student_profiles: revoke sensitive columns from clients
REVOKE SELECT (national_id_number, registration_number, fraud_score, device_id, attempt_count, face_match_score)
  ON public.student_profiles FROM authenticated, anon;
