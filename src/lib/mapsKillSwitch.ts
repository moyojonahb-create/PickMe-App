/**
 * Google Maps kill switch.
 *
 * Default: Google Maps is DISABLED (we use OSM/Leaflet + Nominatim) while
 * Google Cloud billing is unavailable.
 *
 * To re-enable Google Maps later:
 *   - Build env:  VITE_ENABLE_GOOGLE_MAPS=true
 *   - Runtime:    localStorage.setItem('enableGoogleMaps', '1')   // then reload
 */
export function isGoogleMapsDisabled(): boolean {
  try {
    // Explicit opt-out: localStorage.disableGoogleMaps = '1' or VITE_DISABLE_GOOGLE_MAPS=true
    if (typeof window !== 'undefined' && window.localStorage?.getItem('disableGoogleMaps') === '1') {
      return true;
    }
    const env = (import.meta as unknown as { env?: Record<string, string> }).env;
    if (env?.VITE_DISABLE_GOOGLE_MAPS === 'true') return true;
    // Explicit force-on still honored for backwards compat
    if (typeof window !== 'undefined' && window.localStorage?.getItem('enableGoogleMaps') === '1') {
      return false;
    }
    if (env?.VITE_ENABLE_GOOGLE_MAPS === 'true') return false;
  } catch {
    /* ignore */
  }
  return false; // Google Maps enabled by default (key is configured)
}
