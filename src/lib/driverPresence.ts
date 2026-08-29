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
  const result = await goBackend.post<{ is_online?: boolean }>('/api/drivers/me/presence', payload);

  if (typeof result?.is_online === 'boolean' && result.is_online !== online) {
    throw new Error('Server did not confirm the requested status change');
  }

  // The write succeeded server-side — any cached copy of this driver's
  // profile is now stale. Without this, a refresh a few seconds later
  // (toggleOnline's own follow-up refresh() included) can read that stale
  // cache entry and silently revert the UI to the pre-toggle state.
  await invalidateDriverProfileCache();

  return { is_online: online };
}
