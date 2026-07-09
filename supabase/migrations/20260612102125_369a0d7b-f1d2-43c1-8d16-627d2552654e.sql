
-- 1) mirror_outbox: explicit admin-only access
REVOKE ALL ON public.mirror_outbox FROM anon, authenticated;
GRANT ALL ON public.mirror_outbox TO service_role;
DROP POLICY IF EXISTS "Admins can manage mirror_outbox" ON public.mirror_outbox;
CREATE POLICY "Admins can manage mirror_outbox" ON public.mirror_outbox
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- 2) phone_verifications: server-only (edge functions via service role)
REVOKE ALL ON public.phone_verifications FROM anon, authenticated;
GRANT ALL ON public.phone_verifications TO service_role;
DROP POLICY IF EXISTS "Admins can view phone verifications" ON public.phone_verifications;
CREATE POLICY "Admins can view phone verifications" ON public.phone_verifications
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- 3) wallet_pins: server-only (wallet-pin edge function via service role)
REVOKE ALL ON public.wallet_pins FROM anon, authenticated;
GRANT ALL ON public.wallet_pins TO service_role;
DROP POLICY IF EXISTS "Admins can view wallet pins metadata" ON public.wallet_pins;
CREATE POLICY "Admins can view wallet pins metadata" ON public.wallet_pins
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- 4) ride_demand_zones: restrict read to admins
DROP POLICY IF EXISTS "Anyone authenticated can view demand zones" ON public.ride_demand_zones;
CREATE POLICY "Admins can view demand zones" ON public.ride_demand_zones
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- 5) student_profiles: ensure self-insert only
DROP POLICY IF EXISTS "Users can insert their own student profile" ON public.student_profiles;
CREATE POLICY "Users can insert their own student profile" ON public.student_profiles
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own student profile" ON public.student_profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 6) Storage: tighten luggage-photos driver read to assigned driver only
DROP POLICY IF EXISTS "Approved drivers read luggage photos for relevant rides" ON storage.objects;
CREATE POLICY "Assigned drivers read luggage photos" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'luggage-photos'
    AND is_user_driver(auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.luggage_requests lr
      JOIN public.rides r ON r.id = lr.ride_id
      JOIN public.drivers d ON d.id = r.driver_id
      WHERE objects.name = ANY (lr.image_paths)
        AND d.user_id = auth.uid()
    )
  );
