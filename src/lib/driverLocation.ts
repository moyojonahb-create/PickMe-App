import { supabase } from "@/integrations/supabase/client";
import { goBackend, type GoDriverLocationRequest } from "@/lib/goBackendClient";

// Cache userId to avoid repeated auth calls (10K drivers × every 10s = 100K calls/min)
let cachedUserId: string | null = null;

async function getUserId(): Promise<string | null> {
  if (cachedUserId) return cachedUserId;
  const { data } = await supabase.auth.getUser();
  cachedUserId = data?.user?.id ?? null;
  return cachedUserId;
}

// Clear cache on sign-out
supabase.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT") cachedUserId = null;
});

// Deduplicate: skip upsert if driver hasn't moved significantly
let lastSentLat = 0;
let lastSentLng = 0;
const MIN_MOVE_THRESHOLD = 0.00005; // ~5m

/**
 * Update the driver's current location in the database.
 * Skips DB write if position hasn't changed significantly (saves ~70% of writes at 10K scale).
 */
export async function updateDriverLocation(lat: number, lng: number): Promise<void> {
  const userId = await getUserId();
  if (!userId) {
    console.warn("[DriverLocation] No user logged in");
    return;
  }

  // Skip if barely moved
  const dLat = Math.abs(lat - lastSentLat);
  const dLng = Math.abs(lng - lastSentLng);
  if (dLat < MIN_MOVE_THRESHOLD && dLng < MIN_MOVE_THRESHOLD && lastSentLat !== 0) {
    return;
  }

  try {
    const payload: GoDriverLocationRequest = {
      latitude: lat,
      longitude: lng,
    };
    await goBackend.post("/api/drivers/me/location", payload);
    lastSentLat = lat;
    lastSentLng = lng;
  } catch (error) {
    console.error("[DriverLocation] Failed to update location:", error);
  }
}

/**
 * Calculate distance between two points using Haversine formula
 */
export function calculateDistance(
  lat1: number, 
  lon1: number, 
  lat2: number, 
  lon2: number
): number {
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Filter and sort rides by distance from driver's location
 */
export function filterRidesByDistance<T extends { pickup_lat: number; pickup_lon: number }>(
  rides: T[],
  driverLat: number,
  driverLng: number,
  maxDistanceKm: number = 10
): (T & { distance_km: number })[] {
  return rides
    .map((ride) => ({
      ...ride,
      distance_km: calculateDistance(driverLat, driverLng, ride.pickup_lat, ride.pickup_lon),
    }))
    .filter((ride) => ride.distance_km <= maxDistanceKm)
    .sort((a, b) => a.distance_km - b.distance_km);
}
