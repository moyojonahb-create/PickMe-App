// Offer/bidding system helpers - RLS safe implementation
import { supabase } from '@/lib/supabaseClient';
import { resolveAvatarUrl } from '@/lib/avatarUrl';
import { getCached, setCache } from '@/lib/queryCache';
import { goBackend, type GoOfferCreateRequest } from '@/lib/goBackendClient';
import { decimalToMinor } from '@/lib/money';

export type Offer = {
  id: string;
  ride_id: string;
  driver_id: string;
  price: number;
  eta_minutes: number | null;
  message: string | null;
  status: 'pending' | 'accepted' | 'rejected';
  created_at: string;
};

export type DriverProfile = {
  id: string;
  user_id: string;
  status: string;
  vehicle_type: string | null;
  plate_number: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  is_online: boolean | null;
  trial_ends_at: string | null;
  gender: string | null;
  avatar_url: string | null;
  rating_avg: number | null;
  total_trips: number | null;
};

// Round to nearest $0.50
export function roundTo5(n: number): number {
  return Math.round(Number(n) * 2) / 2;
}

export function clampTo5(n: number, min = 0.50, max = 500): number {
  const rounded = roundTo5(n);
  return Math.min(max, Math.max(min, rounded));
}

// Check if it's night time (after 20:00 or before 05:00)
export function isNightLocal(): boolean {
  const h = new Date().getHours();
  return h >= 20 || h < 5;
}

export function defaultNightMultiplier(): number {
  return isNightLocal() ? 1.2 : 1.0;
}

async function getUserOrThrow() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw new Error(error.message);
  if (!data?.user) throw new Error("Please log in.");
  return data.user;
}

// Fetch pending offers for a ride (with LIMIT to prevent overload)
export async function fetchPendingOffers(rideId: string): Promise<Offer[]> {
  const { data, error } = await supabase
    .from("offers")
    .select("id, ride_id, driver_id, price, eta_minutes, message, status, created_at")
    .eq("ride_id", rideId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(50); // Cap offers per ride

  if (error) throw new Error(error.message);
  return (data ?? []) as Offer[];
}

// Fetch drivers by their user IDs, enriched with profile name
// OPTIMIZED: parallel avatar resolution instead of sequential
export async function fetchDriversByIds(driverIds: string[]): Promise<Record<string, DriverProfile & { full_name?: string | null }>> {
  if (driverIds.length === 0) return {};

  // Fetch drivers and profiles in parallel
  const [driversRes, profilesRes] = await Promise.all([
    supabase
      .from("drivers")
      .select("id, user_id, status, vehicle_type, plate_number, vehicle_make, vehicle_model, is_online, trial_ends_at, gender, avatar_url, rating_avg, total_trips")
      .in("user_id", driverIds)
      .limit(driverIds.length),
    supabase
      .from("profiles")
      .select("user_id, full_name")
      .in("user_id", driverIds)
      .limit(driverIds.length),
  ]);

  if (driversRes.error) throw new Error(driversRes.error.message);

  const nameMap: Record<string, string> = {};
  for (const p of (profilesRes.data ?? [])) {
    if (p.full_name) nameMap[p.user_id] = p.full_name;
  }

  // Resolve all avatars in parallel (was sequential — O(n) → O(1) latency)
  const driverRows = (driversRes.data ?? []) as DriverProfile[];
  const avatarPromises = driverRows.map((row) => resolveAvatarUrl(row.avatar_url));
  const resolvedAvatars = await Promise.all(avatarPromises);

  const map: Record<string, DriverProfile & { full_name?: string | null }> = {};
  driverRows.forEach((row, i) => {
    map[row.user_id] = { ...row, avatar_url: resolvedAvatars[i], full_name: nameMap[row.user_id] || null };
  });
  return map;
}

// Fetch open rides for drivers to bid on (only last 5 minutes)
// OPTIMIZED: added LIMIT 30 to cap returned rides at scale
export async function fetchOpenRides(driverGender?: string | null) {
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("rides")
    .select("id, user_id, status, pickup_address, dropoff_address, pickup_lat, pickup_lon, dropoff_lat, dropoff_lon, fare, distance_km, duration_minutes, vehicle_type, gender_preference, payment_method, passenger_count, town_id, created_at")
    .eq("status", "pending")
    .gte("created_at", fiveMinAgo)
    .order("created_at", { ascending: false })
    .limit(30); // Cap to prevent fetching thousands of rides

  if (error) throw new Error(error.message);
  const rides = data ?? [];

  // Server-side filtering: hide female-only rides from male drivers
  if (driverGender && driverGender !== 'female') {
    return rides.filter((r: Record<string, unknown>) => {
      const gp = r.gender_preference as string | null;
      return !gp || gp === 'any';
    });
  }

  return rides;
}

// Get current driver profile (cached for 30s to reduce repeated calls)
export async function getDriverProfile(): Promise<DriverProfile | null> {
  const user = await getUserOrThrow();
  
  const cacheKey = `driver-profile-${user.id}`;
  const cached = getCached<DriverProfile>(cacheKey);
  if (cached) return cached;

  const { data, error } = await supabase
    .from("drivers")
    .select("id, user_id, status, vehicle_type, plate_number, vehicle_make, vehicle_model, is_online, trial_ends_at, gender, avatar_url, rating_avg, total_trips")
    .eq("user_id", user.id)
    .maybeSingle();
  
  if (error) throw new Error(error.message);
  if (data) setCache(cacheKey, data, 30_000); // 30s TTL
  return data as DriverProfile | null;
}

// Submit a new offer
export async function submitOffer(input: {
  ride_id: string;
  price: number;
  eta_minutes: number;
  message?: string;
}): Promise<Offer> {
  await getUserOrThrow();

  const payload: GoOfferCreateRequest = {
    ride_id: input.ride_id,
    price: input.price,
    price_minor: decimalToMinor(input.price),
    eta_minutes: input.eta_minutes,
    message: input.message || null,
    status: 'pending',
  };

  const data = await goBackend.post<Offer | { offer: Offer }>(`/api/rides/${input.ride_id}/offers`, payload);
  const offer = "offer" in data ? data.offer : data;
  if (!offer?.id) throw new Error("Failed to create offer");
  return offer as Offer;
}

// Decline an offer
export async function declineOffer(offerId: string, rideId?: string): Promise<void> {
  const path = rideId
    ? `/api/rides/${rideId}/offers/${offerId}/reject`
    : `/api/rides/offers/${offerId}/reject`;
  await goBackend.post(path);
}

// Accept an offer
export async function acceptOffer(rideId: string, offerOrId: string | Offer) {
  const offerId = typeof offerOrId === 'string' ? offerOrId : offerOrId.id;
  await getUserOrThrow();
  return goBackend.post(`/api/rides/${rideId}/offers/${offerId}/accept`);
}
