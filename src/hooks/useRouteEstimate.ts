/* eslint-disable react-hooks/exhaustive-deps */
import { useCallback, useEffect, useState } from "react";
import { getFallbackRoute, type Coordinates } from "@/lib/osrm";

interface RouteEstimateData {
  distanceKm: number;
  durationMinutes: number;
  durationInTrafficMinutes: number;
  geometry: string | null;
  isTrafficAware: boolean;
  isEstimate: boolean;
}

interface UseRouteEstimateResult {
  route: RouteEstimateData | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useRouteEstimate(pickup: Coordinates | null, dropoff: Coordinates | null): UseRouteEstimateResult {
  const [route, setRoute] = useState<RouteEstimateData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRoute = useCallback(async () => {
    if (!pickup || !dropoff) {
      setRoute(null);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const fallback = getFallbackRoute(pickup, dropoff);
      setRoute({
        distanceKm: fallback.distanceKm,
        durationMinutes: fallback.durationMinutes,
        durationInTrafficMinutes: fallback.durationMinutes,
        geometry: null,
        isTrafficAware: false,
        isEstimate: true,
      });
      setError("Using estimated route");
    } catch {
      setError("Failed to calculate route");
      setRoute(null);
    } finally {
      setLoading(false);
    }
  }, [pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng]);

  useEffect(() => {
    fetchRoute();
  }, [fetchRoute]);

  return { route, loading, error, refetch: fetchRoute };
}
