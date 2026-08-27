/**
 * Client-side "not interested" list for a driver browsing open ride
 * requests. Declining a ride (from the list swipe/Decline button, or from
 * the ride-request detail screen's header Decline) hides it from this
 * driver's list for the rest of the session — the ride itself stays open
 * for every other driver, this is purely a per-device view filter, not a
 * backend decline/reject on the ride.
 */
import { SafeStorage } from './safeStorage';

const KEY = 'cruixe_driver_dismissed_rides';

export function getDismissedRideIds(): Set<string> {
  try {
    const raw = SafeStorage.get(KEY);
    if (!raw) return new Set();
    const ids = JSON.parse(raw);
    return Array.isArray(ids) ? new Set(ids) : new Set();
  } catch {
    return new Set();
  }
}

export function dismissRide(rideId: string): void {
  const ids = getDismissedRideIds();
  ids.add(rideId);
  SafeStorage.set(KEY, JSON.stringify(Array.from(ids)));
}

/** Reverses dismissRide — used by the list's "Undo" toast, so undoing a
 * swipe doesn't leave the ride re-hidden the next time the list mounts. */
export function undismissRide(rideId: string): void {
  const ids = getDismissedRideIds();
  ids.delete(rideId);
  SafeStorage.set(KEY, JSON.stringify(Array.from(ids)));
}
