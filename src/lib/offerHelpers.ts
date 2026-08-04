// Offer/bidding system helpers - RLS safe implementation
import { supabase } from '@/lib/supabaseClient';
import { resolveAvatarUrl } from '@/lib/avatarUrl';
import { getCached, setCache } from '@/lib/queryCache';
import { goBackend, type GoOfferCreateRequest } from '@/lib/goBackendClient';
import { decimalToMinor } from '@/lib/money';
import { normalizeRideRow } from '@/lib/rideContract';
import { isGoBackendConfigured, isBackendUnavailable } from '@/lib/rideMatching';

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

type GoOfferResponse = {
  id?: string;
  offer_id?: string;
  ride_id?: string;
  request_id?: string;
  driver_id: string;
  amount?: number;
  price?: number;
  fare?: number;
  offered_fare?: number;
  eta_minutes?: number | null;
  message?: string | null;
  status?: 'pending' | 'accepted' | 'rejected';
  created_at?: string;
};

function normalizeOffer(row: GoOfferResponse, rideId: string): Offer {
  const id = String(row.id ?? row.offer_id ?? "");
  if (!id) throw new Error("Offer response missing id");
  return {
    id,
    ride_id: String(row.ride_id ?? row.request_id ?? rideId),
    driver_id: row.driver_id,
    price: Number(row.price ?? row.amount ?? row.fare ?? row.offered_fare ?? 0),
    eta_minutes: row.eta_minutes ?? null,
    message: row.message ?? null,
    status: row.status ?? "pending",
    created_at: row.created_at ?? new Date().toISOString(),
  };
}

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
  const viaSupabase = async (): Promise<Offer[]> => {
    const { data, error } = await supabase
      .from('offers')
      .select('id, ride_id, driver_id, price, eta_minutes, message, status, created_at')
      .eq('ride_id', rideId)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(50);
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => normalizeOffer(row as unknown as GoOfferResponse, rideId));
  };

  if (!isGoBackendConfigured()) return viaSupabase();
  try {
    const data = await goBackend.get<GoOfferResponse[]>(`/api/rides/${rideId}/offers`);
    return (data ?? []).slice(0, 50).map((offer) => normalizeOffer(offer, rideId));
  } catch (error) {
    if (isBackendUnavailable(error)) return viaSupabase();
    throw error;
  }
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
  const viaSupabase = async () => {
    const { data, error } = await supabase
      .from('rides')
      .select('*')
      .eq('status', 'pending')
      .is('driver_id', null)
      .order('created_at', { ascending: false })
      .limit(30);
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as Record<string, unknown>[];
  };

  let raw: Record<string, unknown>[];
  if (!isGoBackendConfigured()) {
    raw = await viaSupabase();
  } else {
    try {
      raw = (await goBackend.get<Record<string, unknown>[]>("/api/rides/open")) ?? [];
    } catch (error) {
      if (!isBackendUnavailable(error)) throw error;
      raw = await viaSupabase();
    }
  }
  const rides = raw.map((ride) => normalizeRideRow(ride));

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
  };

  const viaSupabase = async (): Promise<Offer> => {
    const user = await getUserOrThrow();
    const { data, error } = await supabase
      .from('offers')
      .insert([{
        ride_id: input.ride_id,
        driver_id: user.id,
        price: input.price,
        eta_minutes: input.eta_minutes,
        message: input.message || null,
        status: 'pending',
      }] as never)
      .select('id, ride_id, driver_id, price, eta_minutes, message, status, created_at')
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error('Offer could not be created');
    return normalizeOffer(data as unknown as GoOfferResponse, input.ride_id);
  };

  if (!isGoBackendConfigured()) return viaSupabase();
  try {
    const data = await goBackend.post<GoOfferResponse | { offer: GoOfferResponse }>(`/api/rides/${input.ride_id}/offers`, payload);
    const offer = "offer" in data ? data.offer : data;
    return normalizeOffer(offer, input.ride_id);
  } catch (error) {
    if (isBackendUnavailable(error)) return viaSupabase();
    throw error;
  }
}

// Decline an offer
export async function declineOffer(offerId: string, rideId?: string): Promise<void> {
  const viaSupabase = async () => {
    const { error } = await supabase
      .from('offers')
      .update({ status: 'rejected' } as never)
      .eq('id', offerId);
    if (error) throw new Error(error.message);
  };

  if (!isGoBackendConfigured()) return viaSupabase();
  const path = rideId
    ? `/api/rides/${rideId}/offers/${offerId}/reject`
    : `/api/rides/offers/${offerId}/reject`;
  try {
    await goBackend.post(path);
  } catch (error) {
    if (isBackendUnavailable(error)) return viaSupabase();
    throw error;
  }
}

// Accept an offer
export async function acceptOffer(rideId: string, offerOrId: string | Offer) {
  const offerId = typeof offerOrId === 'string' ? offerOrId : offerOrId.id;
  await getUserOrThrow();

  const viaSupabase = async () => {
    const { data, error } = await supabase.rpc('accept_ride_offer' as never, {
      p_ride_id: rideId,
      p_offer_id: offerId,
    } as never);
    if (error) throw new Error(error.message);
    const result = data as unknown as { ok?: boolean; reason?: string } | null;
    if (result && result.ok === false) throw new Error(result.reason || 'Could not accept offer');
    return result;
  };

  if (!isGoBackendConfigured()) return viaSupabase();
  try {
    return await goBackend.post(`/api/rides/${rideId}/offers/${offerId}/accept`);
  } catch (error) {
    if (isBackendUnavailable(error)) return viaSupabase();
    throw error;
  }
}
