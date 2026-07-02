import ws from "k6/ws";
import { check, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

const wsTarget = Number(__ENV.WS_TARGET || __ENV.TARGET || "100");
const duration = __ENV.DURATION || "5m";
const wsUrl = __ENV.WS_URL || "ws://localhost:3000/ws";
const jwt = __ENV.JWT || "";

export const options = {
  scenarios: {
    websocket_connections: {
      executor: "constant-vus",
      vus: wsTarget,
      duration,
    },
  },
  thresholds: {
    checks: ["rate>0.95"],
    websocket_connection_success: ["rate>0.95"],
    websocket_connection_errors: ["count<1"],
    websocket_delivery_latency_ms: ["p(95)<1000", "p(99)<2000"],
  },
};

const websocketConnectionSuccess = new Rate("websocket_connection_success");
const websocketConnectionErrors = new Counter("websocket_connection_errors");
const websocketMessages = new Counter("websocket_messages_total");
const websocketDeliveryLatency = new Trend("websocket_delivery_latency_ms");

export default function () {
  if (!jwt) {
    websocketConnectionSuccess.add(false);
    check(null, { "JWT provided for websocket flow": () => false });
    sleep(1);
    return;
  }
  const separator = wsUrl.includes("?") ? "&" : "?";
  const url = `${wsUrl}${separator}access_token=${encodeURIComponent(jwt)}`;
  const started = Date.now();
  const res = ws.connect(url, {}, (socket) => {
    socket.on("open", () => {
      websocketDeliveryLatency.add(Date.now() - started);
      socket.send(JSON.stringify({
        event: "load_test_ping",
        sent_at: Date.now(),
        room: __ENV.ROOM_ID || `load-room-${__VU % 100}`,
      }));
    });
    socket.on("message", (message) => {
      websocketMessages.add(1);
      try {
        const parsed = JSON.parse(message);
        if (parsed.sent_at) websocketDeliveryLatency.add(Date.now() - parsed.sent_at);
      } catch (_) {
        websocketDeliveryLatency.add(0);
      }
    });
    socket.on("error", () => {
      websocketConnectionSuccess.add(false);
      websocketConnectionErrors.add(1);
    });
    socket.setInterval(() => {
      socket.send(JSON.stringify({ event: "load_test_ping", sent_at: Date.now() }));
    }, 5000);
    socket.setTimeout(() => {
      socket.close();
    }, 30000);
  });
  const connected = res && res.status === 101;
  websocketConnectionSuccess.add(connected);
  check(res, { "websocket connected with 101": () => connected });
  sleep(1);
}
