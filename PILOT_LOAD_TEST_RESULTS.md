# Pilot Load Test Results

Date: 2026-06-19

Scope: GO V2.5-B.1 pilot load test verification against backend on `localhost:3000`.

## Result

Overall result: **FAIL**

The backend process is live and readiness reports score `100`, but the pilot smoke tests did not pass. The 100-user tests were not run because the 1-user smoke gate failed.

## Backend Endpoint Verification

| Endpoint | Result | Evidence |
|---|---:|---|
| `GET /health` | PASS | `200 {"status":"ok","time":"2026-06-19T20:54:27.9790439+02:00"}` |
| `GET /health/ready` | PASS after longer timeout | `200`, status `ready`, score `100` |
| `GET /health/dependencies` | PASS after longer timeout | `200`, status `ready`, score `100` |
| `GET /metrics` | FAIL after API smoke | Prometheus gather failed with duplicate `request_duration_seconds` and `requests_total` label set for `method="GETT", route="/api/rides", status="401"` |

## Dependency Snapshot

```json
{
  "status": "ready",
  "ready": true,
  "score": 100,
  "dependencies": [
    {
      "name": "postgresql",
      "status": "ok",
      "ready": true,
      "latency_ms": 3472.524,
      "details": {
        "acquired_connections": 0,
        "idle_connections": 2,
        "max_connections": 8,
        "total_connections": 2
      }
    },
    { "name": "redis", "status": "disabled", "ready": true },
    { "name": "asynq", "status": "disabled", "ready": true },
    {
      "name": "notification",
      "status": "ok",
      "ready": true,
      "details": {
        "mode": "noop",
        "providers": {
          "email": "noop",
          "push": "noop",
          "sms": "noop"
        }
      }
    },
    {
      "name": "dispatch",
      "status": "ok",
      "ready": true,
      "details": { "mode": "off" }
    }
  ]
}
```

## k6 API Smoke

Command:

```text
TARGET=1 DURATION=30s k6 run backend/loadtest/k6_api_pilot.js
```

Result: **FAIL**

| Metric | Value |
|---|---:|
| Iterations | 15 |
| HTTP p50 | 317.19 ms |
| HTTP p95 | 1.357 s |
| HTTP p99 | 1.89 s |
| k6 `http_req_failed` | 50.00% |
| script `pilot_error_rate` | 0.00% |
| checks | 100.00% |
| PostgreSQL latency avg | 1.029 s |
| PostgreSQL latency p95 | 1.623 s |

Threshold failures:

- `http_req_duration p50<250` failed.
- `http_req_duration p95<1000` failed.

Important caveat:

- The script used no valid JWT in this run, so `/api/rides` returned `401`.
- The script treats non-5xx responses as check success, so `pilot_error_rate=0` is misleading for business-flow readiness.

## k6 WebSocket Smoke

Command:

```text
WS_TARGET=1 DURATION=30s k6 run backend/loadtest/k6_websocket.js
```

Result: **FAIL**

| Metric | Value |
|---|---:|
| WebSocket sessions attempted | 30 |
| WebSocket connection checks passed | 0 |
| WebSocket connection checks failed | 30 |
| Connection success rate | 0.00% |
| `ws_connecting` p95 | 3.18 ms |
| `ws_session_duration` p95 | 3.21 ms |
| `websocket_connection_errors` | 0 |

Important caveat:

- The WebSocket script did not establish successful `101 Switching Protocols` connections.
- The k6 process exited `0` because the script thresholds do not currently fail on connection check rate.

## 100-User Runs

Skipped.

Reason:

- The API smoke failed latency thresholds.
- WebSocket smoke had 0% successful connections.
- `/metrics` became unhealthy after API smoke due Prometheus duplicate metric collection.

## Bottlenecks

1. PostgreSQL readiness latency is too high for pilot smoke.
   - Observed dependency latency: `3472.524 ms`.
   - k6 observed Postgres latency avg: `1029.52 ms`, p95: `1623.36 ms`.

2. Prometheus `/metrics` is not stable after API traffic.
   - Failure: duplicate collected metrics for `requests_total` and `request_duration_seconds`.
   - Label evidence: `method="GETT"`, `route="/api/rides"`, `status="401"`.

3. WebSocket authentication/handshake path is not smoke-ready.
   - 30 attempted sessions.
   - 0 successful connection checks.

4. Readiness score is optimistic for pilot operations.
   - Redis is `disabled`.
   - Asynq is `disabled`.
   - Notification providers are `noop`.
   - Dispatch is `off`.
   - Score still reports `100`.

5. Load-test API script does not currently prove business-flow success.
   - Missing valid JWT means the ride request path returned `401`.
   - The script accepts non-5xx responses as successful checks.

## Readiness For Gwanda Pilot

Result: **NOT READY**

Gwanda pilot gate requires:

- API p95 under `1s`: **FAIL**, observed `1.357s`.
- API p50 under `250ms`: **FAIL**, observed `317.19ms`.
- WebSocket connection success near 100%: **FAIL**, observed `0%`.
- Stable `/metrics`: **FAIL**, duplicate metric collection error after smoke.
- Redis/Asynq available for pilot queues: **FAIL**, both disabled.
- Dispatch enabled for pilot path: **FAIL**, dispatch mode `off`.
- Notification providers configured or explicitly accepted as noop for pilot: **FAIL for production pilot**, all providers noop.

## Exact Recommended Next Fixes

1. Fix Prometheus duplicate metric collection.
   - Normalize HTTP method labels.
   - Investigate why `/api/rides` appears with `method="GETT"`.
   - Ensure each collector/label set is registered and emitted once.

2. Require real smoke credentials.
   - Run k6 with `JWT=<valid rider token>` and `ADMIN_JWT=<valid admin token>`.
   - Update the API load script checks to require expected `2xx` for authenticated business flows and to count `401/403` as smoke failures.

3. Fix WebSocket smoke authentication.
   - Run with a valid JWT accepted by `/ws`.
   - Update k6 thresholds to fail when `checks` rate is below `0.95`.
   - Confirm the server returns `101` for authenticated WebSocket clients.

4. Reduce PostgreSQL readiness latency.
   - Verify database region/network path.
   - Check pool saturation and connection acquisition time.
   - Add a short timeout around readiness `Ping`.
   - Keep p95 dependency latency under `250ms` for pilot.

5. Make readiness score pilot-aware.
   - For pilot profile, mark Redis disabled, Asynq disabled, dispatch off, or notification noop as degraded.
   - Keep local development permissive, but do not let pilot readiness report `100` with critical systems disabled.

6. Re-run sequence after fixes.
   - `TARGET=1 DURATION=30s k6_api_pilot.js`
   - `WS_TARGET=1 DURATION=30s k6_websocket.js`
   - only then run `TARGET=100 DURATION=2m` and `WS_TARGET=100 DURATION=2m`.
