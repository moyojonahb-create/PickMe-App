import { supabase } from '@/lib/supabaseClient';
import { fetchOpenRides } from '@/lib/offerHelpers';

export interface EnrichedRideRequest {
  id: string;
  pickup_address: string;
  dropoff_address: string;
  pickup_lat: number | null;
  pickup_lon: number | null;
  dropoff_lat: number | null;
  dropoff_lon: number | null;
  fare: number;
  distance_km: number;
  duration_minutes: number;
  passenger_count?: number;
  payment_method?: string;
  vehicle_type?: string;
  expires_at?: string | null;
  created_at?: string;
  passenger_name?: string | null;
  passenger_phone?: string | null;
  passenger_gender: string | null;
  preferences: {
    quiet_ride: boolean;
    cool_temperature: boolean;
    wav_required: boolean;
    hearing_impaired: boolean;
  } | null;
  hasLuggage: boolean;
}

/** Open ride requests enriched with the passenger's gender and preferences
 * — the same per-ride batch pattern DriverDashboard.tsx already uses for
 * ride_preferences, extended to also cover profiles.gender and
 * luggage_requests so the new Ride Requests / Ride Details screens can show
 * real passenger info instead of guessing. */
export async function fetchEnrichedOpenRides(driverGender?: string | null): Promise<EnrichedRideRequest[]> {
  const rides = await fetchOpenRides(driverGender);
  if (rides.length === 0) return [];

  const rideIds = rides.map((r) => String(r.id));
  const userIds = Array.from(new Set(rides.map((r) => String(r.user_id ?? r.rider_id ?? '')).filter(Boolean)));

  const [prefsRes, luggageRes, profilesRes] = await Promise.all([
    supabase.from('ride_preferences').select('ride_id, quiet_ride, cool_temperature, wav_required, hearing_impaired').in('ride_id', rideIds),
    supabase.from('luggage_requests').select('ride_id').in('ride_id', rideIds),
    userIds.length > 0 ? supabase.from('profiles').select('user_id, gender').in('user_id', userIds) : Promise.resolve({ data: [] as { user_id: string; gender: string | null }[] }),
  ]);

  const prefsMap = new Map((prefsRes.data ?? []).map((p) => [p.ride_id, p]));
  const luggageSet = new Set((luggageRes.data ?? []).map((l) => l.ride_id));
  const genderMap = new Map((profilesRes.data ?? []).map((p) => [p.user_id, p.gender]));

  return rides.map((r) => {
    const row = r as unknown as Record<string, unknown>;
    const userId = String(row.user_id ?? row.rider_id ?? '');
    const prefs = prefsMap.get(String(row.id));
    return {
      id: String(row.id),
      pickup_address: String(row.pickup_address ?? row.pickup_location ?? ''),
      dropoff_address: String(row.dropoff_address ?? row.dropoff_location ?? ''),
      pickup_lat: row.pickup_lat != null ? Number(row.pickup_lat) : null,
      pickup_lon: row.pickup_lon != null ? Number(row.pickup_lon) : null,
      dropoff_lat: row.dropoff_lat != null ? Number(row.dropoff_lat) : null,
      dropoff_lon: row.dropoff_lon != null ? Number(row.dropoff_lon) : null,
      fare: Number(row.fare ?? row.estimated_fare ?? 0),
      distance_km: Number(row.distance_km ?? 0),
      duration_minutes: Number(row.duration_minutes ?? 0),
      passenger_count: row.passenger_count ? Number(row.passenger_count) : undefined,
      payment_method: row.payment_method ? String(row.payment_method) : undefined,
      vehicle_type: row.vehicle_type ? String(row.vehicle_type) : undefined,
      expires_at: (row.expires_at as string | null | undefined) ?? null,
      created_at: row.created_at ? String(row.created_at) : undefined,
      passenger_name: (row.passenger_name as string | null | undefined) ?? null,
      passenger_phone: (row.passenger_phone as string | null | undefined) ?? null,
      passenger_gender: genderMap.get(userId) ?? null,
      preferences: prefs
        ? {
            quiet_ride: Boolean(prefs.quiet_ride),
            cool_temperature: Boolean(prefs.cool_temperature),
            wav_required: Boolean(prefs.wav_required),
            hearing_impaired: Boolean(prefs.hearing_impaired),
          }
        : null,
      hasLuggage: luggageSet.has(String(row.id)),
    };
  });
}
