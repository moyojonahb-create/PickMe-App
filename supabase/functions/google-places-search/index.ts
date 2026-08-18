import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GOOGLE_API_KEY = Deno.env.get('GOOGLE_MAPS_API_KEY') || '';

// ── Category helpers (for Nominatim fallback) ──

function getCategory(cls: string | undefined, type: string | undefined): string {
  if (!cls && !type) return '';
  const c = cls || '';
  const t = type || '';
  const map: Record<string, string> = {
    hospital: 'Hospital', clinic: 'Clinic', pharmacy: 'Pharmacy',
    school: 'School', university: 'University', college: 'College',
    bank: 'Bank', fuel: 'Fuel Station', police: 'Police',
    restaurant: 'Restaurant', fast_food: 'Fast Food', cafe: 'Café',
    bus_station: 'Bus Station', taxi: 'Taxi Rank',
    stadium: 'Stadium', sports_centre: 'Sports Centre',
    marketplace: 'Market', supermarket: 'Supermarket',
    mall: 'Mall', hotel: 'Hotel', church: 'Church',
    mosque: 'Mosque', townhall: 'Town Hall', courthouse: 'Government',
    cinema: 'Cinema', library: 'Library', park: 'Park',
    suburb: 'Suburb', village: 'Village', town: 'Town',
    city: 'City', neighbourhood: 'Neighbourhood',
    bus_stop: 'Bus Stop',
  };
  return map[t] || (c === 'shop' ? 'Shop' : c === 'amenity' ? 'Amenity' : c === 'highway' ? 'Road' : c === 'place' ? 'Area' : '');
}

function getCategoryPriority(cls: string, type: string): number {
  if (['stadium', 'sports_centre'].includes(type)) return 1;
  if (['hospital', 'clinic'].includes(type)) return 2;
  if (['school', 'university', 'college'].includes(type)) return 3;
  if (['townhall', 'courthouse'].includes(type)) return 4;
  if (['bus_station', 'marketplace', 'fuel'].includes(type)) return 5;
  if (cls === 'amenity') return 6;
  if (cls === 'shop') return 7;
  if (cls === 'tourism') return 8;
  if (cls === 'highway') return 9;
  if (cls === 'place') return 10;
  return 12;
}

// ── Google Places type to category label ──
function googleTypeToCategory(types: string[]): string {
  const map: Record<string, string> = {
    hospital: 'Hospital', school: 'School', university: 'University',
    bank: 'Bank', gas_station: 'Fuel Station', police: 'Police',
    restaurant: 'Restaurant', cafe: 'Café', bar: 'Bar',
    bus_station: 'Bus Station', stadium: 'Stadium',
    shopping_mall: 'Mall', supermarket: 'Supermarket',
    lodging: 'Hotel', church: 'Church', mosque: 'Mosque',
    park: 'Park', library: 'Library', museum: 'Museum',
    pharmacy: 'Pharmacy', post_office: 'Post Office',
    airport: 'Airport', train_station: 'Train Station',
    movie_theater: 'Cinema', gym: 'Gym',
    car_repair: 'Auto Services', store: 'Shop',
    locality: 'City', sublocality: 'Suburb',
    neighborhood: 'Neighbourhood', route: 'Road',
  };
  for (const t of types) {
    if (map[t]) return map[t];
  }
  if (types.includes('point_of_interest')) return 'Place';
  if (types.includes('establishment')) return 'Business';
  return '';
}

// ── Search via Google Places Autocomplete ──
// Best-effort: the app runs on a rate-limited demo key, so any non-OK status
// (OVER_QUERY_LIMIT, REQUEST_DENIED, missing key, network error, etc.) just
// falls back to Nominatim below — it must never surface as a client error.
async function searchGoogle(query: string, lat?: string, lng?: string, radiusKm?: number, viewbox?: string, sessionToken?: string) {
  if (!GOOGLE_API_KEY) {
    console.log('[google-places] skipped: GOOGLE_MAPS_API_KEY not set');
    return null;
  }

  const url = new URL('https://maps.googleapis.com/maps/api/place/autocomplete/json');
  url.searchParams.set('input', query);
  url.searchParams.set('key', GOOGLE_API_KEY);
  url.searchParams.set('components', 'country:zw');
  if (sessionToken) url.searchParams.set('sessiontoken', sessionToken);

  // Location bias
  if (lat && lng) {
    url.searchParams.set('location', `${lat},${lng}`);
    url.searchParams.set('radius', String((radiusKm || 15) * 1000));
    url.searchParams.set('strictbounds', 'true');
  }

  try {
    const res = await fetch(url.toString());
    if (!res.ok) {
      console.error('[google-places] autocomplete HTTP error:', res.status);
      return null;
    }
    const data = await res.json();
    if (data.status === 'OVER_QUERY_LIMIT') {
      console.warn('[google-places] daily/rate quota exhausted — falling back to Nominatim');
      return null;
    }
    if (data.status !== 'OK' || !data.predictions?.length) {
      console.log('[google-places] autocomplete status:', data.status, 'count:', data.predictions?.length || 0);
      return null;
    }

    return data.predictions.map((p: any) => ({
      placeId: p.place_id,
      name: p.structured_formatting?.main_text || p.description.split(',')[0],
      description: p.structured_formatting?.secondary_text || p.description,
      category: googleTypeToCategory(p.types || []),
      source: 'google',
    }));
  } catch (err) {
    console.error('[google-places] autocomplete error:', err);
    return null;
  }
}

// ── Get Google Place Details ──
async function getGooglePlaceDetails(placeId: string, sessionToken?: string) {
  if (!GOOGLE_API_KEY) return null;
  const url = new URL('https://maps.googleapis.com/maps/api/place/details/json');
  url.searchParams.set('place_id', placeId);
  url.searchParams.set('key', GOOGLE_API_KEY);
  url.searchParams.set('fields', 'geometry,name,formatted_address,types');
  if (sessionToken) url.searchParams.set('sessiontoken', sessionToken);

  try {
    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status !== 'OK' || !data.result?.geometry?.location) return null;
    return {
      lat: data.result.geometry.location.lat,
      lng: data.result.geometry.location.lng,
      name: data.result.name || data.result.formatted_address?.split(',')[0] || '',
    };
  } catch {
    return null;
  }
}

// ── Nominatim fallback search ──
async function searchNominatim(query: string, lat?: string, lng?: string, radiusKm?: number, viewbox?: string, bounded?: boolean) {
  const searchUrl = new URL('https://nominatim.openstreetmap.org/search');
  searchUrl.searchParams.set('q', `${query}, Zimbabwe`);
  searchUrl.searchParams.set('format', 'json');
  searchUrl.searchParams.set('addressdetails', '1');
  searchUrl.searchParams.set('limit', '15');
  searchUrl.searchParams.set('countrycodes', 'zw');
  searchUrl.searchParams.set('dedupe', '1');
  searchUrl.searchParams.set('extratags', '1');

  if (viewbox) {
    searchUrl.searchParams.set('viewbox', viewbox);
    searchUrl.searchParams.set('bounded', bounded ? '1' : '0');
  } else if (lat && lng) {
    const delta = radiusKm && radiusKm > 0 ? radiusKm / 111 : 0.3;
    const latNum = Number(lat);
    const lngNum = Number(lng);
    searchUrl.searchParams.set('viewbox', `${lngNum - delta},${latNum - delta},${lngNum + delta},${latNum + delta}`);
    searchUrl.searchParams.set('bounded', bounded ? '1' : '0');
  }

  const res = await fetch(searchUrl.toString(), {
    headers: { 'User-Agent': 'PickMeApp/1.0' },
  });
  if (!res.ok) throw new Error(`Nominatim error: ${res.status}`);
  return res.json();
}

// ── Nominatim lookup by OSM ID ──
async function nominatimLookup(osmType: string, osmId: string) {
  const url = new URL('https://nominatim.openstreetmap.org/lookup');
  url.searchParams.set('osm_ids', `${osmType}${osmId}`);
  url.searchParams.set('format', 'json');
  url.searchParams.set('addressdetails', '1');

  const res = await fetch(url.toString(), {
    headers: { 'User-Agent': 'PickMeApp/1.0' },
  });
  if (!res.ok) return null;
  const results = await res.json();
  if (!results?.length) return null;
  return {
    lat: Number(results[0].lat),
    lng: Number(results[0].lon),
    name: results[0].name || results[0].display_name?.split(',')[0] || 'Unknown',
  };
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);

    // ═══ PLACE DETAILS ═══
    const placeId = url.searchParams.get('placeId');
    const sessionToken = url.searchParams.get('sessionToken') || undefined;
    if (placeId) {
      // Google place ID (starts with "Ch" typically)
      if (placeId.startsWith('Ch') || placeId.startsWith('Ei')) {
        const details = await getGooglePlaceDetails(placeId, sessionToken);
        if (details) {
          return new Response(JSON.stringify(details), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      // OSM ID fallback (starts with N/W/R)
      const osmType = placeId.charAt(0);
      const osmId = placeId.substring(1);
      if (['N', 'W', 'R'].includes(osmType)) {
        const result = await nominatimLookup(osmType, osmId);
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify(null), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ═══ AUTOCOMPLETE SEARCH ═══
    const q = url.searchParams.get('q')?.trim();
    const lat = url.searchParams.get('lat');
    const lng = url.searchParams.get('lng');
    const radiusKm = Number(url.searchParams.get('radiusKm') || '15');
    const viewbox = url.searchParams.get('viewbox');
    const bounded = url.searchParams.get('bounded') === '1';

    if (!q || q.length < 2) {
      return new Response(JSON.stringify([]), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 1️⃣ Try Google Places first (best-effort; see searchGoogle for fallback behavior)
    const googleResults = await searchGoogle(q, lat || undefined, lng || undefined, radiusKm, viewbox || undefined, sessionToken);

    if (googleResults && googleResults.length > 0) {
      return new Response(JSON.stringify(googleResults.slice(0, 7)), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2️⃣ Fallback to Nominatim
    console.log('[google-places-search] Google returned no results, falling back to Nominatim');
    let nomResults: any[] = [];
    try {
      nomResults = await searchNominatim(q, lat || undefined, lng || undefined, radiusKm, viewbox || undefined, bounded) || [];
    } catch (nomErr) {
      console.error('[google-places-search] Nominatim failed:', nomErr);
      return new Response(JSON.stringify([]), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const seenNames = new Set<string>();
    const suggestions = nomResults
      .map((r: any) => {
        const name = r.name && r.name.length >= 2 ? r.name : (r.display_name || '').split(',')[0]?.trim() || 'Unknown';
        const category = getCategory(r.class, r.type);
        const priority = getCategoryPriority(r.class || '', r.type || '');
        const descParts = (r.display_name || '').split(',').map((s: string) => s.trim());
        const description = descParts.slice(1, 4).join(', ') || 'Zimbabwe';

        return {
          placeId: `${(r.osm_type || 'node').charAt(0).toUpperCase()}${r.osm_id}`,
          name,
          description,
          category,
          lat: Number(r.lat),
          lng: Number(r.lon),
          source: 'osm',
          _priority: priority,
        };
      })
      .filter((s: any) => {
        const key = s.name.toLowerCase();
        if (seenNames.has(key)) return false;
        seenNames.add(key);
        return true;
      })
      .sort((a: any, b: any) => a._priority - b._priority)
      .map(({ _priority, ...rest }: any) => rest)
      .slice(0, 7);

    return new Response(JSON.stringify(suggestions), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[google-places-search]', error);
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
