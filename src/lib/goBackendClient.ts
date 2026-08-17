import { supabase } from "@/integrations/supabase/client";
import { authReady } from "@/lib/authReady";

export type GoBackendErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "RATE_LIMITED"
  | "WALLET_ERROR"
  | "SERVER_ERROR"
  | "NETWORK_ERROR"
  | "BAD_RESPONSE"
  | "UNKNOWN";

export type GoRideCreateRequest = {
  pickup_address: string;
  dropoff_address: string;
  pickup_lat: number;
  pickup_lon: number;
  dropoff_lat: number;
  dropoff_lon: number;
  distance_km: number;
  duration_minutes: number;
  fare?: number;
  fare_minor?: number;
  estimated_fare_minor?: number;
  offered_fare_minor?: number;
  price_minor?: number;
  currency?: string;
  vehicle_type?: string;
  payment_method?: string;
  passenger_count?: number;
  scheduled_at?: string;
  town_id?: string | null;
  gender_preference?: string;
  route_polyline?: string | null;
  [key: string]: unknown;
};

export type GoRideResponse = {
  id?: string;
  ride_id?: string;
  ride?: Record<string, unknown>;
  ok?: boolean;
  reason?: string;
  [key: string]: unknown;
};

export type GoOfferCreateRequest = {
  ride_id?: string;
  price?: number;
  price_minor: number;
  offered_fare_minor?: number;
  offer_fare_minor?: number;
  eta_minutes?: number;
  message?: string | null;
  status?: string;
  [key: string]: unknown;
};

export type GoRideStatusRequest = {
  status: string;
  expected_status?: string;
};

export type GoDriverPresenceRequest = {
  is_online: boolean;
  latitude?: number;
  longitude?: number;
};

export type GoDriverLocationRequest = {
  latitude: number;
  longitude: number;
  heading?: number;
  speed?: number;
};

export class GoBackendError extends Error {
  code: GoBackendErrorCode;
  status?: number;
  details?: unknown;

  constructor(message: string, code: GoBackendErrorCode, status?: number, details?: unknown) {
    super(message);
    this.name = "GoBackendError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

// In local dev, the deployed backend's CORS allowlist rejects the
// localhost origin outright — every request fails before it even reaches
// the server. Route through Vite's dev-only proxy (see vite.config.ts)
// instead, which forwards server-to-server and isn't subject to browser
// CORS. Production builds are unaffected — import.meta.env.DEV is false.
const API_BASE_URL = import.meta.env.DEV
  ? "/go-api"
  : (import.meta.env.VITE_GO_BACKEND_URL ||
     import.meta.env.VITE_API_BASE_URL ||
     import.meta.env.VITE_BACKEND_URL ||
     "");

function resolveUrl(path: string): string {
  if (!API_BASE_URL) {
    throw new GoBackendError("Go backend base URL is not configured", "BAD_RESPONSE");
  }
  const base = API_BASE_URL.replace(/\/+$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}

function statusToCode(status: number): GoBackendErrorCode {
  if (status === 401) return "UNAUTHENTICATED";
  if (status === 403) return "FORBIDDEN";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 500) return "SERVER_ERROR";
  return "UNKNOWN";
}

function payloadToCode(payload: unknown, fallback: GoBackendErrorCode): GoBackendErrorCode {
  if (typeof payload !== "object" || !payload) return fallback;
  const rawCode = "code" in payload ? String((payload as { code?: unknown }).code) : "";
  const rawReason = "reason" in payload ? String((payload as { reason?: unknown }).reason) : "";
  const normalized = `${rawCode} ${rawReason}`.toLowerCase();
  if (normalized.includes("wallet") || normalized.includes("balance") || normalized.includes("insufficient_funds")) {
    return "WALLET_ERROR";
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

async function authHeaders(): Promise<Record<string, string>> {
  // Wait for the Supabase client's first real session result before ever
  // reading a token — reading getSession() before that has settled can hand
  // back a not-yet-hydrated/stale session and send the request into a 401.
  await authReady;
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    throw new GoBackendError("Not authenticated", "UNAUTHENTICATED", 401);
  }
  return {
    Authorization: `Bearer ${token}`,
  };
}

// No request to the Go backend may hang indefinitely — a stalled DNS lookup,
// a blocked port, or a server that accepts the connection but never replies
// must fail fast into the Supabase fallback path instead of leaving the
// caller's await stuck forever (see requestRide.ts / isBackendUnavailable).
// Kept short deliberately: a fast failure with a retry affordance beats a
// long hang that just delays the same failure.
const REQUEST_TIMEOUT_MS = 8_000;

async function doFetch(method: string, path: string, headers: Record<string, string>, body?: unknown): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(resolveUrl(path), {
      method,
      headers: {
        ...headers,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    const timedOut = (error as { name?: string })?.name === "AbortError";
    console.warn("[GoBackend] request failed", { method, path, timedOut, error: String(error) });
    throw new GoBackendError(
      timedOut ? "Backend request timed out" : "Network error while contacting backend",
      "NETWORK_ERROR",
      undefined,
      error
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function request<T>(method: string, path: string, body?: unknown, isRetry = false): Promise<T> {
  // Resolved outside the fetch try/catch below so an auth failure (no/expired
  // session) surfaces as UNAUTHENTICATED instead of being masked as a generic
  // network error.
  const headers = await authHeaders();
  const response = await doFetch(method, path, headers, body);

  // The session looked valid client-side but the server rejected the token
  // (e.g. it expired between attach and receipt) — refresh once and retry
  // before surfacing an error, instead of failing a call that would have
  // succeeded a moment later.
  if (response.status === 401 && !isRetry) {
    const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
    if (!refreshError && refreshed.session) {
      return request<T>(method, path, body, true);
    }
  }

  const payload = await parseResponse(response);
  if (!response.ok) {
    const message =
      typeof payload === "object" && payload && "error" in payload
        ? String((payload as { error?: unknown }).error)
        : typeof payload === "object" && payload && "message" in payload
          ? String((payload as { message?: unknown }).message)
          : `Backend request failed with ${response.status}`;
    console.warn("[GoBackend] non-2xx response", { method, path, status: response.status, message });
    const fallbackCode = statusToCode(response.status);
    throw new GoBackendError(message, payloadToCode(payload, fallbackCode), response.status, payload);
  }

  return payload as T;
}

export const goBackend = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  delete: <T>(path: string, body?: unknown) => request<T>("DELETE", path, body),
};

export function getGoBackendBaseUrl(): string {
  return API_BASE_URL;
}
