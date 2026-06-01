# PickMe Phase A Contract Verification

Scope: integration verification only for Migration Phase A. No Phase B flows were migrated or expanded.

## Verification Summary

Runtime verification is blocked because the configured local Go backend is not reachable from this workspace.

Checked:

- `http://localhost:3000/health` -> unable to connect.
- `http://localhost:3000/api/rides` -> unable to connect.
- `http://localhost:3000/ws` -> unable to connect.

Static frontend contract verification was completed from the Phase A call sites. The frontend consistently attaches `Authorization: Bearer <supabase access_token>` for HTTP calls and appends `?token=<supabase access_token>` for WebSocket connections.

## Classification Summary

| Contract | Status | Reason |
| --- | --- | --- |
| `POST /api/rides` | BLOCKED | Frontend contract is clear, but backend response shape cannot be runtime-verified. |
| `POST /api/rides/{rideId}/offers/{offerId}/accept` | BLOCKED | Frontend sends no body and ignores response; backend availability not verified. |
| `POST /api/drivers/me/presence` | BLOCKED | Frontend sends `{ online }`; backend availability not verified. |
| `POST /api/drivers/me/location` | BLOCKED | Frontend fallback sends coordinates; backend availability not verified. |
| `POST /api/rides/{rideId}/status` | BLOCKED | Frontend sends `{ status, expectedStatus }`; backend availability not verified. |
| `POST /api/rides/{rideId}/complete` | BLOCKED | Frontend expects settlement fields; backend availability not verified. |
| `POST /api/rides/{rideId}/settle` | BLOCKED | Frontend expects a small settlement result; backend availability not verified. |
| WebSocket authentication | BLOCKED | Frontend uses `?token=`; backend acceptance cannot be verified. |
| WebSocket `driver.location.update` | NEEDS BACKEND CHANGE | Frontend sender and frontend tracking listener currently use different message shapes; backend must translate or frontend must be adjusted later. |

## Shared HTTP Contract

Actual frontend transport:

- Source: `src/lib/backendClient.ts`.
- Base URL: `VITE_API_URL`.
- Header: `Authorization: Bearer <supabase session access_token>`.
- Header: `Content-Type: application/json`.
- Error behavior:
  - `401` -> `BackendError` with user-facing auth message.
  - `403` -> `BackendError` with forbidden message.
  - `>=500` -> `BackendError` with server error message.
  - network failure -> `BackendError("Network error. Please check your connection and try again.")`.

Required backend behavior:

- Accept Supabase JWT in `Authorization`.
- Return JSON on success and failure.
- Prefer `{ error: string }`, `{ message: string }`, or `{ reason: string }` for non-2xx errors so the frontend shows useful text.
- Return correct CORS headers for browser calls.

## 1. `POST /api/rides`

Status: BLOCKED.

Frontend call sites:

- `src/lib/requestRide.ts` -> `requestRide`.
- `src/components/HeroSection.tsx` -> `handleRequestRide` via `requestRide`.
- `src/components/ride/RideView.tsx` -> existing request handler via `requestRide`.

Expected request payload:

```json
{
  "user_id": "auth user id",
  "status": "pending | scheduled",
  "pickup_address": "string",
  "dropoff_address": "string",
  "fare": 10,
  "distance_km": 2.5,
  "duration_minutes": 8,
  "pickup_lat": -20.0,
  "pickup_lon": 29.0,
  "dropoff_lat": -20.1,
  "dropoff_lon": 29.1,
  "vehicle_type": "economy",
  "route_polyline": null,
  "passenger_count": 1,
  "payment_method": "cash | wallet",
  "town_id": null,
  "gender_preference": "any",
  "passenger_name": "optional",
  "passenger_phone": "optional",
  "scheduled_at": "optional ISO timestamp"
}
```

Actual frontend payload:

- Same as above.
- `user_id` is still included in the body even though the backend must derive the authoritative user from the JWT.
- `fare`, distance, duration, and route fields are client-provided; backend must recalculate or validate them.

Expected response:

```json
{
  "ok": true,
  "ride": {
    "id": "ride uuid"
  }
}
```

Also accepted by current frontend:

```json
{
  "ok": true,
  "ride_id": "ride uuid",
  "fare": 10
}
```

Actual response usage:

- If `ok === false`, frontend displays `reason` or `error`.
- Otherwise frontend uses `result.ride`, or falls back to `{ id: result.ride_id, fare: result.fare }`.
- Downstream UI requires `ride.id`.

Contract mismatches:

- Cannot verify actual backend response.
- Backend must not require the client `user_id`; it should ignore it or reject mismatches against JWT.
- If backend returns only `{ id: "..." }` without `ok`, frontend will treat it as a ride object and still work.
- If backend returns `{ rideId: "..." }`, frontend will not find the ride id.

UI break risks:

- Missing `ride.id` breaks ride metadata follow-up inserts in `RideView`.
- Non-JSON error bodies produce generic request failures.
- Backend rejecting client-provided `user_id` by policy could break current frontend unless it ignores rather than requires absence.

## 2. `POST /api/rides/{rideId}/offers/{offerId}/accept`

Status: BLOCKED.

Frontend call sites:

- `src/lib/offerHelpers.ts` -> `acceptOffer`.
- `src/pages/RideDetail.tsx` -> local `acceptOffer`.
- `src/pages/RiderRideDetail.tsx` indirectly through `acceptOffer`.

Expected request payload:

No JSON body. `rideId` and `offerId` are path parameters.

Actual frontend payload:

- No body.
- Bearer JWT attached by `backendPost`.

Expected response:

```json
{
  "ok": true,
  "ride_id": "ride uuid",
  "offer_id": "offer uuid",
  "driver_id": "driver uuid",
  "status": "accepted"
}
```

Actual response usage:

- Response body is ignored.
- Any non-2xx throws and shows a toast/message.
- UI relies on existing Supabase Realtime/read refresh to observe accepted ride state.

Contract mismatches:

- Cannot verify actual backend response.
- Backend can return any JSON success body because frontend ignores it.

UI break risks:

- If backend returns `204 No Content`, `backendClient` currently handles empty body as `null`, so this is safe.
- If backend accepts but does not update Supabase `rides`/`offers` rows in the schema currently read by the frontend, UI will remain stale.

## 3. `POST /api/drivers/me/presence`

Status: BLOCKED.

Frontend call site:

- `src/pages/DriverDashboard.tsx` -> `toggleOnline`.

Expected request payload:

```json
{
  "online": true
}
```

Actual frontend payload:

- `{ online: boolean }`.
- No driver id is sent.
- Bearer JWT attached.

Expected response:

```json
{
  "ok": true,
  "online": true,
  "driver_id": "driver uuid"
}
```

Actual response usage:

- Response body is ignored.
- On success, frontend immediately updates local `isOnline` and `profile.is_online`.
- On online success, frontend starts browser GPS tracking.
- On offline success, frontend stops tracking and clears local open ride list.

Contract mismatches:

- Cannot verify actual backend response.
- Backend can return any 2xx JSON or `204`; frontend ignores success body.

UI break risks:

- If backend performs async presence update and Supabase read refresh returns old state, UI may briefly flip back after `refresh()`.
- If backend returns `403` for unmet driver requirements, UI shows the backend message. This is expected.

## 4. `POST /api/drivers/me/location`

Status: BLOCKED.

Frontend call site:

- `src/lib/driverLocation.ts` -> `updateDriverLocation`, only when WebSocket is not open.

Expected request payload:

```json
{
  "latitude": -20.0,
  "longitude": 29.0
}
```

Actual frontend payload:

- `{ latitude: lat, longitude: lng }`.
- No `user_id` or `driver_id` is sent.
- Bearer JWT attached.

Expected response:

```json
{
  "ok": true
}
```

Actual response usage:

- Response body is ignored.
- On success, frontend updates local duplicate-send coordinates.
- On failure, frontend logs to console and does not show a toast.

Contract mismatches:

- Cannot verify actual backend response.
- Backend can return any 2xx JSON or `204`; frontend ignores success body.

UI break risks:

- If both WebSocket and HTTP fallback fail, driver location silently stops updating except for console errors.
- If backend expects `lat/lng` instead of `latitude/longitude`, location fallback will fail.

## 5. `POST /api/rides/{rideId}/status`

Status: BLOCKED.

Frontend call sites:

- `src/pages/DriverDashboard.tsx` -> `updateTripStatus`.
- `src/components/driver/DriverLiveNav.tsx` -> `handleGo`, `handleArrived`.
- `src/components/driver/FullScreenNavigation.tsx` -> `handleStatusUpdate`.

Expected request payload:

```json
{
  "status": "enroute | arrived | in_progress",
  "expectedStatus": "accepted | enroute | arrived | in_progress"
}
```

Actual frontend payload:

- Same shape.
- Status values observed:
  - `enroute`
  - `arrived`
  - `in_progress`
- `expectedStatus` is sent from the local active trip state.

Expected response:

```json
{
  "ok": true,
  "ride_id": "ride uuid",
  "status": "arrived"
}
```

Actual response usage:

- Response body is ignored.
- On success, frontend mutates local trip state to the requested status.
- Realtime/read refresh is expected to eventually confirm state.

Contract mismatches:

- Cannot verify actual backend response.
- Backend can return any 2xx JSON or `204`; frontend ignores success body.

UI break risks:

- If backend uses `enroute_pickup` instead of `enroute`, the current frontend will set local state to `enroute` and navigation buttons may diverge from DB state.
- If backend rejects stale `expectedStatus`, the frontend shows an error and refreshes in `DriverDashboard`, but `DriverLiveNav` and `FullScreenNavigation` do not automatically refresh.

## 6. `POST /api/rides/{rideId}/complete`

Status: BLOCKED.

Frontend call sites:

- `src/lib/completeTrip.ts` -> `completeTrip`.
- `src/pages/DriverDashboard.tsx` -> `handleCompleteTrip`.
- `src/components/driver/DriverLiveNav.tsx` -> `handleComplete`.
- `src/components/driver/FullScreenNavigation.tsx` -> `handleComplete`.
- `src/pages/RiderRideDetail.tsx` indirectly through `completeTrip`.

Expected request payload:

No JSON body. `rideId` is a path parameter.

Actual frontend payload:

- No body.
- Bearer JWT attached.
- Before calling backend, `completeTrip` still performs a Supabase read of the ride row to preserve existing UI validation.

Expected response:

```json
{
  "ok": true,
  "fare_usd": 10,
  "commission_usd": 1.5,
  "driver_earnings_usd": 8.5
}
```

Failure response expected:

```json
{
  "ok": false,
  "reason": "Trip can only be completed after it has started"
}
```

Actual response usage:

- Callers check `result.ok`.
- Driver dashboard shows fare, commission, and driver earnings.
- Full-screen navigation shows driver earnings.
- Driver live nav only checks `ok`.

Contract mismatches:

- Cannot verify actual backend response.
- If backend returns `{ success: true }` instead of `{ ok: true }`, UI treats completion as failed.
- If backend completes trip but omits earnings fields, completion succeeds but earnings display as `$0.00`.

UI break risks:

- Missing `ok: true` is a hard UI break.
- Missing `driver_earnings_usd` is a payout display break.
- Backend must make completion idempotent; repeated taps can call the endpoint again if UI state lags.

## 7. `POST /api/rides/{rideId}/settle`

Status: BLOCKED.

Frontend call sites:

- `src/lib/completeTrip.ts` -> `settleTrip`.
- `src/pages/RideDetail.tsx` -> `SettlementInfo.handleSettle`.

Expected request payload:

No JSON body. `rideId` is a path parameter.

Actual frontend payload:

- No body.
- Bearer JWT attached.

Expected response:

```json
{
  "ok": true,
  "alreadySettled": false,
  "settlement": {}
}
```

Actual response usage:

- `settleTrip()` returns the backend response to any caller.
- `RideDetail` ignores the response and then reads `platform_ledger` from Supabase.

Contract mismatches:

- Cannot verify actual backend response.
- Backend can return any 2xx JSON or `204` for `RideDetail`, but `settleTrip()` callers may expect `{ ok }`.

UI break risks:

- If settlement succeeds but `platform_ledger` is not readable by the current user, `RideDetail` will not show settled state.
- If backend does settlement inside `/complete`, this separate endpoint still needs idempotent no-op behavior.

## 8. WebSocket Authentication

Status: BLOCKED.

Frontend call sites:

- `src/lib/backendClient.ts` -> `connectBackendWs`.
- `src/lib/ws.ts` -> `getWS`.
- `src/pages/LiveTrackingPage.tsx` -> listener setup.
- `src/lib/driverLocation.ts` -> location sender.

Expected handshake:

```text
GET ws://localhost:3000/ws?token=<supabase access token>
```

Actual frontend handshake:

- `VITE_WS_URL` is `ws://localhost:3000/ws`.
- Frontend appends `?token=<supabase access_token>`.
- Browser WebSocket API does not send custom `Authorization` headers.

Expected backend behavior:

- Accept JWT from `token` query parameter.
- Validate Supabase JWT.
- Bind the socket to the authenticated user.
- Reject missing/invalid/expired token.

Actual response usage:

- `getWS()` resolves as soon as a `WebSocket` object is constructed, not after the socket is open.
- Callers inspect `readyState` before sending.
- Live tracking attaches a `message` event listener.

Contract mismatches:

- Cannot verify backend accepts `?token=`.
- If backend only accepts `Authorization` header, browser clients cannot authenticate with the current implementation.

UI break risks:

- WebSocket auth rejection only logs errors; location has HTTP fallback, tracking has Supabase Realtime fallback.
- If backend closes unauthorized sockets without a clear error frame, UI will not show a user-facing message.

## 9. WebSocket `driver.location.update`

Status: NEEDS BACKEND CHANGE.

Frontend sender:

- `src/lib/driverLocation.ts`.

Actual frontend outbound event:

```json
{
  "type": "driver.location.update",
  "latitude": -20.0,
  "longitude": 29.0,
  "timestamp": 1710000000000
}
```

Expected backend inbound behavior:

- Derive driver identity from the authenticated WebSocket session.
- Ignore any client-supplied identity.
- Persist latest location to Supabase.
- Fan out a rider tracking event for active rides.

Frontend receiver:

- `src/pages/LiveTrackingPage.tsx`.

Actual frontend inbound event expected by live tracking:

```json
{
  "type": "driver_location",
  "driverId": "driver user id",
  "latitude": -20.0,
  "longitude": 29.0,
  "heading": 90,
  "speed": 12,
  "updated_at": "ISO timestamp"
}
```

Contract mismatch:

- Confirmed static mismatch: the outbound event is `driver.location.update`, but `LiveTrackingPage` only consumes `driver_location`.
- The outbound event does not include `driverId`; that is correct for security, but the backend must add the authorized driver id when broadcasting to riders.

Required backend behavior for current frontend compatibility:

- Accept inbound `driver.location.update`.
- Broadcast outbound `driver_location` with `driverId`, `latitude`, `longitude`, optional `heading`, optional `speed`, and `updated_at`.

UI break risks:

- If backend broadcasts `driver.location.update` unchanged, `LiveTrackingPage` will ignore the event.
- Rider tracking still has Supabase Realtime fallback on `live_locations`, so the break may be masked while Realtime remains enabled.

## Final Recommendation

Do not start Phase B yet.

Start the Go backend locally with the configured URLs, then rerun this verification against live endpoints using valid Supabase rider and driver sessions. The only confirmed static mismatch is the WebSocket location event shape: either the Go backend must translate `driver.location.update` into the current `driver_location` tracking event, or a future frontend change must update `LiveTrackingPage` to consume the new event shape.
