import { supabase } from '@/integrations/supabase/client';
import { compressImage } from '@/lib/imageCompression';

const BUCKET = 'parcel-photos';

export async function uploadParcelPhoto(file: File | Blob, userId: string): Promise<string> {
  const compressed = await compressImage(file, 1280, 0.8);
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, compressed, {
    contentType: 'image/jpeg',
    upsert: false,
  });
  if (error) throw error;
  return path;
}

export async function deleteParcelPhoto(path: string): Promise<void> {
  await supabase.storage.from(BUCKET).remove([path]);
}

export async function getParcelSignedUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 600);
  if (error) return null;
  return data?.signedUrl ?? null;
}
