/**
 * Mapbox token loader.
 *
 * Resolution order:
 *   1. import.meta.env.VITE_MAPBOX_TOKEN (build-time)
 *   2. `mapbox-token` edge function (runtime secret MAPBOX_PUBLIC_TOKEN)
 *
 * Public tokens (pk.*) are designed for client-side use. Restrict by URL
 * in your Mapbox dashboard.
 */
import { supabase } from '@/integrations/supabase/client';

let cached: string | null = null;
let inFlight: Promise<string> | null = null;

export async function getMapboxToken(): Promise<string> {
  if (cached) return cached;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const envToken = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_MAPBOX_TOKEN;
    if (typeof envToken === 'string' && envToken.startsWith('pk.')) {
      cached = envToken;
      return envToken;
    }
    const { data, error } = await supabase.functions.invoke('mapbox-token');
    if (error) throw new Error(`mapbox-token: ${error.message}`);
    const token = (data as { token?: string } | null)?.token;
    if (!token) throw new Error('Mapbox token missing on server');
    cached = token;
    return token;
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

export function resetMapboxToken() {
  cached = null;
  inFlight = null;
}
