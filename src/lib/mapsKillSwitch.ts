/**
 * Map provider switch.
 *
 * Default: Mapbox is the PRIMARY map provider. Google Maps is loaded in the
 * background as a fallback (for routing, places, etc.) but the visible tiles
 * use Mapbox unless the user opts in.
 *
 * To force Google Maps as the visible provider:
 *   - Build env:  VITE_ENABLE_GOOGLE_MAPS=true
 *   - Runtime:    localStorage.setItem('enableGoogleMaps', '1')   // then reload
 */
export function isGoogleMapsDisabled(): boolean {
  try {
    if (typeof window !== 'undefined' && window.localStorage?.getItem('disableGoogleMaps') === '1') {
      return true;
    }
    const env = (import.meta as unknown as { env?: Record<string, string> }).env;
    if (env?.VITE_DISABLE_GOOGLE_MAPS === 'true') return true;
    if (typeof window !== 'undefined' && window.localStorage?.getItem('enableGoogleMaps') === '1') {
      return false;
    }
    if (env?.VITE_ENABLE_GOOGLE_MAPS === 'true') return false;
  } catch {
    /* ignore */
  }
  return true; // Mapbox primary by default; Google Maps stays available as backup.
}
