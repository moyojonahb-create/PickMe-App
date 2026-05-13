/**
 * Centralized Google Maps JS API loader (singleton).
 * - Reads key from import.meta.env.VITE_GOOGLE_MAPS_API_KEY only.
 * - Injects the script exactly once.
 * - Loads required libraries: places, geometry, routes, marker.
 * - One automatic retry on script error.
 * - Resolves once window.google.maps is available.
 */

const SCRIPT_ID = 'pickme-google-maps-script';
const CALLBACK = '__pickmeGmapsInit' as const;
const LIBRARIES = ['places', 'geometry', 'routes', 'marker'] as const;

type WinWithCb = Window & { [CALLBACK]?: () => void };

let cachedPromise: Promise<typeof google.maps> | null = null;
let didRetry = false;

export function getGoogleMapsKey(): string | null {
  const k = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  return typeof k === 'string' && k.length > 0 ? k : null;
}

function injectScript(apiKey: string): Promise<typeof google.maps> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('window unavailable'));
      return;
    }
    if (window.google?.maps) {
      resolve(window.google.maps);
      return;
    }

    // Reuse existing tag if already injected
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      const wait = () => {
        if (window.google?.maps) resolve(window.google.maps);
        else setTimeout(wait, 100);
      };
      wait();
      return;
    }

    const w = window as WinWithCb;
    w[CALLBACK] = () => {
      delete w[CALLBACK];
      if (window.google?.maps) resolve(window.google.maps);
      else reject(new Error('Google Maps loaded without window.google.maps'));
    };

    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.async = true;
    script.defer = true;
    script.src =
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}` +
      `&libraries=${LIBRARIES.join(',')}` +
      `&callback=${CALLBACK}&v=weekly&loading=async`;
    script.onerror = () => reject(new Error('Google Maps script failed to load'));
    document.head.appendChild(script);
  });
}

export function loadGoogleMaps(): Promise<typeof google.maps> {
  if (cachedPromise) return cachedPromise;
  const key = getGoogleMapsKey();
  if (!key) {
    return Promise.reject(new Error('VITE_GOOGLE_MAPS_API_KEY not configured'));
  }
  cachedPromise = injectScript(key).catch(async (err) => {
    if (didRetry) throw err;
    didRetry = true;
    cachedPromise = null;
    // Remove failed tag, retry once
    document.getElementById(SCRIPT_ID)?.remove();
    cachedPromise = injectScript(key);
    return cachedPromise;
  });
  return cachedPromise;
}

export function resetGoogleMapsLoader() {
  cachedPromise = null;
  didRetry = false;
  document.getElementById(SCRIPT_ID)?.remove();
}
