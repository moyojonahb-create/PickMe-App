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

    const params = new URLSearchParams({
      access_token: TOKEN,
      autocomplete: "true",
      limit: "8",
      country: "zw", // Zimbabwe focus
      language: "en",
    });
    if (lat && lng) params.set("proximity", `${lng},${lat}`);

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
    const results = (data.features as MapboxFeature[] | undefined ?? []).map((f) => ({
      placeId: f.id,
      name: f.text,
      description: f.place_name,
      category: categoryFromFeature(f),
      lat: f.center[1],
      lng: f.center[0],
      source: "mapbox" as const,
    }));

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
