import { supabase } from '@/integrations/supabase/client';
import { compressImage } from '@/lib/imageCompression';

const BUCKET = 'luggage-photos';

export async function uploadLuggagePhoto(file: File | Blob, userId: string): Promise<string> {
  const compressed = await compressImage(file, 1280, 0.8);
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, compressed, {
    contentType: 'image/jpeg',
    upsert: false,
  });
  if (error) throw error;
  return path;
}

export async function deleteLuggagePhoto(path: string): Promise<void> {
  await supabase.storage.from(BUCKET).remove([path]);
}

export async function getLuggageSignedUrls(paths: string[]): Promise<string[]> {
  if (!paths.length) return [];
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 600);
  if (error) throw error;
  return (data || []).map(d => d.signedUrl);
}
