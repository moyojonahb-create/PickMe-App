import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const UA = 'PickMe/1.0 (https://pickme.co.zw; support@pickme.co.zw)';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

async function getJson(url: string) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${res.status} ${body.slice(0, 200)}`);
  }
  return await res.json();
}

/** Photon (Komoot) fallback — no key, no rate-limit blocks on datacenter IPs */
function photonToNominatim(f: any) {
  const p = f?.properties ?? {};
  const [lon, lat] = f?.geometry?.coordinates ?? [];
  const parts = [p.name, p.street, p.district, p.city, p.state, p.country].filter(Boolean);
  return {
    place_id: p.osm_id ?? 0,
    osm_type: p.osm_type ?? '',
    osm_id: p.osm_id ?? 0,
    lat: String(lat ?? ''),
    lon: String(lon ?? ''),
    display_name: parts.join(', '),
    name: p.name ?? p.street ?? p.city ?? '',
    class: p.osm_key,
    type: p.osm_value,
    address: {
      road: p.street,
      suburb: p.district,
      city: p.city,
      state: p.state,
      country: p.country,
    },
  };
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const isReverse = url.searchParams.get('reverse') === '1';

  if (isReverse) {
    const lat = url.searchParams.get('lat');
    const lon = url.searchParams.get('lon');
    if (!lat || !lon) return json({ error: 'Missing lat/lon' }, 400);

    const nom = new URL('https://nominatim.openstreetmap.org/reverse');
    nom.searchParams.set('format', 'jsonv2');
    nom.searchParams.set('lat', lat);
    nom.searchParams.set('lon', lon);
    nom.searchParams.set('addressdetails', '1');
    nom.searchParams.set('zoom', '18');

    try {
      return json(await getJson(nom.toString()));
    } catch (err) {
      console.error('[nominatim-search] reverse primary failed:', String(err));
    }

    try {
      const data = await getJson(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}&lang=en`);
      const f = data?.features?.[0];
      if (f) return json(photonToNominatim(f));
    } catch (err) {
      console.error('[nominatim-search] reverse fallback failed:', String(err));
    }

    // Never hard-fail the UI — return a usable placeholder
    return json({
      place_id: 0,
      osm_type: '',
      osm_id: 0,
      lat,
      lon,
      display_name: `${Number(lat).toFixed(5)}, ${Number(lon).toFixed(5)}`,
      name: 'Selected location',
      address: {},
    });
  }

  const q = url.searchParams.get('q');
  const limit = url.searchParams.get('limit') || '10';
  const countrycodes = url.searchParams.get('countrycodes') || 'zw';
  const viewbox = url.searchParams.get('viewbox');
  const bounded = url.searchParams.get('bounded');

  if (!q) return json({ error: 'Missing query parameter q' }, 400);

  const nom = new URL('https://nominatim.openstreetmap.org/search');
  nom.searchParams.set('format', 'jsonv2');
  nom.searchParams.set('q', q);
  nom.searchParams.set('addressdetails', '1');
  nom.searchParams.set('limit', limit);
  nom.searchParams.set('countrycodes', countrycodes);
  nom.searchParams.set('dedupe', '1');
  if (viewbox) nom.searchParams.set('viewbox', viewbox);
  if (bounded) nom.searchParams.set('bounded', bounded);

  try {
    return json(await getJson(nom.toString()));
  } catch (err) {
    console.error('[nominatim-search] search primary failed:', String(err));
  }

  try {
    const photon = new URL('https://photon.komoot.io/api');
    photon.searchParams.set('q', q);
    photon.searchParams.set('limit', limit);
    photon.searchParams.set('lang', 'en');
    const data = await getJson(photon.toString());
    const feats = (data?.features ?? [])
      .filter((f: any) => !countrycodes || String(f?.properties?.countrycode ?? '').toLowerCase() === countrycodes.toLowerCase())
      .map(photonToNominatim);
    return json(feats);
  } catch (err) {
    console.error('[nominatim-search] search fallback failed:', String(err));
    return json([]);
  }
});
