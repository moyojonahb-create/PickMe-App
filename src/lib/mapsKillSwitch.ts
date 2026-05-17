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
    if (typeof window !== 'undefined' && window.localStorage?.getItem('enableGoogleMaps') === '1') {
      return false;
    }
    const env = (import.meta as unknown as { env?: Record<string, string> }).env;
    if (env?.VITE_ENABLE_GOOGLE_MAPS === 'true') return false;
  } catch {
    /* ignore */
  }
  return true; // OSM by default
}
