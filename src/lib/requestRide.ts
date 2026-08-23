import { supabase } from '@/lib/supabaseClient';
import { goBackend, type GoRideCreateRequest, type GoRideResponse } from '@/lib/goBackendClient';
import { decimalToMinor } from '@/lib/money';
import { queueOfflineRide } from '@/lib/offlineQueue';
import { detectSuspiciousPatterns, reportFraudFlag } from '@/lib/fraudDetection';
import { isRateLimited } from '@/lib/rateLimit';
import { normalizeRideRow } from '@/lib/rideContract';
import { isGoBackendConfigured, isBackendUnavailable } from '@/lib/rideMatching';

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

const REQUEST_RIDE_TIMEOUT_MS = 30_000;

// Bounds the whole ride-request flow (auth check, Go backend call, Supabase
// fallback insert) so a stalled network condition can never leave the
// caller's spinner running forever — see requestRideImpl for the actual work.
//
// The timeout used to just win a Promise.race without cancelling the loser:
// requestRideImpl kept running in the background, and if it eventually
// succeeded the rider — already told "request timed out" — had no way to
// know a ride had actually been created, and would tap again, ending up
// with two live rides. The AbortController below is threaded into every
// underlying network call so the loser genuinely stops instead of finishing
// silently after its caller has already given up on it.
export async function requestRide(input: RequestRideInput) {
  const controller = new AbortController();
  const timeoutPromise = new Promise<{ ok: false; error: string }>((resolve) => {
    setTimeout(() => {
      controller.abort();
      resolve({ ok: false, error: "Request timed out. Please check your connection and try again." });
    }, REQUEST_RIDE_TIMEOUT_MS);
  });
  return Promise.race([requestRideImpl(input, controller.signal), timeoutPromise]);
}

async function requestRideImpl(input: RequestRideInput, signal: AbortSignal) {
  const { data: authData, error: authErr } = await supabase.auth.getUser();
  if (authErr) return { ok: false as const, error: `Auth error: ${authErr.message}` };
  const user = authData?.user;
  if (!user) return { ok: false as const, error: "You must be logged in to request a ride." };

  if (isRateLimited(`ride-request-${user.id}`, 5, 60000)) {
    return { ok: false as const, error: "Too many ride requests. Please wait a moment and try again." };
  }

  // Email verification isn't required for now — signups go straight in
  // without a confirmation-link gate (see Auth.tsx's plain signUp flow).

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

  detectSuspiciousPatterns(user.id).then(flags => {
    for (const flag of flags) reportFraudFlag(user.id, flag).catch(() => {});
  }).catch(() => {});

  const ridePayload: GoRideCreateRequest = {
    user_id: user.id,
    status: input.scheduled_at ? "scheduled" : "pending",
    pickup_address,
    dropoff_address,
    fare,
    estimated_fare_minor: decimalToMinor(fare),
    fare_minor: decimalToMinor(fare),
    currency: "USD",
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

  if (!navigator.onLine) {
    try {
      const queuedId = await queueOfflineRide(ridePayload as Record<string, unknown>);
      if ('serviceWorker' in navigator && 'SyncManager' in window) {
        const reg = await navigator.serviceWorker.ready;
        await (reg as unknown as { sync: { register: (tag: string) => Promise<void> } }).sync.register('sync-rides');
      }
      return { ok: true as const, ride: { id: queuedId, _offline: true } as unknown as RideRow };
    } catch {
      return { ok: false as const, error: "Failed to save ride offline. Please try again." };
    }
  }

  const persistViaSupabase = async () => {
    const row = {
      user_id: user.id,
      status: input.scheduled_at ? "scheduled" : "pending",
      pickup_address,
      dropoff_address,
      pickup_lat: input.pickup_lat,
      pickup_lon: input.pickup_lng,
      dropoff_lat: input.dropoff_lat,
      dropoff_lon: input.dropoff_lng,
      fare,
      distance_km,
      duration_minutes: Math.round(duration_minutes),
      vehicle_type: input.vehicle_type ?? "economy",
      route_polyline: input.route_polyline ?? null,
      passenger_count: input.passenger_count ?? 1,
      payment_method: paymentMethod,
      town_id: input.town_id ?? null,
      gender_preference: input.gender_preference ?? "any",
      ...(input.scheduled_at ? { scheduled_at: input.scheduled_at } : {}),
    };
    const { data, error } = await supabase.from("rides").insert([row] as never).select("*").abortSignal(signal).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Ride request failed: no ride returned");
    const created = data as unknown as RideRow;
    const contactName = input.passenger_name?.trim();
    const contactPhone = input.passenger_phone?.trim();
    if (created?.id && (contactName || contactPhone)) {
      // Passenger contact details are stored separately so that only the rider,
      // the assigned driver and admins can read them (never the open ride feed).
      // Best-effort: the ride itself already exists at this point, so a
      // failure here must not make the caller believe ride creation failed
      // and prompt a duplicate request — it previously did exactly that.
      const { error: contactError } = await supabase.from("ride_passenger_contacts").insert([{
        ride_id: created.id,
        passenger_name: contactName || null,
        passenger_phone: contactPhone || null,
      }] as never);
      if (contactError) console.error("Passenger contact insert failed (ride was still created):", contactError.message);
    }
    return created;
  };


  // Primary path: Go Core backend. Fallback: persist directly to the database
  // so the request still reaches drivers when the Go backend isn't reachable.
  if (!isGoBackendConfigured()) {
    try {
      const ride = await persistViaSupabase();
      return { ok: true as const, ride };
    } catch (e: unknown) {
      return { ok: false as const, error: `Ride request failed: ${(e as Error).message}` };
    }
  }

  try {
    const created = await goBackend.post<GoRideResponse>("/api/rides", ridePayload, signal);
    if (created.ok === false) {
      return { ok: false as const, error: created.reason || "Ride request failed" };
    }
    const ride = normalizeRideRow((created.ride ?? created) as Record<string, unknown>) as unknown as RideRow;
    const rideId = ride.id ?? created.ride_id ?? created.id;
    if (!rideId) return { ok: false as const, error: "Ride request failed: backend did not return a ride id" };
    return { ok: true as const, ride: { ...ride, id: rideId } as RideRow };
  } catch (e: unknown) {
    if (isBackendUnavailable(e)) {
      try {
        const ride = await persistViaSupabase();
        return { ok: true as const, ride };
      } catch (fallbackError: unknown) {
        return { ok: false as const, error: `Ride request failed: ${(fallbackError as Error).message}` };
      }
    }
    return { ok: false as const, error: `Ride request failed: ${(e as Error).message}` };
  }
}
