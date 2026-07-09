# PickMe Frontend-Go Integration Audit

Scope: production-grade frontend integration audit against canonical Go Core V1. No code was modified.

Canonical architecture:

- Go backend is authoritative for ride lifecycle, offer lifecycle, driver presence, realtime trip events, websocket communication, and business logic.
- Supabase is storage and authentication only.
- Canonical websocket events are `ride_offer`, `ride_accepted`, `driver_location`, `ride_started`, and `ride_completed`.
- Backend does not emit or consume `driver.location.update`; frontend must use `driver_location`.

## Executive Summary

PickMe frontend is not yet fully aligned with Go Core V1. The backend client layer exists and several Phase A lifecycle writes now call Go, but the frontend still behaves like a Supabase-first ride app in important rider and driver paths.

Launch risk is concentrated in five areas:

- Driver location outbound websocket event is wrong.
- Driver offer creation still writes directly to Supabase.
- Rider/driver realtime lifecycle still depends on Supabase table subscriptions instead of canonical Go websocket events.
- Ride lifecycle side paths still mutate Supabase directly.
- WebSocket client lacks production reconnection, event routing, room subscription, and token refresh behavior.

Internal pilot can continue only with tight monitoring and Supabase Realtime fallback enabled. Public beta should wait until the production blockers below are fixed.

## Launch Risk Order

| Priority | Finding | Classification |
| ---: | --- | --- |
| 1 | Driver location sender uses non-canonical `driver.location.update` event. | PRODUCTION BLOCKER |
| 2 | Driver offer submission still uses direct Supabase `offers.insert`. | PRODUCTION BLOCKER |
| 3 | Frontend does not consume canonical Go ride events for ride lifecycle. | PRODUCTION BLOCKER |
| 4 | Ride cancellation and rider fare changes still mutate `rides` directly. | PRODUCTION BLOCKER |
| 5 | WebSocket client lacks production reconnect/session/room semantics. | HIGH PRIORITY |
| 6 | Driver dashboard discovers open rides through broad Supabase Realtime and polling-style refresh. | HIGH PRIORITY |
| 7 | Ride creation still performs critical metadata side-writes after Go creation. | HIGH PRIORITY |
| 8 | Trip completion is locally blocked by a Supabase read before Go completion. | HIGH PRIORITY |
| 9 | Status naming is inconsistent across frontend views. | HIGH PRIORITY |
| 10 | Error handling and loading states are uneven across navigation screens. | NEEDS FRONTEND CHANGE |
| 11 | JWT handling is acceptable for HTTP but incomplete for long-lived WS. | NEEDS FRONTEND CHANGE |
| 12 | Some Phase A write paths are correctly routed through Go. | PASS |

## Findings

### 1. Driver Location WebSocket Event Is Wrong

Classification: PRODUCTION BLOCKER.

Current frontend:

- [src/lib/driverLocation.ts](src/lib/driverLocation.ts) sends:

```json
{
  "type": "driver.location.update",
  "latitude": 0,
  "longitude": 0,
  "timestamp": 0
}
```

Canonical backend:

- Must use `driver_location`.
- Backend does not emit `driver.location.update`.

Risk:

- If the socket is open, the frontend sends the wrong event and does not fall back to HTTP.
- Driver GPS can silently fail even though the app appears online.
- Rider ETA, map marker, pickup confidence, and operations monitoring become unreliable.

Recommendation:

- Change outbound driver location event to canonical `driver_location`.
- Include only fields accepted by Go.
- Require backend acknowledgment or fallback to `POST /api/drivers/me/location` when no ack arrives within a short timeout.

### 2. Driver Offer Submission Bypasses Go

Classification: PRODUCTION BLOCKER.

Current frontend:

- [src/lib/offerHelpers.ts](src/lib/offerHelpers.ts) `submitOffer` inserts directly into `offers`.
- [src/pages/DriverDashboard.tsx](src/pages/DriverDashboard.tsx) `sendOffer` calls `submitOffer`.

Canonical backend:

- Go owns offer lifecycle.

Risk:

- Backend cannot enforce offer eligibility, driver state, duplicate offer prevention, fare limits, ETA sanity, fraud checks, or websocket fanout.
- Rider may never receive canonical `ride_offer`.
- Race conditions remain between multiple drivers and stale pending rides.

Recommendation:

- Route offer creation through Go, for example `POST /api/rides/{rideId}/offers`.
- Use backend response as the source of truth.
- Emit/consume canonical `ride_offer` event.

### 3. Ride Lifecycle Still Depends On Supabase Realtime

Classification: PRODUCTION BLOCKER.

Current frontend:

- [src/hooks/useRideRealtime.ts](src/hooks/useRideRealtime.ts) subscribes to `rides`, `offers`, and `messages`.
- [src/pages/RideDetail.tsx](src/pages/RideDetail.tsx) reloads ride/offers/messages on Supabase changes.
- [src/pages/RiderRideDetail.tsx](src/pages/RiderRideDetail.tsx) uses Supabase realtime for offer and ride changes.
- [src/pages/DriverDashboard.tsx](src/pages/DriverDashboard.tsx) uses open ride table changes to refresh.

Canonical backend:

- Go websocket owns trip realtime events:
  - `ride_offer`
  - `ride_accepted`
  - `driver_location`
  - `ride_started`
  - `ride_completed`

Risk:

- UI behavior depends on Supabase publications that are no longer the authoritative realtime system.
- If Supabase Realtime is degraded or removed from lifecycle tables, drivers miss offers and riders miss acceptance/status changes.
- Fanout is broad and expensive at scale.

Recommendation:

- Introduce a typed Go websocket event router.
- Subscribe/join ride rooms through Go.
- Use Supabase Realtime only as temporary read fallback, not the primary lifecycle mechanism.

### 4. Ride Cancellation And Fare Changes Still Mutate Supabase

Classification: PRODUCTION BLOCKER.

Current frontend:

- [src/pages/RiderRideDetail.tsx](src/pages/RiderRideDetail.tsx) `updateFare` directly updates `rides.fare`.
- [src/pages/RiderRideDetail.tsx](src/pages/RiderRideDetail.tsx) `handleCancelRide` directly updates `rides.status`.
- [src/components/ride/RideView.tsx](src/components/ride/RideView.tsx) `handleCancelRide` directly updates `rides.status`.

Canonical backend:

- Go owns ride lifecycle and business logic.

Risk:

- Fare tampering and cancellation policy bypass remain possible.
- Backend cannot enforce idempotency, cancellation fee rules, offer invalidation, or driver/rider notification ordering.
- Race with offer acceptance can produce inconsistent UI state.

Recommendation:

- Route cancellation and fare-change commands through Go.
- Use explicit commands such as `POST /api/rides/{rideId}/cancel` and `POST /api/rides/{rideId}/fare`.

### 5. WebSocket Client Is Not Production-Grade

Classification: HIGH PRIORITY.

Current frontend:

- [src/lib/ws.ts](src/lib/ws.ts) keeps one singleton socket.
- [src/lib/backendClient.ts](src/lib/backendClient.ts) creates the socket and immediately returns it.
- There is no heartbeat, backoff, token refresh, event queue, room join, or resubscribe logic.

Risk:

- Mobile backgrounding, spotty data, token expiry, and network handoff will break realtime behavior.
- `getWS()` can return a connecting socket; senders often only check `readyState` once.
- There is no canonical place to dispatch `ride_offer`, `ride_accepted`, `ride_started`, or `ride_completed`.

Recommendation:

- Build a `backendSocketClient` with:
  - authenticated connect
  - `open` promise
  - exponential backoff
  - heartbeat/ping timeout
  - token refresh before reconnect
  - typed event handlers
  - ride room join/rejoin
  - send queue for short reconnect windows

### 6. Driver Open-Ride Discovery Is Broad And Supabase-Centric

Classification: HIGH PRIORITY.

Current frontend:

- [src/hooks/useRideRealtime.ts](src/hooks/useRideRealtime.ts) subscribes to all ride and offer changes for open rides.
- [src/lib/offerHelpers.ts](src/lib/offerHelpers.ts) fetches last five minutes of pending rides from Supabase.
- [src/pages/DriverDashboard.tsx](src/pages/DriverDashboard.tsx) refreshes the dashboard on every ride/offer change.

Risk:

- At 10,000+ users this creates broad fanout and repeated reads.
- Drivers see rides outside backend dispatch logic.
- Candidate selection is not Go-owned from the frontend perspective.

Recommendation:

- Use Go driver feed endpoint or websocket `ride_offer`/dispatch events.
- Keep driver ride list targeted to backend-selected rides.
- Avoid dashboard-wide refreshes on every table event.

### 7. Ride Creation Has Post-Create Supabase Side-Writes

Classification: HIGH PRIORITY.

Current frontend:

- [src/lib/requestRide.ts](src/lib/requestRide.ts) creates the ride through Go.
- [src/components/ride/RideView.tsx](src/components/ride/RideView.tsx) then writes student discount usage, stops, preferences, notifications, and luggage request metadata directly to Supabase.

Risk:

- Ride can be created without required metadata if a side-write fails.
- Backend dispatch may run before preferences/stops/luggage exist.
- Go cannot enforce all ride request rules in one transaction.

Recommendation:

- Keep Phase A stable for now, but next migration should send ride metadata to Go in the ride creation command.
- Go should write ride plus metadata atomically or emit clear compensating errors.

### 8. Trip Completion Is Blocked By Local Supabase Validation

Classification: HIGH PRIORITY.

Current frontend:

- [src/lib/completeTrip.ts](src/lib/completeTrip.ts) reads `rides` from Supabase and validates status/payment/fare before calling Go.

Risk:

- Stale Supabase reads can block a valid backend completion.
- RLS/read errors can prevent an assigned driver from completing a trip.
- Business rules are duplicated and may drift from Go.

Recommendation:

- Let Go own completion validation.
- Frontend should call `POST /api/rides/{rideId}/complete` and display backend errors.
- Supabase read can remain for UI display only, not command authorization.

### 9. Status Naming Is Inconsistent

Classification: HIGH PRIORITY.

Current frontend examples:

- Driver active trip query includes `accepted`, `enroute`, `enroute_pickup`, `in_progress`, `arrived`.
- Rider tracking labels include `driver_arriving`, `driver_arrived`, `arrived`, `in_progress`.
- Canonical websocket events include `ride_started` and `ride_completed`.

Risk:

- Screens can disagree about whether the driver is enroute, arrived, or started.
- Backend events may not map cleanly to local UI state.
- Status-transition buttons may send a value the backend does not expect.

Recommendation:

- Define one frontend enum that maps backend statuses/events to UI states.
- Treat websocket events as authoritative transitions.
- Remove legacy aliases after migration.

### 10. Error Handling Is Uneven

Classification: NEEDS FRONTEND CHANGE.

Current frontend:

- [src/lib/backendClient.ts](src/lib/backendClient.ts) maps HTTP errors reasonably.
- Some screens catch and toast errors.
- [src/components/driver/FullScreenNavigation.tsx](src/components/driver/FullScreenNavigation.tsx) `handleStatusUpdate` does not wrap the backend call in local try/catch.
- Some websocket failures only log to console.

Risk:

- Driver may tap a lifecycle button and see no recoverable state if a backend call throws in a navigation component.
- Riders may not know whether realtime is disconnected.

Recommendation:

- Standardize command wrappers with loading, retry-safe disable, backend error display, and refresh-on-conflict.
- Surface realtime disconnected/reconnecting states in active rides.

### 11. JWT Handling Is Incomplete For Long-Lived Realtime

Classification: NEEDS FRONTEND CHANGE.

Current frontend:

- HTTP calls use Supabase session access token.
- WebSocket token is placed in `?token=`.
- No token refresh or reconnect-on-expiry behavior exists.

Risk:

- A trip crossing token expiry can lose websocket updates.
- Mobile resume can keep a stale socket alive or fail silently.

Recommendation:

- On auth state change, reconnect the Go socket.
- Before websocket reconnect, fetch a fresh Supabase session.
- If backend supports it, prefer a short-lived websocket ticket minted from a Bearer-authenticated HTTP call.

### 12. Phase A Go HTTP Integration Exists For Core Commands

Classification: PASS.

Current frontend:

- Ride creation uses `POST /api/rides`.
- Offer acceptance uses `POST /api/rides/{rideId}/offers/{offerId}/accept`.
- Driver presence uses `POST /api/drivers/me/presence`.
- Ride status updates use `POST /api/rides/{rideId}/status`.
- Ride completion uses `POST /api/rides/{rideId}/complete`.
- Settlement uses `POST /api/rides/{rideId}/settle`.
- Driver location has HTTP fallback to `POST /api/drivers/me/location`.

Risk:

- This is a good base, but not sufficient while offer creation, cancellation, realtime event consumption, and driver location websocket naming remain misaligned.

## Flow-by-Flow Assessment

### Rider Ride Creation

Classification: HIGH PRIORITY.

Current:

- Ride command goes to Go.
- Metadata and notifications still write to Supabase after creation.

Target:

- One Go command creates ride and all dispatch-relevant metadata.
- Go emits `ride_offer` or dispatch events to candidate drivers.

### Driver Offer Workflow

Classification: PRODUCTION BLOCKER.

Current:

- Driver sees open rides from Supabase.
- Driver submits offer directly to Supabase.
- Rider observes offers through Supabase Realtime.

Target:

- Driver receives targeted opportunities from Go.
- Driver submits offer to Go.
- Go emits `ride_offer` to rider room.

### Rider Offer Workflow

Classification: HIGH PRIORITY.

Current:

- Offer acceptance goes to Go.
- Offer discovery still relies on Supabase.
- One `RideView` handler appears to use mocked driver assignment state rather than backend acceptance.

Target:

- Rider receives `ride_offer`.
- Accept command goes to Go.
- UI transitions on `ride_accepted` event or accepted command response.

### Ride Status Lifecycle

Classification: HIGH PRIORITY.

Current:

- Driver status commands go to Go.
- UI also depends on Supabase ride row updates.
- Status aliases are inconsistent.

Target:

- Go validates transitions and emits `ride_started`, `ride_completed`, and related accepted/location events.
- Frontend event reducer updates all rider and driver screens.

### Driver Location Tracking

Classification: PRODUCTION BLOCKER.

Current:

- WebSocket outbound event name is wrong.
- Rider tracking can consume `driver_location`, but other hooks still depend on Supabase `live_locations`.

Target:

- Driver sends `driver_location`.
- Rider receives `driver_location`.
- Supabase `live_locations` is a storage/read fallback only.

### Ride Room Join

Classification: HIGH PRIORITY.

Current:

- Ride presence uses Supabase presence in [src/pages/RideDetail.tsx](src/pages/RideDetail.tsx).
- No Go ride-room join is visible.

Target:

- Authenticated Go websocket joins ride room.
- Backend authorizes membership and sends current room state.

### Error, Loading, And UX

Classification: NEEDS FRONTEND CHANGE.

Current:

- Many buttons have loading guards.
- Some lifecycle actions optimistically update local state.
- Backend conflict/errors are not consistently mapped to user recovery actions.

Target:

- Uber/InDrive-class UX should show:
  - command in progress
  - reconnecting
  - stale state refresh
  - retry option
  - clear failure reason
  - no double-submit window

## Recommended Migration Plan

### Immediate Production Blockers

1. Change driver location websocket event from `driver.location.update` to `driver_location`.
2. Move `submitOffer` and `declineOffer` to Go endpoints.
3. Add typed Go websocket event router for canonical events.
4. Replace direct ride cancellation and fare updates with Go commands.

### High Priority Before Public Beta

1. Add resilient websocket lifecycle: heartbeat, reconnect, rejoin, token refresh.
2. Replace broad Supabase driver open-ride subscriptions with Go dispatch/feed.
3. Move ride metadata side-writes into Go ride creation.
4. Remove local Supabase validation from `completeTrip`.
5. Normalize status/event naming.

### Pilot-Allowed Temporary Fallbacks

These can remain during a narrow internal pilot if monitored:

- Supabase reads for ride detail display.
- Supabase storage.
- Supabase Auth.
- Supabase Realtime as fallback only, not primary lifecycle behavior.
- Chat/calls/wallets if they are outside the Go Core V1 migration scope.

## Production Readiness Decision

Frontend-Go integration is not public-beta ready.

Internal pilot status: conditional.

Public beta status: blocked until the production blockers are fixed.

National launch status: not ready until Go websocket events are the primary realtime layer and Supabase lifecycle writes are removed from rider/driver flows.
