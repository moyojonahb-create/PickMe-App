/**
 * useGoogleMaps – thin hook over the centralized loader (src/lib/googleMapsLoader.ts).
 * Loads exactly once across the app. No hardcoded keys.
 */
import { useEffect, useState } from 'react';
import { loadGoogleMaps, getGoogleMapsKey, resetGoogleMapsLoader } from '@/lib/googleMapsLoader';

const DEV = import.meta.env.DEV;

let authFailure = false;
let lastGoogleConsoleError: string | null = null;
const errorListeners = new Set<(err: Error) => void>();

export interface MapsDiagnostics {
  isLoaded: boolean;
  loadError: Error | null;
  authFailure: boolean;
  lastGoogleConsoleError: string | null;
  apiKeyPresent: boolean;
  apiKeyMasked: string | null;
  scriptInjected: boolean;
  origin: string;
  timestamp: string;
}

export function getMapsDiagnostics(apiKey?: string | null): MapsDiagnostics {
  const k = apiKey ?? getGoogleMapsKey();
  return {
    isLoaded: typeof window !== 'undefined' && !!window.google?.maps,
    loadError: null,
    authFailure,
    lastGoogleConsoleError,
    apiKeyPresent: !!k,
    apiKeyMasked: k ? `${k.slice(0, 6)}…${k.slice(-4)}` : null,
    scriptInjected: !!document.getElementById('pickme-google-maps-script'),
    origin: typeof window !== 'undefined' ? window.location.origin : '',
    timestamp: new Date().toISOString(),
  };
}

// Install one-time global hooks to capture Google's auth/billing console errors.
function installGoogleErrorHooks() {
  if (typeof window === 'undefined') return;
  const w = window as unknown as { __pickmeGmapsHooked?: boolean; gm_authFailure?: () => void };
  if (w.__pickmeGmapsHooked) return;
  w.__pickmeGmapsHooked = true;

  w.gm_authFailure = () => {
    authFailure = true;
    const err = new Error(
      'Google Maps authentication failed. Check API key referrer restrictions, billing, and enabled APIs.',
    );
    errorListeners.forEach((cb) => cb(err));
  };

  const origError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    try {
      const text = args.map((a) => (typeof a === 'string' ? a : '')).join(' ');
      if (text.includes('Google Maps') || text.includes('Maps JavaScript API')) {
        lastGoogleConsoleError = text.slice(0, 500);
        const known = [
          'BillingNotEnabledMapError', 'ApiNotActivatedMapError', 'RefererNotAllowedMapError',
          'InvalidKeyMapError', 'MissingKeyMapError', 'ExpiredKeyMapError', 'OverQuotaMapError',
        ].find((k) => text.includes(k));
        if (known) {
          const err = new Error(`Google Maps error: ${known}`);
          errorListeners.forEach((cb) => cb(err));
        }
      }
    } catch { /* swallow */ }
    origError(...(args as []));
  };
}

export { resetGoogleMapsLoader };

export interface GoogleMapsState {
  isLoaded: boolean;
  loadError: Error | null;
  apiKey: string | null;
}

export function useGoogleMaps(retryKey = 0): GoogleMapsState {
  const envKey = getGoogleMapsKey();
  const [state, setState] = useState<GoogleMapsState>({
    isLoaded: typeof window !== 'undefined' && !!window.google?.maps,
    loadError: null,
    apiKey: envKey ?? 'runtime',
  });

  useEffect(() => {
    installGoogleErrorHooks();
    const onErr = (err: Error) => setState((s) => ({ ...s, isLoaded: false, loadError: err }));
    errorListeners.add(onErr);
    return () => { errorListeners.delete(onErr); };
  }, []);

  useEffect(() => {
    let active = true;
    loadGoogleMaps()
      .then(() => {
        if (!active) return;
        if (DEV) console.info('[PickMe Maps] loaded');
        setState({ isLoaded: true, loadError: null, apiKey: envKey ?? 'runtime' });
      })
      .catch((err: Error) => {
        if (!active) return;
        if (DEV) console.error('[PickMe Maps] load error:', err.message);
        setState({ isLoaded: false, loadError: err, apiKey: envKey });
      });
    return () => { active = false; };
  }, [retryKey, envKey]);

  return state;
}
