# PickMe WebSocket Architecture Report

Internal Pilot Readiness Phase. This report focuses on WebSocket and realtime channels only.

## Executive Summary

PickMe has two realtime systems:

1. Supabase Realtime for database changes and broadcasts.
2. A referenced external Go WebSocket endpoint for driver location and ride events.

Supabase Realtime is the production-critical path in the repo. The Go WebSocket path is present as a client-side sender/listener but has no backend code, auth contract, or deployment configuration in this workspace.

Readiness scores:

| Stage | Score |
| --- | ---: |
| Internal Pilot | 62/100 |
| Public Beta | 38/100 |
| National Launch | 18/100 |

## Current Architecture

### Supabase Realtime

Used for:

- Driver tracking: `live_locations`.
- Ride status and offers: `rides`, `offers`.
- Messages: `messages`.
- Calls: `call_sessions`.
- Wallet updates: `driver_wallets`.
- Admin monitoring: `live_locations`, `rides`, `emergency_alerts`.

The code has some consolidated channel patterns, notably `useRideRealtime`, but still includes broad listeners such as all `rides`, all `offers`, and all `live_locations` in admin and driver contexts.

### Go WebSocket Client Path

Files:

- `src/lib/ws.ts`: singleton WebSocket with env URL fallback.
- `src/lib/socket.ts`: eager WebSocket connection to a hard-coded external endpoint.
- `src/lib/driverLocation.ts`: sends `driver_location` JSON after successful `live_locations` upsert.

Messages observed from client:

```json
{
  "type": "driver_location",
  "userId": "...",
  "latitude": 0,
  "longitude": 0,
  "timestamp": 0
}
```

The listener also expects events such as `driver_location`, `ride_offer`, and `ride_accepted`.

## Bottlenecks

- Supabase Realtime listens to high-churn tables, especially `live_locations`.
- Nearby drivers are filtered in browser memory after fetching up to 200 online drivers.
- WebSocket reconnect behavior is minimal; no exponential backoff, heartbeat, offline queue, or resubscribe protocol is visible.
- The Go WebSocket path does not show per-user subscriptions, auth, or authorization.
- Duplicate realtime paths can create inconsistent UI state if Supabase and Go messages differ.

## Scalability Risks

| Scale | Risk |
| --- | --- |
| 1,000 users | Supabase Realtime probably carries pilot load if location update frequency is controlled. |
| 10,000 users | GPS write and fanout pressure becomes noticeable; broad ride subscriptions create noisy updates. |
| 100,000 users | Database Realtime should not be the primary GPS bus; a dedicated location gateway and event bus are required. |

## Security Risks

- WebSocket endpoint identity is not bound to Supabase JWT in visible client code.
- Driver location messages include userId from the client and can be spoofed unless backend validates.
- Hard-coded external endpoint increases exposure and makes incident response hard.
- Broadcast channels for WebRTC signaling need strict ride/session membership checks to avoid cross-session leakage.
- Realtime relies on RLS. If a table publication or SELECT policy becomes too broad, realtime data leaks instantly.

## Recommended Uber/InDrive Architecture

### WebSocket Gateway

- Go service terminates WebSocket connections.
- JWT required during handshake.
- Connection identity stored as `{user_id, role, device_id, app_version, region}`.
- All inbound messages validated with typed schemas.
- Heartbeat every 20-30 seconds; disconnect stale sessions.
- Backpressure: drop low-value GPS updates before dropping state transitions.

### Event Routing

- `driver.location.updated` goes to location service and dispatch subscribers.
- `ride.offer.sent` targets only selected driver connections.
- `ride.assigned` targets rider and assigned driver only.
- `message.created` targets ride participants.
- `wallet.updated` is never broadcast broadly; only user-specific updates.

### Infrastructure

- WebSocket pods behind sticky load balancer or connection-aware gateway.
- Redis/NATS/Kafka for cross-node fanout.
- Per-region shards by city/town.
- Replayable event IDs for critical state changes.
- Metrics: connection count, message rate, dropped messages, reconnects, p95 delivery latency.

## Migration Plan

### Phase 1: Internal Pilot

1. Remove hard-coded fallback WebSocket URL from production builds.
2. Document message schema and allowed events.
3. Add client-side heartbeat and reconnect backoff.
4. Keep Supabase as source of truth; treat Go WebSocket as best-effort acceleration.
5. Track metrics manually: active channels, GPS write rate, ride update latency.

### Phase 2: Public Beta

1. Add authenticated Go WebSocket handshake.
2. Add per-user and per-ride subscription authorization.
3. Move driver GPS ingestion to Go, with Postgres as sampled persistence.
4. Target ride offers to selected drivers instead of broadcasting all pending rides.
5. Add server-side message validation and schema versioning.

### Phase 3: National Launch

1. Add regional WebSocket clusters.
2. Add event bus for cross-node dispatch.
3. Move dispatch fanout from database Realtime to backend targeted delivery.
4. Keep Supabase Realtime for low-volume admin and user-specific database updates only.
5. Add chaos testing for reconnect storms and regional failover.

## Go Backend Gap

No Go backend code is present in this workspace. Before public beta, PickMe needs a backend repository or checked-in service directory containing:

- `go.mod`.
- WebSocket server.
- Auth middleware.
- Protocol schemas.
- Integration tests.
- Deployment config.
- Load-test scripts.
- Runbook.

Until then, the WebSocket backend should be considered an external black box, not a production-certified PickMe subsystem.
