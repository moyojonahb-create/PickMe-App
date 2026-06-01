// ✅ Request Ride utility - RLS safe implementation with offline support & rate limiting
import { supabase } from '@/lib/supabaseClient';
import { queueOfflineRide } from '@/lib/offlineQueue';
import { detectSuspiciousPatterns, reportFraudFlag } from '@/lib/fraudDetection';
import { isRateLimited } from '@/lib/rateLimit';
import { backendPost } from '@/lib/backendClient';

type RequestRideInput = {
  pickup_address: string;
  dropoff_address: string;
  fare: number;
  distance_km: number;
  duration_minutes: number;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_lat: number;
  dropoff_lng: number;
  vehicle_type?: string;
  route_polyline?: string | null;
  passenger_count?: number;
  scheduled_at?: string;
  payment_method?: string;
  town_id?: string | null;
  gender_preference?: string;
  passenger_name?: string;
  passenger_phone?: string;
};

interface RideRow {
  id: string;
  [key: string]: unknown;
}

export async function requestRide(input: RequestRideInput) {
  const { data: authData, error: authErr } = await supabase.auth.getUser();
  if (authErr) return { ok: false as const, error: `Auth error: ${authErr.message}` };
  const user = authData?.user;
  if (!user) return { ok: false as const, error: "You must be logged in to request a ride." };

  // Rate limit: max 5 ride requests per minute per user
  if (isRateLimited(`ride-request-${user.id}`, 5, 60000)) {
    return { ok: false as const, error: "Too many ride requests. Please wait a moment and try again." };
  }

  // Email verification gate — phone-auth users are exempt
  if (user.email && !user.email_confirmed_at) {
    return { ok: false as const, error: "Please verify your email address before requesting a ride. Check your inbox for a verification link." };
  }

  const pickup_address = (input.pickup_address || "").trim();
  const dropoff_address = (input.dropoff_address || "").trim();
  const fare = Number(input.fare);
  const distance_km = Number(input.distance_km);
  const duration_minutes = Number(input.duration_minutes);
  const paymentMethod = input.payment_method ?? "cash";

  if (!pickup_address) return { ok: false as const, error: "Pickup address is required." };
  if (!dropoff_address) return { ok: false as const, error: "Drop-off address is required." };
  if (!Number.isFinite(fare) || fare <= 0) return { ok: false as const, error: "Fare must be a valid number above 0." };
  if (!Number.isFinite(distance_km) || distance_km <= 0) return { ok: false as const, error: "Distance must be a valid number above 0." };
  if (!Number.isFinite(duration_minutes) || duration_minutes <= 0) return { ok: false as const, error: "Duration must be a valid number above 0." };
  if (!Number.isFinite(input.pickup_lat) || !Number.isFinite(input.pickup_lng)) return { ok: false as const, error: "Pickup coordinates are required." };
  if (!Number.isFinite(input.dropoff_lat) || !Number.isFinite(input.dropoff_lng)) return { ok: false as const, error: "Drop-off coordinates are required." };
  if (!["cash", "wallet"].includes(paymentMethod)) return { ok: false as const, error: "Select a valid payment method." };

  // Run fraud checks in background (don't block ride request)
  detectSuspiciousPatterns(user.id).then(flags => {
    for (const flag of flags) reportFraudFlag(user.id, flag).catch(() => {});
  }).catch(() => {});

  const insertPayload = {
    user_id: user.id,
    status: input.scheduled_at ? "scheduled" : "pending",
    pickup_address,
    dropoff_address,
    fare,
    distance_km,
    duration_minutes,
    pickup_lat: input.pickup_lat,
    pickup_lon: input.pickup_lng,
    dropoff_lat: input.dropoff_lat,
    dropoff_lon: input.dropoff_lng,
    vehicle_type: input.vehicle_type ?? "economy",
    route_polyline: input.route_polyline ?? null,
    passenger_count: input.passenger_count ?? 1,
    payment_method: paymentMethod,
    town_id: input.town_id ?? null,
    gender_preference: input.gender_preference ?? "any",
    ...(input.passenger_name?.trim() ? { passenger_name: input.passenger_name.trim() } : {}),
    ...(input.passenger_phone?.trim() ? { passenger_phone: input.passenger_phone.trim() } : {}),
    ...(input.scheduled_at ? { scheduled_at: input.scheduled_at } : {}),
  };

  // If offline, queue the ride for later
  if (!navigator.onLine) {
    try {
      const queuedId = await queueOfflineRide(insertPayload as Record<string, unknown>);
      // Try to register background sync
      if ('serviceWorker' in navigator && 'SyncManager' in window) {
        const reg = await navigator.serviceWorker.ready;
        await (reg as unknown as { sync: { register: (tag: string) => Promise<void> } }).sync.register('sync-rides');
      }
      return { ok: true as const, ride: { id: queuedId, _offline: true } as unknown as RideRow };
    } catch {
      return { ok: false as const, error: "Failed to save ride offline. Please try again." };
    }
  }

  let data: RideRow | null = null;

  try {
    const result = await backendPost<{
      ok?: boolean;
      reason?: string;
      error?: string;
      ride?: RideRow;
      ride_id?: string;
      fare?: number;
    }>('/api/rides', insertPayload);

    if (result?.ok === false) {
      return { ok: false as const, error: result.reason || result.error || 'Ride could not be created' };
    }

    data = (result.ride ?? (result.ride_id ? { id: result.ride_id, fare: result.fare } : result as RideRow)) as RideRow;
  } catch (e) {
    return { ok: false as const, error: `Ride request failed: ${(e as Error).message}` };
  }

  // Send push notification to online drivers (fire-and-forget)
  try {
    const session = (await supabase.auth.getSession()).data.session;
    if (session?.access_token) {
      fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-notification`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            type: 'ride_requested',
            title: `New ride: ${input.pickup_address} → ${input.dropoff_address}`,
            rideId: (data as RideRow).id,
          }),
        }
      ).catch(() => {}); // Don't block on notification failure
    }
  } catch {
    // Notification is best-effort
  }

  return { ok: true as const, ride: data as RideRow };
}
