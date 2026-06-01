# PickMe Phase A User Flow Verification

Scope: real rider-driver user-flow verification only. No code was modified, no frontend migration was performed, and Phase B was not started.

## Executive Result

Status: BLOCKED.

The live frontend and backend are reachable, and the Phase A compatibility routes now fail closed with `401 Unauthorized` for unauthenticated, invalid, and anon JWT requests. However, the real end-to-end rider-driver flow could not be executed because no actual authenticated PickMe rider and driver sessions were available in this workspace.

Credential/session discovery performed:

- Searched repo for pilot/demo/test rider and driver credentials.
- Checked `.env` and `.env.example`.
- Checked process environment for `PICKME`, `RIDER`, `DRIVER`, `SUPABASE`, and test credential variables.
- Verified the frontend and backend are running.
- Verified protected `/api` routes reject unauthenticated calls.

No valid rider or driver email/password pair, Supabase access token, browser session, or seeded auth fixture was available.

## Environment Runtime Evidence

Frontend:

- `GET http://localhost:8080` returned `200`.
- Served frontend config includes:
  - `VITE_API_URL=http://localhost:3000`
  - `VITE_WS_URL=ws://localhost:3000/ws`

Go backend:

- `GET http://127.0.0.1:3000/health` returned `200`.
- `OPTIONS http://127.0.0.1:3000/api/rides` from `http://localhost:8080` returned `204`.

Auth-gated route behavior:

All required Phase A HTTP routes returned `401 Unauthorized` for:

- No `Authorization` header.
- `Authorization: Bearer invalid.jwt.token`.
- `Authorization: Bearer <Supabase anon publishable JWT>`.

This means the routes are mounted and fail closed, but positive user-session behavior was not verified.

## Classification Summary

| Flow | Status | Reason |
| --- | --- | --- |
| 1. Rider login | BLOCKED | No actual rider credentials or active rider session were available. |
| 2. Driver login | BLOCKED | No actual driver credentials or active driver session were available. |
| 3. Driver online | BLOCKED | Requires authenticated driver JWT and approved driver account. |
| 4. Ride request creation | BLOCKED | Requires authenticated rider JWT. |
| 5. Offer delivery | BLOCKED | Requires rider ride creation plus authenticated driver session. |
| 6. Offer acceptance | BLOCKED | Requires real ride id, offer id, and authenticated rider session. |
| 7. Ride status updates | BLOCKED | Requires accepted ride and authenticated assigned driver session. |
| 8. Driver location updates | BLOCKED | Requires authenticated driver session and active WebSocket. |
| 9. Ride completion | BLOCKED | Requires active in-progress ride and authenticated assigned driver session. |
| 10. Settlement flow | BLOCKED | Requires completed ride and settlement-eligible authenticated session. |

## 1. Rider Login

Status: BLOCKED.

Frontend file involved:

- `src/hooks/useAuth.tsx:87` - `signIn(email, password)`
- `src/pages/Auth.tsx:46` - login form submit path
- `src/components/auth/AuthForm.tsx:154` - modal login submit path

Expected endpoint:

```text
POST https://jidfganntquilvsytslp.supabase.co/auth/v1/token?grant_type=password
```

Expected request:

```json
{
  "email": "<actual rider email>",
  "password": "<actual rider password>"
}
```

Actual request:

```text
Not sent. No actual rider credentials were available.
```

Actual response:

```text
No response. Flow blocked before network execution.
```

Backend handler involved:

- Supabase Auth password grant.

Failure reason:

- A real authenticated rider session is required before any Phase A rider flow can be verified.

## 2. Driver Login

Status: BLOCKED.

Frontend file involved:

- `src/hooks/useAuth.tsx:87` - `signIn(email, password)`
- `src/pages/Auth.tsx:46` - login form submit path
- `src/components/auth/AuthForm.tsx:154` - modal login submit path

Expected endpoint:

```text
POST https://jidfganntquilvsytslp.supabase.co/auth/v1/token?grant_type=password
```

Expected request:

```json
{
  "email": "<actual driver email>",
  "password": "<actual driver password>"
}
```

Actual request:

```text
Not sent. No actual driver credentials were available.
```

Actual response:

```text
No response. Flow blocked before network execution.
```

Backend handler involved:

- Supabase Auth password grant.

Failure reason:

- A real authenticated driver session is required before driver presence, offer delivery, location, trip status, completion, and settlement can be verified.

## 3. Driver Online

Status: BLOCKED.

Frontend file involved:

- `src/pages/DriverDashboard.tsx:288` - `toggleOnline`
- `src/pages/DriverDashboard.tsx:311` - `backendPost("/api/drivers/me/presence", { online })`

Endpoint:

```text
POST http://127.0.0.1:3000/api/drivers/me/presence
```

Expected authenticated request:

```http
POST /api/drivers/me/presence
Authorization: Bearer <driver access_token>
Content-Type: application/json
Origin: http://localhost:8080

{"online":true}
```

Actual unauthenticated control request:

```http
POST /api/drivers/me/presence
Content-Type: application/json
Origin: http://localhost:8080

{"online":true}
```

Actual response:

```text
401 Unauthorized
```

Backend handler involved:

- External Go backend Phase A compatibility handler for `POST /api/drivers/me/presence`.
- Exact Go handler function name is not available in this frontend repository.

Failure reason:

- No authenticated driver JWT was available.

## 4. Ride Request Creation

Status: BLOCKED.

Frontend file involved:

- `src/lib/requestRide.ts:34` - `requestRide`
- `src/lib/requestRide.ts:119` - `backendPost("/api/rides", insertPayload)`
- `src/components/ride/RideView.tsx` - rider request caller
- `src/components/HeroSection.tsx` - alternate rider request caller

Endpoint:

```text
POST http://127.0.0.1:3000/api/rides
```

Expected authenticated request:

```http
POST /api/rides
Authorization: Bearer <rider access_token>
Content-Type: application/json
Origin: http://localhost:8080
```

Expected body shape:

```json
{
  "user_id": "<rider user id>",
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

Actual unauthenticated control request:

```json
{
  "user_id": "00000000-0000-0000-0000-000000000099",
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

Actual response:

```text
401 Unauthorized
```

Backend handler involved:

- External Go backend Phase A compatibility handler for `POST /api/rides`.
- Exact Go handler function name is not available in this frontend repository.

Failure reason:

- No authenticated rider JWT was available.

## 5. Offer Delivery

Status: BLOCKED.

Frontend file involved:

- `src/lib/offerHelpers.ts:115` - `fetchOpenRides`
- `src/pages/DriverDashboard.tsx:550` - `sendOffer`

Endpoint:

```text
No Phase A Go endpoint was exercised for offer delivery.
```

Expected flow:

```text
Rider creates ride -> Go backend writes ride -> Supabase Realtime/open-rides read path exposes request to driver -> driver submits offer.
```

Actual request:

```text
Not sent. Ride creation and driver login were blocked.
```

Actual response:

```text
No response. Flow blocked before offer delivery.
```

Backend handler involved:

- External Go ride creation handler for `POST /api/rides`.
- Existing Supabase Realtime/open ride read path.

Failure reason:

- Requires both an authenticated rider-created ride and an authenticated driver session.

## 6. Offer Acceptance

Status: BLOCKED.

Frontend file involved:

- `src/lib/offerHelpers.ts:194` - `acceptOffer`
- `src/lib/offerHelpers.ts:196` - `backendPost("/api/rides/{rideId}/offers/{offerId}/accept")`
- `src/pages/RideDetail.tsx:283` - local `acceptOffer`
- `src/pages/RideDetail.tsx:287` - direct accept backend call

Endpoint:

```text
POST http://127.0.0.1:3000/api/rides/{rideId}/offers/{offerId}/accept
```

Expected authenticated request:

```http
POST /api/rides/{rideId}/offers/{offerId}/accept
Authorization: Bearer <rider access_token>
Origin: http://localhost:8080
```

Expected body:

```text
empty
```

Actual unauthenticated control request:

```http
POST /api/rides/00000000-0000-0000-0000-000000000001/offers/00000000-0000-0000-0000-000000000002/accept
Origin: http://localhost:8080
```

Actual response:

```text
401 Unauthorized
```

Backend handler involved:

- External Go backend Phase A compatibility handler for `POST /api/rides/{rideId}/offers/{offerId}/accept`.
- Exact Go handler function name is not available in this frontend repository.

Failure reason:

- Requires a real ride, real offer, and authenticated rider JWT.

## 7. Ride Status Updates

Status: BLOCKED.

Frontend file involved:

- `src/pages/DriverDashboard.tsx:579` - `updateTripStatus`
- `src/pages/DriverDashboard.tsx:598` - backend status call
- `src/components/driver/DriverLiveNav.tsx:92` - go/enroute or start status call
- `src/components/driver/DriverLiveNav.tsx:111` - arrived status call
- `src/components/driver/FullScreenNavigation.tsx:398` - `handleStatusUpdate`
- `src/components/driver/FullScreenNavigation.tsx:399` - backend status call

Endpoint:

```text
POST http://127.0.0.1:3000/api/rides/{rideId}/status
```

Expected authenticated request:

```http
POST /api/rides/{rideId}/status
Authorization: Bearer <assigned driver access_token>
Content-Type: application/json
Origin: http://localhost:8080

{"status":"arrived","expectedStatus":"enroute"}
```

Actual unauthenticated control request:

```json
{
  "status": "arrived",
  "expectedStatus": "enroute"
}
```

Actual response:

```text
401 Unauthorized
```

Backend handler involved:

- External Go backend Phase A compatibility handler for `POST /api/rides/{rideId}/status`.
- Exact Go handler function name is not available in this frontend repository.

Failure reason:

- Requires an accepted ride and authenticated assigned driver JWT.

## 8. Driver Location Updates

Status: BLOCKED.

Frontend file involved:

- `src/lib/driverLocation.ts:33` - `updateDriverLocation`
- `src/lib/driverLocation.ts:62` - outbound WebSocket event `driver.location.update`
- `src/lib/driverLocation.ts:69` - HTTP fallback `backendPost("/api/drivers/me/location", { latitude, longitude })`
- `src/pages/LiveTrackingPage.tsx:172` - consumes inbound `driver_location`

WebSocket endpoint:

```text
ws://127.0.0.1:3000/ws?token=<driver access_token>
```

HTTP fallback endpoint:

```text
POST http://127.0.0.1:3000/api/drivers/me/location
```

Expected WebSocket message:

```json
{
  "type": "driver.location.update",
  "latitude": -20.1,
  "longitude": 29.1,
  "timestamp": 1710000000000
}
```

Expected rider broadcast:

```json
{
  "type": "driver_location",
  "driverId": "<driver id>",
  "latitude": -20.1,
  "longitude": 29.1,
  "heading": 90,
  "speed": 12,
  "updated_at": "ISO timestamp"
}
```

Actual WebSocket control responses:

```text
NO_TOKEN -> 401 Unauthorized during upgrade
BAD_TOKEN -> 401 Unauthorized during upgrade
ANON_JWT -> 401 Unauthorized during upgrade
```

Actual HTTP fallback control response:

```text
POST /api/drivers/me/location -> 401 Unauthorized
```

Backend handler involved:

- External Go WebSocket `/ws` auth handler.
- External Go driver location event handler for `driver.location.update`.
- External Go HTTP fallback handler for `POST /api/drivers/me/location`.
- Exact Go handler function names are not available in this frontend repository.

Failure reason:

- Requires authenticated driver WebSocket using a real driver access token.
- Broadcast verification also requires a rider tracking subscriber or capture of backend outbound messages.

## 9. Ride Completion

Status: BLOCKED.

Frontend file involved:

- `src/lib/completeTrip.ts:4` - `completeTrip`
- `src/lib/completeTrip.ts:27` - `backendPost("/api/rides/{tripId}/complete")`
- `src/pages/DriverDashboard.tsx:626` - `handleCompleteTrip`
- `src/components/driver/DriverLiveNav.tsx` - completion caller
- `src/components/driver/FullScreenNavigation.tsx:418` - `handleComplete`

Endpoint:

```text
POST http://127.0.0.1:3000/api/rides/{rideId}/complete
```

Expected authenticated request:

```http
POST /api/rides/{rideId}/complete
Authorization: Bearer <assigned driver access_token>
Origin: http://localhost:8080
```

Expected body:

```text
empty
```

Actual unauthenticated control request:

```http
POST /api/rides/00000000-0000-0000-0000-000000000001/complete
Origin: http://localhost:8080
```

Actual response:

```text
401 Unauthorized
```

Backend handler involved:

- External Go backend Phase A compatibility handler for `POST /api/rides/{rideId}/complete`.
- Exact Go handler function name is not available in this frontend repository.

Failure reason:

- Requires an in-progress ride and authenticated assigned driver JWT.

## 10. Settlement Flow

Status: BLOCKED.

Frontend file involved:

- `src/lib/completeTrip.ts:30` - `settleTrip`
- `src/lib/completeTrip.ts:31` - `backendPost("/api/rides/{tripId}/settle")`
- `src/pages/RideDetail.tsx:50` - `SettlementInfo`
- `src/pages/RideDetail.tsx:68` - `handleSettle`
- `src/pages/RideDetail.tsx:71` - direct settlement backend call

Endpoint:

```text
POST http://127.0.0.1:3000/api/rides/{rideId}/settle
```

Expected authenticated request:

```http
POST /api/rides/{rideId}/settle
Authorization: Bearer <authorized access_token>
Origin: http://localhost:8080
```

Expected body:

```text
empty
```

Actual unauthenticated control request:

```http
POST /api/rides/00000000-0000-0000-0000-000000000001/settle
Origin: http://localhost:8080
```

Actual response:

```text
401 Unauthorized
```

Backend handler involved:

- External Go backend Phase A compatibility handler for `POST /api/rides/{rideId}/settle`.
- Exact Go handler function name is not available in this frontend repository.

Failure reason:

- Requires a completed ride and authorized user/admin/driver session, depending on backend settlement policy.

## Required Inputs To Complete Verification

To finish this verification as a real user-flow test, provide either:

- A valid rider email/password and a valid approved driver email/password for the pilot Supabase project, or
- A current rider Supabase access token and a current approved driver Supabase access token.

The driver account must be approved and eligible to go online. The rider account must be allowed to create cash rides in the pilot environment.

## Final Decision

Phase A route-level auth behavior appears healthy because protected endpoints now return `401` instead of `404`. Real rider-driver flow verification remains BLOCKED until actual authenticated rider and driver sessions are available.
