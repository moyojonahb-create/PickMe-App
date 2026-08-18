-- Add vehicle_photo_url column to drivers table
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS vehicle_photo_url text;

-- Create private storage bucket for vehicle photos (mirrors driver-avatars)
INSERT INTO storage.buckets (id, name, public) VALUES ('vehicle-photos', 'vehicle-photos', false)
ON CONFLICT (id) DO NOTHING;

-- Allow drivers to upload their own vehicle photo
CREATE POLICY "Drivers can upload their own vehicle photo"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'vehicle-photos'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Allow drivers to update their own vehicle photo
CREATE POLICY "Drivers can update their own vehicle photo"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'vehicle-photos'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Allow authenticated users to view vehicle photos
CREATE POLICY "Authenticated users can view vehicle photos"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'vehicle-photos'
  AND auth.uid() IS NOT NULL
);

-- Allow drivers to delete their own vehicle photo
CREATE POLICY "Drivers can delete their own vehicle photo"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'vehicle-photos'
  AND auth.uid()::text = (storage.foldername(name))[1]
);
