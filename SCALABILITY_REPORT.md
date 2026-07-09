# PickMe Scalability Report

Internal Pilot Readiness Phase. Scope is backend, WebSocket, dispatch, matching, tracking, wallet integrity, and rider-driver communication.

## Executive Summary

PickMe can support a small internal pilot if user count, geography, and operating hours are controlled. The architecture is currently database-realtime heavy and client-orchestrated. The main scaling path is to move high-volume and high-integrity operations into backend services:

- GPS ingestion and nearby lookup.
- Dispatch candidate selection.
- Offer acceptance and ride assignment.
- Wallet ledger commands.
- Communication command APIs.

Readiness scores:

| Launch Stage | Score | Scale Assumption |
| --- | ---: | --- |
| Internal Pilot | 66/100 | 100-500 active users, controlled town, live ops |
| Public Beta | 43/100 | 5,000-10,000 users, limited regions |
| National Launch | 22/100 | 100,000+ users, multi-region operations |

## Scale Model

### 1,000 Users

Likely bottlenecks:

- Supabase Realtime channel count during active rides.
- `live_locations` write frequency.
- Driver dashboard open-ride listeners.
- Support burden from ride acceptance races.

Acceptable with:

- GPS throttling.
- Limited pilot geography.
- Manual ops monitoring.
- Fast rollback plan.

### 10,000 Users

Likely bottlenecks:

- Broad Realtime publication fanout on `rides`, `offers`, and `live_locations`.
- Client-side nearby filtering over capped driver lists.
- Non-atomic offer acceptance.
- Full message reloads on every message.
- Wallet reconciliation support load.

Required before this stage:

- Atomic acceptance RPC.
- Server-side driver candidate filtering.
- WebSocket auth and targeted fanout.
- Wallet idempotency and reconciliation.
- Production observability.

### 100,000 Users

Likely bottlenecks:

- Postgres as direct GPS ingestion bus.
- Database Realtime as dispatch bus.
- Single-region or unknown-region WebSocket infrastructure.
- Lack of service boundaries between ride orchestration, location, wallet, and communication.
- Manual admin workflows.

Required before this stage:

- Dedicated dispatch service.
- Dedicated location service with geospatial cache.
- Event bus and regional sharding.
- Financial ledger service.
- SLOs, autoscaling, incident response, fraud/risk platform.

## System-by-System Findings

### Go Backend

Current:

- Not present in repo.
- Referenced only through browser WebSocket URL.

Scalability risk:

- Cannot capacity plan or certify a backend without code, deployment, or load tests.

Recommendation:

- Bring Go backend into version control or link it as a documented service dependency with API contracts and runbooks.

### WebSocket

Current:

- Singleton browser WebSocket plus Supabase Realtime.
- No visible auth handshake for Go WS.

Scalability risk:

- Reconnect storms and GPS bursts can overload a single endpoint.

Recommendation:

- Authenticated gateway, connection registry, heartbeat, backpressure, regional sharding, event bus.

### Driver Dispatch

Current:

- Pending rides broadcast through Realtime; drivers fetch recent rides and submit offers.

Scalability risk:

- Fanout grows with drivers times pending rides.

Recommendation:

- Server-side candidate selection and targeted offers.

### Ride Matching

Current:

- Rider accepts an offer through client-side multi-step updates.

Scalability risk:

- Duplicate assignment and inconsistent offer states under concurrency.

Recommendation:

- One atomic server command for acceptance.

### Realtime Tracking

Current:

- Direct client upsert to `live_locations`, Realtime subscriptions for driver/rider/admin views.

Scalability risk:

- GPS writes and Realtime fanout dominate database load.

Recommendation:

- Location gateway and geospatial cache, Postgres sampled persistence.

### Wallet Integrity

Current:

- RPC-based wallet operations with row locking in critical paths.

Scalability risk:

- Ledger spread across wallet rows, transaction rows, admin earnings, and ride state.

Recommendation:

- Append-only ledger, idempotency keys, reconciliation, currency normalization.

### Rider-Driver Communication

Current:

- Supabase messages table with Realtime; Agora call token function; WebRTC fallback.

Scalability risk:

- Full message reload per event; call state mutation directly from clients.

Recommendation:

- `send_message` command, paginated reads, server-owned call lifecycle.

## Capacity Targets

| Capability | Internal Pilot | Public Beta | National Launch |
| --- | --- | --- | --- |
| GPS ingest | Direct Postgres with throttle | Go ingest plus Postgres sampling | Regional location service and stream |
| Matching | Marketplace offers | Atomic accept + targeted offers | Dispatch optimization service |
| Realtime | Supabase-first | Hybrid Supabase + Go WS | Go WS/event bus primary |
| Wallet | SQL RPCs | RPCs plus idempotency/recon | Ledger service |
| Comms | Messages + Agora | Message RPC + Agora | Messaging/calling service with safety tooling |

## Migration Plan

### Step 1: Stabilize Internal Pilot

- Enforce pilot caps.
- Add dashboards for active rides, channels, GPS row age, wallet failures, call failures.
- Move offer acceptance into one RPC.
- Document Go WS contract.

### Step 2: Prepare Public Beta

- Add authenticated Go WebSocket.
- Move dispatch candidate selection server-side.
- Add wallet idempotency and reconciliation.
- Add message pagination and send-message RPC.
- Add load tests for 1,000 concurrent drivers.

### Step 3: Prepare National Launch

- Introduce event bus.
- Use Redis GEO/H3 for driver locations.
- Split services: ride orchestration, dispatch, location, wallet, communication, admin ops.
- Add regional routing and failover.
- Add SLOs and incident runbooks.

## Key Metrics To Track

- Ride request to first offer p95.
- Ride request to accepted p95.
- GPS update age p95 by active ride.
- Driver online count by town.
- Realtime channel count and reconnect rate.
- Wallet settlement failure rate.
- Duplicate or stale offer acceptance attempts.
- Message delivery latency.
- Call setup success rate.
- Stuck ride counts by state.

## Recommendation

Proceed with internal pilot only under strict constraints. Do not enter public beta until ride acceptance is atomic, Go WebSocket ownership is clear, and location tracking is no longer purely database-realtime dependent.
