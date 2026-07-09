# PickMe Phase A Runtime Verification V2

Scope: runtime verification only. No code was modified and no Phase B work was started.

## Environment Verified

Frontend:

- `http://localhost:8080` returned `200`.
- Served `src/lib/backendClient.ts` contains:
  - `VITE_API_URL=http://localhost:3000`
  - `VITE_WS_URL=ws://localhost:3000/ws`

Go backend:

- `http://127.0.0.1:3000/` returned `200` with `{"message":"PickMe Go Backend Running ..."}`
- `http://127.0.0.1:3000/health` returned `200` with `{"status":"ok","time":"..."}`
- `http://localhost:3000/health` also returned `200`.

CORS:

- `OPTIONS http://127.0.0.1:3000/api/rides` from origin `http://localhost:8080` returned `204`.
- Response included:
  - `Access-Control-Allow-Methods=GET,POST,PUT,DELETE,OPTIONS`
  - `Access-Control-Allow-Headers=Origin,Content-Type,Accept,Authorization`

## Classification Summary

| Contract | Status | Runtime result |
| --- | --- | --- |
| `GET /health` | VERIFIED | Returned `200` and JSON status. |
| JWT authentication | NEEDS BACKEND CHANGE | WebSocket rejects missing/invalid/anon JWTs with `401`, but HTTP Phase A routes return `404` before auth can be verified. |
| `POST /api/rides` | NEEDS BACKEND CHANGE | Returned `404` for no auth, invalid JWT, and anon JWT. |
| `POST /api/rides/{rideId}/offers/{offerId}/accept` | NEEDS BACKEND CHANGE | Returned `404` for no auth, invalid JWT, and anon JWT. |
| `POST /api/drivers/me/presence` | NEEDS BACKEND CHANGE | Returned `404` for no auth, invalid JWT, and anon JWT. |
| `POST /api/drivers/me/location` | NEEDS BACKEND CHANGE | Returned `404` for no auth, invalid JWT, and anon JWT. |
| `POST /api/rides/{rideId}/status` | NEEDS BACKEND CHANGE | Returned `404` for no auth, invalid JWT, and anon JWT. |
| `POST /api/rides/{rideId}/complete` | NEEDS BACKEND CHANGE | Returned `404` for no auth, invalid JWT, and anon JWT. |
| `POST /api/rides/{rideId}/settle` | NEEDS BACKEND CHANGE | Returned `404` for no auth, invalid JWT, and anon JWT. |
| WebSocket authentication | VERIFIED | `/ws` rejects no token, invalid token, and anon JWT with `401`. Positive authenticated user path still needs a real user token. |
| `driver.location.update -> driver_location` broadcast | FAILED | Could not open an authenticated socket, so no broadcast was observed. Static frontend event-shape mismatch remains unless backend translates outbound events. |

## 1. `GET /health`

Status: VERIFIED.

Runtime request:

```text
GET http://127.0.0.1:3000/health
```

Actual response:

```json
{
  "status": "ok",
  "time": "2026-05-31T19:09:52.6815838+02:00"
}
```

Contract result:

- Backend process is running.
- Health endpoint is available.
- `localhost:3000` and `127.0.0.1:3000` both resolve correctly from this workspace.

UI break risk:

- None for health itself.

## 2. JWT Authentication

Status: NEEDS BACKEND CHANGE.

HTTP expected behavior:

- Missing JWT should return `401`.
- Invalid JWT should return `401`.
- Supabase anon JWT should not authorize lifecycle commands.
- Valid Supabase user JWT should authorize only allowed rider/driver actions.

Actual HTTP behavior:

- All Phase A HTTP endpoints returned `404`, including when called with:
  - no `Authorization` header
  - `Authorization: Bearer invalid.jwt.token`
  - `Authorization: Bearer <Supabase anon publishable JWT>`

Runtime evidence:

```text
POST /api/rides -> 404
POST /api/drivers/me/presence -> 404
POST /api/rides/{rideId}/status -> 404
```

WebSocket auth behavior:

- `ws://127.0.0.1:3000/ws` without token returned upgrade error `401`.
- `ws://127.0.0.1:3000/ws?token=invalid.jwt.token` returned upgrade error `401`.
- `ws://127.0.0.1:3000/ws?token=<anon JWT>` returned upgrade error `401`.

Contract mismatches:

- HTTP auth cannot be verified because the running backend does not expose the Phase A route paths.

UI break risk:

- Current frontend Phase A HTTP writes will fail with `BackendError("Request failed.")` because the backend returns `404` with an empty body.

## 3. `POST /api/rides`

Status: NEEDS BACKEND CHANGE.

Expected request payload:

```json
{
  "user_id": "auth user id",
  "status": "pending",
  "pickup_address": "A",
  "dropoff_address": "B",
  "fare": 5,
  "distance_km": 1.2,
  "duration_minutes": 5,
  "pickup_lat": -20.1,
  "pickup_lon": 29.1,
  "dropoff_lat": -20.2,
  "dropoff_lon": 29.2,
  "vehicle_type": "economy",
  "payment_method": "cash"
}
```

Actual frontend payload:

- Same Phase A payload shape from `src/lib/requestRide.ts`.
- The frontend includes `user_id`; backend should derive authoritative user from JWT and ignore or validate this field.

Expected response:

```json
{
  "ok": true,
  "ride": {
    "id": "ride uuid"
  }
}
```

Actual runtime response:

```text
404 Not Found
```

Response body:

```text
empty
```

Contract mismatch:

- The running backend does not expose `POST /api/rides`.

UI break risk:

- Ride creation will fail immediately.
- `RideView` follow-up metadata writes will not run because no `ride.id` is returned.

## 4. `POST /api/rides/{rideId}/offers/{offerId}/accept`

Status: NEEDS BACKEND CHANGE.

Expected request payload:

- No body.
- `rideId` and `offerId` in path.

Actual frontend payload:

- No body from `src/lib/offerHelpers.ts` and `src/pages/RideDetail.tsx`.
- Bearer JWT attached by `backendClient`.

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

Actual runtime response:

```text
404 Not Found
```

Response body:

```text
empty
```

Contract mismatch:

- The running backend does not expose the accept-offer route.

UI break risk:

- Offer acceptance fails before any Supabase state change.
- Rider UI will show a generic failure because the backend returns no JSON error message.

## 5. `POST /api/drivers/me/presence`

Status: NEEDS BACKEND CHANGE.

Expected request payload:

```json
{
  "online": true
}
```

Actual frontend payload:

- `{ "online": boolean }` from `src/pages/DriverDashboard.tsx`.
- No driver id is sent.

Expected response:

```json
{
  "ok": true,
  "online": true,
  "driver_id": "driver uuid"
}
```

Actual runtime response:

```text
404 Not Found
```

Response body:

```text
empty
```

Contract mismatch:

- The running backend does not expose `POST /api/drivers/me/presence`.

UI break risk:

- Driver cannot go online/offline through the migrated frontend.
- Location tracking will not start because presence update fails.

## 6. `POST /api/drivers/me/location`

Status: NEEDS BACKEND CHANGE.

Expected request payload:

```json
{
  "latitude": -20.1,
  "longitude": 29.1
}
```

Actual frontend payload:

- `{ "latitude": number, "longitude": number }` from `src/lib/driverLocation.ts`.
- This HTTP endpoint is used as fallback when WebSocket is not open.

Expected response:

```json
{
  "ok": true
}
```

Actual runtime response:

```text
404 Not Found
```

Response body:

```text
empty
```

Contract mismatch:

- The running backend does not expose `POST /api/drivers/me/location`.

UI break risk:

- If WebSocket auth/open fails, HTTP fallback also fails.
- Driver GPS updates will not reach Go or Supabase through Phase A paths.

## 7. `POST /api/rides/{rideId}/status`

Status: NEEDS BACKEND CHANGE.

Expected request payload:

```json
{
  "status": "arrived",
  "expectedStatus": "enroute"
}
```

Actual frontend payload:

- `status` values emitted by frontend:
  - `enroute`
  - `arrived`
  - `in_progress`
- `expectedStatus` is sent from current local trip state.

Expected response:

```json
{
  "ok": true,
  "ride_id": "ride uuid",
  "status": "arrived"
}
```

Actual runtime response:

```text
404 Not Found
```

Response body:

```text
empty
```

Contract mismatch:

- The running backend does not expose the ride status route.

UI break risk:

- Driver cannot move trips through enroute, arrived, or in-progress states.
- Driver navigation screens will show failure toasts.

## 8. `POST /api/rides/{rideId}/complete`

Status: NEEDS BACKEND CHANGE.

Expected request payload:

- No body.
- `rideId` in path.

Actual frontend payload:

- No body from `src/lib/completeTrip.ts`.
- Frontend performs a Supabase read first to preserve existing validation, then calls backend.

Expected response:

```json
{
  "ok": true,
  "fare_usd": 10,
  "commission_usd": 1.5,
  "driver_earnings_usd": 8.5
}
```

Actual runtime response:

```text
404 Not Found
```

Response body:

```text
empty
```

Contract mismatch:

- The running backend does not expose the trip completion route.

UI break risk:

- Driver cannot complete trips through Phase A frontend.
- Earnings UI will never receive completion settlement fields.

## 9. `POST /api/rides/{rideId}/settle`

Status: NEEDS BACKEND CHANGE.

Expected request payload:

- No body.
- `rideId` in path.

Actual frontend payload:

- No body from `src/lib/completeTrip.ts` and `src/pages/RideDetail.tsx`.

Expected response:

```json
{
  "ok": true,
  "alreadySettled": false,
  "settlement": {}
}
```

Actual runtime response:

```text
404 Not Found
```

Response body:

```text
empty
```

Contract mismatch:

- The running backend does not expose the settlement route.

UI break risk:

- Manual settlement retry in ride detail fails.
- If backend completes and settles in one command later, this endpoint should still exist as idempotent compatibility or the frontend must be changed in a future scoped pass.

## 10. WebSocket Authentication

Status: VERIFIED.

Runtime checks:

```text
ws://127.0.0.1:3000/ws
```

Result:

```text
401 Unauthorized during upgrade
```

Runtime check:

```text
ws://127.0.0.1:3000/ws?token=invalid.jwt.token
```

Result:

```text
401 Unauthorized during upgrade
```

Runtime check:

```text
ws://127.0.0.1:3000/ws?token=<Supabase anon JWT>
```

Result:

```text
401 Unauthorized during upgrade
```

Verified behavior:

- WebSocket route exists.
- Missing token is rejected.
- Malformed token is rejected.
- Public anon JWT is rejected.

Not verified:

- Positive authenticated user JWT handshake, because no logged-in Supabase user access token was available in this runtime environment.

UI break risk:

- If valid Supabase user JWTs are also rejected, driver location and live tracking WebSocket path will fail. That must be tested with a real rider/driver session token.

## 11. `driver.location.update -> driver_location` Broadcast

Status: FAILED.

Expected frontend outbound event:

```json
{
  "type": "driver.location.update",
  "latitude": -20.1,
  "longitude": 29.1,
  "timestamp": 1710000000000
}
```

Expected backend behavior:

- Accept the event on an authenticated driver WebSocket.
- Persist latest driver location to Supabase.
- Broadcast rider-compatible event:

```json
{
  "type": "driver_location",
  "driverId": "driver user id",
  "latitude": -20.1,
  "longitude": 29.1,
  "heading": 90,
  "speed": 12,
  "updated_at": "ISO timestamp"
}
```

Actual runtime result:

- Could not open an authenticated WebSocket because no valid Supabase user JWT was available.
- No `driver.location.update` event was accepted.
- No `driver_location` broadcast was observed.

Contract mismatch:

- Static mismatch remains from Phase A:
  - Sender emits `driver.location.update`.
  - `LiveTrackingPage` consumes `driver_location`.
- Runtime could not confirm whether the Go backend translates between those two event names.

UI break risk:

- If backend broadcasts `driver.location.update` unchanged, rider live tracking ignores it.
- Supabase Realtime fallback may mask this failure temporarily.

## Final Runtime Decision

Phase A is not runtime-ready against the currently running Go backend.

The backend process is up, `/health` is verified, CORS preflight is working, and WebSocket negative authentication is verified. However, every Phase A HTTP endpoint required by the frontend currently returns `404 Not Found`.

Required backend changes before Phase A can pass runtime verification:

- Add or mount `POST /api/rides`.
- Add or mount `POST /api/rides/{rideId}/offers/{offerId}/accept`.
- Add or mount `POST /api/drivers/me/presence`.
- Add or mount `POST /api/drivers/me/location`.
- Add or mount `POST /api/rides/{rideId}/status`.
- Add or mount `POST /api/rides/{rideId}/complete`.
- Add or mount `POST /api/rides/{rideId}/settle`.
- Confirm authenticated WebSocket accepts Supabase user JWT via `?token=`.
- Confirm backend translates inbound `driver.location.update` to outbound `driver_location`, or schedule a future frontend-only compatibility update.
