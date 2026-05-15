/**
 * Centralized Google Maps JS API loader (singleton).
 *
 * Key resolution order:
 *   1. import.meta.env.VITE_GOOGLE_MAPS_API_KEY (build-time secret)
 *   2. Lovable Cloud `google-maps-key` edge function (runtime secret GOOGLE_MAPS_API_KEY)
 *
 * Either source works — no key is ever hardcoded in the bundle.
 *
 * - Injects the script exactly once.
 * - Loads required libraries: places, geometry, marker.
 * - One automatic retry on script error.
 * - Resolves once window.google.maps is available.
 */

import { supabase } from '@/integrations/supabase/client';

const SCRIPT_ID = 'pickme-google-maps-script';
const CALLBACK = '__pickmeGmapsInit' as const;
const LIBRARIES = ['places', 'geometry', 'marker'] as const;

type WinWithCb = Window & { [CALLBACK]?: () => void };

let cachedPromise: Promise<typeof google.maps> | null = null;
let cachedKey: string | null = null;
let didRetry = false;

/** Synchronous key getter — only returns the build-time env value. */
export function getGoogleMapsKey(): string | null {
  if (cachedKey) return cachedKey;
  const k = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  return typeof k === 'string' && k.length > 0 ? k : null;
}

/** Async resolver: env first, then edge function fallback. */
async function resolveGoogleMapsKey(): Promise<string> {
  if (cachedKey) return cachedKey;

  const envKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  if (typeof envKey === 'string' && envKey.length > 0) {
    cachedKey = envKey;
    return envKey;
  }

  // Fallback: fetch from authenticated edge function
  const { data, error } = await supabase.functions.invoke('google-maps-key');
  if (error) {
    throw new Error(
      `Could not fetch Google Maps key: ${error.message}. Make sure you are signed in or set VITE_GOOGLE_MAPS_API_KEY.`,
    );
  }
  const key = (data as { apiKey?: string } | null)?.apiKey;
  if (!key) throw new Error('Google Maps key not configured on the server');
  cachedKey = key;
  return key;
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
  cachedPromise = (async () => {
    const key = await resolveGoogleMapsKey();
    try {
      return await injectScript(key);
    } catch (err) {
      if (didRetry) throw err;
      didRetry = true;
      cachedPromise = null;
      document.getElementById(SCRIPT_ID)?.remove();
      return injectScript(key);
    }
  })();
  return cachedPromise;
}

export function resetGoogleMapsLoader() {
  cachedPromise = null;
  cachedKey = null;
  didRetry = false;
  document.getElementById(SCRIPT_ID)?.remove();
}
