# Frontend Backend Integration Audit

Audit date: 2026-06-12

Scope:

- Lovable React/TypeScript frontend alignment with Go backend
- Supabase client usage
- API route contracts
- Websocket contracts
- Wallet, payments, ride, driver, and admin flows

## Executive Summary

Integration readiness cannot be certified from this repository alone because the Lovable React/TypeScript frontend source is not present in the workspace.

The backend builds and tests successfully, and its route surface is broad enough to support rider, driver, wallet, payments, and admin flows. However, without the frontend source, the audit cannot verify actual `fetch`, `axios`, Supabase client usage, websocket connection code, request DTOs, response DTOs, enums, or screen-level assumptions.

This is a launch blocker for any public pilot that depends on the Lovable frontend.

## Verification Results

Commands run:

```powershell
go test ./...
go build ./cmd/server
npm run build
npm run
```

Results:

- `go test ./...`: PASS
- `go build ./cmd/server`: PASS
- `npm run build`: FAIL, no `build` script exists in `package.json`
- `npm run`: no scripts listed

Frontend source scan:

- No `.tsx`, `.ts`, `.jsx`, `.js`, `src`, `app`, `pages`, `components`, or frontend Supabase client files were found.
- `package.json` contains only `socket.io-client` as a dependency.

## Integration Scores

| Area | Score | Reason |
| --- | ---: | --- |
| Backend contract readiness | 85/100 | Backend route, wallet, payments, and websocket contracts exist and tests pass |
| Frontend auditability | 0/100 | Lovable frontend source is absent |
| Frontend/backend alignment | 35/100 | Backend is available, but actual frontend usage cannot be verified |
| Final integration readiness | 40/100 | Launch-significant integration evidence is missing |

## Authentication Audit

Backend behavior:

- Go validates Supabase JWTs server-side.
- Required HTTP auth format: `Authorization: Bearer {supabase_access_token}`.
- JWT checks include HS256 signature, expiry, not-before, audience, issuer, and subject.
- Role handling uses the JWT `role` claim.
- Admin authorization accepts `admin` and `service_role`.

Frontend verification status:

- Login, signup, session refresh, token storage, and token attachment cannot be verified because frontend source is absent.
- Supabase client key usage cannot be verified.
- It cannot be confirmed whether the frontend uses safe public keys only.
- It cannot be confirmed whether role handling relies on safe app metadata or unsafe user-editable metadata.

Risk:

- Launch blocker until the frontend code proves it attaches valid Supabase access tokens to Go API calls and does not bypass Go with direct privileged Supabase writes.

## Rider Flow Audit

Backend endpoints:

- `GET /rides`
- `POST /rides/request`
- `POST /rides/:id/accept`
- `POST /rides/:id/start`
- `POST /rides/:id/complete`
- `POST /rides/join-room`
- `POST /api/rides`
- `POST /api/rides/:rideId/offers`
- `GET /api/rides/:rideId/offers`
- `POST /api/rides/:rideId/offers/:offerId/accept`
- `POST /api/rides/:rideId/offers/:offerId/reject`
- `POST /api/rides/:rideId/status`
- `POST /api/rides/:rideId/complete`
- `POST /api/rides/:rideId/settle`

Backend rider request body:

```json
{
  "rider_id": "uuid",
  "pickup_location": "string",
  "dropoff_location": "string",
  "estimated_fare_minor": 1055,
  "payment_method": "cash",
  "pickup_latitude": -20.93,
  "pickup_longitude": 29.01,
  "city": "Gwanda",
  "vehicle_type": "economy"
}
```

Compatibility:

- Backend still accepts legacy decimal `estimated_fare` at the JSON boundary and converts to minor units.
- Backend emits minor-unit monetary fields.

Frontend verification status:

- Ride request, ride history, cancellation UI, status updates, and completion flows cannot be verified.

Potential mismatch:

- Frontend may still expect `estimated_fare` in responses or websocket payloads. Backend live structs now use `estimated_fare_minor`.
- No dedicated rider cancellation endpoint was found in active routes.

## Driver Flow Audit

Backend endpoints:

- `POST /drivers/location`
- `POST /drivers/online`
- `POST /drivers/heartbeat`
- `POST /drivers/offline`
- `GET /drivers/nearby` admin-only
- `POST /api/drivers/me/presence`
- `POST /api/drivers/me/location`

Presence compatibility:

- `status`, `state`, `action`, `is_online`, and `online` are accepted.
- Offline is recognized through `offline` or boolean false.
- Heartbeat is recognized through `heartbeat`.
- Otherwise the driver is marked online.

Location body:

```json
{
  "driver_id": "uuid",
  "ride_id": "uuid",
  "latitude": -20.93,
  "longitude": 29.01,
  "speed": 30,
  "heading": 90,
  "city": "Gwanda",
  "vehicle_type": "economy"
}
```

Frontend verification status:

- Driver online/offline, location update cadence, offer reception, offer acceptance, and lifecycle screens cannot be verified.

Potential mismatch:

- If Lovable sends driver presence without coordinates, backend `Online` may reject or fail depending on handler path. The compatibility endpoint defaults to `Online` unless explicit heartbeat/offline is sent.

## Wallet Flow Audit

Backend endpoints:

- `GET /api/wallets/me`
- `GET /api/wallets/me/transactions`
- `POST /api/wallets/deposits`
- `GET /api/wallets/deposits/:id`
- `POST /api/wallets/withdrawals`
- `GET /api/wallets/withdrawals/:id`
- `POST /api/wallets/authorize-ride`
- `POST /api/wallets/capture-ride` admin-only
- `POST /api/wallets/release-ride` admin-only

Wallet money contract:

- Preferred field: `amount_minor`.
- Legacy decimal field `amount` is accepted at Go HTTP boundaries where implemented.
- Internal calculations use int64 minor units.

Pilot restrictions:

- Wallet deposits require rider pilot eligibility.
- Wallet withdrawals require driver pilot eligibility.
- Ride authorization requires rider pilot eligibility.

Frontend verification status:

- Balance screen, transaction history, deposit forms, wallet payment flow, and pilot-denial handling cannot be verified.

Potential mismatch:

- Frontend may send decimal `amount`; backend supports this at current HTTP boundaries.
- Frontend may expect decimal `amount` back; backend responses are now minor-unit oriented.
- Frontend may not handle pilot errors such as `wallet_pilot_disabled`, `wallet_pilot_limit_exceeded`, or `wallet_pilot_not_authorized`.

## Payments Audit

Backend deposit endpoints:

- `POST /api/payments/onemoney/deposits`
- `POST /api/payments/ecocash/deposits`
- `POST /api/payments/innbucks/deposits`
- `POST /api/payments/paypal/deposits`
- `POST /api/payments/cards/deposits`

Provider callback endpoints:

- `POST /api/payments/onemoney/callback`
- `POST /api/payments/ecocash/callback`
- `POST /api/payments/innbucks/callback`
- `POST /api/payments/paypal/callback`

Important contract:

- Callback endpoints are provider-to-backend only.
- Frontend must not call provider callback endpoints.
- Callback requires signed provider payloads and provider status verification.

Deposit request body:

```json
{
  "amount_minor": 1055,
  "currency": "USD",
  "city": "Gwanda",
  "idempotency_key": "client-generated-key"
}
```

Compatibility:

- Legacy decimal `amount` is accepted and converted to minor units.

Frontend verification status:

- Deposit creation screens and provider reference handling cannot be verified.

Potential mismatch:

- If frontend assumes deposit completion happens immediately after intent creation, it will be wrong for provider flows that require callback completion.
- If frontend calls callback endpoints directly, those calls should fail and must be removed.

## Admin Audit

Backend admin routes:

- Wallet reports and operations under `/admin/wallets/*`.
- Finance reports and recovery under `/admin/finance/*`.
- Payment reporting under `/admin/payments/*`.
- Dispatch reporting under `/admin/dispatch/*`.
- Reputation reporting under `/admin/reputation/*`.
- Pilot reporting aliases under `/admin/pilot/*`.

Authorization:

- Admin routes require Supabase JWT auth plus Go `AdminOnly()`.
- Roles accepted: `admin` and `service_role`.

Frontend verification status:

- Admin dashboards, route guards, role checks, and error handling cannot be verified.

Risk:

- Any admin frontend using direct Supabase table access instead of Go admin APIs would violate the architecture requirement.

## Websocket Audit

Backend connection:

- Endpoint: `/ws`
- Auth methods:
  - `Authorization: Bearer {supabase_access_token}`
  - `/ws?access_token={supabase_access_token}`
  - `/ws?token={supabase_access_token}`
- Ride room:
  - `/ws?access_token={token}&room=ride_{ride_id}`

Backend authorization:

- Room membership is checked server-side.
- Client-supplied role is not trusted.
- Driver registration is decided by Go driver authorization.

Canonical events:

- `ride_offer`
- `ride_accepted`
- `driver_location`
- `ride_started`
- `ride_completed`

Payload money contract:

- Ride offer payload uses `estimated_fare_minor`, not `estimated_fare`.

Frontend verification status:

- No websocket client implementation exists in this workspace.

Potential mismatch:

- `package.json` contains `socket.io-client`, but backend documentation describes a `/ws` websocket endpoint. If the Lovable app uses Socket.IO protocol instead of the backend's expected websocket transport, realtime will fail.
- Any frontend listening for `driver.location.update` will not receive backend location events. Backend emits `driver_location`.
- Legacy backend echo messages are plain text `SERVER RECEIVED: ...`; frontend should ignore them.

## Broken Integrations

Confirmed:

- Frontend build is broken/unavailable in this workspace because no frontend build script exists.
- Lovable frontend source is absent, so integration cannot be certified.

Likely or unverified:

- Possible Socket.IO client versus backend websocket transport mismatch.
- Possible `estimated_fare` versus `estimated_fare_minor` response/event mismatch.
- Possible direct Supabase writes from frontend cannot be ruled out.
- Possible frontend role handling mismatch cannot be ruled out.
- Possible wallet pilot error handling missing in frontend cannot be ruled out.

## Contract Mismatches

Confirmed from backend documentation/code:

- Older websocket contract documentation still shows `estimated_fare` in examples, while current code emits `estimated_fare_minor`.
- Backend emits `driver_location`; no backend producer exists for `driver.location.update`.

Unverified against frontend:

- Request body field names.
- Response body field names.
- Status enum handling.
- Payment intent lifecycle handling.
- Admin dashboard DTOs.
- Supabase session refresh behavior.

## Missing Endpoints

From backend route inventory:

- No dedicated ride cancellation endpoint was found.
- No public endpoint for rider-visible support tickets was found.
- No public endpoint for referral/growth features was found, but those are not required for technical pilot launch.

## Unused Backend Endpoints

Cannot be determined without frontend source.

High-risk unused surfaces to verify in frontend:

- `/api/wallets/*`
- `/api/payments/*/deposits`
- `/api/rides/:rideId/offers`
- `/api/drivers/me/presence`
- `/admin/finance/*`
- `/admin/wallets/*`
- `/admin/pilot/*`

## Frontend Features That Might Bypass Go

Cannot be verified because frontend source is absent.

Must explicitly check in Lovable:

- No direct Supabase inserts/updates/deletes to rides.
- No direct Supabase inserts/updates/deletes to wallet tables.
- No direct Supabase writes to driver locations.
- No direct Supabase writes to provider events or payment intents.
- No direct Supabase reads of admin finance tables from non-admin clients.
- No use of service-role keys in browser code.

## Launch Blockers

1. Lovable frontend source is not present in the audited workspace.
2. Frontend build cannot be run because `package.json` has no build script.
3. Supabase client usage cannot be audited.
4. Actual API call payloads cannot be compared against Go DTOs.
5. Actual websocket connection code cannot be verified.
6. Actual wallet, payment, rider, driver, and admin screens cannot be contract-tested.

## Final Determination

Frontend/backend integration is not launch-certified.

Backend readiness remains strong, but public pilot launch should not proceed until the Lovable frontend repository is added to the audit scope or provided separately, then built and contract-tested against the Go backend.

Final integration readiness score: 40/100.

