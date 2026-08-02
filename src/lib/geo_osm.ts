// Nationwide Zimbabwe geocoding via Nominatim (OSM)
// No town-specific restrictions — searches across all of Zimbabwe

import { cachePlaceFromNominatim } from '@/lib/placeCache';

export interface NominatimResult {
  place_id: number;
  osm_type: string;
  osm_id: number;
  lat: string;
  lon: string;
  display_name: string;
  name?: string;
  class?: string;
  type?: string;
  address?: Record<string, string>;
}

/**
 * Forward geocode search across Zimbabwe via Nominatim.
 * In dev: uses Vite proxy `/api/nominatim/search`.
 * In production: routes through Supabase Edge Function to avoid CORS.
 */
const NOMINATIM_TIMEOUT_MS = 5000;

export async function searchZW(
  q: string,
  limit = 10,
  viewbox?: { left: number; top: number; right: number; bottom: number },
  bounded = false,
  signal?: AbortSignal
): Promise<NominatimResult[]> {
  let fetchUrl: string;
  const headers: Record<string, string> = { Accept: 'application/json' };

  if (import.meta.env.DEV) {
    // Dev: Vite proxy rewrites /api/nominatim → https://nominatim.openstreetmap.org
    const url = new URL('/api/nominatim/search', window.location.origin);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('q', q);
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('countrycodes', 'zw');
    url.searchParams.set('dedupe', '1');
    if (viewbox) {
      url.searchParams.set('viewbox', `${viewbox.left},${viewbox.top},${viewbox.right},${viewbox.bottom}`);
      if (bounded) url.searchParams.set('bounded', '1');
    }
    fetchUrl = url.toString();
  } else {
    // Production: Supabase Edge Function proxy (avoids CORS + sets proper User-Agent)
    const base = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/nominatim-search`;
    const url = new URL(base);
    url.searchParams.set('q', q);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('countrycodes', 'zw');
    if (viewbox) {
      url.searchParams.set('viewbox', `${viewbox.left},${viewbox.top},${viewbox.right},${viewbox.bottom}`);
      if (bounded) url.searchParams.set('bounded', '1');
    }
    fetchUrl = url.toString();
    headers['apikey'] = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    headers['Authorization'] = `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`;
  }

  // Abort if the request takes too long, or if the caller's own signal fires
  // (e.g. a shared deadline across a bounded + unbounded fallback pair).
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), NOMINATIM_TIMEOUT_MS);
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    const res = await fetch(fetchUrl, { headers, signal: controller.signal });
    if (!res.ok) throw new Error('Place search failed');
    return await res.json();
  } catch (err) {
    if (controller.signal.aborted) return [];
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Reverse geocode coordinates via Nominatim.
 * Returns the closest address/place for the given lat/lon.
 */
export async function reverseZW(lat: number, lon: number): Promise<NominatimResult> {
  let fetchUrl: string;
  const headers: Record<string, string> = { Accept: 'application/json' };

  if (import.meta.env.DEV) {
    const url = new URL('/api/nominatim/reverse', window.location.origin);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('lat', String(lat));
    url.searchParams.set('lon', String(lon));
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('zoom', '18');
    fetchUrl = url.toString();
  } else {
    const base = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/nominatim-search`;
    const url = new URL(base);
    url.searchParams.set('reverse', '1');
    url.searchParams.set('lat', String(lat));
    url.searchParams.set('lon', String(lon));
    fetchUrl = url.toString();
    headers['apikey'] = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    headers['Authorization'] = `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`;
  }

  const res = await fetch(fetchUrl, { headers });
  if (!res.ok) throw new Error('Reverse geocode failed');
  return res.json();
}

/**
 * Search + cache helper: searches nationwide and caches results.
 */
export async function searchAndCache(q: string, limit = 10) {
  const results = await searchZW(q, limit);
  // Cache in background
  for (const r of results) {
    cachePlaceFromNominatim(r).catch(() => {});
  }
  return results.map((r) => ({
    name: r.name || r.display_name.split(',')[0],
    lat: Number(r.lat),
    lng: Number(r.lon),
    displayName: r.display_name,
  }));
}
