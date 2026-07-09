CREATE POLICY "Users can delete their own student docs"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'student-verification'
  AND (auth.uid())::text = (storage.foldername(name))[1]
);