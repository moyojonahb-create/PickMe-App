/**
 * Supabase client factory with the auth storage adapter injected.
 *
 * The web app hardcodes `brokeredPreviewStorage()`, which brokers the session to
 * the Lovable editor over `window.parent.postMessage` and falls back to
 * `localStorage`. That is definitively browser-only — three DOM globals in one
 * adapter — and is the single thing preventing the client setup from being
 * shared. React Native passes AsyncStorage here instead; the realtime tuning,
 * which is not platform-specific and was arrived at against this backend, is
 * shared unchanged.
 *
 * The web app's version also renders its misconfiguration error by assigning to
 * `document.body.innerHTML`, which would itself throw on React Native. Config
 * validation lives in defineCoreConfig() instead, and each platform renders the
 * failure however it renders failures.
 */

import type { CoreConfig } from '../config.js';

/**
 * The subset of supabase-js's storage contract both platforms satisfy.
 * AsyncStorage matches this directly; so does localStorage.
 */
export interface StorageAdapter {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}

export interface SupabaseClientOptions {
  auth: {
    storage: StorageAdapter;
    persistSession: boolean;
    autoRefreshToken: boolean;
    /**
     * Must be false on React Native. supabase-js otherwise tries to parse the
     * session out of a URL fragment on startup, which is a web OAuth-redirect
     * concept with no meaning on a device.
     */
    detectSessionInUrl?: boolean;
  };
  realtime: {
    params: { eventsPerSecond: number };
    heartbeatIntervalMs: number;
    reconnectAfterMs: (tries: number) => number;
    timeout: number;
  };
  global: { headers: Record<string, string> };
}

/**
 * Builds the options object for `createClient`. Deliberately does not call
 * createClient itself: that keeps supabase-js a peer dependency of this package
 * rather than a hard one, so the web and mobile apps each own their version and
 * their generated `Database` type parameter.
 *
 * Usage:
 *   createClient<Database>(cfg.supabaseUrl, cfg.supabasePublishableKey,
 *     buildSupabaseOptions(cfg, { storage: AsyncStorage, platform: 'native' }))
 */
export function buildSupabaseOptions(
  config: Pick<CoreConfig, 'clientInfo'>,
  opts: { storage: StorageAdapter; platform: 'web' | 'native' },
): SupabaseClientOptions {
  return {
    auth: {
      storage: opts.storage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: opts.platform === 'web',
    },
    realtime: {
      params: { eventsPerSecond: 10 },
      heartbeatIntervalMs: 30_000,
      reconnectAfterMs: (tries: number) => Math.min(tries * 1000, 10_000),
      timeout: 20_000,
    },
    global: {
      headers: { 'x-client-info': config.clientInfo },
    },
  };
}
