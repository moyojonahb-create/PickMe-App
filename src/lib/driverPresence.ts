import { goBackend, type GoDriverPresenceRequest } from '@/lib/goBackendClient';
import { invalidateDriverProfileCache } from '@/lib/offerHelpers';
import { supabase } from '@/integrations/supabase/client';

function getCurrentPositionSafe(timeoutMs = 4000): Promise<GeolocationPosition | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) { resolve(null); return; }
    const timer = setTimeout(() => resolve(null), timeoutMs);
    navigator.geolocation.getCurrentPosition(
      (pos) => { clearTimeout(timer); resolve(pos); },
      () => { clearTimeout(timer); resolve(null); },
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 30_000 }
    );
  });
}

export interface DriverPresenceResult {
  is_online: boolean;
}

/** Direct-to-database presence write used when the Go presence API is unreachable. */
async function setPresenceViaSupabase(
  online: boolean,
  latitude: number | undefined,
  longitude: number | undefined,
  originalError: unknown,
): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth?.user?.id;
  if (!userId) {
    throw originalError instanceof Error ? originalError : new Error('You must be signed in to change your status');
  }

  const { data: driverRow } = await supabase
    .from('drivers')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle();

  const driverId = (driverRow as { id?: string } | null)?.id;
  if (!driverId) {
    throw originalError instanceof Error ? originalError : new Error('Driver profile not found');
  }

  const { error: driverErr } = await supabase
    .from('drivers')
    .update({ is_online: online, updated_at: new Date().toISOString() })
    .eq('id', driverId);
  if (driverErr) throw new Error(driverErr.message);

  try {
    await supabase.from('live_locations').upsert(
      {
        driver_id: driverId,
        is_online: online,
        ...(latitude !== undefined && longitude !== undefined ? { latitude, longitude } : {}),
        updated_at: new Date().toISOString(),
      } as never,
      { onConflict: 'driver_id' },
    );
  } catch {
    // Location mirror is best-effort — the heartbeat will correct it.
  }
}


/**
 * Writes driver online/offline status to the backend and only resolves once
 * the write is confirmed — callers must not flip their own UI state before
 * awaiting this. Going online attaches a best-effort GPS fix (falling back
 * to a `knownCoords` hint, e.g. the dashboard's last tracked position) so
 * the driver isn't written to live_locations at (0,0) — that previously
 * left drivers invisible to riders' nearby-driver queries until the next
 * location heartbeat, which read as "stuck offline" even though
 * `drivers.is_online` was already true.
 */
export async function setDriverOnline(
  online: boolean,
  knownCoords?: { lat: number; lng: number } | null
): Promise<DriverPresenceResult> {
  let latitude: number | undefined;
  let longitude: number | undefined;

  if (online) {
    if (knownCoords) {
      latitude = knownCoords.lat;
      longitude = knownCoords.lng;
    } else {
      const pos = await getCurrentPositionSafe();
      if (pos) {
        latitude = pos.coords.latitude;
        longitude = pos.coords.longitude;
      }
    }
  }

  const payload: GoDriverPresenceRequest = {
    is_online: online,
    ...(latitude !== undefined && longitude !== undefined ? { latitude, longitude } : {}),
  };

  try {
    const result = await goBackend.post<{ is_online?: boolean }>('/api/drivers/me/presence', payload);

    if (typeof result?.is_online === 'boolean' && result.is_online !== online) {
      throw new Error('Server did not confirm the requested status change');
    }
  } catch (goErr) {
    // The Go presence service isn't always reachable (not deployed / down /
    // no VITE_API_URL configured). Presence is a simple row flag, so fall
    // back to writing it directly — RLS still scopes it to this driver.
    await setPresenceViaSupabase(online, latitude, longitude, goErr);
  }


  // The write succeeded server-side — any cached copy of this driver's
  // profile is now stale. Without this, a refresh a few seconds later
  // (toggleOnline's own follow-up refresh() included) can read that stale
  // cache entry and silently revert the UI to the pre-toggle state.
  await invalidateDriverProfileCache();

  return { is_online: online };
}
