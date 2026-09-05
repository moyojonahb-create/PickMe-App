import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createBackendSocketClient, type SocketFactory } from './backendSocketClient.js';
import { eventRideId, eventDriverId, eventOfferId, eventNumber, eventString } from './socketEvents.js';
import type { AuthEvent, AuthTokenProvider } from '../auth.js';

/**
 * The socket carries ride offers. Every failure mode here is invisible until a
 * driver stops getting work: a backoff that stops growing hammers the backend,
 * a backoff that never resets leaves a driver 30s behind, a send queue that
 * drops the wrong end loses the newest offer, and broken room ref-counting
 * unsubscribes a driver from a ride they are still on.
 *
 * Fake socket + fake timers throughout — no network, no real clocks.
 */

class FakeSocket {
  readyState = 0; // CONNECTING
  sent: string[] = [];
  closed = false;
  private handlers: Record<string, Array<(e?: unknown) => void>> = {};

  constructor(public url: string) {}

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.readyState = 3; // CLOSED
    this.emit('close');
  }

  addEventListener(type: string, cb: (e?: unknown) => void) {
    (this.handlers[type] ||= []).push(cb);
  }

  private emit(type: string, payload?: unknown) {
    (this.handlers[type] || []).forEach((h) => h(payload));
  }

  /** Test driver: complete the handshake. */
  open() {
    this.readyState = 1; // OPEN
    this.emit('open');
  }

  /** Test driver: deliver a server message. */
  receive(data: unknown) {
    this.emit('message', { data: typeof data === 'string' ? data : JSON.stringify(data) });
  }

  parsed(): Array<Record<string, unknown>> {
    return this.sent.map((s) => JSON.parse(s));
  }

  eventsNamed(name: string) {
    return this.parsed().filter((m) => m.event === name);
  }
}

function fakeAuth(overrides: Partial<AuthTokenProvider> = {}) {
  const listeners = new Set<(e: AuthEvent) => void>();
  const provider = {
    getToken: vi.fn(async () => 'tok' as string | null),
    refreshToken: vi.fn(async () => 'tok-fresh' as string | null),
    onAuthEvent: (listener: (e: AuthEvent) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    ...overrides,
  };
  return {
    provider: provider as AuthTokenProvider,
    emit: (e: AuthEvent) => listeners.forEach((l) => l(e)),
    listenerCount: () => listeners.size,
  };
}

function setup(opts: { wsUrl?: string; auth?: ReturnType<typeof fakeAuth> } = {}) {
  const auth = opts.auth ?? fakeAuth();
  const sockets: FakeSocket[] = [];
  const socketFactory: SocketFactory = (url) => {
    const s = new FakeSocket(url);
    sockets.push(s);
    return s as unknown as ReturnType<SocketFactory>;
  };
  const client = createBackendSocketClient({
    wsUrl: opts.wsUrl ?? 'wss://api.example.test/ws',
    auth: auth.provider,
    socketFactory,
  });
  return { client, sockets, auth };
}

/** Flush pending microtasks (the awaited auth-token read) without advancing clocks. */
const tick = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

/** connect() and complete the handshake on the socket it creates. */
async function connectAndOpen(ctx: ReturnType<typeof setup>) {
  const p = ctx.client.connect();
  await tick();
  ctx.sockets[ctx.sockets.length - 1].open();
  await p;
}

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.useFakeTimers();
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  errorSpy.mockRestore();
  vi.useRealTimers();
});

describe('connection and URL construction', () => {
  it('appends the token with ? when the URL has no query string', async () => {
    const ctx = setup({ wsUrl: 'wss://api.example.test/ws' });
    await connectAndOpen(ctx);
    expect(ctx.sockets[0].url).toBe('wss://api.example.test/ws?token=tok');
  });

  it('appends the token with & when the URL already has a query string', async () => {
    // The original used URL.searchParams, which handled this for free. After
    // switching to string concatenation to drop the URL polyfill, this is the
    // case that would otherwise produce a second '?' and a malformed URL.
    const ctx = setup({ wsUrl: 'wss://api.example.test/ws?region=zw' });
    await connectAndOpen(ctx);
    expect(ctx.sockets[0].url).toBe('wss://api.example.test/ws?region=zw&token=tok');
  });

  it('URL-encodes the token', async () => {
    const auth = fakeAuth({ getToken: vi.fn(async () => 'a b+c/d=' as string | null) });
    const ctx = setup({ auth });
    await connectAndOpen(ctx);
    expect(ctx.sockets[0].url).toContain('token=a%20b%2Bc%2Fd%3D');
  });

  it('reuses a single in-flight connect instead of opening two sockets', async () => {
    const ctx = setup();
    const a = ctx.client.connect();
    const b = ctx.client.connect();
    await tick();
    expect(ctx.sockets).toHaveLength(1);
    ctx.sockets[0].open();
    await Promise.all([a, b]);
  });

  it('refuses to connect without a token rather than opening an unauthenticated socket', async () => {
    const auth = fakeAuth({ getToken: vi.fn(async () => null) });
    const ctx = setup({ auth });
    await expect(ctx.client.connect()).rejects.toThrow(/without an auth token/);
    expect(ctx.sockets).toHaveLength(0);
  });
});

describe('heartbeat', () => {
  it('pings at 25s and closes the socket when no pong arrives within 10s', async () => {
    const ctx = setup();
    await connectAndOpen(ctx);
    const socket = ctx.sockets[0];

    await vi.advanceTimersByTimeAsync(25_000);
    expect(socket.eventsNamed('ping')).toHaveLength(1);
    expect(socket.closed).toBe(false);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(socket.closed).toBe(true);
  });

  it('does not close when a pong arrives inside the window', async () => {
    const ctx = setup();
    await connectAndOpen(ctx);
    const socket = ctx.sockets[0];

    await vi.advanceTimersByTimeAsync(25_000);
    socket.receive({ event: 'pong' });
    await vi.advanceTimersByTimeAsync(10_000);

    expect(socket.closed).toBe(false);
  });

  it('a dead-socket close schedules a reconnect', async () => {
    const ctx = setup();
    await connectAndOpen(ctx);

    await vi.advanceTimersByTimeAsync(25_000 + 10_000); // ping, then pong timeout
    expect(ctx.sockets[0].closed).toBe(true);

    await vi.advanceTimersByTimeAsync(1_000); // first backoff step
    expect(ctx.sockets.length).toBeGreaterThan(1);
  });
});

describe('reconnect backoff', () => {
  it('doubles 1s → 2s → 4s and does not fire early', async () => {
    const ctx = setup();
    await connectAndOpen(ctx);

    ctx.sockets[0].close();
    await vi.advanceTimersByTimeAsync(999);
    expect(ctx.sockets).toHaveLength(1); // not yet
    await vi.advanceTimersByTimeAsync(1);
    expect(ctx.sockets).toHaveLength(2); // 1s

    ctx.sockets[1].close(); // fails before opening
    await vi.advanceTimersByTimeAsync(1_999);
    expect(ctx.sockets).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(ctx.sockets).toHaveLength(3); // 2s

    ctx.sockets[2].close();
    await vi.advanceTimersByTimeAsync(3_999);
    expect(ctx.sockets).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(ctx.sockets).toHaveLength(4); // 4s
  });

  it('caps the delay at 30s no matter how long the outage lasts', async () => {
    const ctx = setup();
    await connectAndOpen(ctx);

    // Drive well past the point where doubling would exceed the cap.
    for (let i = 0; i < 8; i++) {
      ctx.sockets[ctx.sockets.length - 1].close();
      await vi.advanceTimersByTimeAsync(30_000);
    }

    const countBefore = ctx.sockets.length;
    ctx.sockets[countBefore - 1].close();

    // Just under the cap: nothing yet. If the delay had kept doubling past 30s
    // (1m, 2m, 4m…) this would still be silent here and the driver would be
    // minutes behind.
    await vi.advanceTimersByTimeAsync(29_999);
    expect(ctx.sockets).toHaveLength(countBefore);
    await vi.advanceTimersByTimeAsync(1);
    expect(ctx.sockets).toHaveLength(countBefore + 1);
  });

  it('resets to 1s after a successful open', async () => {
    const ctx = setup();
    await connectAndOpen(ctx);

    // Two failed attempts push the backoff to 4s.
    ctx.sockets[0].close();
    await vi.advanceTimersByTimeAsync(1_000);
    ctx.sockets[1].close();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(ctx.sockets).toHaveLength(3);

    // Third attempt succeeds — backoff must reset.
    ctx.sockets[2].open();
    await tick();

    ctx.sockets[2].close();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(ctx.sockets).toHaveLength(4); // 1s again, not 4s
  });
});

describe('send queue', () => {
  it('queues while disconnected, caps at 50 dropping the oldest, and flushes in order', async () => {
    const ctx = setup();

    // send() triggers a connect but the socket never opens, so everything queues.
    for (let i = 0; i < 60; i++) ctx.client.send({ n: i });
    await tick();

    const socket = ctx.sockets[0];
    expect(socket.sent).toHaveLength(0);

    socket.open();
    await tick();

    const ns = socket.parsed().map((m) => m.n);
    expect(ns).toHaveLength(50);
    expect(ns[0]).toBe(10); // 0–9 dropped as oldest
    expect(ns[49]).toBe(59); // newest retained
    expect(ns).toEqual([...ns].sort((a, b) => (a as number) - (b as number))); // order preserved
  });

  it('sends straight through once open', async () => {
    const ctx = setup();
    await connectAndOpen(ctx);
    ctx.client.send({ hello: 'world' });
    expect(ctx.sockets[0].parsed()).toContainEqual({ hello: 'world' });
  });
});

describe('room ref-counting', () => {
  it('does not leave the room until the last holder leaves', async () => {
    // The subtle one. Two screens can watch the same ride (e.g. the map and a
    // status sheet). If the first unmount sent leave_room, the second screen
    // would go silent with no error anywhere — the driver simply stops seeing
    // updates for a ride they are still on.
    const ctx = setup();
    await connectAndOpen(ctx);
    const socket = ctx.sockets[0];

    ctx.client.joinRide('r1');
    ctx.client.joinRide('r1');
    expect(socket.eventsNamed('join_room')).toHaveLength(2);

    ctx.client.leaveRide('r1');
    expect(socket.eventsNamed('leave_room')).toHaveLength(0); // still one holder

    ctx.client.leaveRide('r1');
    expect(socket.eventsNamed('leave_room')).toHaveLength(1);
    expect(socket.eventsNamed('leave_room')[0].room_id).toBe('ride_r1');
  });

  it('normalises the room id and does not double-prefix', async () => {
    const ctx = setup();
    await connectAndOpen(ctx);

    ctx.client.joinRide('r1');
    ctx.client.joinRide('ride_r2');

    const rooms = ctx.sockets[0].eventsNamed('join_room').map((m) => m.room_id);
    expect(rooms).toEqual(['ride_r1', 'ride_r2']);
  });

  it('ignores an empty ride id', async () => {
    const ctx = setup();
    await connectAndOpen(ctx);
    ctx.client.joinRide('');
    ctx.client.leaveRide('');
    expect(ctx.sockets[0].sent).toHaveLength(0);
  });

  it('rejoins its rooms after a reconnect', async () => {
    const ctx = setup();
    await connectAndOpen(ctx);
    ctx.client.joinRide('r1');

    ctx.sockets[0].close();
    await vi.advanceTimersByTimeAsync(1_000);
    const revived = ctx.sockets[1];
    revived.open();
    await tick();

    expect(revived.eventsNamed('join_room').map((m) => m.room_id)).toContain('ride_r1');
  });
});

describe('ping round trip', () => {
  it('resolves true when the server pongs', async () => {
    const ctx = setup();
    await connectAndOpen(ctx);

    const promise = ctx.client.ping();
    await tick();

    expect(ctx.sockets[0].eventsNamed('ping').length).toBeGreaterThan(0);
    ctx.sockets[0].receive({ event: 'pong' });

    await expect(promise).resolves.toBe(true);
  });

  it('resolves false on timeout rather than hanging', async () => {
    const ctx = setup();
    await connectAndOpen(ctx);

    const promise = ctx.client.ping(5_000);
    await tick();
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(promise).resolves.toBe(false);
  });

  it('does not leak its listener after resolving', async () => {
    // A diagnostic that accumulates listeners every time it is tapped would be
    // a slow leak in exactly the screen used to debug leaks.
    const ctx = setup();
    await connectAndOpen(ctx);

    for (let i = 0; i < 3; i++) {
      const p = ctx.client.ping();
      await tick();
      ctx.sockets[0].receive({ event: 'pong' });
      await p;
    }

    // A fourth pong with no ping outstanding must reach nobody and not throw.
    expect(() => ctx.sockets[0].receive({ event: 'pong' })).not.toThrow();
  });

  it('a pong still does not reach event listeners', async () => {
    // pong is transport bookkeeping, not a ride event — it must never surface
    // as one, or every consumer has to filter it out.
    const ctx = setup();
    const any = vi.fn();
    ctx.client.onAny(any);
    await tick();
    ctx.sockets[0].open();
    await tick();

    ctx.sockets[0].receive({ event: 'pong' });
    expect(any).not.toHaveBeenCalled();
  });
});

describe('message dispatch', () => {
  it('delivers canonical events to type listeners and onAny', async () => {
    const ctx = setup();
    const typed = vi.fn();
    const any = vi.fn();
    ctx.client.on('ride_offer', typed);
    ctx.client.onAny(any);
    await tick();
    ctx.sockets[0].open();
    await tick();

    ctx.sockets[0].receive({ event: 'ride_offer', ride_id: 'r1' });

    expect(typed).toHaveBeenCalledTimes(1);
    expect(any).toHaveBeenCalledTimes(1);
    expect(typed.mock.calls[0][0]).toMatchObject({ type: 'ride_offer', ride_id: 'r1' });
  });

  it('ignores unknown event names and malformed JSON without throwing', async () => {
    const ctx = setup();
    const any = vi.fn();
    ctx.client.onAny(any);
    await tick();
    ctx.sockets[0].open();
    await tick();

    ctx.sockets[0].receive({ event: 'something_else' });
    ctx.sockets[0].receive('not json at all');

    expect(any).not.toHaveBeenCalled();
  });

  it('unsubscribes cleanly', async () => {
    const ctx = setup();
    const listener = vi.fn();
    const off = ctx.client.on('ride_offer', listener);
    await tick();
    ctx.sockets[0].open();
    await tick();

    off();
    ctx.sockets[0].receive({ event: 'ride_offer', ride_id: 'r1' });
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('auth lifecycle', () => {
  it('reconnects on TOKEN_REFRESHED, reading the current session token', async () => {
    const auth = fakeAuth();
    const ctx = setup({ auth });
    await connectAndOpen(ctx);
    ctx.client.joinRide('r1'); // gives it a reason to reconnect

    auth.emit('TOKEN_REFRESHED');
    await tick();

    expect(ctx.sockets).toHaveLength(2);
    // Reads getToken(), NOT refreshToken() — see the "effectively unreachable"
    // note in backendSocketClient.ts. Correct here, because by the time
    // TOKEN_REFRESHED fires the session already holds the new token; asserting
    // it explicitly so the RN work doesn't "fix" this into a double refresh.
    expect(ctx.sockets[1].url).toContain('token=tok');
    expect(auth.provider.refreshToken).not.toHaveBeenCalled();
    expect(auth.provider.getToken).toHaveBeenCalled();
  });

  // DIVERGENCE-002: the web client infers freshness from a state string that
  // connect() overwrites two lines later, so its refresh branch is dead code
  // and every reconnect uses the cached token. Core passes freshness
  // explicitly. These pin both halves of that contract.
  describe('DIVERGENCE-002: token freshness is explicit, not inferred from state', () => {
    it('reconnectWithFreshToken() actually forces a refresh and uses the new token', async () => {
      // The mobile foreground-resume path. If this regresses, a driver who
      // reopens the app after hours reconnects with a dead token, the server
      // rejects it, and the backoff loop retries the same dead token forever —
      // online, receiving nothing, no visible error.
      const auth = fakeAuth();
      const ctx = setup({ auth });
      await connectAndOpen(ctx);
      ctx.client.joinRide('r1');

      ctx.client.reconnectWithFreshToken();
      await tick();

      expect(auth.provider.refreshToken).toHaveBeenCalledTimes(1);
      expect(ctx.sockets).toHaveLength(2);
      expect(ctx.sockets[1].url).toContain('token=tok-fresh');
    });

    it('an ordinary backoff reconnect does not force a refresh', async () => {
      // Refreshing on every backoff attempt would hammer the auth endpoint
      // during an outage, which is the opposite of what backoff is for.
      const auth = fakeAuth();
      const ctx = setup({ auth });
      await connectAndOpen(ctx);

      ctx.sockets[0].close();
      await vi.advanceTimersByTimeAsync(1_000);

      expect(ctx.sockets).toHaveLength(2);
      expect(auth.provider.refreshToken).not.toHaveBeenCalled();
    });
  });

  it('closes and does not reconnect on SIGNED_OUT', async () => {
    const auth = fakeAuth();
    const ctx = setup({ auth });
    await connectAndOpen(ctx);

    auth.emit('SIGNED_OUT');
    expect(ctx.sockets[0].closed).toBe(true);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(ctx.sockets).toHaveLength(1); // stayed down, as intended
  });

  it('dispose() detaches the auth subscription', async () => {
    const auth = fakeAuth();
    const ctx = setup({ auth });
    await connectAndOpen(ctx);
    expect(auth.listenerCount()).toBe(1);

    ctx.client.dispose();
    expect(auth.listenerCount()).toBe(0);
    expect(ctx.sockets[0].closed).toBe(true);
  });
});

describe('event field extraction', () => {
  it('walks the ride-id fallback chain, ending at the room name', () => {
    expect(eventRideId({ type: 'ride_offer', ride_id: 'a' })).toBe('a');
    expect(eventRideId({ type: 'ride_offer', rideId: 'b' })).toBe('b');
    expect(eventRideId({ type: 'ride_offer', ride: { id: 'c' } })).toBe('c');
    expect(eventRideId({ type: 'ride_offer', ride: { ride_id: 'd' } })).toBe('d');
    // Last resort: the backend sometimes only identifies the ride by the room
    // it broadcast to.
    expect(eventRideId({ type: 'ride_offer', room: 'ride_e' })).toBe('e');
    expect(eventRideId({ type: 'ride_offer' })).toBeNull();
    expect(eventRideId({ type: 'ride_offer', room: 'not_a_ride_room' })).toBeNull();
  });

  it('ignores blank strings rather than returning them as ids', () => {
    expect(eventRideId({ type: 'ride_offer', ride_id: '   ', rideId: 'real' })).toBe('real');
  });

  it('extracts driver and offer ids from nested payloads', () => {
    expect(eventDriverId({ type: 'ride_offer', offer: { driver_id: 'd1' } })).toBe('d1');
    expect(eventDriverId({ type: 'ride_offer', ride: { driver_id: 'd2' } })).toBe('d2');
    expect(eventOfferId({ type: 'ride_offer', offer: { id: 'o1' } })).toBe('o1');
  });

  it('coerces numeric strings and falls through nested containers', () => {
    expect(eventNumber({ type: 'ride_offer', latitude: -17.8 }, ['latitude'])).toBe(-17.8);
    expect(eventNumber({ type: 'ride_offer', offer: { price: '12.5' } }, ['price'])).toBe(12.5);
    expect(eventNumber({ type: 'ride_offer' }, ['price'])).toBeNull();
    expect(eventNumber({ type: 'ride_offer', price: 'abc' }, ['price'])).toBeNull();
  });

  it('extracts strings from the event, then the offer, then the ride', () => {
    expect(eventString({ type: 'ride_offer', status: 'pending' }, ['status'])).toBe('pending');
    expect(eventString({ type: 'ride_offer', ride: { status: 'accepted' } }, ['status'])).toBe('accepted');
    expect(eventString({ type: 'ride_offer' }, ['status'])).toBeNull();
  });
});
