# PickMe Backend Architecture Report

Internal Pilot Readiness Phase. This report does not re-audit old launch blockers. It reviews the backend, dispatch, matching, tracking, wallet, and communication architecture visible in this workspace.

## Executive Summary

PickMe is currently Supabase-first: PostgreSQL, RLS, RPCs, Edge Functions, and Supabase Realtime are the primary backend. The React/Capacitor client directly performs many workflow transitions. A Go WebSocket backend is referenced by the client, but no Go source, `go.mod`, deployment manifest, protocol contract, authentication middleware, or load model is present in this repository.

This is acceptable for a controlled internal pilot if the pilot is small, staffed, and observed. It is not a public beta or national-launch backend shape yet. The main architectural gap is that ride state, matching, offer acceptance, dispatch, and some communications are not governed by a single server-side ride orchestration service.

Readiness scores:

| Stage | Score | Rationale |
| --- | ---: | --- |
| Internal Pilot | 68/100 | Core flows exist, recent blocker fixes improved payment and realtime basics, but operations must be watched closely. |
| Public Beta | 45/100 | Client-driven dispatch/matching and unversioned Go WebSocket dependency create correctness and support risk. |
| National Launch | 24/100 | Needs server-side dispatch, geospatial indexing, event bus, ledger hardening, observability, and backend ownership boundaries. |

## 1. Go Backend Architecture

### Current Architecture

No Go backend code is checked into this workspace. The client references an external WebSocket endpoint:

- `src/lib/ws.ts`: `VITE_WS_URL` or fallback `wss://swell-pouch-delegator.ngrok-free.dev/ws`.
- `src/lib/socket.ts`: hard-coded connection to the same external URL.
- `src/lib/driverLocation.ts`: sends `driver_location` messages to the Go WebSocket backend after writing to `live_locations`.

The authoritative system of record remains Supabase/Postgres. The Go backend appears to be an auxiliary realtime fanout path, not the source of truth.

### Bottlenecks

- No repo-visible protocol schema, versioning, auth handshake, message validation, retry behavior, or deployment topology.
- Client writes driver GPS to Postgres and then optionally sends WebSocket, creating dual-write drift.
- Hard-coded ngrok fallback is not production infrastructure.
- No visible backpressure model for GPS bursts or ride event storms.

### Scalability Risks

- 1,000 users: Works only if WebSocket traffic is non-critical and Supabase remains source of truth.
- 10,000 users: A single external WS endpoint becomes a capacity, reliability, and incident-response blind spot.
- 100,000 users: Without sharded connection ownership, regional routing, pub/sub, and replayable events, real-time dispatch cannot be guaranteed.

### Security Risks

- No visible JWT validation or user identity binding on the Go WebSocket channel.
- Client can send arbitrary JSON fields unless the Go backend validates them.
- If Go consumes driver location messages as trusted truth, spoofed GPS is possible.
- The fallback URL discloses operational infrastructure and could be targeted directly.

### Recommended Uber/InDrive Architecture

Use Go as a first-class real-time control plane:

- Authenticated WebSocket gateway: JWT verification, driver/rider role binding, ride membership checks.
- Internal event bus: NATS, Kafka, Redis Streams, or Supabase queue equivalent for `driver.location.updated`, `ride.requested`, `offer.created`, `ride.assigned`, `trip.completed`.
- Dispatch service: server-side matching, offer fanout, acceptance locking, expiry, and retry.
- Location service: ingest GPS, validate, dedupe, store latest location in Redis/geospatial index, persist sampled trail to Postgres.
- Wallet/ledger service boundary: Postgres RPCs can remain initially, but all wallet-changing commands should be called by controlled backend paths.
- Observability: per-message metrics, connection counts, dropped messages, dispatch latency, GPS age, offer latency, settlement latency.

### Migration Plan

1. Document the current Go WebSocket protocol in `docs/ws-protocol.md`.
2. Remove hard-coded ngrok fallback and require `VITE_WS_URL` for non-dev builds.
3. Add JWT auth and identity-bound subscriptions to the Go gateway.
4. Route only non-authoritative fanout through Go at first; keep Postgres as source of truth.
5. Move dispatch and offer acceptance into a single server-side command API.
6. Introduce Redis or equivalent for latest driver state and geospatial lookup.
7. Move high-volume GPS writes off direct client-to-Postgres writes; persist sampled/location snapshots asynchronously.

## 2. Driver Dispatch Architecture

### Current Architecture

Dispatch is mostly database and client driven:

- Riders create rides through `request_cash_ride` or `request_wallet_ride`.
- Drivers receive open rides through Realtime listeners on `rides`.
- `fetchOpenRides` reads pending rides from the last five minutes and limits to 30.
- `dispatch-scheduled` Edge Function calls `dispatch_scheduled_rides` and `expire_old_rides`.
- `driver_queue` exists in migrations, but active driver dispatch appears centered on open ride broadcast and driver offers.

### Bottlenecks

- Every driver can subscribe to broad ride changes.
- Matching radius is not enforced server-side in the main open ride query.
- Offer lifecycle and ride assignment are not centrally serialized.
- Scheduled dispatch is separate from real-time dispatch.

### Scalability Risks

- 1,000 users: Broad Realtime can work if driver count is modest.
- 10,000 users: Open ride broadcasts and client-side filtering produce unnecessary fanout.
- 100,000 users: The system needs regional dispatch partitions and server-side candidate selection.

### Security Risks

- Driver visibility of pending rides depends on RLS and publication filtering. Any unsafe publication or broad policy leaks rider pickup/dropoff information.
- Client-side acceptance creates race conditions and inconsistent offer states.
- Driver eligibility checks must be enforced server-side for every offer and acceptance, not only in UI.

### Recommended Architecture

Use a dispatch service with one command path:

- `POST /rides/request` creates ride and dispatch job.
- Dispatch service selects candidate drivers by geo cell, vehicle type, status, wallet eligibility, driver score, gender preference, fatigue/safety constraints.
- Offer fanout is targeted to selected drivers only.
- Acceptance is a single atomic transaction: lock ride, verify offer, assign driver, reject competing offers, publish event.
- Expiry and no-show flows run from scheduled jobs against authoritative state.

### Migration Plan

1. Add `accept_ride_offer(ride_id, offer_id)` RPC or backend command to replace client-side parallel updates.
2. Add server-side candidate selection around `live_locations` with town/radius/vehicle filters.
3. Narrow Realtime subscriptions from all pending rides to targeted `ride_offers` or `driver_queue` rows.
4. Move dispatch retries and expirations into one scheduled worker.
5. Add dispatch metrics: candidate count, offer send latency, acceptance latency, timeout rate, cancellation before pickup.

## 3. Ride Matching Architecture

### Current Architecture

PickMe currently looks closer to an inDrive-style marketplace than pure Uber auto-dispatch:

- Rider creates a `rides` row.
- Drivers view open rides and submit `offers`.
- Riders accept an offer via `acceptOffer`.
- `acceptOffer` fetches offer, fetches driver, updates accepted offer, updates ride, and rejects other offers from the client.

### Bottlenecks

- Accepting an offer is not atomic.
- No visible unique partial index prevents two accepted offers for one ride.
- No server-side check shown in the acceptance path for ride status, offer status, driver online state, or driver wallet eligibility.
- Driver ETA and bid price are client-submitted.

### Scalability Risks

- 1,000 users: Race conditions are rare but possible.
- 10,000 users: Duplicate acceptance and stale offers become support incidents.
- 100,000 users: Marketplace matching requires server-side state machines and robust concurrency controls.

### Security Risks

- Client can attempt to update offer status or ride assignment if policies allow it.
- Driver can submit arbitrary ETA/price without server validation unless RLS/triggers enforce bounds.
- Rider offer acceptance can be replayed unless acceptance is idempotent.

### Recommended Architecture

- Model ride matching as a state machine: `requested`, `broadcasting`, `offered`, `accepted`, `driver_enroute`, `arrived`, `in_progress`, `completed`, `cancelled`, `expired`.
- Store offer eligibility and offer expiry.
- Use one server-side acceptance function with `SELECT ... FOR UPDATE`.
- Add invariant constraints: one active driver per ride, one accepted offer per ride, offer must belong to ride, ride must be pending, driver must be eligible.
- Publish match result events to both rider and driver.

### Migration Plan

1. Create atomic `accept_offer` RPC.
2. Add database constraints and partial indexes for accepted offer uniqueness.
3. Replace client-side offer acceptance with the RPC.
4. Add server-side offer TTL and stale-offer rejection.
5. Move ETA calculation to server-side route service or signed driver app estimate.

## 4. Realtime Driver Tracking Architecture

### Current Architecture

- Drivers call `updateDriverLocation`, which upserts into `live_locations`.
- The same function also sends a `driver_location` message to the external Go WebSocket endpoint if connected.
- Riders use `useDriverTracking` to subscribe to one driver's `live_locations` row.
- Nearby driver display uses `useNearbyDrivers`, initially loading up to 200 online drivers, then filtering in memory by Haversine distance.
- Admin maps subscribe broadly to `live_locations`.

### Bottlenecks

- High-frequency GPS writes hit Postgres directly.
- Nearby driver filtering is client-side and limited to 200 rows.
- No spatial index or PostGIS-based candidate query is evident.
- Go WebSocket and Supabase Realtime can diverge.
- Admin dashboards can amplify load with broad subscriptions and refreshes.

### Scalability Risks

- 1,000 users: Direct Postgres upserts are probably acceptable with throttling.
- 10,000 users: GPS write volume and Realtime fanout become primary pressure points.
- 100,000 users: Direct location updates to Postgres/Realtime will not hold; needs location ingestion tier.

### Security Risks

- Driver location spoofing is possible from client-side location writes.
- Rider nearby driver visibility must avoid exposing precise locations for drivers not assigned to that rider.
- Admin location views need strict role checks because Realtime respects SELECT permissions.

### Recommended Architecture

- Location Gateway in Go: authenticated, rate-limited, validates driver state.
- Redis GEO or H3 grid for latest online driver positions.
- Postgres stores sampled location history and latest durable snapshot, not every ping.
- Realtime to riders only after a ride is accepted, filtered to the assigned driver.
- Dispatch uses geospatial index, not browser-side filtering.

### Migration Plan

1. Reduce browser GPS send rate by movement and time windows.
2. Add server-side location ingest endpoint and keep direct Postgres write as fallback during pilot.
3. Add geospatial candidate lookup service.
4. Store location age/accuracy/heading/speed and reject impossible jumps.
5. Remove broad driver location subscriptions from non-admin user paths.

## 5. Wallet Transaction Integrity

### Current Architecture

Wallet critical flows are mostly server-side Postgres RPCs:

- `request_wallet_ride` checks wallet balance and creates a wallet ride.
- `request_cash_ride` now recalculates cash fare server-side.
- `pay_ride_from_wallet` locks ride and wallet rows and writes wallet transactions.
- `complete_trip_with_commission` handles wallet auto-payment, driver credit, cash commission deduction, admin earnings, and trip completion.
- `transfer_funds` checks locks, duplicate transfers, and daily limit.
- `admin_topup_driver` exists in the previous launch-blocker migration.

### Bottlenecks

- Wallet ledger logic is distributed across several evolving migrations.
- `request_wallet_ride` validates balance but does not reserve/hold funds at request time.
- Driver wallet, rider wallet, admin earnings, ride status, and fraud flags share one transaction path but lack a formal double-entry ledger abstraction.
- Currency handling is mixed: USD/ZAR fields and town pricing create reconciliation complexity.

### Scalability Risks

- 1,000 users: RPC-based wallet operations are acceptable.
- 10,000 users: Reconciliation and idempotency become more important than raw throughput.
- 100,000 users: Need append-only ledger, settlement workers, idempotency keys, and financial audit pipelines.

### Security Risks

- SECURITY DEFINER functions in `public` increase blast radius if grants drift.
- Without idempotency keys, retries can create duplicate operational attempts even when some duplicate checks exist.
- Wallet transfer limits live in SQL but should also feed risk scoring.
- Cash commission depends on driver wallet balance at trip completion; operational disputes can strand trips.

### Recommended Architecture

- Wallet service with append-only ledger entries: debit, credit, hold, release, capture, reversal.
- Every wallet command has an idempotency key.
- Balances are derived or validated against ledger snapshots.
- Payment settlement is asynchronous but stateful: `authorized`, `captured`, `failed`, `reversed`.
- Separate financial ledger from user-visible wallet tables.
- Automated reconciliation job compares balances, transactions, admin earnings, and ride payment state.

### Migration Plan

1. Add idempotency keys to wallet RPCs and client commands.
2. Introduce ledger transaction groups for multi-row wallet changes.
3. Add wallet hold/reservation for wallet rides.
4. Standardize currency fields and exchange-rate source.
5. Build daily reconciliation report before public beta.

## 6. Rider-Driver Communication Flow

### Current Architecture

- Chat messages are stored in `messages` and synchronized through Supabase Realtime.
- `RideCommunication` loads all messages for a ride and inserts new messages directly.
- Voice flow has two paths:
  - Native phone call button using phone number.
  - App call flow through `call_sessions`, Supabase Realtime, and Agora token Edge Function.
- A WebRTC fallback/hook exists using Supabase broadcast channels and public STUN servers.

### Bottlenecks

- Chat loads all messages for a ride; no pagination in the component.
- Realtime callbacks reload the full message list.
- Call signaling and call state are split across database changes, broadcast channels, and Agora.
- WebRTC fallback lacks TURN credentials, so NAT traversal will be unreliable at scale.

### Scalability Risks

- 1,000 users: Chat and Agora are acceptable.
- 10,000 users: Full reload per message and broad call session update subscriptions start hurting latency.
- 100,000 users: Communication needs dedicated call/message state services, push notification fallback, and retention policies.

### Security Risks

- Phone number exposure enables off-platform contact unless masked calling is used.
- Message content has no visible moderation, abuse detection, or retention enforcement from the app path.
- Call session updates allow participants to mutate call state; this is okay for pilot but should become command-based.

### Recommended Architecture

- Chat service or RPC for `send_message`, validating ride participant and status.
- Paginated message reads and incremental append on Realtime.
- Masked calling or in-app voice only for public beta.
- Agora token service remains, but call session lifecycle should be server-command based.
- Add abuse reporting, message retention, and PII minimization.

### Migration Plan

1. Add `send_ride_message` RPC and stop direct message inserts.
2. Add paginated message query and incremental UI append.
3. Move call start/answer/end into RPCs or Edge Functions.
4. Use Agora as primary in-app calling; keep WebRTC fallback only with TURN.
5. Add communication audit events for safety review.

## Pilot Recommendation

Proceed to internal pilot only with guardrails:

- Limit active drivers and riders by geography.
- Staff live ops during every pilot window.
- Keep database and Realtime dashboards open.
- Log dispatch latency, GPS age, offer acceptance races, wallet settlement failures, call failures, and stuck rides.
- Do not market public availability until matching and acceptance are server-side atomic.
