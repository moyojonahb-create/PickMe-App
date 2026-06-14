# PickMe Go V2.0 Engineering Design Review

## Executive Summary

V2.0 introduces marketplace intelligence around the already production-ready Go Core V1 ride lifecycle. The scope is intentionally narrow:

```text
1. Redis GEO Driver Discovery
2. Smart Dispatch Engine
3. Driver Reputation System
4. Push Notification Infrastructure
```

V2.0 must preserve Go Core V1 behavior and contracts. It must not alter:

```text
ride lifecycle semantics
websocket event names or payload contracts
public.rides schema
public.ride_offers schema
```

The architectural pattern is additive. V2.0 observes V1 first, then shadows, then gradually influences dispatch behind feature flags. V1 remains the rollback path at all times.

## V2.0 Product Goal

Go Core V1 can complete a ride. V2.0 should make the marketplace smarter:

```text
find nearby eligible drivers faster
rank drivers intelligently
avoid noisy broad fanout
improve rider response time
improve driver fairness
support background/mobile push delivery
prepare for national scale without a rewrite
```

## Non-Negotiable Constraints

```text
Storage belongs to Supabase.
Decision-making belongs to Go.
```

Supabase remains responsible for PostgreSQL durability, authentication, file storage, user profiles, media uploads, reporting data, and realtime backup.

Go remains responsible for marketplace decisions: dispatch, driver ranking, business rules, notifications, fraud-adjacent throttling, realtime behavior, and future wallet logic.

## 1. Architecture Changes

### New V2.0 Components

```text
internal/geo
internal/dispatch
internal/reputation
internal/notifications
internal/redis
```

These should be introduced as internal Go packages first, not separate deployable services. PickMe should avoid premature microservices while the product is still proving dispatch behavior.

### Runtime Additions

```text
Redis client
Driver geo index writer
Dispatch candidate selector
Dispatch ranking engine
Driver reputation calculator
Notification publisher
Push provider adapter boundary
Feature flag/config layer for V2 dispatch
```

### Preserved V1 Components

```text
internal/rides
internal/drivers
internal/websocket
public.rides
public.ride_offers
canonical websocket events
Frontend F1 /api routes
```

V2.0 should wrap and augment existing handlers. It should not rewrite the ride lifecycle.

### Recommended Request Flow

V1 flow:

```text
Rider creates ride
Go inserts public.rides
Go sends ride_offer to registered driver connections
Driver submits offer
Rider accepts offer
Ride starts/completes
```

V2.0 target flow:

```text
Rider creates ride
Go inserts public.rides exactly as V1
Dispatch Engine queries Redis GEO for nearby eligible drivers
Dispatch Engine ranks drivers by distance, freshness, reputation, fairness
Go sends existing ride_offer event only to selected driver registry connections
Push Notification Service sends background fallback notifications to selected drivers
Driver submits offer through existing V1 endpoint
Rider lists/accepts offer through existing V1 endpoint
Ride lifecycle continues unchanged
```

## 2. Database Changes

V2.0 must not change:

```text
public.rides
public.ride_offers
```

V2.0 may add new support tables. These tables must not become required for V1 ride completion until V2.0 is fully proven.

### New Tables

#### `public.driver_reputation`

Purpose: store aggregated driver reputation metrics used by Go dispatch ranking.

Recommended columns:

```text
driver_id uuid primary key
rating_avg numeric(3,2)
rating_count integer
acceptance_rate numeric(5,4)
completion_rate numeric(5,4)
cancel_after_accept_rate numeric(5,4)
reliability_score numeric(5,4)
freshness_score numeric(5,4)
fraud_penalty numeric(5,4)
dispatch_score numeric(6,4)
window_start timestamptz
window_end timestamptz
updated_at timestamptz
```

Notes:

```text
This table stores derived ranking inputs.
It is not the source of truth for ride outcomes.
It can be rebuilt from ride/offer/event history.
```

#### `public.driver_dispatch_stats`

Purpose: store rolling counters for dispatch fairness and operational tuning.

Recommended columns:

```text
driver_id uuid primary key
offers_sent_7d integer
offers_accepted_7d integer
offers_rejected_7d integer
offers_timed_out_7d integer
rides_completed_7d integer
rides_cancelled_after_accept_7d integer
last_offer_at timestamptz
last_completed_ride_at timestamptz
updated_at timestamptz
```

#### `public.dispatch_attempts`

Purpose: durable audit trail for V2 dispatch waves without changing `public.rides` or `public.ride_offers`.

Recommended columns:

```text
id uuid primary key
ride_id uuid not null
driver_id uuid not null
wave integer not null
rank integer not null
dispatch_score numeric(8,4)
distance_km numeric(8,3)
eta_seconds integer
status text not null
sent_at timestamptz
expires_at timestamptz
responded_at timestamptz
created_at timestamptz
```

Suggested statuses:

```text
selected
sent
viewed
offered
rejected
timed_out
accepted
cancelled
```

#### `public.device_tokens`

Purpose: store mobile push notification targets.

Recommended columns:

```text
id uuid primary key
user_id uuid not null
role text not null
platform text not null
token text not null
app_version text
device_id text
is_active boolean not null default true
last_seen_at timestamptz
created_at timestamptz
updated_at timestamptz
```

Recommended unique constraint:

```text
unique(platform, token)
```

#### `public.notification_deliveries`

Purpose: audit push delivery attempts and deduplicate notifications.

Recommended columns:

```text
id uuid primary key
event_id text not null
user_id uuid not null
role text
channel text not null
provider text not null
template text not null
status text not null
provider_message_id text
error_code text
error_message text
attempt_count integer not null default 0
created_at timestamptz
updated_at timestamptz
```

Recommended unique constraint:

```text
unique(event_id, user_id, channel)
```

### Database Principles

```text
New V2.0 tables are additive.
No V1 table is rewritten.
No V1 route depends on V2.0 tables at launch.
Dispatch can fail open to V1 driver registry fanout.
Reputation can be rebuilt.
Notification delivery audit is durable but non-blocking.
```

## 3. Redis Schema

Redis is the hot-state layer for dispatch speed. PostgreSQL remains the durable system of record.

### Driver Location GEO Index

```text
GEO key:
drivers:geo:{city}:{vehicle_type}

member:
driver_id

value:
longitude latitude driver_id

TTL:
managed indirectly through presence/location freshness keys
```

Example logical shape:

```text
drivers:geo:harare:economy
drivers:geo:bulawayo:economy
drivers:geo:harare:premium
```

### Driver Hot Location

```text
key:
driver:{driver_id}:location

type:
hash

fields:
latitude
longitude
heading
speed
city
vehicle_type
updated_at

ttl:
30-60 seconds
```

### Driver Presence

```text
key:
driver:{driver_id}:presence

type:
hash

fields:
state
availability
ride_id
last_seen_at
websocket_instance
push_available

ttl:
30-90 seconds
```

States:

```text
online
available
offered
accepted
on_trip
offline
```

### Dispatch State

```text
key:
dispatch:{ride_id}:state

type:
hash

fields:
status
current_wave
pickup_lat
pickup_lng
vehicle_type
started_at
updated_at

ttl:
15-30 minutes
```

### Attempted Drivers

```text
key:
dispatch:{ride_id}:attempted_drivers

type:
set

members:
driver_id

ttl:
15-30 minutes
```

### Driver Cooldown

```text
key:
driver:{driver_id}:dispatch_cooldown

type:
string

value:
ride_id

ttl:
10-60 seconds
```

### Rate Limits

```text
rate:rider:{rider_id}:ride_requests
rate:driver:{driver_id}:offers
rate:driver:{driver_id}:location_updates
rate:device:{device_id}:auth_sensitive
rate:ip:{ip}:auth_sensitive
```

### Notification Deduplication

```text
notification:dedupe:{event_id}:{user_id}

type:
string

value:
sent

ttl:
24-72 hours
```

### Redis Failure Policy

Redis outage must not stop V1 rides.

Fallback behavior:

```text
driver location still writes to PostgreSQL
ride creation still works
offer submission still works
ride lifecycle still works
dispatch falls back to V1 driver registry fanout
push notification dedupe falls back to PostgreSQL unique constraint
```

## 4. Service Design

### Redis GEO Driver Discovery

Responsibilities:

```text
maintain Redis GEO indexes from driver location updates
maintain driver hot-location hashes
maintain presence/availability TTLs
query nearby candidates by pickup coordinates
remove stale candidates based on freshness
fallback to PostgreSQL nearby driver query if Redis unavailable
```

Inputs:

```text
driver location updates
driver online/offline events
ride pickup coordinates
vehicle type
city/zone
```

Outputs:

```text
rankable driver candidate list
distance estimate
location freshness
availability state
```

### Smart Dispatch Engine

Responsibilities:

```text
start dispatch after ride creation
choose search radius
query Redis GEO candidates
filter unavailable or stale drivers
rank drivers
create dispatch attempts
send ride_offer through existing websocket contract
trigger push fallback
handle wave timeout
expand radius
record dispatch outcomes
fallback to V1 if V2 dispatch fails
```

Dispatch algorithm:

```text
1. Load ride request context.
2. Determine city, vehicle type, pickup location, and rider constraints.
3. Query Redis GEO for Wave 1 radius.
4. Filter stale, busy, suspended, or cooldown drivers.
5. Score candidates.
6. Select top N drivers.
7. Record dispatch_attempts.
8. Send existing ride_offer event to selected driver registry connections.
9. Send push notification if websocket is unavailable or app is backgrounded.
10. Wait for offers or timeout.
11. Expand radius if no useful response.
12. End as matched, exhausted, or fallback.
```

V2.0 should support three dispatch modes:

```text
off       V1 behavior only
shadow    V2 computes candidates but V1 sends as before
active    V2 selected candidates receive ride_offer
fallback  V2 attempted but failed, V1 behavior used
```

### Driver Ranking

Candidate score:

```text
dispatch_score =
  0.35 * proximity_score
+ 0.15 * eta_score
+ 0.15 * freshness_score
+ 0.15 * reputation_score
+ 0.10 * acceptance_score
+ 0.05 * fairness_score
+ 0.05 * availability_score
- cancellation_penalty
- cooldown_penalty
- fraud_penalty
```

Launch defaults should be configurable. Do not hardcode business weights permanently.

### Driver Reputation System

Responsibilities:

```text
compute driver reputation from durable ride/offer history
maintain rolling dispatch stats
provide ranking inputs to Dispatch Engine
avoid over-penalizing new drivers
emit manual-review signals for risky behavior
```

Reputation update cadence:

```text
near-realtime counters for dispatch attempts and responses
periodic aggregation job for 7-day and 30-day scores
manual recalculation command for backfills
```

New driver treatment:

```text
use neutral priors
cap maximum ranking until sufficient completed rides
do not suppress new drivers unless safety/compliance requires it
```

### Push Notification Infrastructure

Responsibilities:

```text
register/update device tokens
send Android notifications through FCM
send iOS notifications through APNs or FCM
dedupe by event_id
audit delivery attempts
retry transient provider failures
deactivate invalid tokens
support rider and driver templates
```

Notification events:

```text
ride_offer.created
driver_offer.submitted
ride.accepted
ride.started
driver.location_stale
ride.completed
payment.failed
```

V2.0 push priority:

```text
ride_offer to driver: high priority
offer submitted to rider: high priority
ride lifecycle updates: normal/high depending state
receipts and wallet summaries: normal priority
marketing/promotions: out of scope
```

Push is not a replacement for websocket foreground realtime. It is a background and fallback delivery path.

## 5. Migration Plan

### Phase 0: Preparation

```text
create V2.0 support tables
configure Redis
add feature flags
add metrics/logging around current V1 dispatch
add device token registration endpoint
```

No V1 behavior changes.

### Phase 1: Redis Shadow Writes

```text
driver location updates continue writing PostgreSQL
also write Redis location/presence/GEO keys
monitor Redis freshness vs PostgreSQL state
do not use Redis for production dispatch decisions
```

Exit criteria:

```text
Redis location freshness p95 under target
stale driver rate acceptable
no driver location regression
fallback works when Redis is unavailable
```

### Phase 2: Dispatch Shadow Mode

```text
ride creation still uses V1 ride_offer behavior
Dispatch Engine computes candidate drivers in shadow
record dispatch_attempts as shadow records
compare selected candidates against actual offer/accept outcomes
```

Exit criteria:

```text
candidate quality beats or matches V1 broad fanout
no material latency regression
ranking produces fair driver distribution
no safety/compliance filter failures
```

### Phase 3: Push Notification Shadow/Audit

```text
register device tokens
prepare notification payloads
write notification delivery audit rows
do not send production pushes until templates and permissions are verified
```

Exit criteria:

```text
valid token rate known
invalid token handling verified
dedupe works
provider sandbox tests pass
```

### Phase 4: Controlled Active Dispatch

Enable V2 dispatch for:

```text
internal users
single city/zone
small percentage of rides
specific vehicle type
```

Keep fallback:

```text
if Dispatch Engine errors -> V1 fanout
if Redis unavailable -> V1 fanout
if selected drivers unavailable -> next wave or V1 fallback
```

### Phase 5: Gradual Rollout

Rollout gates:

```text
1%
5%
10%
25%
50%
100%
```

Monitor:

```text
ride request to first offer latency
offer acceptance rate
no-driver-found rate
driver complaint rate
duplicate ride_offer count
push failure rate
Redis latency
database write latency
```

### Phase 6: V2.0 Default

Make V2.0 dispatch default only when:

```text
V1 fallback has been tested in production
dispatch metrics beat V1 baseline
push delivery is stable
support team has operational visibility
rollback is documented and rehearsed
```

## 6. Implementation Plan

### Workstream A: Redis Foundation

Deliverables:

```text
Redis configuration
Redis client package
health check
GEO key conventions
presence key conventions
fallback behavior
metrics for Redis latency/errors
```

Acceptance criteria:

```text
driver location update writes PostgreSQL even if Redis fails
Redis keys expire correctly
nearby driver query excludes stale drivers
load test validates expected query latency
```

### Workstream B: Dispatch Engine

Deliverables:

```text
dispatch mode config: off/shadow/active
candidate discovery
driver filters
ranking function
wave expansion policy
dispatch attempt audit writes
V1 fallback path
dispatch metrics
```

Acceptance criteria:

```text
shadow mode changes no V1 behavior
active mode sends ride_offer only to selected drivers
duplicate ride_offer protection remains intact
dispatch failure falls back to V1
race-condition protection remains in existing offer acceptance flow
```

### Workstream C: Driver Reputation

Deliverables:

```text
driver_reputation table
driver_dispatch_stats table
aggregation job design
ranking score provider
new-driver prior model
manual recalculation workflow
```

Acceptance criteria:

```text
driver without history receives neutral score
bad cancellation pattern lowers score
high completion/reliability improves rank
scores are explainable for support/admin review
```

### Workstream D: Push Notifications

Deliverables:

```text
device_tokens table
notification_deliveries table
device token registration API
notification service package
FCM adapter
APNs/FCM iOS strategy
dedupe/idempotency
delivery audit
invalid-token cleanup
```

Acceptance criteria:

```text
push failure never blocks ride lifecycle
duplicate event_id does not send duplicate notification
invalid tokens are deactivated
ride_offer push is sent only to selected drivers
foreground websocket remains primary
```

### Workstream E: Observability And Operations

Deliverables:

```text
dispatch dashboards
Redis dashboards
push notification dashboards
driver reputation audit view
runbook for Redis outage
runbook for dispatch rollback
runbook for push provider outage
```

Acceptance criteria:

```text
operators can see active dispatch mode
operators can see no-driver-found rates
operators can identify why a driver was selected or skipped
operators can disable V2 dispatch without redeploy
```

## 7. Risk Review

### Risk: Redis Stale Drivers

Impact:

```text
rides offered to offline or unavailable drivers
```

Mitigation:

```text
short TTLs
heartbeat freshness filters
PostgreSQL fallback
driver response timeout
stale candidate metrics
```

### Risk: Dispatch Over-Optimization

Impact:

```text
same drivers receive too much demand
new drivers get starved
```

Mitigation:

```text
fairness score
idle-time boost
dispatch count penalty
driver cohort dashboards
```

### Risk: Push Notification Dependency

Impact:

```text
provider outage affects driver/rider awareness
```

Mitigation:

```text
websocket remains primary
push is non-blocking
provider retries
delivery audit
fallback messaging
```

### Risk: V2 Dispatch Regression

Impact:

```text
lower acceptance rate or higher no-driver-found rate
```

Mitigation:

```text
shadow mode
feature flags
percentage rollout
V1 fallback
city/vehicle scoped activation
```

## 8. CTO Approval Criteria

V2.0 is approved for implementation when leadership accepts:

```text
No V1 lifecycle or websocket contract changes.
No public.rides or public.ride_offers schema changes.
Redis is hot state only.
PostgreSQL remains source of truth.
Dispatch can run in off/shadow/active modes.
V1 fallback remains available.
Push notifications are non-blocking.
Driver reputation is explainable and auditable.
Rollout is staged and measurable.
```

## Final Recommendation

Approve V2.0 as an additive marketplace intelligence layer.

Recommended sequence:

```text
1. Redis GEO and presence foundation
2. Reputation support tables and aggregation model
3. Dispatch Engine in shadow mode
4. Push notification infrastructure
5. Controlled active dispatch rollout
6. V2.0 default only after metrics prove improvement
```

This gives PickMe a credible path from V1 correctness to V2 marketplace quality without destabilizing the production-ready core.
