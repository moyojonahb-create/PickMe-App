/**
 * Go backend HTTP client — ported from src/lib/goBackendClient.ts.
 *
 * Behaviour is preserved exactly: the 3-failure/30s auth circuit breaker, the
 * 8s AbortController timeout, the one-shot refresh-and-retry on 401, and the
 * GoBackendError code mapping (including the wallet-reason sniffing that
 * callers switch on). What changed is only what had to:
 *
 *   1. `import.meta.env` → injected CoreConfig. Vite-only syntax; Metro has no
 *      equivalent, and the `DEV ? '/go-api'` branch is a Vite dev-proxy path
 *      that means nothing on a device.
 *   2. Module-level `supabase` import → injected AuthTokenProvider, so this is
 *      unit-testable without a live Supabase client.
 *   3. Factory instead of a module singleton, so tests get a clean breaker per
 *      case instead of leaking state between them.
 *
 * `AbortSignal.any` is used for caller-supplied cancellation. It is available on
 * Hermes from React Native 0.76+; `createGoBackendClient` degrades to the
 * timeout-only signal when it is missing rather than throwing, so an older
 * runtime loses caller cancellation but keeps the timeout.
 */

import type { CoreConfig } from '../config.js';
import type { AuthTokenProvider } from '../auth.js';

export type GoBackendErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'RATE_LIMITED'
  | 'WALLET_ERROR'
  | 'SERVER_ERROR'
  | 'NETWORK_ERROR'
  | 'BAD_RESPONSE'
  | 'UNKNOWN';

export class GoBackendError extends Error {
  code: GoBackendErrorCode;
  status?: number;
  details?: unknown;

  constructor(message: string, code: GoBackendErrorCode, status?: number, details?: unknown) {
    super(message);
    this.name = 'GoBackendError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const AUTH_FAILURE_THRESHOLD = 3;
const AUTH_BREAKER_MS = 30_000;

function statusToCode(status: number): GoBackendErrorCode {
  if (status === 401) return 'UNAUTHENTICATED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500) return 'SERVER_ERROR';
  return 'UNKNOWN';
}

function payloadToCode(payload: unknown, fallback: GoBackendErrorCode): GoBackendErrorCode {
  if (typeof payload !== 'object' || !payload) return fallback;
  const rawCode = 'code' in payload ? String((payload as { code?: unknown }).code) : '';
  const rawReason = 'reason' in payload ? String((payload as { reason?: unknown }).reason) : '';
  const normalized = `${rawCode} ${rawReason}`.toLowerCase();
  if (
    normalized.includes('wallet') ||
    normalized.includes('balance') ||
    normalized.includes('insufficient_funds')
  ) {
    return 'WALLET_ERROR';
  }
  return fallback;
}

async function parseResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function combineSignals(timeout: AbortSignal, external?: AbortSignal): AbortSignal {
  if (!external) return timeout;
  const anyFn = (AbortSignal as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
  if (typeof anyFn === 'function') return anyFn([timeout, external]);
  // Hermes without AbortSignal.any: keep the timeout, lose caller cancellation.
  return timeout;
}

export interface GoBackendClient {
  get<T>(path: string, signal?: AbortSignal): Promise<T>;
  post<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T>;
  patch<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T>;
  delete<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T>;
  /** Test/diagnostic hook: is the auth breaker currently open? */
  isAuthBreakerOpen(): boolean;
  /** Detaches the auth-event subscription that closes the breaker. */
  dispose(): void;
}

export function createGoBackendClient(deps: {
  config: Pick<CoreConfig, 'apiBaseUrl' | 'requestTimeoutMs'>;
  auth: AuthTokenProvider;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Injectable for tests so breaker timing doesn't need real clocks. */
  now?: () => number;
}): GoBackendClient {
  const { config, auth } = deps;
  const doFetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? (() => Date.now());
  const timeoutMs = config.requestTimeoutMs ?? 8_000;

  let consecutiveAuthFailures = 0;
  let authBreakerUntil = 0;

  const closeAuthBreaker = () => {
    consecutiveAuthFailures = 0;
    authBreakerUntil = 0;
  };

  const noteAuthFailure = () => {
    consecutiveAuthFailures += 1;
    if (consecutiveAuthFailures >= AUTH_FAILURE_THRESHOLD) {
      authBreakerUntil = now() + AUTH_BREAKER_MS;
    }
  };

  // A new session or refreshed token is exactly the condition that makes the
  // backend usable again — reopen immediately rather than waiting out the window.
  const unsubscribe = auth.onAuthEvent(() => closeAuthBreaker());

  function resolveUrl(path: string): string {
    if (!config.apiBaseUrl) {
      throw new GoBackendError('Go backend base URL is not configured', 'BAD_RESPONSE');
    }
    const suffix = path.startsWith('/') ? path : `/${path}`;
    return `${config.apiBaseUrl}${suffix}`;
  }

  /**
   * The single place an auth failure is ever counted.
   *
   * DIVERGENCE-001 (see packages/core/DIVERGENCE.md). The web client increments
   * from three separate sites with three different behaviours for the same
   * logical event: the no-token path counts once, a 401 whose refresh fails
   * counts twice (the refresh-failed branch and the !response.ok branch both
   * fire for the same response), and a 401 that succeeds on retry counts zero.
   * With three counting rules feeding one threshold, no value of
   * AUTH_FAILURE_THRESHOLD is meaningful for more than one of them — which is
   * why this is fixed by funnelling the increment, not by retuning the number.
   *
   * Contract now: exactly one increment per request that terminally fails auth.
   * A request that recovers via refresh-and-retry counts zero.
   */
  function failAuth(message: string, status = 401, details?: unknown): never {
    noteAuthFailure();
    throw new GoBackendError(message, 'UNAUTHENTICATED', status, details);
  }

  async function authHeaders(): Promise<Record<string, string>> {
    const token = await auth.getToken();
    if (!token) failAuth('Not authenticated');
    return { Authorization: `Bearer ${token}` };
  }

  async function doFetch(
    method: string,
    path: string,
    headers: Record<string, string>,
    body?: unknown,
    externalSignal?: AbortSignal,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await doFetchImpl(resolveUrl(path), {
        method,
        headers: {
          ...headers,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: combineSignals(controller.signal, externalSignal),
      });
    } catch (error) {
      const timedOut = (error as { name?: string })?.name === 'AbortError';
      console.warn('[GoBackend] request failed', { method, path, timedOut, error: String(error) });
      throw new GoBackendError(
        timedOut ? 'Backend request timed out' : 'Network error while contacting backend',
        'NETWORK_ERROR',
        undefined,
        error,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
    isRetry = false,
    signal?: AbortSignal,
  ): Promise<T> {
    if (now() < authBreakerUntil) {
      // Skip the network entirely; callers treat UNAUTHENTICATED as
      // "backend unavailable" and use their Supabase fallback.
      throw new GoBackendError('Backend auth circuit open', 'UNAUTHENTICATED', 401);
    }

    const headers = await authHeaders();
    const response = await doFetch(method, path, headers, body, signal);

    // The session looked valid client-side but the server rejected the token
    // (e.g. it expired between attach and receipt) — refresh once and retry.
    // A failed refresh deliberately does NOT count here; it falls through to
    // the single choke point in the !response.ok branch below, so this 401 is
    // counted exactly once however it plays out.
    if (response.status === 401 && !isRetry) {
      const refreshed = await auth.refreshToken();
      if (refreshed) return request<T>(method, path, body, true, signal);
    }

    const payload = await parseResponse(response);
    if (!response.ok) {
      const message =
        typeof payload === 'object' && payload && 'error' in payload
          ? String((payload as { error?: unknown }).error)
          : typeof payload === 'object' && payload && 'message' in payload
            ? String((payload as { message?: unknown }).message)
            : `Backend request failed with ${response.status}`;
      console.warn('[GoBackend] non-2xx response', { method, path, status: response.status, message });
      // The choke point: every terminal auth failure lands here exactly once.
      if (response.status === 401) failAuth(message, 401, payload);
      throw new GoBackendError(
        message,
        payloadToCode(payload, statusToCode(response.status)),
        response.status,
        payload,
      );
    }

    closeAuthBreaker();
    return payload as T;
  }

  return {
    get: <T>(path: string, signal?: AbortSignal) => request<T>('GET', path, undefined, false, signal),
    post: <T>(path: string, body?: unknown, signal?: AbortSignal) => request<T>('POST', path, body, false, signal),
    patch: <T>(path: string, body?: unknown, signal?: AbortSignal) => request<T>('PATCH', path, body, false, signal),
    delete: <T>(path: string, body?: unknown, signal?: AbortSignal) => request<T>('DELETE', path, body, false, signal),
    isAuthBreakerOpen: () => now() < authBreakerUntil,
    dispose: unsubscribe,
  };
}
