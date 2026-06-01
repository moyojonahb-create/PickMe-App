import { supabase } from "@/integrations/supabase/client";

const API_URL = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");
const WS_URL = import.meta.env.VITE_WS_URL || "";

export class BackendError extends Error {
  status?: number;
  code: "unauthorized" | "forbidden" | "server_error" | "network_error" | "config_error" | "request_error";
  details?: unknown;

  constructor(message: string, code: BackendError["code"], status?: number, details?: unknown) {
    super(message);
    this.name = "BackendError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export async function getAuthToken(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new BackendError(error.message, "unauthorized", 401);
  const token = data.session?.access_token;
  if (!token) throw new BackendError("You must be logged in.", "unauthorized", 401);
  return token;
}

export async function getFreshAuthToken(): Promise<string> {
  const { data, error } = await supabase.auth.refreshSession();
  if (error) throw new BackendError(error.message, "unauthorized", 401);
  const token = data.session?.access_token;
  if (token) return token;
  return getAuthToken();
}

function getApiUrl(path: string): string {
  if (!API_URL) {
    throw new BackendError("Missing required environment variable: VITE_API_URL", "config_error");
  }
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

async function readResponse(res: Response): Promise<unknown> {
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return res.json();
  const text = await res.text();
  return text ? { message: text } : null;
}

function messageFromBody(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    const message = record.error || record.message || record.reason;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

async function backendRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await getAuthToken();

  let res: Response;
  try {
    res = await fetch(getApiUrl(path), {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw new BackendError(
      "Network error. Please check your connection and try again.",
      "network_error",
      undefined,
      error
    );
  }

  const responseBody = await readResponse(res);
  if (!res.ok) {
    if (res.status === 401) {
      throw new BackendError(messageFromBody(responseBody, "You must be logged in."), "unauthorized", 401, responseBody);
    }
    if (res.status === 403) {
      throw new BackendError(messageFromBody(responseBody, "You are not allowed to perform this action."), "forbidden", 403, responseBody);
    }
    if (res.status >= 500) {
      throw new BackendError(messageFromBody(responseBody, "Server error. Please try again."), "server_error", res.status, responseBody);
    }
    throw new BackendError(messageFromBody(responseBody, "Request failed."), "request_error", res.status, responseBody);
  }

  return responseBody as T;
}

export function backendGet<T>(path: string): Promise<T> {
  return backendRequest<T>("GET", path);
}

export function backendPost<T>(path: string, body?: unknown): Promise<T> {
  return backendRequest<T>("POST", path, body);
}

export function backendPatch<T>(path: string, body?: unknown): Promise<T> {
  return backendRequest<T>("PATCH", path, body);
}

export function backendDelete<T>(path: string, body?: unknown): Promise<T> {
  return backendRequest<T>("DELETE", path, body);
}

export function cancelRide(rideId: string, body?: Record<string, unknown>) {
  return backendPost<{ ok?: boolean; status?: string }>(`/api/rides/${encodeURIComponent(rideId)}/cancel`, body);
}

export function updateRideFare(rideId: string, fare: number) {
  return backendPost<{ ok?: boolean; fare?: number }>(`/api/rides/${encodeURIComponent(rideId)}/fare`, { fare });
}

export async function connectBackendWs(path = ""): Promise<WebSocket> {
  if (!WS_URL) {
    throw new BackendError("Missing required environment variable: VITE_WS_URL", "config_error");
  }

  const token = await getAuthToken();
  const url = new URL(path || WS_URL, WS_URL);
  url.searchParams.set("token", token);

  return new WebSocket(url.toString());
}
