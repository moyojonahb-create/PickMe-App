# Pilot Smoke Fix Report

Date: 2026-06-19

Scope: GO V2.5-B.2 pilot smoke blocker fixes for PickMe Zimbabwe.

## Result

Overall result: **PASS FOR SMOKE BLOCKER FIXES, FAIL FOR FULL PILOT BUSINESS SMOKE**

Implemented the requested source fixes for Prometheus label stability, JWT-required k6 API/WebSocket smoke tests, pilot-aware readiness scoring, and PostgreSQL readiness diagnostics.

The updated backend was verified on `localhost:3100` because an older backend was already present on the normal pilot port. The updated process served the patched code.

## Implemented Fixes

### Prometheus Duplicate Metrics

Updated:

- `backend/internal/observability/observability.go`

Changes:

- Normalized HTTP method labels through `normalizeHTTPMethod`.
- Allowed only stable method labels: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`, `HEAD`, `OTHER`.
- Copied route/method label strings before passing them to Prometheus.
- Kept collector registration in package `init()` so collectors register once per process.

Verification after API and WebSocket traffic:

```text
GET /metrics
STATUS=200
requests_total{method="GET",route="/health/ready",status="503"} 38
requests_total{method="GET",route="/ws",status="101"} 1
requests_total{method="POST",route="/api/rides",status="500"} 11
request_duration_seconds_count{method="GET",route="/ws",status="101"} 1
```

No duplicate metric collection error occurred after traffic, and no `GETT` method label appeared.

### k6 API Smoke

Updated:

- `backend/loadtest/k6_api_pilot.js`

Changes:

- Requires JWT for authenticated business flows.
- Treats missing JWT as an intentional smoke failure.
- Treats `401` and `403` as business-flow failures.
- Separates public endpoint checks from authenticated endpoint checks.
- Adds separate metrics:
  - `public_endpoint_success`
  - `authenticated_business_success`
  - `authenticated_ride_created`
- Supports separate tokens:
  - `RIDER_JWT`
  - `DRIVER_JWT`
  - `ADMIN_JWT`
  - `JWT` remains the fallback.

Missing JWT smoke:

```text
TARGET=1 DURATION=30s BASE_URL=http://localhost:3100 k6 run backend/loadtest/k6_api_pilot.js
Result: FAIL intentionally
public_endpoint_success: 100.00%
authenticated_business_success: 0.00%
authenticated_ride_created: 0.00%
checks: 75.00%
JWT provided for authenticated business flow: 0 / 13
```

Valid JWT smoke:

```text
TARGET=1 DURATION=30s BASE_URL=http://localhost:3100 RIDER_JWT=<set> DRIVER_JWT=<set> ADMIN_JWT=<set> k6 run backend/loadtest/k6_api_pilot.js
Result: FAIL at business route, not auth
POST /api/rides not auth rejected: PASS
POST /api/rides authenticated business success: 0 / 10
authenticated_ride_created: 0.00%
```

Server evidence:

```text
POST path=/api/rides status=500 user_id=00000000-0000-0000-0000-000000000111
```

The valid JWT now reaches the ride business handler. The remaining API smoke failure is a `500` on ride creation, not the previous missing-auth false positive.

### k6 WebSocket Smoke

Updated:

- `backend/loadtest/k6_websocket.js`

Changes:

- Requires JWT.
- Sends token as `access_token` in the WebSocket URL.
- Validates `101 Switching Protocols`.
- Fails when `websocket_connection_success` is below `95%`.
- Fails when global checks are below `95%`.

Missing JWT smoke:

```text
WS_TARGET=1 DURATION=30s WS_URL=ws://localhost:3100/ws k6 run backend/loadtest/k6_websocket.js
Result: FAIL intentionally
websocket_connection_success: 0.00%
checks: 0.00%
JWT provided for websocket flow: 0 / 30
```

Valid JWT smoke:

```text
WS_TARGET=1 DURATION=30s WS_URL=ws://localhost:3100/ws JWT=<set> k6 run backend/loadtest/k6_websocket.js
Result: FAIL latency threshold only
websocket_connection_success: 100.00%
checks: 100.00%
websocket connected with 101: PASS
websocket_delivery_latency_ms p95: 1106 ms
```

The WebSocket auth/handshake blocker is fixed. The remaining WebSocket smoke failure is connection/delivery latency slightly above the 1s threshold.

### Pilot Readiness Scoring

Updated:

- `backend/internal/config/config.go`
- `backend/internal/readiness/readiness.go`
- `backend/cmd/server/main.go`

Added:

```text
READINESS_PROFILE
APP_PROFILE
```

Behavior:

- Local profile permits disabled Redis/Asynq/dispatch/noop notification providers.
- Pilot/production profiles mark those states degraded.
- `/health/ready` returns `503` when pilot-critical dependencies are disabled.

Verification:

```text
GET /health/dependencies
STATUS=200
status=degraded ready=False score=20
redis: disabled ready=false
asynq: disabled ready=false
notification: noop ready=false
dispatch: off ready=false
```

### PostgreSQL Readiness Check

Updated:

- `backend/internal/readiness/readiness.go`

Changes:

- Added timeout around readiness check.
- Reports connection acquisition latency separately from query latency.
- Exports pgxpool stats in `/health/dependencies`.
- Includes Supabase pooler/direct connection guidance.
- Does not hide real latency.

Verification sample:

```text
postgresql status=ok ready=true latency_ms=651.594
acquire_latency_ms=344.444
query_latency_ms=307.15
timeout_ms=2000
acquired_connections=1
idle_connections=1
total_connections=2
max_connections=16
acquire_count=79
empty_acquire_count=2
canceled_acquire_count=0
```

PostgreSQL readiness is now better instrumented and bounded, but latency is still above the pilot target.

## Verification

Backend:

```text
cd backend
$env:GOCACHE=(Resolve-Path .).Path + '\.gocache'
go test ./...
PASS
```

Endpoint checks against patched backend:

```text
GET /health
STATUS=200

GET /health/ready
STATUS=503

GET /health/dependencies
STATUS=200
status=degraded ready=False score=20

GET /metrics
STATUS=200
```

## Remaining Bottlenecks

1. Authenticated ride creation returns `500`.
   - JWT auth is no longer the blocker.
   - The handler is reached with a real `user_id`.
   - Need inspect ride creation logs/database constraints for the `500`.

2. WebSocket positive smoke connects but exceeds latency threshold.
   - Connection success: `100%`.
   - p95 delivery/connect latency: `1106 ms`.
   - Target threshold: `<1000 ms`.

3. PostgreSQL readiness latency remains too high.
   - Observed readiness sample: `651.594 ms`.
   - Acquisition and query time are now separated, showing both network/pool acquisition and query latency matter.

4. Pilot readiness correctly fails because critical systems are disabled.
   - Redis disabled.
   - Asynq disabled.
   - Dispatch off.
   - Notification providers noop.

## Exact Next Fixes

1. Debug `POST /api/rides` `500` with the valid generated JWT user.
   - Capture the DB error from `Handler.Request`.
   - Verify required ride columns, triggers, and foreign keys.
   - Seed a valid rider profile for k6 or relax the smoke to use a dedicated test fixture.

2. Tune WebSocket handshake latency.
   - Measure auth verification duration for `/ws`.
   - Avoid database room authorization on bare `/ws` connect.
   - Keep connection p95 below `1000 ms` before running `WS_TARGET=100`.

3. Reduce Postgres readiness latency.
   - Compare Supabase direct connection versus pooler latency.
   - Keep direct/session pooling for prepared statement cache or set `PGX_QUERY_EXEC_MODE=describe_exec` for transaction pooler.
   - Keep readiness p95 under `200 ms`.

4. Run pilot smoke only after enabling pilot dependencies.
   - `REDIS_ENABLED=true`
   - `ASYNQ_ENABLED=true`
   - `DISPATCH_MODE` not `off`
   - Configure at least one real notification provider or explicitly run in local profile.
