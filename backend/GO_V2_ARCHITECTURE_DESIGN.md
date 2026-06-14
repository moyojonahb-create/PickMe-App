# PickMe Go V2 Architecture Design

## Executive Summary

PickMe Go Core V1 is production-ready for the current rider-driver lifecycle. V2 should evolve the platform from a single-instance realtime backend into a national-scale transportation marketplace without violating the core architectural principle:

```text
Storage belongs to Supabase.
Decision-making belongs to Go.
```

Supabase remains the system of record for authentication, PostgreSQL data, media, profiles, reporting data, and backup realtime. Go owns marketplace intelligence: dispatch, matching, pricing, wallet settlement, fraud controls, realtime delivery, notifications, and business rules.

The recommended V2 architecture is a modular Go service platform, beginning as a well-bounded modular monolith and evolving into independently deployable services only where scale or ownership demands it. The first major technical inflection points are Redis for driver geo/presence, NATS for operational event fanout, and a dedicated realtime gateway for horizontal websocket scaling.

## 1. Service Architecture

### Recommended V2 Services

```text
API Gateway / Edge API
Auth Adapter
Ride Service
Dispatch Service
Driver Service
Realtime Gateway
Offer Service
Pricing Service
Wallet Service
Payment Integration Service
Notification Service
Analytics/Event Service
Fraud and Risk Service
Admin/Ops Service
```

### Service Responsibilities

**API Gateway / Edge API**

Receives mobile and frontend traffic, validates Supabase JWTs, applies rate limits, request IDs, CORS, version negotiation, and routes requests to internal services. This can initially live inside the Go backend but should be architecturally separated.

**Ride Service**

Owns ride lifecycle state: requested, offered, accepted, ongoing, completed, cancelled, expired. It enforces legal ride transitions and persists authoritative ride state to `public.rides`.

**Dispatch Service**

Owns marketplace decisions: eligible driver discovery, ranking, batching, dispatch windows, timeouts, fallback expansion, fairness rules, and driver assignment recommendations. It reads live state from Redis and writes durable outcomes through Ride/Offer flows.

**Driver Service**

Owns driver online/offline presence, heartbeat freshness, location ingestion, availability, vehicle type, and driver operational state. It writes durable session/location snapshots to PostgreSQL and hot state to Redis.

**Offer Service**

Owns driver offers, offer TTL, accept/reject/expire state, idempotency, and offer race protection. It persists canonical offer state to `public.ride_offers`.

**Realtime Gateway**

Owns websocket connections, room membership, rider/driver registries, fanout, event delivery metrics, and protocol versioning. It should consume internal events and deliver to connected clients independent of which API instance produced the event.

**Pricing Service**

Owns fare estimates, surge/multiplier logic, minimum fare, service fees, promotions, driver payout estimates, and city/zone pricing rules.

**Wallet Service**

Owns ledger-derived balances, rider wallet, driver wallet, platform wallet, settlement rules, commissions, refunds, and reconciliation.

**Payment Integration Service**

Integrates with EcoCash, Innbucks, Visa, Mastercard, and PayPal. It isolates provider-specific callbacks, retries, reconciliation files, and failure semantics from core ride logic.

**Notification Service**

Owns Android/iOS push notifications, SMS fallback if added later, notification templates, delivery priority, provider failures, and retry policy.

**Analytics/Event Service**

Consumes business events and produces operational dashboards, revenue reports, marketplace health metrics, and analytical projections.

**Fraud and Risk Service**

Scores suspicious ride requests, fake GPS signals, repeated cancellations, payment anomalies, driver collusion, rider abuse, and account/device risk.

**Admin/Ops Service**

Provides internal tools for support teams: stuck ride inspection, websocket diagnostics, driver/rider lookup, refunds, ride correction workflows, and incident response.

### Service Boundaries

Go services should communicate through explicit internal APIs and events. Direct database access should be limited by ownership:

```text
Ride Service       owns ride lifecycle writes
Offer Service      owns offer lifecycle writes
Driver Service     owns driver session/location writes
Wallet Service     owns wallet ledger writes
Analytics Service  reads event stream/reporting replicas
```

Supabase PostgreSQL remains the durable data store, but Go must be the only place where marketplace decisions are made.

### Inter-Service Communication

Recommended communication model:

```text
synchronous HTTP/gRPC: user-facing commands requiring immediate result
NATS events: realtime operational events and cross-service fanout
PostgreSQL: durable source of truth
Redis: hot ephemeral state, geo indexes, rate limits, short TTL locks
```

Examples:

```text
Rider requests ride -> Ride Service writes ride -> Dispatch Service starts search
Dispatch selects drivers -> Realtime Gateway sends ride_offer
Driver submits offer -> Offer Service persists -> Realtime Gateway notifies rider
Rider accepts offer -> Offer Service transaction -> Ride Service assigns driver -> lifecycle events emitted
Ride completed -> Ride Service completes -> Wallet Service settles -> Analytics records revenue event
```

## 2. Smart Matching Engine

### Dispatch Model Recommendation

PickMe should use a hybrid model:

```text
Uber-style ranked dispatch for normal ride allocation
inDrive-style driver offer marketplace where rider choice matters
```

This fits PickMe’s current V1 offer-based model while allowing future automation. The platform should not blindly broadcast rides to every online driver. It should identify a ranked candidate set, dispatch in controlled waves, collect offers or acceptances, and preserve rider choice.

### Nearby Driver Discovery

Use Redis GEO as the hot path:

```text
GEOADD drivers:{city}:{vehicle_type} longitude latitude driver_id
GEORADIUS/GEOSEARCH pickup_location radius
```

PostgreSQL remains durable storage for driver session history, but Redis drives dispatch-time discovery because marketplace matching is latency-sensitive.

Candidate filters:

```text
online=true
last_seen within 10-20 seconds for hot dispatch
vehicle_type matches rider request
not currently assigned to active ride
not blocked/suspended
within active service zone
driver app websocket or push route reachable
```

### Driver Ranking

Initial ranking formula:

```text
score =
  distance_weight
+ ETA_weight
+ freshness_weight
+ reputation_weight
+ acceptance_weight
+ completion_weight
+ fairness_weight
- cancellation_penalty
- overload_penalty
```

Suggested normalized weights for launch:

```text
distance/ETA:        40%
location freshness:  15%
acceptance rate:     15%
completion rate:     15%
rating/reputation:   10%
fairness balancing:   5%
```

This should be configuration-driven per city.

### Search Radius Expansion

Use staged expansion:

```text
Wave 1: 0-2 km, top 3-5 drivers, 8-12 seconds
Wave 2: 0-5 km, next 5-10 drivers, 10-15 seconds
Wave 3: 0-10 km, broader set, 15-20 seconds
Fallback: rider sees no-driver state or can widen service type/fare
```

The system must avoid repeatedly spamming the same drivers. Track per-ride dispatch attempts and per-driver cooldowns in Redis.

### Timeout Handling

Each dispatch wave should have:

```text
offer_sent_at
expires_at
driver_response_state
timeout_reason
next_wave_trigger
```

Timeouts should emit events:

```text
dispatch.wave_started
dispatch.offer_sent
dispatch.offer_timeout
dispatch.wave_exhausted
dispatch.no_driver_found
```

### Acceptance Strategy

For PickMe, the best model is:

```text
Phase V2.1: rider chooses among driver offers
Phase V2.2: optional auto-accept best offer based on rider preference
Phase V2.3: managed marketplace with pricing and availability optimization
```

This keeps the current product DNA close to inDrive while allowing Uber-like dispatch efficiency later.

### Marketplace Fairness

Fairness rules should prevent the same top drivers from receiving all demand:

```text
recent dispatch count penalty
idle-time boost
low-earning-period boost
zone balancing
driver quality floor
anti-collusion checks
```

Fairness must never override safety, eligibility, or strong rider experience constraints.

## 3. Driver Reputation System

### Reputation Inputs

Driver reputation should be computed from:

```text
average rider rating
completed rides
acceptance rate
completion rate
cancel-after-accept rate
location freshness
arrival reliability
support incidents
fraud/risk flags
document/compliance state
```

### Core Metrics

```text
rating_score = Bayesian adjusted rating, not raw average
acceptance_rate = accepted_dispatches / offered_dispatches over rolling window
completion_rate = completed_accepted_rides / accepted_rides over rolling window
cancellation_penalty = weighted penalty for driver-caused cancellations
freshness_score = recent valid GPS heartbeat quality
reliability_score = arrival + completion + low support incident score
```

### Reputation Formula

Recommended launch formula:

```text
driver_reputation =
  0.30 * rating_score
+ 0.25 * completion_rate_score
+ 0.20 * acceptance_rate_score
+ 0.15 * reliability_score
+ 0.10 * freshness_score
- cancellation_penalty
- fraud_penalty
```

Use rolling windows:

```text
last 7 days: operational responsiveness
last 30 days: ranking and dispatch
lifetime: trust and compliance context
```

### Impact On Dispatch

Reputation should affect:

```text
candidate ranking
eligibility for high-value rides
dispatch wave priority
driver incentives
temporary throttling after poor behavior
manual review triggers
```

It should not permanently punish new drivers. Use Bayesian priors and confidence thresholds so new drivers can earn opportunity while unreliable drivers are controlled.

## 4. Wallet Architecture

### Wallet Types

```text
Rider wallet: prepaid balance, refunds, promotions, payment source abstraction
Driver wallet: earnings, bonuses, cash balance owed, withdrawals
Platform wallet: commissions, fees, promotions, clearing, provider settlement
```

### Ledger Recommendation

Balances must be ledger-derived.

Do not treat a mutable `balance` column as the source of truth. Store immutable ledger entries and optionally maintain cached balances for performance.

Reason:

```text
auditability
financial correctness
reconciliation
fraud investigation
refund/reversal support
provider settlement matching
regulatory readiness
```

Recommended model:

```text
wallet_accounts
wallet_ledger_entries
payment_transactions
provider_events
settlements
withdrawals
```

Each ledger entry should be immutable and double-entry:

```text
debit account
credit account
amount
currency
reason
ride_id/payment_id reference
idempotency_key
created_at
```

### Payment Providers

Support providers through a Payment Integration Service:

```text
EcoCash
Innbucks
Visa
Mastercard
PayPal
```

Provider integrations should normalize:

```text
authorization
capture
refund
reversal
callback/webhook
failure reason
provider reference
reconciliation status
```

### Cash Ride Handling

Cash creates a special accounting path:

```text
rider pays driver directly
driver owes platform commission
driver wallet records payable-to-platform
platform can collect through wallet top-up or withdrawal offset
```

This must be separate from card/mobile-money captured payments.

## 5. Redis Strategy

Redis should be introduced as an operational hot-state layer, not as the source of truth.

### Recommended Uses

**Driver Location Caching**

```text
driver:{id}:location -> latest lat/lng/heading/speed, TTL 30-60 seconds
drivers:{city}:{vehicle_type} -> Redis GEO index
```

**Presence and Session Freshness**

```text
driver:{id}:presence -> online/available/busy, TTL heartbeat-based
rider:{id}:session -> active websocket instance/session metadata
```

**Dispatch Performance**

```text
ride:{id}:dispatch_state
ride:{id}:attempted_drivers
driver:{id}:dispatch_cooldown
```

**Rate Limiting**

```text
rate:rider:{id}:ride_requests
rate:driver:{id}:offers
rate:driver:{id}:location_updates
rate:ip:{ip}:auth_sensitive
```

**Short TTL Locks**

```text
dispatch_lock:{ride_id}
wallet_idempotency:{key}
notification_dedupe:{event_id}
```

### What Redis Must Not Own

Redis must not be the durable source of truth for:

```text
ride state
accepted offers
wallet balances
payments
driver identity/compliance
audit logs
```

All durable state remains in PostgreSQL through Go-owned service rules.

## 6. Kafka vs NATS vs Redis Pub/Sub

### Redis Pub/Sub

Advantages:

```text
simple
already useful if Redis is adopted
low operational overhead
fast local fanout
```

Disadvantages:

```text
no durable event retention
weak replay story
limited observability
not ideal as a long-term event backbone
```

Best use:

```text
small-scale websocket fanout and local operational notifications
```

### NATS

Advantages:

```text
excellent low-latency messaging
simple operational model compared with Kafka
supports request/reply and pub/sub
JetStream supports persistence and replay
good fit for realtime dispatch events
```

Disadvantages:

```text
less familiar to analytics teams than Kafka
requires event design discipline
JetStream operations still need expertise
```

Best use:

```text
core Go service event bus, realtime fanout, dispatch events, lifecycle events
```

### Kafka

Advantages:

```text
durable high-throughput event log
strong replay and stream processing
excellent analytics ecosystem
well suited for long-term marketplace data
```

Disadvantages:

```text
higher operational complexity
more infrastructure cost
slower to operate well for a small team
overkill for early V2 realtime dispatch
```

Best use:

```text
large-scale analytics pipeline, long-retention event history, data platform
```

### Recommendation

```text
1,000-10,000 users: Redis + PostgreSQL, optional Redis Pub/Sub for simple fanout
10,000-50,000 users: adopt NATS for operational events and websocket fanout
50,000-100,000+ users: add Kafka only when analytics/event-retention needs justify it
```

For PickMe V2, choose NATS before Kafka. It gives the best balance of latency, operational simplicity, and service decoupling for a Go realtime marketplace.

## 7. Analytics Architecture

### Event Tracking Strategy

Every major marketplace action should emit a structured business event:

```text
ride.requested
dispatch.started
dispatch.offer_sent
dispatch.offer_viewed
driver.offer_submitted
rider.offer_accepted
ride.accepted
ride.started
driver.location_updated
ride.completed
ride.cancelled
payment.authorized
payment.captured
wallet.entry_created
notification.sent
notification.failed
```

Events should include:

```text
event_id
event_name
occurred_at
producer
ride_id
rider_id
driver_id
city/zone
correlation_id
schema_version
payload
```

### Reporting Architecture

Recommended flow:

```text
Go services emit events
NATS handles operational event distribution
PostgreSQL stores authoritative state
Analytics consumer writes reporting tables
Supabase/Postgres views power dashboards at early scale
Kafka/data warehouse added at national analytics scale
```

### Operational Dashboards

Required dashboards:

```text
active rides by state
ride request rate
offer response latency
driver supply by zone
rider demand heatmap
acceptance rate
completion rate
cancel rate
average ETA
websocket connection count
event delivery failure rate
payment success/failure rate
driver earnings
platform revenue
```

Marketplace dashboards:

```text
supply-demand imbalance
search radius expansion frequency
no-driver-found rate
dispatch wave conversion
driver idle time
zone-level pricing pressure
```

## 8. Push Notification Architecture

### Channels

```text
Android: FCM
iOS: APNs directly or through FCM
Driver notifications: ride offers, accepted ride, cancellation, wallet updates
Rider notifications: offers received, driver assigned, driver arrived, trip status, receipts
```

### Notification Service Responsibilities

```text
device token registry
template management
priority routing
deduplication by event_id
retry policy
provider error normalization
delivery audit
fallback strategy
```

### Integration With Go Services

Notification Service consumes events:

```text
ride_offer.created -> push driver if websocket unavailable or app backgrounded
driver_offer.submitted -> push rider
ride.accepted -> push both parties
ride.started -> push rider
ride.completed -> push rider receipt and driver earnings summary
payment.failed -> push rider action required
```

Websocket remains primary for foreground realtime. Push notification is the reliable mobile background path.

## 9. Scaling Strategy

### 1,000 Users

Architecture:

```text
single Go backend
Supabase PostgreSQL
native Go websockets
process-local registries
basic monitoring
```

Focus:

```text
correctness
auth
ride lifecycle
frontend compatibility
manual operational support
```

### 10,000 Users

Add:

```text
Redis for driver geo/presence/rate limits
structured logs
metrics
Sentry/error tracking
background offer expiration
sticky sessions if multiple backend instances are used
```

Database:

```text
indexes for active rides, driver sessions, ride offers
connection pool tuning
read query review
```

### 50,000 Users

Add:

```text
NATS operational event bus
Realtime Gateway service
horizontal API scaling
externalized websocket registries
dispatch service separated from ride handlers
notification service
wallet ledger
```

Database:

```text
partition or archive high-volume event/history tables
separate reporting tables
slow query monitoring
```

### 100,000+ Users

Add:

```text
multi-zone deployment
dedicated data/analytics pipeline
Kafka or warehouse event ingestion if needed
regional dispatch partitioning
advanced fraud/risk service
automated incident runbooks
load testing and chaos testing
```

Realtime:

```text
dedicated websocket gateway pool
NATS-backed fanout
connection draining on deploy
delivery metrics and alerting
```

## 10. Migration Strategy From Go Core V1 To Go V2

### Migration Principles

```text
zero downtime
backward compatibility
no disruption to active rides
no breaking changes to Frontend F1
feature flags for V2 behavior
dual-read or shadow-read before cutover
event emission added before event dependency
```

### Phase 1: Observability And Protocol Stability

Add:

```text
request IDs
structured logs
event IDs
event schema versions
metrics
error tracking
documented websocket protocol version
```

No product behavior changes.

### Phase 2: Redis Hot State

Add Redis behind existing Driver Service behavior:

```text
write driver location to PostgreSQL as today
also write hot driver location to Redis
compare Redis candidate discovery against existing behavior in shadow mode
```

Do not route production dispatch from Redis until accuracy is proven.

### Phase 3: Dispatch Service In Shadow Mode

Run V2 dispatch scoring in parallel:

```text
V1 still sends existing ride_offer flow
V2 computes ranked drivers but does not affect outcome
compare V2 candidates to real accepted drivers
measure ETA, acceptance, completion, fairness
```

### Phase 4: Controlled Dispatch Rollout

Enable V2 dispatch for:

```text
internal test accounts
single zone
small percentage of rides
specific vehicle type
```

Keep V1 fallback available.

### Phase 5: Realtime Gateway

Introduce dedicated websocket gateway:

```text
keep V1 event names
support same access_token auth
support same ride room names
bridge events from API services through NATS
maintain old websocket endpoint until clients migrate
```

### Phase 6: Wallet And Payments

Introduce wallet behind completed rides:

```text
record ledger entries in shadow/reconciliation mode first
do not block ride completion on wallet until proven
enable provider payments per payment method and city
```

### Phase 7: Full V2 Cutover

Cut over only after:

```text
V1 and V2 event parity verified
dispatch success rate improves or matches V1
no-driver-found rate does not regress
payment reconciliation passes
support team has admin tools
rollback runbook is tested
```

## Final Recommendation

PickMe should not jump directly from V1 to a large microservice fleet. The right path is:

```text
1. Keep Go as the decision-making layer.
2. Add Redis for hot marketplace state.
3. Add NATS for operational event fanout.
4. Split realtime delivery into a gateway.
5. Introduce dispatch intelligence gradually.
6. Build wallet as ledger-first from day one.
7. Add Kafka only when analytics scale requires it.
```

This architecture preserves the proven V1 product surface while creating a clean path to national scale.
