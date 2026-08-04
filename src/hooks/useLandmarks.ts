import { useState, useEffect, useMemo } from 'react';
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

  // Fuzzy match score - returns higher score for better matches
  const getFuzzyScore = (text: string, query: string): number => {
    if (!text || !query) return 0;
    
    const textLower = text.toLowerCase();
    const queryLower = query.toLowerCase();
    
    // Exact match
    if (textLower === queryLower) return 100;
    
    // Starts with query
    if (textLower.startsWith(queryLower)) return 80;
    
    // Contains query as a word
    const words = textLower.split(/\s+/);
    if (words.some(w => w.startsWith(queryLower))) return 70;
    
    // Contains query anywhere
    if (textLower.includes(queryLower)) return 50;
    
    // Check each query word separately
    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 1);
    const matchedWords = queryWords.filter(qw => 
      textLower.includes(qw) || words.some(w => w.startsWith(qw))
    );
    if (matchedWords.length > 0) {
      return 30 + (matchedWords.length / queryWords.length) * 20;
    }
    
    return 0;
  };

  // Filter and sort landmarks based on search query, user location, and proximity
  const filteredLandmarks = useMemo(() => {
    let results = [...landmarks];

    // Filter by town for browse mode only.
    // During search, do not hide valid Zimbabwe matches just because they fall outside the current town radius.
    if (townCenter && townRadiusKm) {
      results = results.filter(landmark => {
        const dist = getDistance(townCenter.lat, townCenter.lng, landmark.latitude, landmark.longitude);
        const effectiveRadius = searchQuery.trim() ? Infinity : townRadiusKm;
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
    }

    // Filter by search query with fuzzy matching
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      
      // Score each landmark
      const scoredResults = results.map(landmark => {
        const nameScore = getFuzzyScore(landmark.name, query);
        const categoryScore = getFuzzyScore(landmark.category, query) * 0.5;
        const descriptionScore = getFuzzyScore(landmark.description || '', query) * 0.3;
        const keywordsScore = Math.max(
          0,
          ...(landmark.keywords || []).map(kw => getFuzzyScore(kw, query) * 0.8)
        );
        
        const totalScore = Math.max(nameScore, categoryScore, descriptionScore, keywordsScore);
        
        return { ...landmark, matchScore: totalScore };
      });
      
      // Filter those with any match and sort by score
      results = scoredResults
        .filter(r => r.matchScore > 0)
        .sort((a, b) => b.matchScore - a.matchScore);
    } else if (userLocation) {
      // If no search query but have location, sort by distance
      results.sort((a, b) => (a.distance || 0) - (b.distance || 0));
    }

    return results.slice(0, limit);
  }, [landmarks, searchQuery, userLocation, limit, radiusKm, townCenter, townRadiusKm]);

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
    loading,
    error,
    getNearbyLandmarks,
    findNearestLandmark,
    getLandmarksByCategory,
  };
};
