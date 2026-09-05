/**
 * Go backend WebSocket client — ported from src/lib/backendSocketClient.ts.
 *
 * Behaviour preserved exactly: 25s heartbeat with a 10s pong deadline,
 * exponential backoff to 30s, a 50-message send queue while disconnected,
 * ref-counted room join/leave keyed `ride_<id>`, room rejoin on reconnect, and
 * reconnect-with-a-fresh-token on TOKEN_REFRESHED/SIGNED_IN.
 *
 * Three things had to change to run on React Native:
 *
 *   1. `location.protocol` / `location.host` (the dev branch of WS_URL) are DOM
 *      globals. They do not exist in RN and would throw on the first connect.
 *      The URL now comes from injected config.
 *   2. `new URL(WS_URL)` + `searchParams` needed `react-native-url-polyfill`,
 *      because Hermes's URL support varies by version. Replaced with plain
 *      string concatenation — the only mutation was appending one query
 *      parameter, which does not justify a polyfill dependency on either
 *      platform.
 *   3. Module-level singleton + import-time `onAuthStateChange` side effect →
 *      factory with an explicit `dispose()`. RN screens mount and unmount far
 *      more aggressively than browser tabs, so an un-disposable global socket
 *      with a permanent auth subscription is a real leak here, not a
 *      theoretical one.
 *
 * RN's global WebSocket is API-compatible with the browser's, including
 * addEventListener and the readyState constants, so the transport itself is
 * unchanged.
 */

import type { AuthTokenProvider } from '../auth.js';

const HEARTBEAT_MS = 25_000;
const PONG_TIMEOUT_MS = 10_000;
const MAX_BACKOFF_MS = 30_000;
const INITIAL_BACKOFF_MS = 1_000;
const SEND_QUEUE_LIMIT = 50;

const WS_OPEN = 1;
const WS_CLOSED = 3;

export type BackendSocketEventType =
  | 'ride_offer'
  | 'ride_accepted'
  | 'driver_location'
  | 'ride_status_updated'
  | 'ride_cancelled'
  | 'ride_started'
  | 'ride_completed';

export type BackendSocketEvent = {
  type: BackendSocketEventType;
  event?: BackendSocketEventType;
  room?: string;
  ride?: Record<string, unknown>;
  offer?: Record<string, unknown>;
  ride_id?: string;
  rideId?: string;
  offer_id?: string;
  offerId?: string;
  driver_id?: string;
  driverId?: string;
  latitude?: number;
  longitude?: number;
  heading?: number | null;
  speed?: number | null;
  updated_at?: string;
  timestamp?: number;
  [key: string]: unknown;
};

export type BackendSocketState =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'closed'
  | 'error';

type Listener = (event: BackendSocketEvent) => void;
type StateListener = (state: BackendSocketState) => void;

const canonicalEvents = new Set<BackendSocketEventType>([
  'ride_offer',
  'ride_accepted',
  'driver_location',
  'ride_status_updated',
  'ride_cancelled',
  'ride_started',
  'ride_completed',
]);

function roomIdForRide(rideId: string): string {
  return rideId.startsWith('ride_') ? rideId : `ride_${rideId}`;
}

/** Minimal structural socket type — satisfied by both browser and RN WebSocket. */
interface SocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: 'open' | 'close' | 'error', cb: () => void): void;
  addEventListener(type: 'message', cb: (event: { data: unknown }) => void): void;
}

export type SocketFactory = (url: string) => SocketLike;

export class BackendSocketClient {
  private ws: SocketLike | null = null;
  private connectPromise: Promise<SocketLike> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private backoffMs = INITIAL_BACKOFF_MS;
  private closedByClient = false;
  private rooms = new Set<string>();
  private queue: string[] = [];
  private listeners = new Map<BackendSocketEventType, Set<Listener>>();
  private anyListeners = new Set<Listener>();
  private stateListeners = new Set<StateListener>();
  private state: BackendSocketState = 'idle';
  private roomRefs = new Map<string, number>();
  private unsubscribeAuth: (() => void) | null = null;
  private pongListeners = new Set<() => void>();

  constructor(
    private readonly deps: {
      wsUrl: string;
      auth: AuthTokenProvider;
      /** Injectable for tests; defaults to the platform's global WebSocket. */
      socketFactory?: SocketFactory;
    },
  ) {
    this.unsubscribeAuth = deps.auth.onAuthEvent((event) => {
      // Deliberately reconnect() and not reconnectWithFreshToken(): by the time
      // TOKEN_REFRESHED fires, the session already holds the new token, so
      // forcing another refresh here would be a wasted round trip on every
      // rotation. The forced path exists for foreground-resume on mobile.
      if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') this.reconnect();
      if (event === 'SIGNED_OUT') this.close();
    });
  }

  get readyState(): number {
    return this.ws?.readyState ?? WS_CLOSED;
  }

  getState(): BackendSocketState {
    return this.state;
  }

  /**
   * @param opts.forceFresh Force a token refresh before opening, rather than
   * reading whatever the session currently holds. See reconnectWithFreshToken().
   */
  async connect(opts: { forceFresh?: boolean } = {}): Promise<SocketLike> {
    if (this.ws?.readyState === WS_OPEN) return this.ws;
    if (this.connectPromise) return this.connectPromise;
    if (!this.deps.wsUrl) throw new Error('Backend socket URL is not configured');

    this.closedByClient = false;
    this.setState(this.ws ? 'reconnecting' : 'connecting');
    this.connectPromise = this.openSocket(opts.forceFresh ?? false)
      .then((socket) => {
        this.ws = socket;
        this.backoffMs = INITIAL_BACKOFF_MS;
        this.setState('open');
        this.startHeartbeat();
        this.rejoinRooms();
        this.flushQueue();
        return socket;
      })
      .finally(() => {
        this.connectPromise = null;
      });

    return this.connectPromise;
  }

  close(): void {
    this.closedByClient = true;
    this.clearTimers();
    this.ws?.close();
    this.ws = null;
    this.setState('closed');
  }

  /** Detaches the auth subscription as well as closing. Call on teardown. */
  dispose(): void {
    this.unsubscribeAuth?.();
    this.unsubscribeAuth = null;
    this.listeners.clear();
    this.anyListeners.clear();
    this.stateListeners.clear();
    this.pongListeners.clear();
    this.close();
  }

  /**
   * Reconnect, forcing a token refresh first.
   *
   * This is the method React Native must call from an AppState listener when
   * the app returns to the foreground. A backgrounded RN process has its JS
   * timers suspended, so supabase-js's auto-refresh never runs: on resume the
   * cached session can be hours stale, the server rejects the socket, and the
   * backoff loop then retries with that same dead token forever. The driver
   * shows as online and silently receives nothing. Forcing the refresh here is
   * what breaks that loop.
   *
   * Not used for TOKEN_REFRESHED — see reconnect(), where the session is
   * already fresh and refreshing again is a wasted round trip.
   */
  reconnectWithFreshToken(): void {
    this.restart({ forceFresh: true });
  }

  /** Reconnect using the current session token. */
  reconnect(): void {
    this.restart({ forceFresh: false });
  }

  private restart(opts: { forceFresh: boolean }): void {
    this.closedByClient = false;
    this.clearTimers();
    this.ws?.close();
    this.ws = null;
    if (this.rooms.size > 0 || this.listeners.size > 0 || this.anyListeners.size > 0) {
      this.connect(opts).catch((error) =>
        console.error('[BackendSocket] reconnect failed:', error),
      );
    }
  }

  /**
   * Send a ping and resolve true when the server pongs, false on timeout.
   *
   * Addition to the web client's surface, not a change to it: the heartbeat
   * already does exactly this on a 25s timer, but consumed the pong privately,
   * so nothing outside could prove a round trip. Diagnostics needed that — a
   * socket in state 'open' only proves the handshake completed, whereas a
   * pong proves the token was accepted and traffic flows both ways.
   *
   * Deliberately does not disturb the heartbeat: this sends its own ping and
   * listens for any pong, so a heartbeat pong arriving first resolves it too.
   * That is fine — either way a round trip happened.
   */
  async ping(timeoutMs = 10_000): Promise<boolean> {
    await this.connect();
    return new Promise<boolean>((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const onPong = () => {
        if (settled) return;
        settled = true;
        this.pongListeners.delete(onPong);
        if (timer) clearTimeout(timer);
        resolve(true);
      };

      this.pongListeners.add(onPong);
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.pongListeners.delete(onPong);
        resolve(false);
      }, timeoutMs);

      this.send({ event: 'ping', timestamp: Date.now() });
    });
  }

  send(message: Record<string, unknown>): void {
    const serialized = JSON.stringify(message);
    if (this.ws?.readyState === WS_OPEN) {
      this.ws.send(serialized);
      return;
    }
    this.queue.push(serialized);
    if (this.queue.length > SEND_QUEUE_LIMIT) this.queue.shift();
    this.connect().catch((error) => console.error('[BackendSocket] connect failed:', error));
  }

  joinRide(rideId: string): void {
    if (!rideId) return;
    const roomId = roomIdForRide(rideId);
    this.roomRefs.set(roomId, (this.roomRefs.get(roomId) ?? 0) + 1);
    this.rooms.add(roomId);
    this.send({ event: 'join_room', room_id: roomId });
  }

  leaveRide(rideId: string): void {
    if (!rideId) return;
    const roomId = roomIdForRide(rideId);
    const next = (this.roomRefs.get(roomId) ?? 1) - 1;
    if (next > 0) {
      this.roomRefs.set(roomId, next);
      return;
    }
    this.roomRefs.delete(roomId);
    this.rooms.delete(roomId);
    this.send({ event: 'leave_room', room_id: roomId });
  }

  on(type: BackendSocketEventType, listener: Listener): () => void {
    const set = this.listeners.get(type) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(type, set);
    this.connect().catch((error) => console.error('[BackendSocket] subscribe failed:', error));
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(type);
    };
  }

  onAny(listener: Listener): () => void {
    this.anyListeners.add(listener);
    this.connect().catch((error) => console.error('[BackendSocket] subscribe failed:', error));
    return () => this.anyListeners.delete(listener) as unknown as void;
  }

  onState(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    listener(this.state);
    this.connect().catch((error) => console.error('[BackendSocket] state subscribe failed:', error));
    return () => this.stateListeners.delete(listener) as unknown as void;
  }

  private async openSocket(forceFresh: boolean): Promise<SocketLike> {
    // DIVERGENCE-002 (see packages/core/DIVERGENCE.md). The web client infers
    // freshness from `this.state === 'reconnecting'`, which cannot work: every
    // path into connect() nulls `this.ws` first, and connect() then derives
    // state from `this.ws ? 'reconnecting' : 'connecting'` two lines later. The
    // caller's intent is overwritten before it is ever read, so the refresh
    // branch is dead code and every reconnect uses the cached token.
    //
    // Freshness is now an explicit argument, so intent survives the call.
    const token = forceFresh
      ? await this.deps.auth.refreshToken()
      : await this.deps.auth.getToken();

    if (!token) throw new Error('Cannot open backend socket without an auth token');

    // Plain concatenation rather than `new URL(...).searchParams` — see the file
    // header. One appended query parameter does not warrant a URL polyfill.
    const separator = this.deps.wsUrl.includes('?') ? '&' : '?';
    const url = `${this.deps.wsUrl}${separator}token=${encodeURIComponent(token)}`;

    const factory: SocketFactory =
      this.deps.socketFactory ?? ((u) => new WebSocket(u) as unknown as SocketLike);

    return new Promise<SocketLike>((resolve, reject) => {
      const socket = factory(url);
      let settled = false;

      socket.addEventListener('open', () => {
        settled = true;
        resolve(socket);
      });

      socket.addEventListener('message', (event) => this.handleMessage(event));

      socket.addEventListener('close', () => {
        if (this.ws === socket) this.ws = null;
        this.clearHeartbeat();
        if (!settled) reject(new Error('Backend websocket closed before opening'));
        if (!this.closedByClient) this.scheduleReconnect();
      });

      socket.addEventListener('error', () => {
        this.setState('error');
        if (!settled) reject(new Error('Backend websocket error before opening'));
      });
    });
  }

  private handleMessage(event: { data: unknown }): void {
    let data: unknown;
    try {
      data = JSON.parse(String(event.data));
    } catch {
      return;
    }

    if (!data || typeof data !== 'object') return;
    const record = data as Record<string, unknown>;
    const messageType = record.event ?? record.type;

    if (messageType === 'pong') {
      this.clearPongTimer();
      // Also surface it, so a caller can prove a round trip on demand rather
      // than inferring liveness from the absence of a disconnect 35s later.
      this.pongListeners.forEach((listener) => listener());
      return;
    }
    if (typeof messageType !== 'string' || !canonicalEvents.has(messageType as BackendSocketEventType)) {
      return;
    }

    const typed = { ...record, type: messageType, event: messageType } as BackendSocketEvent;
    this.listeners.get(typed.type)?.forEach((listener) => listener(typed));
    this.anyListeners.forEach((listener) => listener(typed));
  }

  private startHeartbeat(): void {
    this.clearHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState !== WS_OPEN) return;
      this.ws.send(JSON.stringify({ event: 'ping', timestamp: Date.now() }));
      this.clearPongTimer();
      this.pongTimer = setTimeout(() => this.ws?.close(), PONG_TIMEOUT_MS);
    }, HEARTBEAT_MS);
  }

  private rejoinRooms(): void {
    this.rooms.forEach((roomId) => {
      this.ws?.send(JSON.stringify({ event: 'join_room', room_id: roomId }));
    });
  }

  private flushQueue(): void {
    if (this.ws?.readyState !== WS_OPEN) return;
    const pending = [...this.queue];
    this.queue = [];
    pending.forEach((message) => this.ws?.send(message));
  }

  private scheduleReconnect(): void {
    this.setState('reconnecting');
    if (this.reconnectTimer) return;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch((error) => {
        console.error('[BackendSocket] reconnect failed:', error);
        this.scheduleReconnect();
      });
    }, delay);
  }

  private setState(state: BackendSocketState): void {
    this.state = state;
    this.stateListeners.forEach((listener) => listener(state));
  }

  private clearPongTimer(): void {
    if (this.pongTimer) clearTimeout(this.pongTimer);
    this.pongTimer = null;
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.clearPongTimer();
  }

  private clearTimers(): void {
    this.clearHeartbeat();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }
}

export function createBackendSocketClient(deps: {
  wsUrl: string;
  auth: AuthTokenProvider;
  socketFactory?: SocketFactory;
}): BackendSocketClient {
  return new BackendSocketClient(deps);
}
