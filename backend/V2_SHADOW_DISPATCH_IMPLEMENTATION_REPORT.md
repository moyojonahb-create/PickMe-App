# V2 Shadow Dispatch Implementation Report

## Summary

GO V2.0-B Smart Dispatch Shadow Mode was implemented as an observation-only system.

Production behavior remains unchanged:

```text
Go Core V1 ride lifecycle: preserved
Frontend F1 contracts: preserved
public.rides: unchanged
public.ride_offers: unchanged
ride_offer websocket contract: unchanged
production ride_offer delivery: unchanged
```

Shadow Mode can discover, filter, rank, record, and compare dispatch candidates, but it does not send dispatch offers and does not affect riders or drivers.

Default mode:

```text
DISPATCH_MODE=off
```

## Files Changed

```text
cmd/server/main.go
internal/config/config.go
internal/rides/handler.go
internal/rides/types.go
internal/rides/handler_test.go
internal/geo/service.go
internal/dispatch/types.go
internal/dispatch/service.go
internal/dispatch/geo_provider.go
internal/dispatch/repository.go
internal/dispatch/service_test.go
internal/dispatch/geo_provider_test.go
DISPATCH_SHADOW_SCHEMA.sql
V2_SHADOW_DISPATCH_IMPLEMENTATION_REPORT.md
```

V2.0-A Redis foundation files remain part of the working tree:

```text
internal/redis/*
internal/geo/*
internal/drivers/handler_test.go
V2_REDIS_FOUNDATION_REPORT.md
```

## Architecture

Added:

```text
internal/dispatch
```

Responsibilities:

```text
read Redis GEO candidates through internal/geo
filter online, available, fresh-location candidates
rank candidates by distance, freshness, and availability
select top-ranked candidates for analytics only
record shadow metrics in additive analytics tables
compare actual offer/acceptance drivers against shadow candidates
log who would have been selected
```

No dispatch package code can send websocket messages or alter the production driver audience.

## Configuration

Added:

```text
DISPATCH_MODE=off|shadow
DISPATCH_SHADOW_RADIUS_KM
DISPATCH_SHADOW_CANDIDATE_LIMIT
DISPATCH_SHADOW_SELECTED_LIMIT
DISPATCH_SHADOW_RANKING_VERSION
```

Defaults:

```text
DISPATCH_MODE=off
DISPATCH_SHADOW_RADIUS_KM=5
DISPATCH_SHADOW_CANDIDATE_LIMIT=20
DISPATCH_SHADOW_SELECTED_LIMIT=3
DISPATCH_SHADOW_RANKING_VERSION=v2.0-b-simple
```

## Schema Additions

Created SQL file:

```text
DISPATCH_SHADOW_SCHEMA.sql
```

Additive analytics tables:

```text
public.dispatch_shadow_runs
public.dispatch_shadow_candidates
public.dispatch_shadow_outcomes
```

No changes were made to:

```text
public.rides
public.ride_offers
```

## Shadow Flow

### Ride Creation

After V1 successfully inserts `public.rides` and sends the existing production `ride_offer`, the ride handler invokes the optional shadow observer.

Important:

```text
h.offerNotifier.NotifyRideOffer(offer)
```

remains the production delivery path. Shadow Mode does not replace or narrow it.

### Candidate Discovery

Shadow Mode reads candidates from Redis GEO via `internal/geo`.

Filters:

```text
state == online
availability == available
freshness_score > 0
```

Redis unavailable behavior:

```text
record/log redis_unavailable
do not fail ride creation
do not change ride_offer delivery
```

### Candidate Ranking

Scoring:

```text
score =
  0.45 * proximity_score
+ 0.25 * freshness_score
+ 0.20 * availability_score
+ 0.10 * fairness_placeholder
```

Selection:

```text
selected_driver_id = rank 1 candidate
top selected candidates = DISPATCH_SHADOW_SELECTED_LIMIT
```

Selection is analytics-only.

### Outcome Comparison

After successful V1 offer submission:

```text
RecordFirstOfferOutcome
```

After successful V1 offer acceptance transaction commit:

```text
RecordAcceptedOfferOutcome
```

These writes are async and best-effort. Failures log warnings and do not affect offer response status, response body, ride assignment, or `ride_accepted` delivery.

## Metrics Captured

Shadow run metrics:

```text
candidate_count
selected_count
dispatch_latency_ms
redis_latency_ms
selected_driver_id
selected_rank
ranking_version
status
```

Outcome comparison:

```text
actual_driver_was_candidate
actual_driver_was_selected
actual_driver_shadow_rank
actual_driver_shadow_score
first_offer_was_candidate
first_offer_was_selected
first_offer_shadow_rank
seconds_to_first_offer
seconds_to_acceptance
```

## Tests Added

```text
internal/dispatch/service_test.go
internal/dispatch/geo_provider_test.go
internal/rides/handler_test.go
```

Covered:

```text
DISPATCH_MODE=off performs no shadow query or write
missing coordinates records no_coordinates safely
Redis unavailable records redis_unavailable and does not affect V1
candidate ranking is deterministic
shadow selection records top candidate and selected rank
shadow write failure does not change computed shadow result
comparison logic records first-offer and accepted-offer outcomes
Geo candidate provider filters online/available drivers
Geo candidate provider maps Redis unavailable cleanly
ride_offer delivery remains exactly one production notification when observer is present
```

## Build Results

Executed with normal Windows Go build-cache access:

```text
go test ./...          PASS
go build ./cmd/server PASS
```

## Runtime Verification Plan

### 1. Deploy Off Mode

Environment:

```text
DISPATCH_MODE=off
```

Verify:

```text
POST /api/rides returns same response as V1
driver receives same ride_offer behavior as V1
no rows are inserted into dispatch_shadow_* tables
```

### 2. Prepare Shadow Tables

Apply:

```text
DISPATCH_SHADOW_SCHEMA.sql
```

This is additive only.

### 3. Enable Shadow Mode In Staging

Environment:

```text
DISPATCH_MODE=shadow
REDIS_ENABLED=true
```

Run:

```text
driver online
driver location update with Redis hot-state write
rider creates ride with optional pickup coordinates
driver submits offer
rider accepts offer
```

Verify:

```text
production ride_offer count is unchanged
dispatch_shadow_runs has one row for the ride
dispatch_shadow_candidates contains ranked candidates when coordinates and Redis data exist
dispatch_shadow_outcomes compares actual driver against shadow candidates
no rider/driver visible behavior changes
```

### 4. Redis Unavailable Probe

Temporarily point `REDIS_URL` to an unavailable endpoint with:

```text
DISPATCH_MODE=shadow
REDIS_ENABLED=true
```

Verify:

```text
ride creation still returns 201
ride_offer still delivers as V1
shadow run status records/logs redis_unavailable
```

## Operational Risks

### Missing pickup coordinates

V1 stores pickup location as text. Shadow dispatch records `no_coordinates` when optional coordinates are not supplied. This is safe and expected until geocoding or coordinate-bearing frontend payloads are introduced.

### Shadow schema not applied

If `DISPATCH_MODE=shadow` is enabled before `DISPATCH_SHADOW_SCHEMA.sql` is applied, shadow writes log warnings. V1 ride flow remains successful.

### Redis stale candidates

Candidates are filtered through Redis location freshness and dispatch freshness scoring. Future phases should add explicit stale GEO member cleanup.

### Request latency

Ride observations and outcome comparisons are async and best-effort. They should not materially affect HTTP response latency. Monitor logs for dispatch warnings.

## Final Classification

```text
GO V2.0-B Smart Dispatch Shadow Mode: IMPLEMENTED
Active dispatch: NOT ACTIVATED
Production behavior: PRESERVED
```

## Next Recommended Phase

Recommended GO V2.0-C:

```text
Shadow dispatch runtime validation and dashboarding
```

Do not proceed to active dispatch until:

```text
shadow data quality is verified
actual_driver_was_candidate_rate is understood
actual_driver_was_selected_rate is acceptable
Redis failure behavior is proven
operators can inspect shadow decisions
```
