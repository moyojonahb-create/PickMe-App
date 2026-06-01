# PickMe Phase A Runtime Verification V3

Scope: runtime verification only. No frontend code was modified and no Phase B work was started.

## Environment Verified

Frontend:

- `http://localhost:8080` returned `200`.
- Served `src/lib/backendClient.ts` contains:
  - `VITE_API_URL=http://localhost:3000`
  - `VITE_WS_URL=ws://localhost:3000/ws`
- Local `.env` contains:
  - `VITE_API_URL=http://localhost:3000`
  - `VITE_WS_URL=ws://localhost:3000/ws`

Go backend:

- `http://127.0.0.1:3000/` returned `200` with backend running JSON.
- `http://127.0.0.1:3000/health` returned `200`.

CORS:

- `OPTIONS http://127.0.0.1:3000/api/rides` from origin `http://localhost:8080` returned `204`.
- Response included:
  - `Access-Control-Allow-Methods=GET,POST,PUT,DELETE,OPTIONS`
  - `Access-Control-Allow-Headers=Origin,Content-Type,Accept,Authorization`

## Classification Summary

| Contract | Status | Runtime result |
| --- | --- | --- |
| `GET /health` | VERIFIED | Returned `200` and JSON status. |
| `POST /api/rides` | NEEDS BACKEND CHANGE | Returned `404` for no auth, invalid JWT, and anon JWT. |
| `POST /api/rides/{rideId}/offers/{offerId}/accept` | NEEDS BACKEND CHANGE | Returned `404` for no auth, invalid JWT, and anon JWT. |
| `POST /api/drivers/me/presence` | NEEDS BACKEND CHANGE | Returned `404` for no auth, invalid JWT, and anon JWT. |
| `POST /api/drivers/me/location` | NEEDS BACKEND CHANGE | Returned `404` for no auth, invalid JWT, and anon JWT. |
| `POST /api/rides/{rideId}/status` | NEEDS BACKEND CHANGE | Returned `404` for no auth, invalid JWT, and anon JWT. |
| `POST /api/rides/{rideId}/complete` | NEEDS BACKEND CHANGE | Returned `404` for no auth, invalid JWT, and anon JWT. |
| `POST /api/rides/{rideId}/settle` | NEEDS BACKEND CHANGE | Returned `404` for no auth, invalid JWT, and anon JWT. |
| WebSocket JWT auth | VERIFIED | `/ws` rejects missing token, invalid token, and anon JWT with `401`. Positive user-token path was not available in this workspace. |
| `driver.location.update -> driver_location` broadcast | FAILED | Could not open an authenticated driver socket, so no broadcast was observed. |

## Test Controls Used

HTTP routes were tested with:

- No `Authorization` header.
- `Authorization: Bearer invalid.jwt.token`.
- `Authorization: Bearer <Supabase anon publishable JWT>`.

No valid logged-in Supabase rider or driver access token was available from this workspace, so positive authenticated write-through to Supabase could not be executed.

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
  "time": "2026-05-31T19:30:25.2306853+02:00"
}
```

Contract result:

- Backend process is running.
- Health endpoint is available.
- `localhost:3000` and `127.0.0.1:3000` both reach the backend.

UI break risk:

- None for health itself.

## 2. `POST /api/rides`

Status: NEEDS BACKEND CHANGE.

Expected frontend payload:

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

Expected success response:

```json
{
  "ok": true,
  "ride": {
    "id": "ride uuid"
  }
}
```

Actual runtime result:

```text
NO_AUTH  -> 404 Not Found
BAD_AUTH -> 404 Not Found
ANON_JWT -> 404 Not Found
```

Response body:

```text
empty
```

Contract mismatch:

- The running backend still does not expose `POST /api/rides` at either `127.0.0.1:3000` or `localhost:3000`.
- The endpoint should fail closed with `401` or `403` before payload validation when auth is missing or invalid.

UI break risk:

- Ride creation fails immediately.
- The frontend receives an empty `404`, which becomes a generic request failure.
- Follow-up ride metadata writes in `RideView` will not run because no `ride.id` is returned.

## 3. `POST /api/rides/{rideId}/offers/{offerId}/accept`

Status: NEEDS BACKEND CHANGE.

Expected frontend payload:

- No body.
- `rideId` and `offerId` are path parameters.

Expected success response:

```json
{
  "ok": true,
  "ride_id": "ride uuid",
  "offer_id": "offer uuid",
  "driver_id": "driver uuid",
  "status": "accepted"
}
```

Actual runtime result:

```text
NO_AUTH  -> 404 Not Found
BAD_AUTH -> 404 Not Found
ANON_JWT -> 404 Not Found
```

Response body:

```text
empty
```

Contract mismatch:

- The running backend still does not expose the accept-offer route.

UI break risk:

- Offer acceptance fails before any Supabase state change.
- Rider UI will show a generic failure because the backend returns no JSON error.

## 4. `POST /api/drivers/me/presence`

Status: NEEDS BACKEND CHANGE.

Expected frontend payload:

```json
{
  "online": true
}
```

Expected success response:

```json
{
  "ok": true,
  "online": true,
  "driver_id": "driver uuid"
}
```

Actual runtime result:

```text
NO_AUTH  -> 404 Not Found
BAD_AUTH -> 404 Not Found
ANON_JWT -> 404 Not Found
```

Response body:

```text
empty
```

Contract mismatch:

- The running backend still does not expose `POST /api/drivers/me/presence`.

UI break risk:

- Drivers cannot go online or offline through the migrated frontend.
- Browser location tracking does not start because presence update fails.

## 5. `POST /api/drivers/me/location`

Status: NEEDS BACKEND CHANGE.

Expected frontend payload:

```json
{
  "latitude": -20.1,
  "longitude": 29.1
}
```

Expected success response:

```json
{
  "ok": true
}
```

Actual runtime result:

```text
NO_AUTH  -> 404 Not Found
BAD_AUTH -> 404 Not Found
ANON_JWT -> 404 Not Found
```

Response body:

```text
empty
```

Contract mismatch:

- The running backend still does not expose `POST /api/drivers/me/location`.

UI break risk:

- If WebSocket is unavailable, the HTTP fallback also fails.
- Driver GPS updates will not reach Go or Supabase through the Phase A fallback path.

## 6. `POST /api/rides/{rideId}/status`

Status: NEEDS BACKEND CHANGE.

Expected frontend payload:

```json
{
  "status": "arrived",
  "expectedStatus": "enroute"
}
```

Expected success response:

```json
{
  "ok": true,
  "ride_id": "ride uuid",
  "status": "arrived"
}
```

Actual runtime result:

```text
NO_AUTH  -> 404 Not Found
BAD_AUTH -> 404 Not Found
ANON_JWT -> 404 Not Found
```

Response body:

```text
empty
```

Contract mismatch:

- The running backend still does not expose the ride status route.

UI break risk:

- Drivers cannot move trips through `enroute`, `arrived`, or `in_progress`.
- Driver dashboard and navigation screens will show failure states.

## 7. `POST /api/rides/{rideId}/complete`

Status: NEEDS BACKEND CHANGE.

Expected frontend payload:

- No body.
- `rideId` is a path parameter.

Expected success response:

```json
{
  "ok": true,
  "fare_usd": 10,
  "commission_usd": 1.5,
  "driver_earnings_usd": 8.5
}
```

Actual runtime result:

```text
NO_AUTH  -> 404 Not Found
BAD_AUTH -> 404 Not Found
ANON_JWT -> 404 Not Found
```

Response body:

```text
empty
```

Contract mismatch:

- The running backend still does not expose the trip completion route.

UI break risk:

- Drivers cannot complete trips through the Phase A frontend.
- Earnings fields never return to the UI.

## 8. `POST /api/rides/{rideId}/settle`

Status: NEEDS BACKEND CHANGE.

Expected frontend payload:

- No body.
- `rideId` is a path parameter.

Expected success response:

```json
{
  "ok": true,
  "alreadySettled": false,
  "settlement": {}
}
```

Actual runtime result:

```text
NO_AUTH  -> 404 Not Found
BAD_AUTH -> 404 Not Found
ANON_JWT -> 404 Not Found
```

Response body:

```text
empty
```

Contract mismatch:

- The running backend still does not expose the settlement route.

UI break risk:

- Manual settlement retry fails.
- If settlement is handled inside `/complete`, this compatibility endpoint still needs to exist as an idempotent no-op or the frontend must be changed in a later scoped pass.

## 9. WebSocket JWT Auth

Status: VERIFIED.

Runtime checks:

```text
ws://127.0.0.1:3000/ws
ws://127.0.0.1:3000/ws?token=invalid.jwt.token
ws://127.0.0.1:3000/ws?token=<Supabase anon publishable JWT>
```

Actual results:

```text
NO_TOKEN -> 401 Unauthorized during upgrade
BAD_TOKEN -> 401 Unauthorized during upgrade
ANON_JWT -> 401 Unauthorized during upgrade
```

Verified behavior:

- WebSocket route exists.
- Missing token is rejected.
- Malformed token is rejected.
- Public anon JWT is rejected.

Not verified:

- Positive authenticated user JWT handshake was not verified because no logged-in Supabase user access token was available in this runtime workspace.

UI break risk:

- If valid Supabase user JWTs are also rejected, driver location and live tracking over the Go WebSocket will fail. That still requires a rider/driver session token test.

## 10. `driver.location.update -> driver_location` Broadcast

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

Expected backend broadcast for current frontend compatibility:

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

- No authenticated driver WebSocket could be opened without a valid user JWT.
- No `driver.location.update` event was accepted.
- No `driver_location` broadcast was observed.

Contract mismatch:

- Static frontend compatibility requirement remains:
  - Driver sender emits `driver.location.update`.
  - Rider live tracking consumes `driver_location`.
- The runtime test could not confirm whether the backend translates between the two event shapes.

UI break risk:

- If the backend broadcasts `driver.location.update` unchanged, `LiveTrackingPage` will ignore it.
- Supabase Realtime fallback may mask this during pilot testing.

## Final Runtime Decision

Phase A is still not runtime-ready against the currently running Go backend.

Verified:

- Frontend is reachable.
- Backend process is reachable.
- `/health` works.
- CORS preflight works.
- WebSocket route fails closed for missing, malformed, and anon JWTs.

Not passing:

- Every required Phase A HTTP compatibility endpoint still returns `404 Not Found`.
- Positive authenticated WebSocket behavior could not be tested without a real Supabase user token.
- `driver.location.update -> driver_location` broadcast could not be verified.

Required backend action before Phase A can pass runtime verification:

- Mount or expose `POST /api/rides`.
- Mount or expose `POST /api/rides/{rideId}/offers/{offerId}/accept`.
- Mount or expose `POST /api/drivers/me/presence`.
- Mount or expose `POST /api/drivers/me/location`.
- Mount or expose `POST /api/rides/{rideId}/status`.
- Mount or expose `POST /api/rides/{rideId}/complete`.
- Mount or expose `POST /api/rides/{rideId}/settle`.
- Confirm authenticated WebSocket accepts Supabase user JWT via `?token=`.
- Confirm backend translates inbound `driver.location.update` to outbound `driver_location`.
