// Cache Nominatim results to places_cache table
import { supabase } from '@/lib/supabaseClient';
import type { NominatimResult } from '@/lib/geo';
import { cachePlace } from '@/lib/businessApi';

/**
 * Cache a Nominatim result into the places_cache table.
 * Silently ignores duplicate OSM entities (upsert via unique index).
 */
export async function cachePlaceFromNominatim(p: NominatimResult): Promise<void> {
  try {
    const payload = {
      name: p.name ?? null,
      display_name: p.display_name,
      lat: Number(p.lat),
      lon: Number(p.lon),
      osm_type: p.osm_type ?? null,
      osm_id: p.osm_id ? Number(p.osm_id) : null,
      class: p.class ?? null,
      type: p.type ?? null,
      address: p.address ?? null,
    };

    // Check if this place is already cached to avoid 409 conflicts
    if (payload.osm_type && payload.osm_id) {
      const { data: existing } = await supabase
        .from('places_cache')
        .select('id')
        .eq('osm_type', payload.osm_type)
        .eq('osm_id', payload.osm_id)
        .limit(1)
        .maybeSingle();
      if (existing) return; // Already cached
    }

    await cachePlace(payload);

      // Silence all cache errors — they're non-fatal
  } catch {
    // Ignore cache failures (duplicates, auth issues, etc.)
  }
}

/**
 * Search the local places_cache for previously cached results.
 * Useful for offline-first or reducing Nominatim API calls.
 */
export async function searchCachedPlaces(query: string, limit = 10) {
  const { data } = await supabase
    .from('places_cache')
    .select('*')
    .ilike('display_name', `%${query}%`)
    .limit(limit);
  return data ?? [];
}

export interface TownBBox {
  /** min longitude */ left: number;
  /** max latitude  */ top: number;
  /** max longitude */ right: number;
  /** min latitude  */ bottom: number;
}

/**
 * Prefix-first cached search for fast rider suggestions.
 * Prioritizes names/display names that start with the typed text,
 * then falls back to contains matches across cached Zimbabwe places.
 *
 * When `bbox` is supplied results are restricted to that bounding box
 * so a search in Harare only returns Harare places.
 */
export async function searchCachedPlacesPrefix(
  query: string,
  limit = 20,
  bbox?: TownBBox,
) {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const prefix = `${trimmed}%`;
  const contains = `%${trimmed}%`;

  const applyBbox = <T extends { gte: (col: string, v: number) => T; lte: (col: string, v: number) => T }>(q: T): T => {
    if (!bbox) return q;
    const minLng = Math.min(bbox.left, bbox.right);
    const maxLng = Math.max(bbox.left, bbox.right);
    const minLat = Math.min(bbox.top, bbox.bottom);
    const maxLat = Math.max(bbox.top, bbox.bottom);
    return q.gte('lat', minLat).lte('lat', maxLat).gte('lon', minLng).lte('lon', maxLng);
  };

  const [{ data: namePrefix }, { data: displayPrefix }, { data: containsMatches }] = await Promise.all([
    applyBbox(supabase.from('places_cache').select('*').ilike('name', prefix)).limit(limit),
    applyBbox(supabase.from('places_cache').select('*').ilike('display_name', prefix)).limit(limit),
    applyBbox(
      supabase
        .from('places_cache')
        .select('*')
        .or(`name.ilike.${contains},display_name.ilike.${contains}`),
    ).limit(limit),
  ]);

  const merged = [...(namePrefix ?? []), ...(displayPrefix ?? []), ...(containsMatches ?? [])];
  const seen = new Set<string>();

  return merged.filter((row) => {
    const key = row.id ?? `${row.osm_type ?? 'x'}-${row.osm_id ?? row.display_name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit);
}
