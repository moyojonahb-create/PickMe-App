import { supabase } from "@/integrations/supabase/client";
import { getGoBackendBaseUrl } from "@/lib/goBackendClient";

export type GoRideSocketEvent =
  | "ride_offer"
  | "ride_accepted"
  | "driver_location"
  | "ride_started"
  | "ride_completed";

export type GoRideSocketMessage<T = unknown> = {
  type: GoRideSocketEvent;
  payload: T;
};

type Handler = (message: GoRideSocketMessage) => void;

export async function connectGoRideSocket(rideId: string, onMessage: Handler): Promise<() => void> {
  const base = getGoBackendBaseUrl();
  if (!base) {
    console.warn("[GoRideSocket] VITE_GO_BACKEND_URL is not configured");
    return () => {};
  }

  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    console.warn("[GoRideSocket] No access token available");
    return () => {};
  }

  const url = new URL(base);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.searchParams.set("access_token", token);
  url.searchParams.set("room", `ride_${rideId}`);

  const socket = new WebSocket(url.toString());
  socket.onmessage = (event) => {
    try {
      const parsed = JSON.parse(event.data) as GoRideSocketMessage;
      if (["ride_offer", "ride_accepted", "driver_location", "ride_started", "ride_completed"].includes(parsed.type)) {
        onMessage(parsed);
      }
    } catch (error) {
      console.warn("[GoRideSocket] ignored malformed message", { error: String(error) });
    }
  };
  socket.onerror = () => {
    console.warn("[GoRideSocket] websocket error", { rideId });
  };

  return () => {
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close();
    }
  };
}
