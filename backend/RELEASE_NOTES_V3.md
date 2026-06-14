# Release Notes V3: Gwanda Pilot Ready Backend

Release date: 2026-06-12

Release tag: `v3-gwanda-pilot-ready`

Commit message: `feat: complete backend hardening and gwanda pilot readiness`

## Executive Summary

This release completes PickMe's backend hardening package for controlled Gwanda pilot readiness. It consolidates driver authorization, admin route protection, driver location privacy, exact minor-unit money handling, wallet pilot runtime enforcement, payment provider callback security, production hardening, and pilot operations documentation.

The backend is ready to hand to the Lovable frontend team for integration against documented Go API contracts, with one important condition: the Lovable frontend source must be audited and contract-tested before public pilot launch.

## Phase 1: Driver Authorization Hardening

Implemented:

- Centralized driver authorization service.
- Driver action checks for location updates, online/offline state, heartbeat, ride acceptance, and offer handling.
- Server-side websocket driver registration decision.
- Driver eligibility checks before driver-only operations.
- Driver authorization test coverage.

Primary files:

- `internal/authz/driver_authorization.go`
- `internal/authz/driver_authorization_test.go`
- `internal/drivers/repository_authorization.go`
- `internal/drivers/handler.go`
- `internal/drivers/handler_test.go`
- `internal/websocket/auth.go`
- `internal/websocket/auth_test.go`

## Phase 2: Admin Route Hardening

Implemented:

- Centralized `AdminOnly()` middleware.
- Structured admin authorization failure logging.
- Admin-only protection for wallet, finance, payment, dispatch, reputation, pilot, reconciliation, and reporting routes.
- Tests proving rider/driver denial and admin allow behavior for sensitive routes.

Primary files:

- `internal/middleware/auth.go`
- `internal/wallet/admin_http.go`
- `internal/wallet/reporting.go`
- `internal/payments/http.go`
- `internal/dispatch/reporting.go`
- `internal/reputation/reporting.go`
- `internal/reputation/calibration_reporting.go`

## Phase 3: Driver Location Privacy

Implemented:

- Driver location updates require authenticated driver identity.
- Driver location writes validate coordinates, impossible movement, and update cadence.
- Ride-room location delivery is scoped to authorized ride participants.
- Redis hot-state location and presence support.
- Location privacy security logging.

Primary files:

- `internal/drivers/handler.go`
- `internal/drivers/types.go`
- `internal/geo/service.go`
- `internal/geo/service_test.go`
- `internal/redis/client.go`
- `internal/redis/health.go`
- `internal/websocket/authorizer.go`

## Phase 4: Exact Money Migration

Implemented:

- Removed monetary `float64` fields and parameters from live Go financial paths.
- Migrated wallet, ride fare, deposit, withdrawal, authorization, capture, settlement, refund, chargeback, dispute, and reconciliation values to `int64` minor units.
- Preserved decimal JSON compatibility at Go-controlled boundaries.
- Added deterministic platform-fee calculation with integer basis-point math.
- Added exact money certification artifact.

Primary files:

- `internal/money/money.go`
- `internal/money/money_test.go`
- `internal/wallet/money.go`
- `internal/wallet/money_test.go`
- `internal/rides/money_json.go`
- `internal/rides/types.go`
- `internal/payments/provider.go`
- `internal/payments/card.go`
- `internal/payments/http.go`
- `internal/wallet/types.go`
- `internal/wallet/settlement.go`
- `internal/wallet/active_settlement.go`
- `internal/wallet/repository.go`
- `EXACT_MONEY_CERTIFICATION.md`

## Phase 5: Wallet Pilot Runtime Enforcement

Implemented:

- Public wallet pilot program model and Gwanda defaults.
- Runtime wallet mutation guard.
- Cohort, city, balance cap, daily cap, monthly cap, and kill-switch enforcement.
- Pilot transaction evidence recording.
- Structured denial logging through `SECURITY_WALLET_PILOT_DENIED`.
- Admin reporting for pilot participants, transactions, reconciliation, fraud, and evidence.

Primary files:

- `internal/wallet/public_wallet_pilot.go`
- `internal/wallet/public_wallet_pilot_test.go`
- `internal/wallet/public_wallet_pilot_enforcement.go`
- `internal/wallet/admin_http.go`
- `internal/wallet/reporting.go`

## Phase 6: Provider Callback Security

Implemented:

- Provider-specific HMAC callback verification for OneMoney, EcoCash, Innbucks, and PayPal.
- Callback event allow-list.
- Replay window validation.
- Duplicate provider event, provider reference, and payload protection.
- Provider status verification adapter support.
- Dead-letter recording for suspicious callbacks.
- Structured callback rejection logging through `SECURITY_PROVIDER_CALLBACK_REJECTED`.
- Provider callback tests for forged, invalid, replayed, duplicate, unsupported, and status-mismatch callbacks.

Primary files:

- `internal/payments/provider.go`
- `internal/payments/service.go`
- `internal/payments/service_test.go`
- `internal/payments/http.go`
- `internal/wallet/repository.go`
- `internal/wallet/financial_jobs.go`

## Production Readiness Hardening

Implemented:

- Global request ID middleware.
- Panic recovery middleware.
- Request timeout middleware and Fiber read/write/idle timeouts.
- Global process-local rate limiting.
- Structured HTTP request logging.
- Websocket write isolation with bounded queues and write deadlines.
- Redis connection pooling.
- Production startup validation for mock card processor and provider status verification.

Primary files:

- `cmd/server/main.go`
- `cmd/server/main_test.go`
- `internal/config/config.go`
- `internal/middleware/production.go`
- `internal/middleware/production_test.go`
- `internal/websocket/manager.go`
- `internal/websocket/handler.go`
- `internal/redis/client.go`

## Gwanda Pilot Readiness

Added operational and management artifacts:

- Gwanda pilot operations report.
- Day 1 launch operations report.
- Incident response playbook.
- Finance reconciliation guide.
- Risk register.
- Executive go/no-go checklist.
- Growth and expansion plan.
- Frontend/backend integration audit.
- Backend capability matrix.

Primary files:

- `GWANDA_PILOT_OPERATIONS_REPORT.md`
- `GWANDA_PILOT_LAUNCH_OPERATIONS_REPORT.md`
- `GWANDA_INCIDENT_RESPONSE_PLAYBOOK.md`
- `GWANDA_FINANCE_RECONCILIATION_GUIDE.md`
- `GWANDA_RISK_REGISTER.md`
- `GWANDA_EXECUTIVE_GO_NO_GO_CHECKLIST.md`
- `GWANDA_GROWTH_AND_EXPANSION_PLAN.md`
- `FRONTEND_BACKEND_INTEGRATION_AUDIT.md`
- `BACKEND_CAPABILITY_MATRIX.md`

## Verification

Commands:

```powershell
$env:GOCACHE='c:\Users\ntepemanamafm\Desktop\pickme-go-backend\.gocache'; go test ./...
$env:GOCACHE='c:\Users\ntepemanamafm\Desktop\pickme-go-backend\.gocache'; go build ./cmd/server
rg -n "TODO|FIXME|HACK|TEMP|WORKAROUND" -S -g "*.go" .
```

Results:

- `go test ./...`: PASS
- `go build ./cmd/server`: PASS
- Placeholder scan in Go source: PASS, no matches

## Known Issues

- Lovable frontend source is not present in this repository, so frontend/backend integration is not yet certified.
- No dedicated ride cancellation endpoint exists.
- `/rides/join-room` is deprecated and should not be used for new frontend work.
- `GET /test-db` is diagnostic and should not be exposed in public production routing.
- Card payments remain disabled for production unless a real processor replaces the development mock.
- Provider withdrawals currently fail closed.
- Rate limiting and websocket registries are process-local; multi-instance scale still requires shared infrastructure or sticky sessions.

## Frontend Integration Requirements

Lovable frontend must integrate against `API_CONTRACTS_V3.md` and verify:

- HTTP auth uses `Authorization: Bearer {supabase_access_token}`.
- Frontend does not directly write Supabase business tables.
- Websocket connects to `/ws` with token and `room=ride_{ride_id}` where needed.
- Frontend listens for canonical websocket events: `ride_offer`, `ride_accepted`, `driver_location`, `ride_started`, `ride_completed`.
- Frontend uses `*_minor` monetary response fields and handles legacy decimal input only where supported.
- Wallet pilot errors are handled: `wallet_pilot_disabled`, `wallet_pilot_limit_exceeded`, `wallet_pilot_not_authorized`.
- Provider callback endpoints are treated as provider-only, never frontend-called.

