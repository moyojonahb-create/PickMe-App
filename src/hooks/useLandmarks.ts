import { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { getCached, setCache } from '@/lib/queryCache';
import { getDistance } from '@/lib/towns';

export interface Landmark {
  id: string;
  name: string;
  category: string;
  latitude: number;
  longitude: number;
  description: string | null;
  keywords: string[];
  distance?: number; // Calculated client-side when user location is available
  matchScore?: number; // Set when a search query is active; higher = better match
}

// Format distance for display - always show as approximate since this is straight-line distance
// NOT to be used for pricing - only for UI display in search results
export const formatDistance = (distanceKm: number): string => {
  if (distanceKm < 1) {
    return `${Math.round(distanceKm * 1000)}m`;
  }
  return `${distanceKm.toFixed(1)}km`;
};

// Category icons mapping
export const getCategoryIcon = (category: string): 'landmark' | 'building' | 'pin' | 'hospital' | 'school' | 'fuel' | 'market' | 'bank' => {
  const categoryLower = category.toLowerCase();
  if (['rank', 'border', 'town'].includes(categoryLower)) return 'landmark';
  if (['hospital', 'clinic'].includes(categoryLower)) return 'hospital';
  if (['school'].includes(categoryLower)) return 'school';
  if (['fuel station'].includes(categoryLower)) return 'fuel';
  if (['market'].includes(categoryLower)) return 'market';
  if (['bank'].includes(categoryLower)) return 'bank';
  if (['shopping', 'hotel', 'government', 'church'].includes(categoryLower)) return 'building';
  return 'pin';
};

interface UseLandmarksOptions {
  userLocation?: { lat: number; lng: number } | null;
  searchQuery?: string;
  limit?: number;
  radiusKm?: number | null; // Filter by proximity radius
  townCenter?: { lat: number; lng: number } | null; // Filter landmarks to this town
  townRadiusKm?: number | null; // Radius around town center
}

export const useLandmarks = ({ userLocation, searchQuery = '', limit = 10, radiusKm = null, townCenter = null, townRadiusKm = null }: UseLandmarksOptions = {}) => {
  const [landmarks, setLandmarks] = useState<Landmark[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch all landmarks once
  useEffect(() => {
    const fetchLandmarks = async () => {
      // Check cache first (10 min TTL)
      const cached = getCached<Landmark[]>('landmarks');
      if (cached) {
        setLandmarks(cached);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      
      const { data, error: fetchError } = await supabase
        .from('koloi_landmarks')
        .select('*')
        .eq('is_active', true)
        .order('name');

      if (fetchError) {
        console.error('Failed to fetch landmarks:', fetchError);
        setError('Failed to load landmarks');
        setLandmarks([]);
      } else {
        const result = data || [];
        setLandmarks(result);
        setCache('landmarks', result, 10 * 60 * 1000); // 10 min cache
      }
      setLoading(false);
    };

    // Cached data is applied synchronously inside fetchLandmarks; a cold fetch
    // is deferred to idle time so it never competes with first paint.
    const cached = getCached<Landmark[]>('landmarks');
    if (cached) {
      fetchLandmarks();
      return;
    }

    const idle = (window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    }).requestIdleCallback;
    let handle: number;
    if (typeof idle === 'function') {
      handle = idle(() => { void fetchLandmarks(); }, { timeout: 1200 });
      return () => {
        (window as unknown as { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback?.(handle);
      };
    }
    handle = window.setTimeout(() => { void fetchLandmarks(); }, 200);
    return () => window.clearTimeout(handle);
  }, []);

  // ── Server-side search (query >= 3 chars) ──
  // Prefix/contains/keyword search runs against koloi_landmarks directly
  // (pg_trgm-indexed on name) instead of scanning the full client-side
  // dataset above — that dataset stays around only for browse/nearby mode.
  const [searchResults, setSearchResults] = useState<Landmark[]>([]);
  const [searching, setSearching] = useState(false);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const q = searchQuery.trim();
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchAbortRef.current?.abort();

    if (q.length < 3) {
      setSearchResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    searchDebounceRef.current = setTimeout(() => {
      const controller = new AbortController();
      searchAbortRef.current = controller;

      const scopedQuery = () => {
        let query = supabase.from('koloi_landmarks').select('*').eq('is_active', true).abortSignal(controller.signal);
        if (townCenter && townRadiusKm) {
          // Coarse bounding box so the DB index can narrow the scan; a
          // precise circular cut is applied client-side below on the (small)
          // result set, same buffer as the browse-mode filter above.
          const deltaLat = (townRadiusKm + 3) / 111;
          const deltaLng = deltaLat / Math.max(0.15, Math.cos((townCenter.lat * Math.PI) / 180));
          query = query
            .gte('latitude', townCenter.lat - deltaLat).lte('latitude', townCenter.lat + deltaLat)
            .gte('longitude', townCenter.lng - deltaLng).lte('longitude', townCenter.lng + deltaLng);
        }
        return query;
      };

      (async () => {
        try {
          const [prefixRes, containsRes, keywordRes] = await Promise.all([
            scopedQuery().ilike('name', `${q}%`).limit(limit),
            scopedQuery().ilike('name', `%${q}%`).limit(limit),
            scopedQuery().contains('keywords', [q.toLowerCase()]).limit(limit),
          ]);
          if (prefixRes.error) throw prefixRes.error;
          if (containsRes.error) throw containsRes.error;
          if (keywordRes.error) throw keywordRes.error;

          const seen = new Set<string>();
          const merged: Landmark[] = [];
          const addRows = (rows: Landmark[] | null, matchScore: number) => {
            (rows ?? []).forEach((row) => {
              if (seen.has(row.id)) return;
              if (townCenter && townRadiusKm && getDistance(townCenter.lat, townCenter.lng, row.latitude, row.longitude) > townRadiusKm + 3) return;
              seen.add(row.id);
              merged.push({
                ...row,
                matchScore,
                distance: userLocation ? getDistance(userLocation.lat, userLocation.lng, row.latitude, row.longitude) : undefined,
              });
            });
          };
          // Prefix beats contains beats keyword-only matches.
          addRows(prefixRes.data as Landmark[] | null, 3);
          addRows(containsRes.data as Landmark[] | null, 2);
          addRows(keywordRes.data as Landmark[] | null, 1);
          merged.sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0));
          setSearchResults(merged.slice(0, limit));
        } catch (err) {
          if ((err as { name?: string })?.name !== 'AbortError') {
            console.error('Landmark search failed:', err);
            setSearchResults([]);
          }
        } finally {
          if (searchAbortRef.current === controller) setSearching(false);
        }
      })();
    }, 200);

    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      searchAbortRef.current?.abort();
    };
  }, [searchQuery, townCenter?.lat, townCenter?.lng, townRadiusKm, userLocation?.lat, userLocation?.lng, limit]);

  // Browse mode (no query): sort the already-fetched dataset by proximity.
  // Search mode (query >= 3 chars): use the server-searched results above.
  const filteredLandmarks = useMemo(() => {
    if (searchQuery.trim()) return searchResults;

    let results = [...landmarks];

    // Filter by town — a small buffer keeps edge-of-town places from being
    // cut off right at the radius.
    if (townCenter && townRadiusKm) {
      const effectiveRadius = townRadiusKm + 3;
      results = results.filter(landmark => {
        const dist = getDistance(townCenter.lat, townCenter.lng, landmark.latitude, landmark.longitude);
        return dist <= effectiveRadius;
      });
    }

    // Calculate distances if user location is available
    if (userLocation) {
      results = results.map(landmark => ({
        ...landmark,
        distance: getDistance(
          userLocation.lat,
          userLocation.lng,
          landmark.latitude,
          landmark.longitude
        )
      }));

      // Apply proximity filter (within user's radius)
      if (radiusKm !== null) {
        results = results.filter(landmark => (landmark.distance || 0) <= radiusKm);
      }
      results.sort((a, b) => (a.distance || 0) - (b.distance || 0));
    }

    return results.slice(0, limit);
  }, [landmarks, searchQuery, searchResults, userLocation, limit, radiusKm, townCenter, townRadiusKm]);

  // Get nearby landmarks (within specified radius in km)
  const getNearbyLandmarks = (radiusKm: number = 5): Landmark[] => {
    if (!userLocation) return [];
    
    return landmarks
      .map(landmark => ({
        ...landmark,
        distance: getDistance(
          userLocation.lat,
          userLocation.lng,
          landmark.latitude,
          landmark.longitude
        )
      }))
      .filter(landmark => (landmark.distance || 0) <= radiusKm)
      .sort((a, b) => (a.distance || 0) - (b.distance || 0));
  };

  // Find the nearest landmark to a given coordinate
  const findNearestLandmark = (lat: number, lng: number): Landmark | null => {
    if (landmarks.length === 0) return null;

    let nearest: Landmark | null = null;
    let minDistance = Infinity;

    for (const landmark of landmarks) {
      const distance = getDistance(lat, lng, landmark.latitude, landmark.longitude);
      if (distance < minDistance) {
        minDistance = distance;
        nearest = { ...landmark, distance };
      }
    }

    return nearest;
  };

  // Get landmarks by category
  const getLandmarksByCategory = (category: string): Landmark[] => {
    return landmarks.filter(l => l.category.toLowerCase() === category.toLowerCase());
  };

  return {
    landmarks: filteredLandmarks,
    allLandmarks: landmarks,
    loading: searchQuery.trim() ? searching : loading,
    error,
    getNearbyLandmarks,
    findNearestLandmark,
    getLandmarksByCategory,
  };
};
