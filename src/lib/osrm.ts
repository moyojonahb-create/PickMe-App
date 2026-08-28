// OSRM (Open Source Routing Machine) integration for Koloi
// Uses the public OSRM demo server - for production, deploy your own OSRM instance

const OSRM_BASE_URL = 'https://router.project-osrm.org';

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface RouteInfo {
  distanceKm: number;
  durationMinutes: number;
  geometry: string | null; // Encoded polyline for map display
}

export interface RouteStep {
  distance: number;
  duration: number;
  name: string;
  maneuver: {
    type: string;
    instruction?: string;
  };
}

/**
 * Get route from OSRM between two points
 * Uses the driving profile which works for roads and tracks
 */
export async function getRoute(
  pickup: Coordinates,
  dropoff: Coordinates
): Promise<RouteInfo | null> {
  try {
    const url = `${OSRM_BASE_URL}/route/v1/driving/${pickup.lng},${pickup.lat};${dropoff.lng},${dropoff.lat}?overview=full&geometries=polyline`;
    
    const response = await fetch(url);
    if (!response.ok) {
      console.error('OSRM request failed:', response.status);
      return null;
    }

    const data = await response.json();
    
    if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
      console.warn('No route found by OSRM');
      return null;
    }

    const route = data.routes[0];
    
    return {
      distanceKm: Math.round((route.distance / 1000) * 10) / 10, // meters to km, 1 decimal
      durationMinutes: Math.round(route.duration / 60), // seconds to minutes
      geometry: route.geometry || null,
    };
  } catch (error) {
    console.error('OSRM routing error:', error);
    return null;
  }
}

/**
 * Calculate straight-line distance (Haversine) as fallback
 */
export function calculateHaversineDistance(a: Coordinates, b: Coordinates): number {
  const R = 6371; // Earth's radius in km
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  
  return 2 * R * Math.asin(Math.sqrt(x));
}

/** A driver's `live_locations` row can genuinely hold (0,0) — a driver who
 * has never sent a real GPS fix, not a rare edge case — and nothing about
 * that value is invalid enough for a null check to catch. Haversine against
 * it against a real pickup/dropoff produces a "valid" but geographically
 * meaningless distance (thousands of km), which is what produced a
 * "9255 min away" ETA with the map zoomed out to the whole continent. */
export function isNullIslandCoord(c: Coordinates): boolean {
  return Math.abs(c.lat) < 0.01 && Math.abs(c.lng) < 0.01;
}

/** No real ride in this product covers this distance — treat anything
 * beyond it as bad data (stale/unset location), not a number to display. */
export const MAX_PLAUSIBLE_RIDE_KM = 150;

export function isPlausibleRideCoord(c: Coordinates): boolean {
  return Number.isFinite(c.lat) && Number.isFinite(c.lng) && !isNullIslandCoord(c);
}

/**
 * Fallback route calculation when OSRM is unavailable
 * Estimates road distance as ~1.4x straight-line distance
 */
export function getFallbackRoute(pickup: Coordinates, dropoff: Coordinates): RouteInfo {
  const straightLineKm = calculateHaversineDistance(pickup, dropoff);
  const estimatedRoadKm = Math.round(straightLineKm * 1.4 * 10) / 10;
  const estimatedMinutes = Math.round(estimatedRoadKm * 2.5); // ~24 km/h average in town
  
  return {
    distanceKm: estimatedRoadKm,
    durationMinutes: estimatedMinutes,
    geometry: null,
  };
}

/**
 * Get route with automatic fallback to Haversine if OSRM fails
 */
export async function getRouteWithFallback(
  pickup: Coordinates,
  dropoff: Coordinates
): Promise<RouteInfo & { isEstimate: boolean }> {
  const osrmRoute = await getRoute(pickup, dropoff);
  
  if (osrmRoute) {
    return { ...osrmRoute, isEstimate: false };
  }
  
  // Fallback to estimated route
  const fallback = getFallbackRoute(pickup, dropoff);
  return { ...fallback, isEstimate: true };
}

/**
 * Check if driver is within arrival distance of pickup (50 meters)
 */
export function isDriverArrived(
  driverLocation: Coordinates,
  pickupLocation: Coordinates,
  thresholdMeters: number = 50
): boolean {
  const distanceKm = calculateHaversineDistance(driverLocation, pickupLocation);
  const distanceMeters = distanceKm * 1000;
  return distanceMeters <= thresholdMeters;
}

/**
 * Get ETA for driver to reach a location
 */
export async function getDriverETA(
  driverLocation: Coordinates,
  destination: Coordinates
): Promise<{ distanceKm: number; etaMinutes: number } | null> {
  const route = await getRouteWithFallback(driverLocation, destination);
  return {
    distanceKm: route.distanceKm,
    etaMinutes: route.durationMinutes,
  };
}
