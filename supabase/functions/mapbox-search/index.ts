// Mapbox Geocoding edge function — matches the response shape of
// `google-places-search` so the existing autocomplete hook works unchanged.
//
// GET /mapbox-search?q=...&lat=...&lng=...&radiusKm=...
// GET /mapbox-search?placeId=<mapbox feature id>

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TOKEN = Deno.env.get("MAPBOX_PUBLIC_TOKEN") || Deno.env.get("VITE_MAPBOX_TOKEN") || "";

interface MapboxFeature {
  id: string;
  text: string;
  place_name: string;
  center: [number, number]; // [lng, lat]
  place_type?: string[];
  properties?: Record<string, unknown>;
  context?: Array<{ id: string; text: string }>;
}

function categoryFromFeature(f: MapboxFeature): string {
  const t = f.place_type?.[0] || "";
  const cat = (f.properties?.category as string) || "";
  const map: Record<string, string> = {
    poi: cat ? cat.split(",")[0].replace(/\b\w/g, (s) => s.toUpperCase()) : "Place",
    address: "Address",
    place: "Town",
    locality: "Area",
    neighborhood: "Neighbourhood",
    region: "Region",
    country: "Country",
    postcode: "Postcode",
  };
  return map[t] || "";
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!TOKEN) {
    return new Response(JSON.stringify({ error: "Mapbox token not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const url = new URL(req.url);
    const placeId = url.searchParams.get("placeId");

    // ── Place details: lookup a single feature by id ──
    if (placeId) {
      // Mapbox doesn't have a "details by id" endpoint; the feature id encodes
      // its type. We just re-query by id text using the retrieval endpoint.
      const r = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(placeId)}.json?access_token=${TOKEN}&limit=1`,
      );
      if (!r.ok) {
        return new Response(JSON.stringify({ error: `Mapbox ${r.status}` }), {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const data = await r.json();
      const f: MapboxFeature | undefined = data.features?.[0];
      if (!f) {
        return new Response(JSON.stringify(null), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ lat: f.center[1], lng: f.center[0], name: f.text }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Autocomplete search ──
    const q = url.searchParams.get("q")?.trim();
    if (!q || q.length < 2) {
      return new Response(JSON.stringify([]), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const lat = url.searchParams.get("lat");
    const lng = url.searchParams.get("lng");
    const radiusKm = parseFloat(url.searchParams.get("radiusKm") || "0");
    const viewbox = url.searchParams.get("viewbox"); // "left,top,right,bottom" (minLng,maxLat,maxLng,minLat)

    const params = new URLSearchParams({
      access_token: TOKEN,
      autocomplete: "true",
      limit: "10", // Mapbox hard-caps autocomplete at 10
      country: "zw", // Zimbabwe focus
      language: "en",
      fuzzyMatch: "true",
      types: "poi,address,place,locality,neighborhood,postcode",
    });
    if (lat && lng) params.set("proximity", `${lng},${lat}`);

    // Convert Nominatim viewbox -> Mapbox bbox (minLng,minLat,maxLng,maxLat)
    if (viewbox) {
      const [left, top, right, bottom] = viewbox.split(",").map(Number);
      if ([left, top, right, bottom].every((n) => Number.isFinite(n))) {
        const minLng = Math.min(left, right);
        const maxLng = Math.max(left, right);
        const minLat = Math.min(top, bottom);
        const maxLat = Math.max(top, bottom);
        params.set("bbox", `${minLng},${minLat},${maxLng},${maxLat}`);
      }
    }

    const r = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?${params}`,
    );
    if (!r.ok) {
      return new Response(JSON.stringify({ error: `Mapbox ${r.status}` }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const data = await r.json();
    let results = (data.features as MapboxFeature[] | undefined ?? []).map((f) => ({
      placeId: f.id,
      name: f.text,
      description: f.place_name,
      category: categoryFromFeature(f),
      lat: f.center[1],
      lng: f.center[0],
      source: "mapbox" as const,
    }));

    // Strict radius filter — drop anything outside the town's radius.
    // Belt-and-braces because Mapbox bbox is a soft hint, not a hard filter.
    if (lat && lng && radiusKm > 0) {
      const centerLat = parseFloat(lat);
      const centerLng = parseFloat(lng);
      const toRad = (d: number) => (d * Math.PI) / 180;
      const distKm = (la: number, lo: number) => {
        const R = 6371;
        const dLat = toRad(la - centerLat);
        const dLng = toRad(lo - centerLng);
        const a =
          Math.sin(dLat / 2) ** 2 +
          Math.cos(toRad(centerLat)) * Math.cos(toRad(la)) * Math.sin(dLng / 2) ** 2;
        return 2 * R * Math.asin(Math.sqrt(a));
      };
      results = results.filter((p) => distKm(p.lat, p.lng) <= radiusKm);
    }

    return new Response(JSON.stringify(results), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
