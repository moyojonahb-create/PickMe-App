# API Contracts V3

Contract date: 2026-06-12

Scope: Go backend contracts for Lovable frontend integration.

Status legend:

- ACTIVE: Supported for current frontend integration.
- COMPATIBILITY: Supported legacy or adapter route; prefer ACTIVE APIs for new work.
- DEPRECATED: Do not use for new frontend work.
- PROVIDER_ONLY: External provider callback route, not frontend-facing.
- ADMIN_ONLY: Requires admin role.

## Authentication

All protected HTTP APIs require:

```http
Authorization: Bearer {supabase_access_token}
```

Admin routes require:

- Valid Supabase JWT.
- JWT role of `admin` or `service_role`.

## Rider APIs

| Method | Path | Status | Purpose |
| --- | --- | --- | --- |
| `GET` | `/rides` | ACTIVE | List authenticated user's rides; admins see all |
| `POST` | `/api/rides` | ACTIVE | Request ride |
| `POST` | `/api/rides/:rideId/offers/:offerId/accept` | ACTIVE | Rider accepts driver offer |
| `POST` | `/api/rides/:rideId/offers/:offerId/reject` | ACTIVE | Rider rejects driver offer |
| `GET` | `/api/rides/:rideId/offers` | ACTIVE | List ride offers |
| `POST` | `/api/rides/:rideId/status` | ACTIVE | Start accepted ride |
| `POST` | `/api/rides/:rideId/complete` | ACTIVE | Complete ongoing ride |
| `POST` | `/api/rides/:rideId/settle` | COMPATIBILITY | Settle/complete adapter |
| `POST` | `/rides/request` | COMPATIBILITY | Legacy ride request |
| `POST` | `/rides/:id/start` | COMPATIBILITY | Legacy start |
| `POST` | `/rides/:id/complete` | COMPATIBILITY | Legacy complete |
| `POST` | `/rides/join-room` | DEPRECATED | Legacy unauthenticated room helper; use `/ws` |

Ride request body:

```json
{
  "pickup_location": "string",
  "dropoff_location": "string",
  "estimated_fare_minor": 1055,
  "payment_method": "cash",
  "pickup_latitude": -20.93,
  "pickup_longitude": 29.01,
  "city": "Gwanda",
  "vehicle_type": "economy",
  "rider_id": "optional-uuid"
}
```

Money compatibility:

- Preferred: `estimated_fare_minor`.
- Accepted legacy input: `estimated_fare` decimal.
- Responses and events use minor-unit fields.

## Driver APIs

| Method | Path | Status | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/drivers/me/presence` | ACTIVE | Online/offline/heartbeat adapter |
| `POST` | `/api/drivers/me/location` | ACTIVE | Update authenticated driver location |
| `POST` | `/api/rides/:rideId/offers` | ACTIVE | Submit driver offer |
| `POST` | `/rides/:id/accept` | COMPATIBILITY | Legacy direct accept |
| `POST` | `/drivers/online` | COMPATIBILITY | Legacy online |
| `POST` | `/drivers/heartbeat` | COMPATIBILITY | Legacy heartbeat |
| `POST` | `/drivers/offline` | COMPATIBILITY | Legacy offline |
| `POST` | `/drivers/location` | COMPATIBILITY | Legacy location update |
| `GET` | `/drivers/nearby` | ADMIN_ONLY | Nearby driver lookup |

Presence body:

```json
{
  "status": "online|offline|heartbeat",
  "state": "online|offline|heartbeat",
  "action": "online|offline|heartbeat",
  "is_online": true,
  "online": true
}
```

Location body:

```json
{
  "driver_id": "uuid",
  "ride_id": "optional-uuid",
  "latitude": -20.93,
  "longitude": 29.01,
  "speed": 30,
  "heading": 90,
  "city": "Gwanda",
  "vehicle_type": "economy"
}
```

Offer body:

```json
{
  "driver_id": "uuid",
  "amount_minor": 1055,
  "eta_minutes": 5
}
```

Money compatibility:

- Preferred: `amount_minor`, `price_minor`, `offered_fare_minor`, `estimated_fare_minor`.
- Accepted legacy input: `amount`, `price`, `offered_fare`, `estimated_fare`.

## Wallet APIs

| Method | Path | Status | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/wallets/me` | ACTIVE | Wallet state |
| `GET` | `/api/wallets/me/transactions` | ACTIVE | Wallet transaction history |
| `POST` | `/api/wallets/deposits` | ACTIVE | Create manual/admin-flow deposit; pilot rider gated |
| `GET` | `/api/wallets/deposits/:id` | ACTIVE | Deposit detail |
| `POST` | `/api/wallets/withdrawals` | ACTIVE | Create withdrawal request; pilot driver gated |
| `GET` | `/api/wallets/withdrawals/:id` | ACTIVE | Withdrawal detail |
| `POST` | `/api/wallets/authorize-ride` | ACTIVE | Authorize rider wallet funds |
| `POST` | `/api/wallets/capture-ride` | ADMIN_ONLY | Capture ride authorization |
| `POST` | `/api/wallets/release-ride` | ADMIN_ONLY | Release ride authorization |

Deposit body:

```json
{
  "amount_minor": 1055,
  "currency": "USD",
  "method": "manual_ecocash",
  "city": "Gwanda",
  "wallet_account_type": "rider_wallet",
  "idempotency_key": "client-generated-key"
}
```

Authorization body:

```json
{
  "ride_id": "uuid",
  "amount_minor": 1055,
  "currency": "USD",
  "city": "Gwanda",
  "idempotency_key": "client-generated-key"
}
```

Wallet error codes:

- `wallet_pilot_disabled`
- `wallet_pilot_limit_exceeded`
- `wallet_pilot_not_authorized`

## Payment APIs

| Method | Path | Status | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/payments/onemoney/deposits` | ACTIVE | OneMoney deposit intent |
| `POST` | `/api/payments/ecocash/deposits` | ACTIVE | EcoCash deposit intent |
| `POST` | `/api/payments/innbucks/deposits` | ACTIVE | Innbucks deposit intent |
| `POST` | `/api/payments/paypal/deposits` | ACTIVE | PayPal deposit intent |
| `POST` | `/api/payments/cards/deposits` | ACTIVE/CONFIG_GATED | Card deposit; production requires real processor |
| `POST` | `/api/payments/onemoney/callback` | PROVIDER_ONLY | OneMoney callback |
| `POST` | `/api/payments/ecocash/callback` | PROVIDER_ONLY | EcoCash callback |
| `POST` | `/api/payments/innbucks/callback` | PROVIDER_ONLY | Innbucks callback |
| `POST` | `/api/payments/paypal/callback` | PROVIDER_ONLY | PayPal callback |

Deposit body:

```json
{
  "amount_minor": 1055,
  "currency": "USD",
  "city": "Gwanda",
  "idempotency_key": "client-generated-key"
}
```

Money compatibility:

- Preferred: `amount_minor`.
- Accepted legacy input: `amount` decimal.

Frontend rule:

- Never call provider callback endpoints from frontend code.

## Admin APIs

All admin APIs are `ADMIN_ONLY`.

Wallet admin:

- `GET /admin/wallets/deposits/pending`
- `POST /admin/wallets/deposits/:id/approve`
- `POST /admin/wallets/deposits/:id/reject`
- `GET /admin/wallets/withdrawals/pending`
- `POST /admin/wallets/withdrawals/:id/approve`
- `POST /admin/wallets/withdrawals/:id/reject`
- `GET /admin/wallets/admin-actions`
- `GET /admin/wallets/reconciliation/summary`
- `GET /admin/wallets/reconciliation/drift`
- `POST /admin/wallets/reconciliation/run`
- `GET /admin/wallets/authorizations/open`
- `GET /admin/wallets/authorizations/expired`
- `GET /admin/wallets/pilot/summary`
- `GET /admin/wallets/pilot/users`
- `GET /admin/wallets/pilot/failures`
- `GET /admin/wallets/pilot/reconciliation`
- `POST /admin/wallets/pilot/users/:userId/enable`
- `POST /admin/wallets/pilot/users/:userId/disable`
- `POST /admin/wallets/pilot/users/:userId/suspend`
- `POST /admin/wallets/pilot/users/:userId/remove`

Finance admin:

- `GET /admin/finance/hardening/summary`
- `GET /admin/finance/recovery/summary`
- `GET /admin/finance/refunds`
- `POST /admin/finance/refunds`
- `GET /admin/finance/chargebacks`
- `POST /admin/finance/chargebacks`
- `GET /admin/finance/disputes`
- `POST /admin/finance/disputes`
- `POST /admin/finance/disputes/:id/status`
- `GET /admin/finance/incidents`
- `POST /admin/finance/incidents`
- `GET /admin/finance/provider-statements`
- `GET /admin/finance/provider-statements/lines`
- `POST /admin/finance/provider-statements/import`
- `POST /admin/finance/provider-statements/:id/reconcile`
- `GET /admin/finance/runbooks`
- `GET /admin/finance/reliability/summary`
- `GET /admin/finance/certifications`
- `GET /admin/finance/certifications/checks`
- `POST /admin/finance/certifications/:provider/start`
- `GET /admin/finance/recovery-drills`
- `GET /admin/finance/recovery-drills/events`
- `POST /admin/finance/recovery-drills`
- `GET /admin/finance/recovery-scorecards`
- `POST /admin/finance/recovery-scorecards`
- `GET /admin/finance/governance/summary`
- `GET /admin/finance/approvals`
- `POST /admin/finance/approvals`
- `POST /admin/finance/approvals/:id/decision`
- `GET /admin/finance/launch-gates`
- `POST /admin/finance/launch-gates`
- `POST /admin/finance/launch-gates/:id/evaluate`
- `GET /admin/finance/close-runs`
- `POST /admin/finance/close-runs`
- `GET /admin/finance/signoffs`
- `POST /admin/finance/signoffs`
- `GET /admin/finance/launch-readiness-scorecards`
- `POST /admin/finance/launch-readiness-scorecards`

Pilot/report aliases:

- `GET /admin/pilot/cohort`
- `GET /admin/pilot/transactions`
- `GET /admin/pilot/monitoring`
- `GET /admin/pilot/daily-report`

## Reporting APIs

Admin-only reporting groups:

- `/admin/payments/{onemoney|ecocash|innbucks|paypal|cards}/{summary|transactions|reconciliation|failures}`
- `/admin/dispatch/shadow/{summary|daily|recent|outcomes|failures|health}`
- `/admin/dispatch/shadow/runs/:id/candidates`
- `/admin/reputation/drivers`
- `/admin/reputation/drivers/:driverID`
- `/admin/reputation/drivers/:driverID/events`
- `/admin/reputation/top-drivers`
- `/admin/reputation/low-score-drivers`
- `/admin/reputation/{health|distribution|cohorts|calibration|dispatch-analysis}`
- `/admin/wallets/shadow-settlements/{summary|recent|failed}`
- `/admin/wallets/active-settlements/{summary|failed}`
- `/admin/wallets/driver-liabilities`
- `/admin/finance/public-wallet-pilot*`
- `/admin/finance/internal-pilot*`
- `/admin/finance/release-*`
- `/admin/finance/control-room`
- `/admin/finance/daily-close`
- `/admin/finance/pilot-monitoring`
- `/admin/finance/day1-close`
- `/admin/finance/pilot-status`
- `/admin/finance/go-no-go`

## WebSocket Contract

Endpoint:

```text
/ws
```

Auth options:

```text
Authorization: Bearer {supabase_access_token}
/ws?access_token={supabase_access_token}
/ws?token={supabase_access_token}
```

Ride room:

```text
/ws?access_token={token}&room=ride_{ride_id}
```

Canonical events:

| Event | Status | Notes |
| --- | --- | --- |
| `ride_offer` | ACTIVE | Sent to registered drivers; includes `estimated_fare_minor` |
| `ride_accepted` | ACTIVE | Sent to rider; offer path includes `offer_id` |
| `driver_location` | ACTIVE | Sent to ride room when `ride_id` present |
| `ride_started` | ACTIVE | Sent to room plus participant fallback sockets |
| `ride_completed` | ACTIVE | Sent to room plus participant fallback sockets |
| `SERVER RECEIVED: ...` | DEPRECATED | Legacy plain-text echo; ignore in frontend |

Missing/broken event:

- `driver.location.update` is not emitted by backend.

## Deprecated Contracts

- `POST /rides/join-room`
- `SERVER RECEIVED: ...` websocket echo
- Frontend usage of decimal monetary response fields
- Frontend calls to provider callback endpoints

## Frontend Integration Rules

- Use Go APIs for business actions.
- Do not write directly to Supabase business tables from Lovable.
- Do not expose service-role keys in browser code.
- Use `*_minor` monetary fields for displayed backend responses.
- Treat provider callbacks as backend/provider traffic only.
- Handle pilot denial errors explicitly.
- Use canonical websocket event names exactly as listed.

