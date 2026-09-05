/**
 * Field extractors for backend socket payloads — ported verbatim from
 * src/lib/backendSocketClient.ts. Pure functions, no platform dependencies.
 *
 * They exist because the Go backend sends the same logical field under several
 * names depending on the event (`ride_id` vs `rideId` vs nested `ride.id`, and
 * the room name as a last resort). That normalisation is real business logic
 * and must not be re-derived by hand in the mobile app.
 */

import type { BackendSocketEvent } from './backendSocketClient.js';

function normalizeId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function nestedRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function rideIdFromRoom(roomId: unknown): string | null {
  if (typeof roomId !== 'string' || !roomId.startsWith('ride_')) return null;
  return roomId.slice('ride_'.length) || null;
}

export function eventRideId(event: BackendSocketEvent): string | null {
  const ride = nestedRecord(event.ride);
  return (
    normalizeId(event.ride_id) ??
    normalizeId(event.rideId) ??
    normalizeId(ride?.id) ??
    normalizeId(ride?.ride_id) ??
    rideIdFromRoom(event.room)
  );
}

export function eventDriverId(event: BackendSocketEvent): string | null {
  const offer = nestedRecord(event.offer);
  const ride = nestedRecord(event.ride);
  return (
    normalizeId(event.driver_id) ??
    normalizeId(event.driverId) ??
    normalizeId(offer?.driver_id) ??
    normalizeId(offer?.driverId) ??
    normalizeId(ride?.driver_id)
  );
}

export function eventOfferId(event: BackendSocketEvent): string | null {
  const offer = nestedRecord(event.offer);
  return (
    normalizeId(event.offer_id) ??
    normalizeId(event.offerId) ??
    normalizeId(offer?.id) ??
    normalizeId(offer?.offer_id)
  );
}

export function eventNumber(event: BackendSocketEvent, keys: string[]): number | null {
  for (const key of keys) {
    const value = asNumber((event as Record<string, unknown>)[key]);
    if (value != null) return value;
  }
  for (const container of [nestedRecord(event.offer), nestedRecord(event.ride)]) {
    if (!container) continue;
    for (const key of keys) {
      const value = asNumber(container[key]);
      if (value != null) return value;
    }
  }
  return null;
}

export function eventString(event: BackendSocketEvent, keys: string[]): string | null {
  for (const key of keys) {
    const value = (event as Record<string, unknown>)[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  for (const container of [nestedRecord(event.offer), nestedRecord(event.ride)]) {
    if (!container) continue;
    for (const key of keys) {
      const value = container[key];
      if (typeof value === 'string' && value.trim()) return value;
    }
  }
  return null;
}
