/**
 * Kill switch for Google Maps.
 *
 * When ON, the app renders the OSM (Leaflet) map and uses Nominatim search
 * instead of Google. Use this while Google billing / key is unavailable.
 *
 * Enable via either:
 *   - Build env:   VITE_DISABLE_GOOGLE_MAPS=true
 *   - Runtime:     localStorage.setItem('disableGoogleMaps', '1')   // then reload
 *
 * Disable:
 *   - Remove the env var, or
 *   - localStorage.removeItem('disableGoogleMaps')
 */
export function isGoogleMapsDisabled(): boolean {
  try {
    const env = (import.meta as unknown as { env?: Record<string, string> }).env;
    if (env?.VITE_DISABLE_GOOGLE_MAPS === 'true') return true;
    if (typeof window !== 'undefined' && window.localStorage?.getItem('disableGoogleMaps') === '1') return true;
  } catch {
    /* ignore */
  }
  return false;
}
