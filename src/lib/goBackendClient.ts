import { supabase } from "@/integrations/supabase/client";

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

const API_BASE_URL =
  import.meta.env.VITE_GO_BACKEND_URL ||
  import.meta.env.VITE_API_BASE_URL ||
  import.meta.env.VITE_BACKEND_URL ||
  "";

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
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    throw new GoBackendError("Not authenticated", "UNAUTHENTICATED", 401);
  }
  return {
    Authorization: `Bearer ${token}`,
  };
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(resolveUrl(path), {
      method,
      headers: {
        ...(await authHeaders()),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    console.warn("[GoBackend] request failed", { method, path, error: String(error) });
    throw new GoBackendError("Network error while contacting backend", "NETWORK_ERROR", undefined, error);
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
