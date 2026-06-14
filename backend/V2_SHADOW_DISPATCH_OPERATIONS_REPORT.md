# V2 Shadow Dispatch Operations Report

## Summary

GO V2.0-C Shadow Dispatch Validation and Operations Dashboard backend was implemented as an additive reporting layer.

Preserved:

```text
Go Core V1 ride lifecycle
Frontend F1 contracts
V2.0-A Redis Foundation
V2.0-B Smart Dispatch Shadow Mode
public.rides
public.ride_offers
canonical websocket events
production ride_offer delivery
```

Not implemented:

```text
active dispatch
driver audience narrowing
frontend dashboard UI
wallet
push notifications
Kafka
NATS
pricing
fraud system
```

Default dispatch remains:

```text
DISPATCH_MODE=off
```

## Files Changed

```text
cmd/server/main.go
internal/dispatch/types.go
internal/dispatch/service.go
internal/dispatch/repository.go
internal/dispatch/reporting.go
internal/dispatch/reporting_test.go
internal/dispatch/service_test.go
DISPATCH_SHADOW_SCHEMA.sql
V2_SHADOW_DISPATCH_OPERATIONS_REPORT.md
```

## Architecture

Added an admin reporting surface under:

```text
internal/dispatch/reporting.go
```

The reporting layer reads only from additive shadow analytics tables:

```text
public.dispatch_shadow_runs
public.dispatch_shadow_candidates
public.dispatch_shadow_outcomes
public.dispatch_shadow_daily_stats
```

It does not write to ride lifecycle tables and does not influence dispatch, websocket delivery, offer submission, offer acceptance, ride start, location updates, or ride completion.

## Schema Additions

Extended `public.dispatch_shadow_runs` with shadow operations latency fields:

```text
candidate_discovery_latency_ms
ranking_latency_ms
shadow_write_latency_ms
```

Created daily rollup table:

```text
public.dispatch_shadow_daily_stats
```

Daily rollups include:

```text
total_shadow_runs
average_candidate_count
average_dispatch_latency_ms
average_redis_geo_latency_ms
average_candidate_discovery_latency_ms
average_ranking_latency_ms
average_shadow_write_latency_ms
actual_driver_was_candidate_rate
actual_driver_was_selected_rate
average_shadow_rank
average_first_offer_time_seconds
average_acceptance_time_seconds
redis_unavailable_count
no_coordinates_count
low_candidate_count
```

No changes were made to:

```text
public.rides
public.ride_offers
```

## APIs Created

All endpoints are registered behind the existing authenticated middleware.

```text
GET /admin/dispatch/shadow/summary
GET /admin/dispatch/shadow/daily
GET /admin/dispatch/shadow/recent
GET /admin/dispatch/shadow/runs/:id/candidates
GET /admin/dispatch/shadow/outcomes
GET /admin/dispatch/shadow/failures
GET /admin/dispatch/shadow/health
```

Query parameters:

```text
days=<positive integer>
limit=<positive integer>
```

The APIs expose dashboard-ready JSON for:

```text
total shadow runs
average candidate count
average dispatch latency
actual_driver_was_candidate_rate
actual_driver_was_selected_rate
average shadow rank
average first offer time
average acceptance time
recent shadow runs
candidate rankings
outcome comparisons
dispatch failures
redis_unavailable counts
no_coordinates counts
low candidate count detection
stale driver density
```

## Dispatch Health Metrics

Shadow dispatch now records:

```text
Redis GEO latency
Candidate discovery latency
Ranking latency
Shadow write latency
End-to-end shadow dispatch latency
```

These are written to `public.dispatch_shadow_runs` and surfaced through summary, recent-run, daily-rollup, and health endpoints.

## Safety Checks

The operations endpoints surface:

```text
low candidate counts
missing coordinates
Redis failures
no candidate results
stale driver density
shadow write latency
```

These checks are read-only and do not alter production behavior.

## Tests Added

Added coverage in:

```text
internal/dispatch/reporting_test.go
internal/dispatch/service_test.go
```

Covered:

```text
admin shadow summary endpoint
daily stats endpoint
recent runs endpoint
candidate rankings endpoint
outcome comparisons endpoint
failure endpoint
health endpoint
safe error response behavior
dispatch health latency metrics recorded during shadow runs
```

Existing V2.0-B tests continue to cover:

```text
candidate discovery
ranking
shadow selection
metrics recording
comparison logic
Redis unavailable fallback
production ride_offer behavior preservation
```

## Build Results

Attempted:

```text
go test ./...
```

Result:

```text
BLOCKED
```

Reason:

```text
The sandboxed Windows Go build cache returned Access is denied for files under:
C:\Users\ntepemanamafm\AppData\Local\go-build
```

An escalated retry was requested, but the approval path was unavailable because the Codex usage limit was reached. No workaround was used.

`go build ./cmd/server` was not executed after the same Go build-cache permission blocker.

## Runtime Validation Plan

### 1. Apply Additive Schema

Run:

```text
DISPATCH_SHADOW_SCHEMA.sql
```

Verify:

```text
public.dispatch_shadow_daily_stats exists
dispatch_shadow_runs has latency columns
public.rides unchanged
public.ride_offers unchanged
```

### 2. Deploy With Dispatch Off

Environment:

```text
DISPATCH_MODE=off
```

Verify:

```text
ride creation returns existing V1 response
driver receives existing V1 ride_offer behavior
no active dispatch occurs
admin reporting endpoints authenticate and return JSON
```

### 3. Enable Shadow Mode In Staging

Environment:

```text
DISPATCH_MODE=shadow
REDIS_ENABLED=true
```

Run:

```text
driver online
driver location update
rider creates ride with pickup coordinates
driver submits offer
rider accepts offer
```

Verify:

```text
production ride_offer delivery remains unchanged
dispatch_shadow_runs receives one run
dispatch_shadow_candidates receives ranking rows
dispatch_shadow_outcomes records comparison data
/admin/dispatch/shadow/summary returns aggregate metrics
/admin/dispatch/shadow/health returns safety counts
```

### 4. Refresh Daily Rollups

Run the rollup SQL block from:

```text
DISPATCH_SHADOW_SCHEMA.sql
```

Verify:

```text
/admin/dispatch/shadow/daily returns daily aggregates
```

### 5. Redis Failure Probe

With shadow mode enabled, point Redis to an unavailable endpoint.

Verify:

```text
ride creation still succeeds
production ride_offer still follows V1
/admin/dispatch/shadow/failures shows redis_unavailable rows
/admin/dispatch/shadow/health increments redis_unavailable_count
```

## Operational Risks

### Shadow schema not applied

If dashboard endpoints are called before the shadow tables exist, they return a safe `500` JSON error. V1 ride behavior is unaffected.

### Dashboard data freshness

Daily stats are rollup-based. Operators should schedule the rollup SQL through a safe job before relying on daily panels.

### Missing coordinates

V1 still supports text pickup locations. Shadow dispatch records and reports `no_coordinates` until coordinate-bearing requests are consistently available.

### Stale Redis GEO members

V2.0-C reports stale driver density through candidate freshness scores. Future phases should add explicit stale GEO cleanup jobs.

## Final Classification

```text
GO V2.0-C Shadow Dispatch Validation & Operations Backend: IMPLEMENTED
Active dispatch: NOT ACTIVATED
Production ride flow: PRESERVED
Frontend contracts: PRESERVED
```

## Next Recommended Phase

Recommended next phase:

```text
V2.0-C staging validation with real Redis and Supabase data
```

Do not start active dispatch until dashboard metrics prove candidate quality, Redis reliability, and outcome comparison accuracy.
