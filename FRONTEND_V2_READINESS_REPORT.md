# PickMe Frontend V2 Readiness Report

Date: 2026-06-01

Scope: readiness assessment only. V2 is not implemented in this pass.

## Executive Summary

The frontend is now structured enough for a V2 evolution because Go Core V1 owns the canonical ride lifecycle and the frontend has a centralized websocket client. V2 should focus on hardening, observability, UX state machines, and removing legacy/storage-era surfaces rather than changing backend contracts.

V2 readiness status: READY TO PLAN, NOT READY TO BUILD WITHOUT PRODUCT/OPS PRIORITIZATION.

## Current Foundation

| Capability | Readiness | Notes |
| --- | --- | --- |
| Go API command layer | READY | `backendClient` centralizes authenticated Go HTTP requests. |
| Websocket event router | READY | `backendSocketClient` owns canonical event dispatch, reconnect, heartbeat, token refresh, join, and rejoin. |
| Canonical lifecycle events | READY | `ride_offer`, `ride_accepted`, `driver_location`, `ride_started`, and `ride_completed` are wired into active rider/driver flows. |
| Legacy negotiation isolation | READY | Legacy `/negotiate/*` routes are redirected away from Supabase-native lifecycle. |
| Production build | READY | `npm run build` passes. |

## V2 Themes

### 1. Frontend State Machine

Readiness: HIGH.

Recommended V2 work:

- Introduce a single ride lifecycle reducer/state machine.
- Normalize backend statuses and websocket events into one frontend enum.
- Remove scattered status aliases such as `enroute`, `driver_arriving`, `driver_arrived`, `arrived`, and `in_progress` from component-level logic.
- Make command buttons derive enabled/disabled states from the state machine.

### 2. WebSocket Observability

Readiness: HIGH.

Recommended V2 work:

- Expose connection state to rider and driver active trip UI.
- Add reconnecting/offline banners for active trips.
- Add telemetry for connect, reconnect, heartbeat timeout, room join, room rejoin, queue flush, and auth refresh failures.
- Add integration tests with mocked websocket event sequences.

### 3. Backend Payload Contracts

Readiness: MEDIUM.

Recommended V2 work:

- Replace flexible event payload extraction with generated or shared TypeScript contract types.
- Add schema validation at websocket boundaries.
- Add contract tests for every canonical event shape.

### 4. Metadata Migration

Readiness: MEDIUM.

Current state:

- Ride creation uses Go.
- Some request metadata still writes to Supabase after ride creation: stops, preferences, luggage, student discount usage, and related notifications.

Recommended V2 work:

- Move dispatch-relevant metadata into the Go ride creation command.
- Keep Supabase as storage only after Go writes or approves the metadata transaction.
- Add retry/compensation UI only for non-critical metadata.

### 5. Legacy Code Removal

Readiness: MEDIUM.

Recommended V2 work:

- Delete or quarantine `src/pages/negotiate/*` once product confirms no migration path is needed.
- Retire legacy `RideDetail` if no admin/support workflow uses it.
- Remove obsolete Supabase realtime ride/offer subscriptions from unmounted or unreachable surfaces.
- Update stale tests that still assert old Supabase mutation behavior.

### 6. Mobile Reliability

Readiness: MEDIUM.

Recommended V2 work:

- Add Android background/resume test harness.
- Persist active ride context locally for app cold resume.
- Add foreground reconnect and state refresh after push notification tap.
- Add battery/location permission education for drivers.

### 7. Performance

Readiness: MEDIUM.

Current build warnings:

- Large chunks exceed 1000 kB.
- Map/call/admin bundles are heavy.

Recommended V2 work:

- Split admin, maps, calling, and driver navigation bundles more aggressively.
- Lazy-load heavy map/call SDKs only inside active screens.
- Measure first input and route-transition latency on low-end Android devices.

### 8. Release Operations

Readiness: HIGH.

Recommended V2 work:

- Attach frontend build version to every Go command header.
- Add a visible internal diagnostics panel for websocket state, ride room, token expiry, and last event.
- Add rollback-ready feature flags for experimental rider/driver surfaces.

## V2 Non-Goals

Do not implement these until Go/product contracts are explicitly approved:

- New ride lifecycle statuses.
- New websocket event names.
- Alternative offer negotiation models.
- Supabase lifecycle triggers or client-side business rules.
- Frontend-side dispatch ranking.

## V2 Entry Criteria

Start V2 only after:

1. Public beta staging E2E passes against Go Core V1.
2. Product confirms which legacy negotiation UX should survive.
3. Backend confirms event payload schemas.
4. Operations confirms monitoring fields and incident dashboards.
5. QA has mobile background/resume test coverage.

## V2 Recommendation

Proceed to V2 planning after production release candidate staging signoff.

Priority order:

1. Typed lifecycle state machine.
2. Websocket observability and UI connection states.
3. Payload contract validation.
4. Metadata migration into Go creation command.
5. Legacy code deletion.
6. Bundle/performance optimization.

