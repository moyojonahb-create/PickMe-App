import { useState, useCallback, useRef, useEffect } from 'react';

export interface PlaceSuggestion {
  placeId: string;
  name: string;
  description: string;
  category?: string;
  lat?: number;
  lng?: number;
  source?: 'google' | 'osm';
}

/**
 * Hook that calls the google-places-search edge function (server-side).
 * Google Places API is primary, Nominatim is the automatic fallback.
 * API key is NEVER exposed to the frontend.
 */
export function useGooglePlacesAutocomplete() {
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const townRef = useRef<{ lat: number; lng: number; radiusKm: number; viewbox?: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  /** Set the town context so results are restricted to that area */
  const setTownBias = useCallback((center: { lat: number; lng: number }, radiusKm: number, viewbox?: string) => {
    townRef.current = { ...center, radiusKm, viewbox };
  }, []);

  const search = useCallback((query: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!query || query.trim().length < 3) {
      setSuggestions([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    debounceRef.current = setTimeout(async () => {
      // Cancel previous in-flight request
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const base = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-places-search`;
        const url = new URL(base);
        url.searchParams.set('q', query.trim());

        if (townRef.current) {
          url.searchParams.set('lat', String(townRef.current.lat));
          url.searchParams.set('lng', String(townRef.current.lng));
          url.searchParams.set('radiusKm', String(townRef.current.radiusKm));
          if (townRef.current.viewbox) {
            url.searchParams.set('viewbox', townRef.current.viewbox);
            url.searchParams.set('bounded', '1');
          }
        }

        const res = await fetch(url.toString(), {
          signal: controller.signal,
          headers: {
            Accept: 'application/json',
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
        });

        if (!res.ok) throw new Error(`Edge function error: ${res.status}`);
        const results = await res.json();

        if (Array.isArray(results)) {
          setSuggestions(results);
        } else {
          setSuggestions([]);
        }
      } catch (err: unknown) {
        if ((err as { name?: string })?.name !== 'AbortError') {
          console.error('[useGooglePlacesAutocomplete]', err);
          setSuggestions([]);
        }
      } finally {
        setLoading(false);
      }
    }, 300); // 300ms debounce for smooth UX
  }, []);

  const getPlaceDetails = useCallback(
    async (placeId: string, suggestion?: PlaceSuggestion): Promise<{ lat: number; lng: number; name: string } | null> => {
      // If suggestion already has coordinates (from Nominatim/OSM), use directly
      if (suggestion?.lat && suggestion?.lng) {
        return { lat: suggestion.lat, lng: suggestion.lng, name: suggestion.name };
      }

      try {
        const base = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-places-search`;
        const url = new URL(base);
        url.searchParams.set('placeId', placeId);

        const res = await fetch(url.toString(), {
          headers: {
            Accept: 'application/json',
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
        });

        if (!res.ok) return null;
        return await res.json();
      } catch {
        return null;
      }
    },
    []
  );

  const clear = useCallback(() => {
    setSuggestions([]);
    setLoading(false);
  }, []);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  return { suggestions, loading, search, getPlaceDetails, clear, setTownBias };
}
