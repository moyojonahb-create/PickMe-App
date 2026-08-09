DROP POLICY IF EXISTS "Admins can update student docs" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete student docs" ON storage.objects;

CREATE POLICY "Admins can update student docs"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'student-verification' AND public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (bucket_id = 'student-verification' AND public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can delete student docs"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'student-verification' AND public.has_role(auth.uid(), 'admin'::public.app_role));