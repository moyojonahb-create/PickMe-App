# PickMe GO V2.0-B Smart Dispatch Shadow Mode Plan

## Executive Summary

GO V2.0-B introduces Smart Dispatch Shadow Mode as an invisible marketplace intelligence layer.

Shadow Mode must not change production rider or driver behavior. It observes each new ride request, reads Redis GEO driver candidates, ranks the candidates, logs who would have been selected, records dispatch metrics, and later compares the shadow-selected drivers against the driver who actually submits or wins the accepted offer through the unchanged V1 flow.

Preserved:

```text
Go Core V1 ride lifecycle
Frontend F1 routes and payloads
public.rides
public.ride_offers
canonical ride_offer websocket contract
current production ride_offer delivery
current driver offer submission
current rider offer list and acceptance
```

Not implemented or activated:

```text
active dispatch
driver-target narrowing
changed ride_offer delivery
new frontend behavior
pricing
wallet
push notifications
Kafka
NATS
fraud system
```

## 1. Architecture

### New Internal Components

Recommended packages:

```text
internal/dispatch
internal/dispatch/shadow
```

The shadow dispatcher consumes V1 ride creation context and Redis GEO candidate data, but it does not control production delivery.

### Shadow Flow

Current V1 production flow remains:

```text
Rider creates ride
Go writes public.rides
Go sends ride_offer according to current V1 contract
Driver submits offer
Rider accepts offer
Ride lifecycle proceeds unchanged
```

V2.0-B shadow side flow:

```text
Rider creates ride
After public.rides insert succeeds, shadow dispatcher receives ride context
Shadow dispatcher queries Redis GEO candidates
Shadow dispatcher filters stale/unavailable candidates
Shadow dispatcher ranks candidates
Shadow dispatcher records selected candidates in shadow tables
Shadow dispatcher logs who would have been selected
Production ride_offer delivery remains unchanged
Later offer/acceptance activity is compared against shadow candidates
```

### Dispatch Modes

V2.0-B should support config modes but ship with shadow disabled unless explicitly enabled:

```text
DISPATCH_MODE=off
DISPATCH_MODE=shadow
```

Meaning:

```text
off     no shadow discovery or writes
shadow  observe and record only; never changes ride_offer delivery
```

Active mode is intentionally out of scope.

### Service Boundary

The shadow dispatcher may read:

```text
ride context from the V1 request
Redis GEO candidates from internal/geo
driver hot-state metadata from Redis hashes
driver reputation/future ranking inputs if present
```

The shadow dispatcher may write:

```text
shadow dispatch attempts
shadow dispatch metrics
logs
```

The shadow dispatcher must not write:

```text
public.rides
public.ride_offers
driver assignment
production websocket delivery decisions
```

## 2. Schema Additions

No changes to:

```text
public.rides
public.ride_offers
```

Recommended additive tables:

### `public.dispatch_shadow_runs`

Purpose: one row per ride request shadow-dispatch analysis.

```text
id uuid primary key
ride_id uuid not null
rider_id uuid
pickup_lat numeric(10,7)
pickup_lng numeric(10,7)
pickup_location text
dropoff_location text
vehicle_type text
city text
mode text not null default 'shadow'
status text not null
candidate_count integer not null default 0
selected_count integer not null default 0
redis_available boolean not null default false
redis_latency_ms numeric(10,3)
ranking_version text not null
started_at timestamptz not null
completed_at timestamptz
error text
created_at timestamptz not null default now()
```

Suggested statuses:

```text
completed
redis_unavailable
no_candidates
failed
disabled
```

### `public.dispatch_shadow_candidates`

Purpose: one row per candidate discovered during shadow dispatch.

```text
id uuid primary key
shadow_run_id uuid not null
ride_id uuid not null
driver_id uuid not null
rank integer not null
selected boolean not null default false
distance_km numeric(8,3)
score numeric(10,4)
proximity_score numeric(6,4)
freshness_score numeric(6,4)
availability_score numeric(6,4)
reputation_score numeric(6,4)
fairness_score numeric(6,4)
location_updated_at timestamptz
vehicle_type text
city text
exclusion_reason text
created_at timestamptz not null default now()
```

Recommended indexes:

```text
dispatch_shadow_candidates(ride_id)
dispatch_shadow_candidates(driver_id)
dispatch_shadow_candidates(shadow_run_id, rank)
dispatch_shadow_candidates(ride_id, selected)
```

### `public.dispatch_shadow_outcomes`

Purpose: compare shadow candidates against actual V1 marketplace outcomes.

```text
id uuid primary key
ride_id uuid not null unique
shadow_run_id uuid
actual_driver_id uuid
actual_offer_id uuid
actual_driver_was_candidate boolean
actual_driver_was_selected boolean
actual_driver_shadow_rank integer
actual_driver_shadow_score numeric(10,4)
first_offer_driver_id uuid
first_offer_was_candidate boolean
first_offer_was_selected boolean
first_offer_shadow_rank integer
seconds_to_first_offer integer
seconds_to_acceptance integer
ride_final_status text
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

This table can be populated when:

```text
first driver offer is submitted
rider accepts an offer
ride completes/cancels
periodic reconciliation runs
```

## 3. Candidate Discovery

Shadow dispatch reads Redis GEO through the existing V2.0-A `internal/geo` service.

Candidate query inputs:

```text
pickup latitude
pickup longitude
radius_km
city
vehicle_type
count
```

Initial shadow defaults:

```text
radius_km=5
count=20
vehicle_type=economy
city=default unless derived
```

Important constraint:

V1 currently stores pickup as text, not canonical coordinates. V2.0-B should support shadow dispatch only when coordinates are available from request metadata, future optional fields, or geocoding output. If coordinates are missing, the shadow run should record:

```text
status=no_coordinates
candidate_count=0
selected_count=0
```

No rider-facing behavior changes.

## 4. Ranking Design

Shadow ranking should be intentionally simple and explainable at first.

Initial score:

```text
score =
  0.45 * proximity_score
+ 0.25 * freshness_score
+ 0.20 * availability_score
+ 0.10 * fairness_score
```

Deferred to future phases:

```text
driver reputation
driver cancellation penalty
driver earnings fairness
ETA model
pricing sensitivity
fraud/risk penalty
```

### Score Components

**Proximity score**

```text
1.0 at 0 km
0.0 at or beyond configured radius
linear decay for V2.0-B
```

**Freshness score**

```text
1.0 if location updated within 10 seconds
0.5 if updated within 30 seconds
0.0 if stale beyond Redis TTL
```

**Availability score**

```text
1.0 if driver presence availability=available
0.5 if presence unknown but fresh location exists
0.0 if unavailable/busy/offline
```

**Fairness score**

V2.0-B placeholder:

```text
0.5 neutral for all candidates
```

Real fairness scoring belongs in a later driver reputation/fairness phase.

## 5. Selection Design

Shadow selection should choose:

```text
top 5 candidates by score
```

These drivers are recorded as `selected=true`, but production `ride_offer` delivery remains exactly as V1.

Logs should include:

```text
ride_id
shadow_run_id
candidate_count
selected_driver_ids
top_score
redis_latency_ms
ranking_version
```

Log example:

```text
Smart dispatch shadow: ride_id=... candidates=18 selected=[d1 d2 d3 d4 d5] top_score=0.9123
```

## 6. Metrics Design

### Operational Metrics

```text
dispatch_shadow_runs_total
dispatch_shadow_runs_failed_total
dispatch_shadow_redis_unavailable_total
dispatch_shadow_no_coordinates_total
dispatch_shadow_no_candidates_total
dispatch_shadow_candidates_count
dispatch_shadow_selected_count
dispatch_shadow_redis_latency_ms
dispatch_shadow_duration_ms
```

### Marketplace Quality Metrics

```text
actual_driver_was_candidate_rate
actual_driver_was_selected_rate
first_offer_driver_was_candidate_rate
first_offer_driver_was_selected_rate
average_actual_driver_shadow_rank
seconds_to_first_offer
seconds_to_acceptance
candidate_distance_distribution
selected_distance_distribution
```

### Safety Metrics

```text
shadow_candidate_stale_location_rate
shadow_candidate_missing_presence_rate
shadow_candidate_busy_or_unavailable_rate
shadow_dispatch_error_rate
```

### Dashboard Views

Recommended dashboard panels:

```text
Shadow run volume by hour
Redis availability and latency
Candidate count p50/p95
Selected count p50/p95
No-coordinate rate
No-candidate rate
Actual driver was in top 5 rate
Actual driver average shadow rank
Shadow run failures by reason
```

## 7. Outcome Comparison

Shadow comparison should answer:

```text
Would the future dispatch engine have included the real accepted driver?
Would the future dispatch engine have selected the real accepted driver in top N?
How far away was the accepted driver relative to shadow candidates?
Did the first driver to offer appear in the candidate set?
What was their shadow rank?
```

Comparison points:

### On first offer submission

Record:

```text
first_offer_driver_id
first_offer_was_candidate
first_offer_was_selected
first_offer_shadow_rank
seconds_to_first_offer
```

### On offer acceptance

Record:

```text
actual_driver_id
actual_offer_id
actual_driver_was_candidate
actual_driver_was_selected
actual_driver_shadow_rank
actual_driver_shadow_score
seconds_to_acceptance
```

### Periodic reconciliation

Needed because shadow recording must be non-blocking. If comparison write fails during the request path, a background reconciler can compute outcomes later from:

```text
public.rides
public.ride_offers
public.dispatch_shadow_runs
public.dispatch_shadow_candidates
```

## 8. Implementation Plan

### Workstream A: Configuration

Add:

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
DISPATCH_SHADOW_SELECTED_LIMIT=5
DISPATCH_SHADOW_RANKING_VERSION=v2.0-b-simple
```

### Workstream B: Shadow Dispatcher Package

Add package:

```text
internal/dispatch
```

Responsibilities:

```text
accept ride context
check dispatch mode
derive/validate pickup coordinates
query internal/geo nearby drivers
rank candidates
select top N
write shadow run and candidate records
log selected drivers
return without affecting V1
```

### Workstream C: Persistence Boundary

Add a small dispatch repository abstraction:

```text
CreateShadowRun
InsertShadowCandidates
MarkShadowRunCompleted
RecordFirstOfferOutcome
RecordAcceptedOfferOutcome
```

All writes must be best-effort in request paths.

If shadow DB write fails:

```text
log warning
do not fail ride creation
do not fail offer submission
do not fail offer acceptance
```

### Workstream D: Ride Creation Hook

After successful V1 ride insert and without changing the V1 response:

```text
if DISPATCH_MODE=shadow:
  launch shadow dispatch with ride context
else:
  do nothing
```

Production `ride_offer` delivery remains unchanged.

Important:

The shadow hook must not run before the V1 ride insert succeeds.

### Workstream E: Offer Submission Comparison Hook

After successful V1 offer insert:

```text
best-effort record first-offer comparison
```

Do not change:

```text
offer response status
offer response body
public.ride_offers write path
```

### Workstream F: Offer Acceptance Comparison Hook

After successful V1 offer acceptance transaction commits:

```text
best-effort record accepted-driver comparison
```

Do not change:

```text
accept transaction semantics
ride assignment semantics
ride_accepted websocket delivery
```

### Workstream G: Tests

Required tests:

```text
DISPATCH_MODE=off performs no shadow query or write
shadow mode missing coordinates records no_coordinates or skips safely
shadow mode Redis unavailable logs/records failure and V1 ride creation still returns 201
shadow mode ranks candidates deterministically
shadow mode selects configured top N
shadow write failure does not fail ride creation
offer submission comparison write failure does not fail offer submission
offer acceptance comparison write failure does not fail offer acceptance
ride_offer delivery remains unchanged
go test ./... passes
go build ./cmd/server passes
```

## 9. Rollout Plan

### Phase 1: Build and Test Locally

```text
DISPATCH_MODE=off
go test ./...
go build ./cmd/server
```

Confirm no production behavior changes.

### Phase 2: Deploy Off Mode

Deploy with:

```text
DISPATCH_MODE=off
```

Confirm:

```text
V1 ride creation unchanged
V1 ride_offer unchanged
V1 offer flow unchanged
```

### Phase 3: Enable Shadow For Internal Accounts

If account scoping is available:

```text
DISPATCH_MODE=shadow
DISPATCH_SHADOW_SCOPE=internal
```

Otherwise use a low-traffic staging environment first.

### Phase 4: Enable Shadow For Production Read-Only Observation

Enable:

```text
DISPATCH_MODE=shadow
```

Monitor:

```text
shadow run failure rate
Redis latency
no-coordinate rate
candidate count
actual driver selected rate
request latency impact
```

### Phase 5: CTO Review Before Any Active Dispatch

Do not proceed to active dispatch until:

```text
actual_driver_was_candidate_rate is acceptable
actual_driver_was_selected_rate is understood
request latency impact is negligible
Redis failure behavior is proven
support/ops can inspect shadow decisions
```

## 10. Non-Goals

V2.0-B explicitly does not implement:

```text
active dispatch
driver ranking based on reputation
driver offer narrowing
changed ride_offer audience
push notifications
pricing
wallet
fraud controls
Kafka
NATS
frontend changes
```

## Approval Criteria

V2.0-B is acceptable when:

```text
Production ride_offer delivery is byte-for-byte behaviorally unchanged.
Shadow dispatch can be disabled with config.
Redis failures do not affect V1.
Shadow DB write failures do not affect V1.
Candidate ranking is deterministic and auditable.
Metrics can compare shadow-selected drivers to actual accepted drivers.
No user-facing behavior changes occur.
```

## Final Recommendation

Approve GO V2.0-B as a shadow-only learning layer.

Recommended implementation order:

```text
1. Add dispatch config.
2. Add additive shadow tables.
3. Add internal dispatch shadow package.
4. Hook shadow run after successful ride creation.
5. Hook comparison after offer submission and acceptance.
6. Add tests proving V1 behavior is unchanged.
7. Deploy with DISPATCH_MODE=off.
8. Enable shadow only after staging validation.
```

This phase should produce marketplace intelligence without changing the marketplace yet. That is exactly the right risk profile before any active dispatch rollout.
