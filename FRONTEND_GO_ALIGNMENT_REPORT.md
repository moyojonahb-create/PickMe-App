# PickMe Frontend-Go Alignment Report

Phase: F1 Frontend-Go Alignment

Date: 2026-06-01

Scope:

- Frontend only.
- No backend code changed.
- No database schema changed.
- Go Core V1 remains the canonical source of truth for ride lifecycle, offer lifecycle, driver presence, driver location, and realtime lifecycle events.

## Executive Decision

Core rider and driver flows are now aligned to Go Core V1 at the frontend integration layer.

Public beta status: conditionally ready for a live Go Core V1 staging pass.

Runtime caveat: this pass completed code alignment and production build verification. A live end-to-end websocket run against a running Go backend was not available in this workspace, so the final rider-driver scenario still needs staging-device verification.

## Verification

| Check | Result | Notes |
| --- | --- | --- |
| `npm run build` | PASS | Production build completed successfully. |
| `driver.location.update` search | PASS | No frontend usage remains. |
| Canonical `driver_location` sender | PASS | Driver location websocket sender uses `driver_location`. |
| Core offer submission | PASS | Driver dashboard offer submission uses `POST /api/rides/:rideId/offers`. |
| Core cancellation | PASS | Rider/admin cancellation paths call Go cancel endpoint. |
| Core fare update | PASS | Rider fare update calls Go fare endpoint. |
| Legacy negotiate routes | FIXED | `/negotiate/*` now redirects to canonical Go-backed ride/driver surfaces. |

Build notes:

- First sandboxed build failed with `spawn EPERM` when Vite/esbuild attempted to start its native service.
- Re-run with approved elevated build permissions passed.
- Non-blocking warnings remain: Tailwind ambiguous class warning, missing Sentry auth token, and large chunk warnings.

## Item Classification

| Item | Classification | Result |
| --- | --- | --- |
| Replace `driver.location.update` with `driver_location` | FIXED | `src/lib/driverLocation.ts` sends canonical `driver_location` over Go websocket and falls back to Go HTTP location update when socket is not open. |
| Replace direct Supabase offer creation with `POST /api/rides/:rideId/offers` | FIXED | `src/lib/offerHelpers.ts` submits offers through Go and normalizes direct or nested Go offer responses. |
| Replace rider offer lifecycle with canonical Go events | FIXED | `RiderRideDetail` and `RideView` consume `ride_offer` through `useRideRealtime`; legacy mock offer acceptance in `RideView` was removed. |
| Build centralized websocket event router | FIXED | `src/lib/backendSocketClient.ts` is the centralized typed router for canonical lifecycle events. |
| Implement `ride_offer` | FIXED | Rider screens receive offers; driver dashboard consumes backend-dispatched ride opportunities. |
| Implement `ride_accepted` | FIXED | Ride room subscribers refresh/transition from Go websocket event. |
| Implement `driver_location` | FIXED | Driver sends canonical event; rider detail consumes websocket location before Supabase storage fallback. |
| Implement `ride_started` | FIXED | Ride room subscribers transition active lifecycle state from Go event. |
| Implement `ride_completed` | FIXED | Ride room subscribers complete/exit active flows from Go event. |
| Add websocket reconnect | FIXED | Exponential reconnect with max backoff exists in `backendSocketClient`. |
| Add websocket heartbeat | FIXED | Client sends ping and closes/reconnects on pong timeout. |
| Add token refresh | FIXED | Reconnect path fetches a fresh Supabase JWT before opening the socket. |
| Add room join/rejoin | FIXED | `join_ride`/`leave_ride` are centralized and rooms are rejoined after reconnect. |
| Remove direct Supabase ride cancellation mutations | FIXED | Core rider/admin cancellation now calls Go cancel endpoint; legacy negotiate route is no longer exposed. |
| Remove direct Supabase fare mutations | FIXED | Core rider fare adjustment calls Go fare endpoint. |

## Flow Verification Matrix

| Flow | Classification | Evidence |
| --- | --- | --- |
| Rider -> Request Ride | PASS | Existing `requestRide` path creates through Go. Metadata side-writes remain storage-only follow-ups and were not expanded in F1. |
| Driver -> Receive `ride_offer` | FIXED | Driver dashboard consumes Go `ride_offer` events and adds targeted ride opportunities. |
| Driver -> Submit Offer | FIXED | Driver offer modal calls Go offer endpoint. |
| Rider -> Accept Offer | FIXED | Rider offer acceptance calls Go accept endpoint; mock local assignment removed. |
| Driver -> Start Ride | PASS | Driver status transitions call Go status endpoint. |
| Driver -> Send `driver_location` | FIXED | Canonical websocket event is used. |
| Rider -> Receive `driver_location` | FIXED | Rider detail consumes Go websocket location events. |
| Driver -> Complete Ride | PASS | Completion calls Go complete endpoint. |
| Rider -> Receive `ride_completed` | FIXED | Ride room subscription handles Go `ride_completed`. |

## Remaining

| Item | Classification | Notes |
| --- | --- | --- |
| Live staging verification against Go Core V1 | REMAINING | Needs real backend websocket, authenticated rider, authenticated driver, and mobile/background network testing. |
| Supabase Realtime storage fallback for driver tracking | REMAINING | Still present as fallback display path in `useDriverTracking`; not used as canonical lifecycle decisioning. |
| Ride creation metadata side-writes | REMAINING | Out of F1 scope. Go should eventually own stops/preferences/luggage/student metadata atomically. |
| Broad Supabase reads for dashboard/detail display | REMAINING | Reads remain for display hydration. Lifecycle commands/events are Go-owned. |

## Production Blockers

No F1 production blockers remain in the canonical `/ride` and `/driver/dashboard` flows.

Legacy Supabase-native negotiate screens are no longer routable from `App.tsx`; their source files still exist but are not production entry points.

