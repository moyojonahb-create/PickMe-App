// Ride expiry utilities
import { adminExpireOldRides } from '@/lib/businessApi';
import { isRequestedRideStatus } from '@/lib/rideContract';

export const RIDE_EXPIRY_SECONDS = 300; // 5 minutes

/**
 * Check if a ride has expired based on its expires_at timestamp
 */
export function isRideExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() < Date.now();
}

/**
 * Get seconds remaining until a ride expires
 */
export function getSecondsRemaining(expiresAt: string | null): number {
  if (!expiresAt) return RIDE_EXPIRY_SECONDS;
  const msLeft = new Date(expiresAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(msLeft / 1000));
}

/**
 * Call the server-side RPC to expire old pending rides
 */
export async function expireOldRides(): Promise<number> {
  try {
    return await adminExpireOldRides();
  } catch (error) {
    console.error('[Expiry] Failed to expire old rides:', error);
    return 0;
  }
}

/**
 * Filter out expired rides from a list
 */
export function filterActiveRides<T extends { expires_at?: string | null; status?: string; ride_status?: string }>(
  rides: T[]
): T[] {
  return rides.filter((r) => {
    if (!isRequestedRideStatus(r.status, r.ride_status)) return true;
    return !isRideExpired(r.expires_at ?? null);
  });
}
