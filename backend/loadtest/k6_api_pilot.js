import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

const target = Number(__ENV.TARGET || "100");
const duration = __ENV.DURATION || "5m";
const baseUrl = __ENV.BASE_URL || "http://localhost:3000";
const jwt = __ENV.JWT || "";
const riderJwt = __ENV.RIDER_JWT || jwt;
const driverJwt = __ENV.DRIVER_JWT || jwt;
const adminJwt = __ENV.ADMIN_JWT || jwt;

export const options = {
  scenarios: {
    pilot_api: {
      executor: "constant-vus",
      vus: target,
      duration,
    },
  },
  thresholds: {
    http_req_duration: ["p(50)<250", "p(95)<1000", "p(99)<2000"],
    checks: ["rate>0.95"],
    pilot_error_rate: ["rate<0.05"],
    public_endpoint_success: ["rate>0.95"],
    authenticated_business_success: ["rate>0.95"],
    authenticated_ride_created: ["rate>0.95"],
  },
};

const pilotErrorRate = new Rate("pilot_error_rate");
const publicEndpointSuccess = new Rate("public_endpoint_success");
const authenticatedBusinessSuccess = new Rate("authenticated_business_success");
const authenticatedRideCreated = new Rate("authenticated_ride_created");
const queueDepth = new Trend("pilot_queue_depth");
const redisLatency = new Trend("pilot_redis_latency_ms");
const postgresLatency = new Trend("pilot_postgres_latency_ms");
const dependencyFailures = new Counter("pilot_dependency_failures");

function headers(token = jwt) {
  const h = {
    "Content-Type": "application/json",
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function checkPublic(path, acceptedStatuses = [200]) {
  const res = http.get(`${baseUrl}${path}`);
  const ok = acceptedStatuses.includes(res.status);
  publicEndpointSuccess.add(ok);
  check(res, { [`public ${path} reachable`]: () => ok });
  return res;
}

function post(path, body, token = jwt) {
  const res = http.post(`${baseUrl}${path}`, JSON.stringify(body), { headers: headers(token) });
  const ok = res.status >= 200 && res.status < 300;
  const authFailure = res.status === 401 || res.status === 403;
  pilotErrorRate.add(!ok);
  authenticatedBusinessSuccess.add(ok);
  check(res, {
    [`POST ${path} authenticated business success`]: () => ok,
    [`POST ${path} not auth rejected`]: () => !authFailure,
  });
  return res;
}

function patch(path, body, token = jwt) {
  const res = http.patch(`${baseUrl}${path}`, JSON.stringify(body), { headers: headers(token) });
  const ok = res.status >= 200 && res.status < 300;
  const authFailure = res.status === 401 || res.status === 403;
  pilotErrorRate.add(!ok);
  authenticatedBusinessSuccess.add(ok);
  check(res, {
    [`PATCH ${path} authenticated business success`]: () => ok,
    [`PATCH ${path} not auth rejected`]: () => !authFailure,
  });
  return res;
}

function pollOperationalSignals() {
  const deps = http.get(`${baseUrl}/health/dependencies`);
  if (deps.status === 200) {
    const body = deps.json();
    for (const dep of body.dependencies || []) {
      if (!dep.ready) dependencyFailures.add(1);
      if (dep.name === "redis" && dep.latency_ms) redisLatency.add(dep.latency_ms);
      if (dep.name === "postgresql" && dep.latency_ms) postgresLatency.add(dep.latency_ms);
      if (dep.name === "asynq" && dep.details && dep.details.queue_depth !== undefined) {
        queueDepth.add(dep.details.queue_depth);
      }
    }
  }
  if (adminJwt) {
    const stats = http.get(`${baseUrl}/admin/jobs/stats`, { headers: headers(adminJwt) });
    if (stats.status === 200) {
      const body = stats.json();
      for (const queue of body.queues || []) {
        queueDepth.add((queue.pending || 0) + (queue.active || 0) + (queue.retry || 0));
      }
    }
  }
}

export default function () {
  const id = `${__VU}-${__ITER}-${Date.now()}`;
  checkPublic("/health/live");
  checkPublic("/health/ready", [200, 503]);
  checkPublic("/health/dependencies");
  if (!riderJwt) {
    authenticatedBusinessSuccess.add(false);
    authenticatedRideCreated.add(false);
    check(null, { "JWT provided for authenticated business flow": () => false });
    pollOperationalSignals();
    sleep(1);
    return;
  }

  const ride = post("/api/rides", {
    pickup_location: "Gwanda CBD",
    dropoff_location: "Gwanda Provincial Hospital",
    pickup_latitude: -20.936,
    pickup_longitude: 29.007,
    dropoff_latitude: -20.94,
    dropoff_longitude: 29.01,
    vehicle_type: "standard",
    city: "Gwanda",
    idempotency_key: `ride-${id}`,
  }, riderJwt);

  let rideId = __ENV.RIDE_ID || "";
  if (!rideId && ride.status >= 200 && ride.status < 300 && ride.body) {
    try {
      rideId = ride.json("id") || ride.json("ride_id") || "";
    } catch (_) {
      rideId = "";
    }
  }
  if (!rideId) {
    authenticatedRideCreated.add(false);
    pollOperationalSignals();
    sleep(1);
    return;
  }
  authenticatedRideCreated.add(true);
  const offerId = __ENV.OFFER_ID || `offer-${id}`;

  post(`/api/rides/${rideId}/offers`, {
    offer_id: offerId,
    driver_id: __ENV.DRIVER_ID || "load-driver-1",
    amount_minor: 500,
    currency: "USD",
    eta_minutes: 4,
  }, driverJwt);
  post(`/api/rides/${rideId}/offers/${offerId}/accept`, {}, riderJwt);
  post(`/api/rides/${rideId}/status`, { status: "started" }, driverJwt);
  post(`/api/rides/${rideId}/complete`, { final_fare_minor: 500, currency: "USD" }, driverJwt);

  post("/api/wallets/deposits", {
    amount: 10,
    currency: "USD",
    method: "cash",
    city: "Gwanda",
    idempotency_key: `deposit-${id}`,
  }, riderJwt);
  post("/api/wallets/transfer", {
    receiver_id: __ENV.RECEIVER_ID || "load-receiver-1",
    amount: 2.5,
    note: "pilot load test",
  }, riderJwt);
  post("/api/wallets/withdrawals", {
    amount: 5,
    currency: "USD",
    method: "bank",
    destination_reference: "load-bank",
    idempotency_key: `withdraw-${id}`,
  }, riderJwt);

  post("/api/notifications/device", {
    platform: "web",
    device_token: `load-device-${id}`,
    app_version: "pilot-load",
  }, riderJwt);
  post("/api/notifications/preferences", {
    push: true,
    sms: true,
    email: true,
    marketing: false,
    transactional: true,
  }, riderJwt);

  post("/api/risk/events", {
    area: "fake_ride_creation",
    event_type: "load_test_signal",
    severity: "low",
    device_fingerprint: `load-device-${__VU}`,
    metadata: { iteration: __ITER, city: "Gwanda" },
  }, riderJwt);

  patch(`/api/rides/${rideId}`, { note: "dispatch processing load probe" }, riderJwt);
  pollOperationalSignals();
  sleep(1);
}
