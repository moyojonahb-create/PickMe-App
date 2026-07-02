# Observability Verification Report

Date: 2026-06-16

Scope: GO V2.4-A.1 verification of the newly claimed Sentry, Prometheus, OpenTelemetry, Redis/PostgreSQL/WebSocket/ride/wallet metrics, and Grafana dashboard integration.

## Executive Summary

Overall result: **FAIL**

The application builds and tests pass, and there is basic structured logging plus health endpoints. However, the backend observability stack is not production-ready:

- No backend `/metrics` endpoint is registered.
- No Prometheus Go dependency or collector registration exists.
- No OpenTelemetry Go dependency, tracer provider, propagator, or exporter exists.
- No backend Sentry SDK is wired.
- No Grafana dashboard/provisioning assets were found.
- Redis/PostgreSQL/WebSocket/ride/wallet telemetry exists as health JSON, logs, or admin/reporting SQL only, not scrapeable metrics.

Frontend Sentry exists in `src/main.tsx`, `ErrorBoundary`, and `SentryTestPanel`, but test exception capture was not runtime-verified because Sentry is enabled only in production and no live Sentry check was available in this local pass.

## Verification Matrix

| Check | Result | Evidence |
|---|---|---|
| Metrics endpoint works | **FAIL** | No `/metrics` route in backend route wiring. |
| Metrics are being emitted | **FAIL** | No Prometheus dependency, registry, counters, gauges, or histograms in `backend/go.mod` or backend code. |
| Sentry captures test exceptions | **PARTIAL / NOT VERIFIED** | Frontend Sentry code and `SentryTestPanel` exist, but backend Sentry is absent and no live Sentry event was confirmed. |
| Redis metrics populated | **FAIL** | `GET /health/redis` returns health/latency JSON; no Redis Prometheus metrics. |
| PostgreSQL metrics populated | **FAIL** | `GET /test-db` verifies connectivity only; no pgxpool stats exported. |
| WebSocket metrics populated | **FAIL** | WebSocket logs connection/message/backpressure events; no gauges/counters for connections, rooms, sends, drops, latency. |
| Ride lifecycle metrics populated | **FAIL** | Ride lifecycle emits websocket events and domain writes; no Prometheus ride lifecycle metrics. |
| Wallet metrics populated | **PARTIAL** | Wallet domain writes/reporting tables such as `financial_metrics`; not exported as Prometheus/Grafana metrics. |
| OpenTelemetry traces propagate | **FAIL** | No OTel SDK, propagators, traceparent handling, Fiber middleware, or exporter. |
| No performance regressions introduced | **PASS WITH LIMITED EVIDENCE** | Unit tests and TypeScript pass; no benchmark/load test or scrape/tracing overhead exists to assess. |

## What Exists

- Backend request ID middleware.
- Backend panic recovery middleware.
- Backend request timeout middleware.
- Backend fixed-window rate limiter.
- Backend structured HTTP request logging via `middleware.Observability()`.
- `GET /health`.
- `GET /health/redis`.
- `GET /test-db`.
- Frontend Sentry initialization in production mode.
- Frontend Sentry error boundaries/global error handlers.
- Frontend Datadog RUM opt-in integration.
- Wallet/admin/reporting SQL endpoints that expose operational data as JSON reports.

## Missing Instrumentation

- `/metrics` endpoint using Prometheus exposition format.
- HTTP request counter and latency histogram by route/method/status.
- Panic/error counter and Sentry capture path in backend recovery middleware.
- Redis command latency/error counters and pool gauges.
- PostgreSQL pool gauges: acquired, idle, total, acquire duration, query errors.
- WebSocket gauges/counters: active clients, active rooms, joins/leaves, sends, drops, backpressure disconnects, pubsub publish/subscribe errors.
- Ride lifecycle counters: requested, offered, accepted, started, completed, cancelled, settlement success/failure.
- Wallet counters/histograms: deposits, withdrawals, transfers, authorizations, captures, releases, reconciliation drift, ledger post latency/failure.
- OpenTelemetry tracing for HTTP, database, Redis, WebSocket control events, ride lifecycle, wallet settlement, and payment callbacks.
- Trace propagation from frontend to Go API (`traceparent` / `baggage`) and onward to PostgreSQL/Redis spans.
- Backend Sentry DSN/config, environment/release tagging, panic capture, and test exception endpoint guarded for non-production.

## Dashboard Gaps

No Grafana dashboard or provisioning files were found in the repository. Missing dashboards:

- API golden signals: RPS, error rate, p95/p99 latency, saturation.
- Redis health and command latency.
- PostgreSQL pool and query health.
- WebSocket connection and delivery health.
- Ride lifecycle funnel and failure rates.
- Wallet ledger/reconciliation/authorization health.
- Sentry error overview linked by release/environment.
- OTel trace latency waterfall and high-cardinality route guardrails.

## Sentry Notes

Frontend Sentry is present but has issues:

- DSN is hardcoded in `src/main.tsx`; prefer `VITE_SENTRY_DSN`.
- `enabled: import.meta.env.PROD` prevents local verification unless a production build is run.
- `SentryTestPanel` exists but is not referenced by app routing in the scanned code, so it may be unreachable.
- Backend Sentry is absent entirely.

## Performance Regression Assessment

Result: **No test-level regression detected**

Evidence:

- `go test ./...` passed.
- `npx tsc --noEmit -p tsconfig.app.json` passed.

Limitations:

- No load test was run.
- No benchmark suite was found/run.
- No Prometheus/OTel code is active, so there is no observability overhead to measure.
- Current structured request logging may become noisy under production load and should be sampled or shipped asynchronously.

## Verification Commands

Backend:

```text
cd backend
go test ./...
PASS
```

Frontend:

```text
npx tsc --noEmit -p tsconfig.app.json
PASS
```

## Production Readiness Score

Score: **25 / 100**

Rationale:

- +10 for passing backend/frontend verification.
- +5 for basic health endpoints.
- +5 for structured request logging and request IDs.
- +5 for frontend Sentry/RUM scaffolding.
- 0 for Prometheus scrapeability.
- 0 for OpenTelemetry propagation.
- 0 for backend Sentry.
- 0 for Grafana dashboard assets.
- 0 for populated Redis/Postgres/WebSocket/ride/wallet scrapeable metrics.

## Required Next Steps

1. Add a backend observability package with Prometheus registry and `/metrics`.
2. Instrument Fiber middleware for HTTP request totals, duration, in-flight requests, and panics.
3. Export pgxpool stats and Redis command stats.
4. Add WebSocket manager metrics for connections, rooms, sends, drops, and pubsub errors.
5. Add ride lifecycle and wallet domain counters at canonical state-transition/write points.
6. Add OpenTelemetry SDK, W3C propagators, HTTP middleware, and OTLP exporter.
7. Add backend Sentry SDK integration in recovery/error paths.
8. Add Grafana provisioning and dashboards for API, Redis, PostgreSQL, WebSocket, ride lifecycle, wallet, and error telemetry.
9. Add an authenticated/non-production-only observability smoke endpoint or test command that emits one metric, one trace, and one Sentry event.
