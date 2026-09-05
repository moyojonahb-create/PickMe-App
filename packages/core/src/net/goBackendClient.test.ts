import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createGoBackendClient, GoBackendError } from './goBackendClient.js';
import type { AuthEvent, AuthTokenProvider } from '../auth.js';

/**
 * These tests lock the behavioural contract of the Go API client before anyone
 * adapts it for React Native. Every case here is a behaviour that fails
 * silently in production if broken: a breaker that never opens hammers a dead
 * backend, a breaker that never closes locks a signed-in user out, and a
 * missing timeout hangs a ride request forever on a bad mobile connection.
 */

function fakeAuth(overrides: Partial<AuthTokenProvider> = {}) {
  const listeners = new Set<(e: AuthEvent) => void>();
  const provider = {
    getToken: vi.fn(async () => 'token-1' as string | null),
    refreshToken: vi.fn(async () => 'token-2' as string | null),
    onAuthEvent: (listener: (e: AuthEvent) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    ...overrides,
  };
  return {
    provider: provider as AuthTokenProvider,
    emit: (event: AuthEvent) => listeners.forEach((l) => l(event)),
    listenerCount: () => listeners.size,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

const config = { apiBaseUrl: 'https://api.example.test', requestTimeoutMs: 8_000 };

let warnSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  // The client logs expected failures; keep test output readable.
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  warnSpy.mockRestore();
  vi.useRealTimers();
});

describe('auth circuit breaker', () => {
  it('opens the breaker and short-circuits the next call without touching the network', async () => {
    const auth = fakeAuth({ refreshToken: vi.fn(async () => null) });
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'nope' }, 401));
    const client = createGoBackendClient({ config, auth: auth.provider, fetchImpl });

    // Three calls, matching AUTH_FAILURE_THRESHOLD now that each terminally
    // failed request counts exactly once (DIVERGENCE-001).
    for (let i = 0; i < 3; i++) {
      await expect(client.get('/api/x')).rejects.toMatchObject({ status: 401 });
    }

    expect(client.isAuthBreakerOpen()).toBe(true);
    const callsBefore = fetchImpl.mock.calls.length;

    // The next call must not reach the network at all.
    await expect(client.get('/api/x')).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
      message: 'Backend auth circuit open',
    });
    expect(fetchImpl.mock.calls.length).toBe(callsBefore);
  });

  // DIVERGENCE-001: the web client counts the same logical failure from three
  // sites with three different behaviours, so the threshold is only meaningful
  // for one of them. Core funnels every increment through one choke point.
  // These three tests pin all three paths to the same rule.
  describe('DIVERGENCE-001: exactly one failure counted per terminally-failed request', () => {
    it('a failed-refresh 401 counts once, so the breaker needs a full 3 calls', async () => {
      const auth = fakeAuth({ refreshToken: vi.fn(async () => null) });
      const client = createGoBackendClient({
        config,
        auth: auth.provider,
        fetchImpl: vi.fn(async () => jsonResponse({}, 401)),
      });

      await client.get('/api/x').catch(() => {});
      expect(client.isAuthBreakerOpen()).toBe(false);
      await client.get('/api/x').catch(() => {});
      // Under the web client's double-count this would already be open.
      expect(client.isAuthBreakerOpen()).toBe(false);
      await client.get('/api/x').catch(() => {});
      expect(client.isAuthBreakerOpen()).toBe(true);
    });

    it('the no-token path counts once, at the same rate', async () => {
      const auth = fakeAuth({ getToken: vi.fn(async () => null) });
      const fetchImpl = vi.fn(async () => jsonResponse({}, 200));
      const client = createGoBackendClient({ config, auth: auth.provider, fetchImpl });

      await client.get('/api/x').catch(() => {});
      await client.get('/api/x').catch(() => {});
      expect(client.isAuthBreakerOpen()).toBe(false);
      await client.get('/api/x').catch(() => {});
      expect(client.isAuthBreakerOpen()).toBe(true);
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('a 401 that recovers on retry counts zero', async () => {
      const auth = fakeAuth();
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(jsonResponse({}, 401))
        .mockResolvedValueOnce(jsonResponse({ ok: true }, 200))
        .mockResolvedValueOnce(jsonResponse({}, 401))
        .mockResolvedValueOnce(jsonResponse({ ok: true }, 200))
        .mockResolvedValueOnce(jsonResponse({}, 401))
        .mockResolvedValueOnce(jsonResponse({ ok: true }, 200));

      const client = createGoBackendClient({ config, auth: auth.provider, fetchImpl });
      for (let i = 0; i < 3; i++) await client.get('/api/x');

      // Three 401s were seen, but all three recovered — a recovered request is
      // not a failure and must never contribute to the breaker.
      expect(client.isAuthBreakerOpen()).toBe(false);
    });
  });

  it('closes immediately on TOKEN_REFRESHED rather than waiting out the 30s window', async () => {
    const auth = fakeAuth({ refreshToken: vi.fn(async () => null) });
    const fetchImpl = vi.fn(async () => jsonResponse({}, 401));
    const client = createGoBackendClient({ config, auth: auth.provider, fetchImpl });

    for (let i = 0; i < 3; i++) await client.get('/api/x').catch(() => {});
    expect(client.isAuthBreakerOpen()).toBe(true);

    auth.emit('TOKEN_REFRESHED');

    expect(client.isAuthBreakerOpen()).toBe(false);
    // And the next call really does hit the network again.
    const before = fetchImpl.mock.calls.length;
    await client.get('/api/x').catch(() => {});
    expect(fetchImpl.mock.calls.length).toBe(before + 1);
  });

  it('a successful response closes the breaker', async () => {
    const auth = fakeAuth({ refreshToken: vi.fn(async () => null) });
    let status = 401;
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }, status));
    const client = createGoBackendClient({ config, auth: auth.provider, fetchImpl });

    // One failing call only: enough to bank failures, not enough to open the
    // breaker, so the success below is genuinely reaching the network.
    await client.get('/api/x').catch(() => {});
    expect(client.isAuthBreakerOpen()).toBe(false);

    status = 200;
    await expect(client.get('/api/x')).resolves.toEqual({ ok: true });
    expect(client.isAuthBreakerOpen()).toBe(false);

    // And the banked failures were cleared, not merely under threshold: a
    // fresh failing call must not immediately trip it.
    status = 401;
    await client.get('/api/x').catch(() => {});
    expect(client.isAuthBreakerOpen()).toBe(false);
  });

  it('dispose() detaches the auth listener', () => {
    const auth = fakeAuth();
    const client = createGoBackendClient({
      config,
      auth: auth.provider,
      fetchImpl: vi.fn(async () => jsonResponse({})),
    });
    expect(auth.listenerCount()).toBe(1);
    client.dispose();
    expect(auth.listenerCount()).toBe(0);
  });
});

describe('401 refresh-and-retry', () => {
  it('refreshes once and retries, succeeding on the second attempt', async () => {
    const auth = fakeAuth();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({}, 401))
      .mockResolvedValueOnce(jsonResponse({ ok: true }, 200));

    const client = createGoBackendClient({ config, auth: auth.provider, fetchImpl });
    await expect(client.get('/api/x')).resolves.toEqual({ ok: true });

    expect(auth.provider.refreshToken).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not retry a second time when the retry also 401s (no infinite loop)', async () => {
    const auth = fakeAuth();
    const fetchImpl = vi.fn(async () => jsonResponse({}, 401));
    const client = createGoBackendClient({ config, auth: auth.provider, fetchImpl });

    await expect(client.get('/api/x')).rejects.toMatchObject({ status: 401 });

    // Exactly two network calls: the original and the single retry.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(auth.provider.refreshToken).toHaveBeenCalledTimes(1);
  });

  it('counts the failure when the refresh itself fails', async () => {
    const auth = fakeAuth({ refreshToken: vi.fn(async () => null) });
    const fetchImpl = vi.fn(async () => jsonResponse({}, 401));
    const client = createGoBackendClient({ config, auth: auth.provider, fetchImpl });

    await client.get('/api/x').catch(() => {});
    // One request => one refresh attempt => no retry, because refresh returned null.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('throws UNAUTHENTICATED without a network call when there is no token', async () => {
    const auth = fakeAuth({ getToken: vi.fn(async () => null) });
    const fetchImpl = vi.fn(async () => jsonResponse({}));
    const client = createGoBackendClient({ config, auth: auth.provider, fetchImpl });

    await expect(client.get('/api/x')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('timeout and cancellation', () => {
  it('surfaces NETWORK_ERROR when the request times out instead of hanging', async () => {
    vi.useFakeTimers();
    const auth = fakeAuth();

    // A fetch that never settles on its own, and rejects the way the platform
    // does when its AbortSignal fires.
    const fetchImpl = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    ) as unknown as typeof fetch;

    const client = createGoBackendClient({ config, auth: auth.provider, fetchImpl });
    const promise = client.get('/api/slow');
    const assertion = expect(promise).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      message: 'Backend request timed out',
    });

    await vi.advanceTimersByTimeAsync(8_000);
    await assertion;
  });

  it('a caller-supplied AbortSignal aborts the in-flight fetch', async () => {
    // Regression guard: the comment in the original client notes that letting a
    // caller give up without aborting is what allowed an abandoned request to
    // keep running and create a duplicate ride.
    const auth = fakeAuth();
    let sawAbort = false;

    const fetchImpl = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            sawAbort = true;
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    ) as unknown as typeof fetch;

    const client = createGoBackendClient({ config, auth: auth.provider, fetchImpl });
    const controller = new AbortController();
    const promise = client.get('/api/slow', controller.signal);

    // Let the auth await resolve so the fetch is actually in flight.
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();

    await expect(promise).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    expect(sawAbort).toBe(true);
  });
});

describe('error code mapping', () => {
  it.each([
    [403, 'FORBIDDEN'],
    [429, 'RATE_LIMITED'],
    [500, 'SERVER_ERROR'],
    [503, 'SERVER_ERROR'],
    [418, 'UNKNOWN'],
  ])('maps HTTP %i to %s', async (status, expected) => {
    const auth = fakeAuth();
    const client = createGoBackendClient({
      config,
      auth: auth.provider,
      fetchImpl: vi.fn(async () => jsonResponse({ error: 'x' }, status)),
    });
    await expect(client.get('/api/x')).rejects.toMatchObject({ code: expected });
  });

  // String matching rots. These are the exact substrings the client sniffs for,
  // and callers branch on WALLET_ERROR to show a top-up prompt rather than a
  // generic failure — so a silent change here degrades a real user flow.
  it.each<[Record<string, string>, string]>([
    [{ reason: 'insufficient_funds' }, 'insufficient_funds'],
    [{ reason: 'WALLET balance too low' }, 'wallet keyword, case-insensitive'],
    [{ code: 'balance_error' }, 'balance keyword in code'],
  ])('classifies %j as WALLET_ERROR (%s)', async (payload, _why) => {
    const auth = fakeAuth();
    const client = createGoBackendClient({
      config,
      auth: auth.provider,
      fetchImpl: vi.fn(async () => jsonResponse(payload, 400)),
    });
    await expect(client.get('/api/wallet/pay-ride')).rejects.toMatchObject({ code: 'WALLET_ERROR' });
  });

  it('does not classify an unrelated 400 as WALLET_ERROR', async () => {
    const auth = fakeAuth();
    const client = createGoBackendClient({
      config,
      auth: auth.provider,
      fetchImpl: vi.fn(async () => jsonResponse({ reason: 'ride_expired' }, 400)),
    });
    await expect(client.get('/api/x')).rejects.toMatchObject({ code: 'UNKNOWN' });
  });
});

describe('request shaping', () => {
  /** Typed so mock.calls carries real argument types instead of never[]. */
  const recordingFetch = () =>
    vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ ok: true }));

  it('sends the bearer token and joins the base URL without a double slash', async () => {
    const auth = fakeAuth();
    const fetchImpl = recordingFetch();
    const client = createGoBackendClient({
      config,
      auth: auth.provider,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await client.get('/api/rides');

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.example.test/api/rides');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer token-1');
  });

  it('omits a JSON content-type when there is no body', async () => {
    const auth = fakeAuth();
    const fetchImpl = recordingFetch();
    const client = createGoBackendClient({
      config,
      auth: auth.provider,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await client.get('/api/rides');
    const [, init] = fetchImpl.mock.calls[0];
    expect((init?.headers as Record<string, string>)['Content-Type']).toBeUndefined();

    await client.post('/api/rides', { a: 1 });
    const [, postInit] = fetchImpl.mock.calls[1];
    expect((postInit?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(postInit?.body).toBe(JSON.stringify({ a: 1 }));
  });

  it('returns null for an empty response body rather than throwing', async () => {
    const auth = fakeAuth();
    const client = createGoBackendClient({
      config,
      auth: auth.provider,
      fetchImpl: vi.fn(async () => jsonResponse('', 200)),
    });
    await expect(client.get('/api/x')).resolves.toBeNull();
  });
});
