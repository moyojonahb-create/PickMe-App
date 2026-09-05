/**
 * Runtime configuration, injected rather than read from the environment.
 *
 * The web app reads `import.meta.env.VITE_*` directly inside its API and socket
 * clients. That is Vite-specific syntax — Metro/Hermes has no `import.meta.env`
 * at all — and it is the single reason those otherwise-portable files cannot be
 * moved across as-is. Rather than fork them per platform, config is passed in:
 * the web app supplies its `import.meta.env` values, the RN app supplies
 * `process.env.EXPO_PUBLIC_*`, and the client code below never knows which.
 *
 * It also removes the dev-only branches that cannot mean anything on device —
 * `import.meta.env.DEV ? '/go-api'` is a Vite dev-proxy path, and the socket
 * client's `location.protocol`/`location.host` are DOM globals that throw in RN.
 * Both become "the host app tells us the base URL".
 */

export interface CoreConfig {
  /** Absolute base URL of the Go backend, no trailing slash. Web dev may pass the Vite proxy path. */
  apiBaseUrl: string;
  /** Absolute ws:// or wss:// URL of the Go backend socket. */
  wsUrl: string;
  supabaseUrl: string;
  supabasePublishableKey: string;
  /**
   * Sent as `x-client-info`. The web app sends `pickme-web`; mobile should send
   * its own value so backend logs and Supabase analytics can tell the clients
   * apart. Note the existing value retains the legacy name — that string is
   * load-bearing for existing dashboards, so it is not renamed here.
   */
  clientInfo: string;
  /** Request timeout for Go backend calls. Defaults to 8s, matching the web client. */
  requestTimeoutMs?: number;
}

export class CoreConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CoreConfigError';
  }
}

const REQUIRED: Array<keyof CoreConfig> = [
  'apiBaseUrl',
  'wsUrl',
  'supabaseUrl',
  'supabasePublishableKey',
  'clientInfo',
];

/**
 * Validates eagerly and reports every missing key at once. The web app's
 * Supabase client currently fails this case by writing an error card into
 * `document.body` — a DOM call that would itself throw on React Native. Throwing
 * a plain error and letting each platform render its own failure state is the
 * portable equivalent.
 */
export function defineCoreConfig(input: CoreConfig): Readonly<CoreConfig> {
  const missing = REQUIRED.filter((key) => {
    const value = input[key];
    return typeof value !== 'string' || value.trim() === '';
  });

  if (missing.length > 0) {
    throw new CoreConfigError(
      `CruiXe core is misconfigured — missing: ${missing.join(', ')}. ` +
        'On web these come from import.meta.env.VITE_*; on mobile from process.env.EXPO_PUBLIC_*.',
    );
  }

  return Object.freeze({
    ...input,
    apiBaseUrl: input.apiBaseUrl.replace(/\/+$/, ''),
    requestTimeoutMs: input.requestTimeoutMs ?? 8_000,
  });
}
