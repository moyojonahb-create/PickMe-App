# Pilot Readiness Report

Date: 2026-06-19

Scope: Implemented GO V2.5-B load testing and pilot readiness assets for PickMe Zimbabwe without changing frontend contracts.

## Result

Overall result: **PASS WITH LOCAL LOAD-RUN LIMITATIONS**

Implemented backend readiness/liveness/dependency endpoints, pilot readiness Prometheus metrics, load-test assets for API/WebSocket/vegeta runs, failure testing drills, and a Grafana pilot-readiness dashboard.

Full load targets were not executed locally because no backend was listening on `localhost:3000` during the verification run, and `vegeta` is not installed on this machine. k6 is installed and both k6 scripts execute.

## Backend Readiness Endpoints

Added:

```text
GET /health/live
GET /health/ready
GET /health/dependencies
```

Implemented in:

- `backend/internal/readiness/readiness.go`
- `backend/internal/readiness/metrics.go`
- `backend/cmd/server/main.go`

Dependency checks:

- PostgreSQL pool ping and pool stats
- Redis enabled/connected/latency status
- Asynq enabled/stats/queue-depth saturation status
- Notification provider posture: configured provider mode or local noop mode
- Dispatch mode posture

Readiness behavior:

- `/health/live` is process-only.
- `/health/ready` returns `503` when critical dependencies are degraded.
- `/health/dependencies` returns detailed dependency state for operations and load tests.

## Metrics

Added Prometheus metrics:

```text
pilot_readiness_score
system_degradation_events_total
dependency_failures_total
```

Metric behavior:

- `pilot_readiness_score` is a 0-100 gauge updated from dependency status.
- `system_degradation_events_total` increments by dependency and reason.
- `dependency_failures_total` increments by dependency.

## Load Testing

Created:

```text
backend/loadtest/
```

Assets:

- `README.md`
- `k6_api_pilot.js`
- `k6_websocket.js`
- `vegeta_targets.txt`
- `run_vegeta.ps1`
- `failure_testing.md`

Covered flows:

- Ride Requests
- Offer Creation
- Offer Acceptance
- Wallet Deposits
- Wallet Transfers
- Wallet Withdrawals
- WebSocket Connections
- Notification Delivery setup paths
- Dispatch Processing probes
- Risk Engine Events

Target levels supported by scripts:

- `TARGET=100`
- `TARGET=500`
- `TARGET=1000`
- `TARGET=5000`
- `WS_TARGET=10000`

Measured by scripts:

- p50/p95/p99 latency through k6 built-in `http_req_duration`
- error rate through `pilot_error_rate`
- queue depth through `/health/dependencies` and `/admin/jobs/stats`
- Redis latency through `/health/dependencies`
- PostgreSQL latency through `/health/dependencies`
- WebSocket delivery latency through `websocket_delivery_latency_ms`

## Failure Testing

Documented staging drills:

- Redis outage
- PostgreSQL outage
- Notification provider outage
- High WebSocket load
- Queue saturation

Drills are in:

- `backend/loadtest/failure_testing.md`

## Grafana

Added:

- `docs/grafana/pilot-readiness-dashboard.json`

Dashboard panels:

- Pilot readiness score
- System degradation events
- Dependency failures
- API p95 latency
- Asynq queue depth
- Redis/PostgreSQL failures
- WebSocket saturation
- Ride lifecycle throughput
- Notification delivery
- Risk engine load

## Capacity Estimates

These estimates are based on the implemented test targets and current platform topology. They must be replaced with measured staging numbers after running the full load suite against a deployed backend with production-like PostgreSQL, Redis, Asynq, and WebSocket capacity.

| Pilot Stage | Target Load | WebSocket Target | Readiness Gate |
|---|---:|---:|---|
| Gwanda pilot | 100 concurrent users | 500-1,000 connections | p95 API latency under 1s, error rate under 5%, readiness score 100 |
| Bulawayo pilot | 1,000 concurrent users | 5,000 connections | p95 API latency under 1s, p99 under 2s, queue depth stable, no dependency failures |
| National rollout | 5,000 concurrent API users | 10,000 connections | p95 API latency under 1s, queue depth drains under steady state, Redis/PostgreSQL saturation below alert thresholds |

## Verification

Backend:

```text
cd backend
go test ./...
PASS
```

k6 toolchain:

```text
k6 version
k6.exe v1.7.0
```

k6 API smoke:

```text
$env:TARGET='1'; $env:DURATION='1s'; k6 run backend/loadtest/k6_api_pilot.js
Result: FAIL because localhost:3000 refused connection.
Script executed cleanly and reported 100% request failure against unavailable backend.
```

k6 WebSocket smoke:

```text
$env:WS_TARGET='1'; $env:DURATION='1s'; k6 run backend/loadtest/k6_websocket.js
Result: script executed; WebSocket connection check failed because localhost:3000 refused connection.
```

vegeta toolchain:

```text
vegeta -version
FAIL: vegeta is not installed on this machine.
```
