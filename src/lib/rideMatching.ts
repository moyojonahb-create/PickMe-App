/**
 * Supabase (Lovable Cloud) fallback for the rider matching pipeline.
 *
 * The primary pipeline is the Go Core backend. When `VITE_GO_BACKEND_URL` /
 * `VITE_API_URL` is not configured (or the backend is unreachable), the rider
 * would otherwise dead-end on "Find Drivers". These helpers persist and read
 * the same data directly from the database so the flow keeps working:
 *
 *   rides            → the ride request itself (rider inserts, RLS scoped)
 *   offers           → driver bids on a pending ride
 *   accept_ride_offer→ security-definer RPC that assigns the driver
 *   live_locations   → driver position while en route
 */
import { supabase } from '@/lib/supabaseClient';
import { getGoBackendBaseUrl, goBackend } from '@/lib/goBackendClient';
import { decimalToMinor } from '@/lib/money';

export function isGoBackendConfigured(): boolean {
  return Boolean(getGoBackendBaseUrl());
}

/** True when the error means "backend unavailable", not "request rejected".
 *
 * UNAUTHENTICATED is included alongside the network-level codes: it covers
 * both "no local session at all" (the Supabase fallback will fail the same
 * way and surface a clear error) and "the backend rejected an otherwise-
 * valid token" (e.g. a backend-side signing-secret misconfiguration) — in
 * that second case the same token is perfectly valid for a direct Supabase
 * call, so falling back is what actually lets the rider proceed instead of
 * silently dead-ending on a 401 the backend shouldn't have sent. */
export function isBackendUnavailable(error: unknown): boolean {
  if (!isGoBackendConfigured()) return true;
  const code = (error as { code?: string } | null)?.code;
  return code === 'NETWORK_ERROR' || code === 'BAD_RESPONSE' || code === 'SERVER_ERROR' || code === 'UNAUTHENTICATED';
}

export type MatchingRide = {
  id: string;
  user_id: string;
  driver_id: string | null;
  status: string;
  pickup_address: string;
  dropoff_address: string;
  pickup_lat: number;
  pickup_lon: number;
  dropoff_lat: number;
  dropoff_lon: number;
  fare: number;
  distance_km: number;
  duration_minutes: number;
  route_polyline?: string | null;
  expires_at?: string | null;
  created_at?: string;
};

export type MatchedDriver = {
  id: string;
  user_id: string;
  full_name: string | null;
  phone: string | null;
  avatar_url: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_color: string | null;
  plate_number: string | null;
  rating_avg: number | null;
  total_trips: number | null;
};

export async function fetchRideById(rideId: string): Promise<MatchingRide | null> {
  const { data, error } = await supabase
    .from('rides')
    .select(
      'id, user_id, driver_id, status, pickup_address, dropoff_address, pickup_lat, pickup_lon, dropoff_lat, dropoff_lon, fare, distance_km, duration_minutes, route_polyline, expires_at, created_at'
    )
    .eq('id', rideId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as unknown as MatchingRide) ?? null;
}

export async function cancelRideRequest(rideId: string, reason?: string): Promise<void> {
  const { error } = await supabase
    .from('rides')
    .update({ status: 'cancelled' } as never)
    .eq('id', rideId);
  if (error) throw new Error(error.message);

  // Best-effort — the cancellation itself already succeeded above, so a
  // failure to log the reason shouldn't surface as an error to the rider.
  if (reason) {
    const { data: auth } = await supabase.auth.getUser();
    supabase
      .from('trip_events')
      .insert([{ ride_id: rideId, actor_id: auth?.user?.id ?? null, event_type: 'ride_cancelled', payload: { reason } }] as never)
      .then(({ error: eventError }) => {
        if (eventError) console.warn('Could not log cancellation reason:', eventError.message);
      });
  }
}

/** Bumps the offered fare while a ride is still pending, so it reaches more
 * drivers — mirrors Handler.PatchRide's `status = 'pending'` guard. */
export async function updateRideFare(rideId: string, fare: number): Promise<void> {
  const viaSupabase = async () => {
    const { error } = await supabase
      .from('rides')
      .update({ fare } as never)
      .eq('id', rideId)
      .eq('status', 'pending');
    if (error) throw new Error(error.message);
  };

  if (!isGoBackendConfigured()) return viaSupabase();
  try {
    await goBackend.patch(`/api/rides/${rideId}`, { fare_minor: decimalToMinor(fare) });
  } catch (error) {
    if (isBackendUnavailable(error)) return viaSupabase();
    throw error;
  }
}

/** Assigned-driver details. Readable by the rider once the ride is accepted. */
export async function fetchAssignedDriver(driverId: string): Promise<MatchedDriver | null> {
  const { data, error } = await supabase
    .from('drivers')
    .select('id, user_id, vehicle_make, vehicle_model, vehicle_color, plate_number, rating_avg, total_trips, avatar_url')
    .eq('id', driverId)
    .maybeSingle();
  if (error || !data) return null;

  const row = data as unknown as Record<string, unknown>;
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, phone')
    .eq('user_id', String(row.user_id))
    .maybeSingle();

  return {
    id: String(row.id),
    user_id: String(row.user_id),
    full_name: (profile?.full_name as string | null) ?? null,
    phone: (profile?.phone as string | null) ?? null,
    avatar_url: (row.avatar_url as string | null) ?? null,
    vehicle_make: (row.vehicle_make as string | null) ?? null,
    vehicle_model: (row.vehicle_model as string | null) ?? null,
    vehicle_color: (row.vehicle_color as string | null) ?? null,
    plate_number: (row.plate_number as string | null) ?? null,
    rating_avg: (row.rating_avg as number | null) ?? null,
    total_trips: (row.total_trips as number | null) ?? null,
  };
}

/** Latest known position of the assigned driver (RLS-scoped to active trips). */
export async function fetchDriverLocation(driverUserId: string): Promise<{ lat: number; lng: number } | null> {
  const { data } = await supabase
    .from('live_locations')
    .select('latitude, longitude')
    .eq('user_id', driverUserId)
    .maybeSingle();
  if (!data) return null;
  return { lat: Number(data.latitude), lng: Number(data.longitude) };
}
