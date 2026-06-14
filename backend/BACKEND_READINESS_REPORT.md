# Backend Readiness Report

Date: 2026-06-14

Scope: read-only scan of the Go backend in `cmd/server` and `internal/*`, with special focus on the frontend finance/wallet contract from the migration report. No source files were modified.

## Executive Summary

The backend has a substantial wallet/finance implementation, including JWT auth, admin-only route protection, double-entry ledger primitives, wallet authorizations, provider callbacks, pilot gates, reconciliation reports, and many operational finance reports.

However, it is not contract-ready for the current frontend migration. The frontend expects singular `/api/wallet/*` endpoints and specific `/admin/finance/*` plus `/admin/wallets/*` collection routes. The backend currently exposes mostly plural `/api/wallets/*` routes and older admin/reporting route names. Several expected public wallet actions are absent entirely: transfer, wallet pay, wallet PIN, user lookup, driver summary, driver earnings, deposit list, and singular wallet state/transaction endpoints.

Production readiness is also limited by missing endpoint aliases, a manual deposit SQL defect, broad admin authorization, weak request validation on several finance/admin paths, incomplete idempotency on manual deposit/withdrawal creation, and asynchronous wallet capture after ride completion.

Production readiness score: 58/100.

Verdict: not ready for production frontend cutover without backend adapter endpoints and targeted hardening.

## Verification Performed

- Scanned route registration in `cmd/server/main.go` and all `Register*Routes` functions under `internal/*`.
- Traced wallet/admin handlers through `internal/wallet/admin_http.go`, `admin_flow.go`, `authorization.go`, `repository.go`, `reporting.go`.
- Traced payment provider handlers through `internal/payments/http.go`, `service.go`, `provider.go`.
- Traced ride settlement compatibility route through `internal/rides/handler.go`.
- Ran `go test ./...`.

Test result:

- Initial `go test ./...` was blocked by Windows profile write restrictions for Go build cache and telemetry.
- Rerun with workspace cache and telemetry disabled for the command passed all packages.
- Go still printed a telemetry upload-token warning after the passing run because it attempted to write under the user profile.

Command used for successful package verification:

```powershell
$env:GOCACHE='c:\Users\ntepemanamafm\Desktop\pickme-go-backend\.gocache'; $env:GOTELEMETRY='off'; go test ./...
```

## 1. Implemented Endpoints

Core/system:

- `GET /`
- `GET /health`
- `GET /health/redis`
- `GET /test-db`
- `USE /ws`

Ride endpoints:

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

Driver endpoints:

- `POST /drivers/location`
- `POST /drivers/online`
- `POST /drivers/heartbeat`
- `POST /drivers/offline`
- `GET /drivers/nearby`
- `POST /api/drivers/me/presence`
- `POST /api/drivers/me/location`

Public wallet and wallet operation endpoints:

- `POST /api/wallets/deposits`
- `GET /api/wallets/deposits/:id`
- `GET /api/wallets/me`
- `GET /api/wallets/me/transactions`
- `POST /api/wallets/withdrawals`
- `GET /api/wallets/withdrawals/:id`
- `POST /api/wallets/authorize-ride`
- `POST /api/wallets/capture-ride`
- `POST /api/wallets/release-ride`

Payment provider endpoints:

- `POST /api/payments/onemoney/deposits`
- `POST /api/payments/onemoney/callback`
- `POST /api/payments/ecocash/deposits`
- `POST /api/payments/ecocash/callback`
- `POST /api/payments/innbucks/deposits`
- `POST /api/payments/innbucks/callback`
- `POST /api/payments/paypal/deposits`
- `POST /api/payments/paypal/callback`
- `POST /api/payments/cards/deposits`

Admin wallet operation endpoints:

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
- `GET /admin/wallets/shadow-settlements/summary`
- `GET /admin/wallets/shadow-settlements/recent`
- `GET /admin/wallets/shadow-settlements/failed`
- `GET /admin/wallets/active-settlements/summary`
- `GET /admin/wallets/driver-liabilities`
- `GET /admin/wallets/active-settlements/failed`

Admin finance and governance endpoints:

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
- `GET /admin/finance/release-readiness`
- `GET /admin/finance/release-evidence`
- `GET /admin/finance/release-scorecards`
- `GET /admin/finance/executive-signoff`
- `GET /admin/finance/launch-blockers`
- `GET /admin/finance/internal-launch-status`
- `GET /admin/finance/drill-evidence`
- `GET /admin/finance/exceptions`
- `GET /admin/finance/reliability-scorecards`
- `GET /admin/finance/control-room`
- `GET /admin/finance/daily-close`
- `GET /admin/finance/pilot-monitoring`
- `GET /admin/finance/day1-close`
- `GET /admin/finance/pilot-status`
- `GET /admin/finance/go-no-go`
- `GET /admin/finance/pilot-authorization`
- `GET /admin/finance/pilot-readiness`
- `GET /admin/finance/internal-pilot-board`
- `GET /admin/finance/internal-pilot-authorization`
- `GET /admin/finance/internal-pilot-health`
- `GET /admin/finance/internal-pilot-incidents`
- `GET /admin/finance/internal-pilot-participants`
- `GET /admin/finance/internal-pilot-kill-switches`
- `GET /admin/finance/internal-pilot-readiness`
- `GET /admin/finance/internal-pilot-evidence`
- `GET /admin/finance/internal-pilot-objectives`
- `GET /admin/finance/internal-pilot-summary`
- `GET /admin/finance/internal-pilot-compliance`
- `GET /admin/finance/internal-pilot-board-review`
- `GET /admin/finance/internal-pilot-findings`
- `GET /admin/finance/internal-pilot-readiness-assessment`
- `GET /admin/finance/internal-pilot-board-recommendation`
- `GET /admin/finance/internal-pilot-review-summary`
- `GET /admin/finance/public-wallet-pilot`
- `GET /admin/finance/public-wallet-pilot-participants`
- `GET /admin/finance/public-wallet-pilot-transactions`
- `GET /admin/finance/public-wallet-pilot-reconciliation`
- `GET /admin/finance/public-wallet-pilot-fraud`
- `GET /admin/finance/public-wallet-pilot-evidence`

Admin payment provider reports:

- `GET /admin/payments/onemoney/summary`
- `GET /admin/payments/onemoney/transactions`
- `GET /admin/payments/onemoney/reconciliation`
- `GET /admin/payments/onemoney/failures`
- `GET /admin/payments/ecocash/summary`
- `GET /admin/payments/ecocash/transactions`
- `GET /admin/payments/ecocash/reconciliation`
- `GET /admin/payments/ecocash/failures`
- `GET /admin/payments/innbucks/summary`
- `GET /admin/payments/innbucks/transactions`
- `GET /admin/payments/innbucks/reconciliation`
- `GET /admin/payments/innbucks/failures`
- `GET /admin/payments/paypal/summary`
- `GET /admin/payments/paypal/transactions`
- `GET /admin/payments/paypal/reconciliation`
- `GET /admin/payments/paypal/failures`
- `GET /admin/payments/cards/summary`
- `GET /admin/payments/cards/transactions`
- `GET /admin/payments/cards/reconciliation`
- `GET /admin/payments/cards/failures`

Admin dispatch/reputation endpoints:

- `GET /admin/dispatch/shadow/summary`
- `GET /admin/dispatch/shadow/daily`
- `GET /admin/dispatch/shadow/recent`
- `GET /admin/dispatch/shadow/runs/:id/candidates`
- `GET /admin/dispatch/shadow/outcomes`
- `GET /admin/dispatch/shadow/failures`
- `GET /admin/dispatch/shadow/health`
- `GET /admin/reputation/drivers`
- `GET /admin/reputation/drivers/:driverID`
- `GET /admin/reputation/drivers/:driverID/events`
- `GET /admin/reputation/top-drivers`
- `GET /admin/reputation/low-score-drivers`
- `GET /admin/reputation/health`
- `GET /admin/reputation/distribution`
- `GET /admin/reputation/cohorts`
- `GET /admin/reputation/calibration`
- `GET /admin/reputation/dispatch-analysis`

Pilot dashboard aliases:

- `GET /admin/pilot/cohort`
- `GET /admin/pilot/transactions`
- `GET /admin/pilot/monitoring`
- `GET /admin/pilot/daily-report`

## 2. Missing Endpoints Expected By The Frontend

Expected public wallet endpoints:

- Missing: `GET /api/wallet/me`
- Missing: `GET /api/wallet/transactions`
- Missing: `GET /api/wallet/deposits`
- Missing: `POST /api/wallet/deposit`
- Missing: `POST /api/wallet/withdraw`
- Missing: `POST /api/wallet/transfer`
- Missing: `POST /api/wallet/pay`
- Missing: `POST /api/wallet/pin`
- Missing: `GET /api/wallet/lookup-user`
- Missing: `GET /api/wallet/driver/summary`
- Missing: `GET /api/wallet/driver/earnings`

Closest implemented routes:

- `GET /api/wallets/me`
- `GET /api/wallets/me/transactions`
- `POST /api/wallets/deposits`
- `GET /api/wallets/deposits/:id`
- `POST /api/wallets/withdrawals`
- `GET /api/wallets/withdrawals/:id`

Expected admin finance/wallet endpoints:

- Missing: `GET /admin/finance/wallet-dashboard`
- Missing: `GET /admin/finance/earnings`
- Missing: `GET /admin/finance/ledger`
- Missing: `GET /admin/finance/settlements/summary`
- Missing: `GET /admin/finance/health`
- Missing: `POST /admin/finance/fx-rate`
- Missing: `POST /admin/finance/fraud-flags`
- Missing: `POST /admin/finance/fraud-flags/:id/resolve`
- Missing: `POST /admin/finance/low-balance-reminders`
- Missing: `GET /admin/wallets/deposits`
- Implemented only as pending list: `GET /admin/wallets/deposits/pending`
- Implemented: `POST /admin/wallets/deposits/:id/approve`
- Implemented: `POST /admin/wallets/deposits/:id/reject`
- Missing: `GET /admin/wallets/withdrawals`
- Implemented only as pending list: `GET /admin/wallets/withdrawals/pending`
- Implemented: `POST /admin/wallets/withdrawals/:id/approve`
- Implemented: `POST /admin/wallets/withdrawals/:id/reject`
- Missing: `POST /admin/wallets/users/:userId/lock`
- Missing: `POST /admin/wallets/users/:userId/unlock`
- Missing: `POST /admin/wallets/transactions/:txId/reverse`

Expected settlement endpoints:

- Missing: `GET /api/rides/:tripId/settlement`
- Partially implemented: `POST /api/rides/:rideId/settle`

Important naming mismatch:

- The frontend contract uses `tripId`; backend uses `rideId`.
- The frontend contract uses singular `/api/wallet/*`; backend uses plural `/api/wallets/*`.

## 3. Wallet Endpoints Implemented Vs Missing

Implemented wallet operations:

- Manual deposit creation through `POST /api/wallets/deposits`.
- Deposit detail through `GET /api/wallets/deposits/:id`.
- Wallet state through `GET /api/wallets/me`.
- Wallet transactions through `GET /api/wallets/me/transactions`.
- Withdrawal creation through `POST /api/wallets/withdrawals`.
- Withdrawal detail through `GET /api/wallets/withdrawals/:id`.
- Ride authorization through `POST /api/wallets/authorize-ride`.
- Admin capture/release through `POST /api/wallets/capture-ride` and `POST /api/wallets/release-ride`.
- Provider-specific deposit intents and callbacks under `/api/payments/*`.

Missing from frontend contract:

- Singular wallet route aliases.
- Deposit list endpoint.
- Transfer endpoint.
- Wallet pay endpoint.
- Wallet PIN setup/update endpoint.
- User lookup endpoint.
- Driver wallet summary endpoint.
- Driver earnings endpoint.
- Rider-facing settlement fetch endpoint.

Implementation blockers:

- `CreateDepositRequest` inserts `amount_minor` twice in the SQL column list. This should fail manual deposit creation at runtime against the declared schema, because the intended `amount` column is not named.
- Manual deposit creation does not use `ON CONFLICT` or return an existing idempotent result; retry behavior depends on database uniqueness failure bubbling as a generic conflict.
- Manual withdrawal creation also does not use idempotent insert semantics.

## 4. Admin Endpoints Implemented Vs Missing

Implemented admin strengths:

- Admin approval/rejection exists for deposits and withdrawals.
- Approval paths use atomic repository implementations with `FOR UPDATE` locks and transactional ledger/account/status updates.
- Admin reporting coverage is broad for reconciliation, pilot, hardening, provider statements, disputes, incidents, launch readiness, and control-room operations.
- Admin routes consistently apply `requireAuth` and `middleware.AdminOnly()`.

Missing from frontend contract:

- Dashboard aliases expected by the frontend: wallet dashboard, earnings, ledger, settlement summary, health.
- FX rate mutation endpoint.
- Fraud flag creation and resolution endpoints.
- Low-balance reminder endpoint.
- Generic list endpoints for deposits and withdrawals.
- User wallet lock/unlock endpoints.
- Transaction reversal endpoint.

Compatibility concern:

- The backend has many admin finance reports, but they are not named as the frontend expects. Without adapters, admin pages migrated to Go will fail with 404s even though related data may be available under older route names.

## 5. Authorization Weaknesses

High:

- Admin authorization is role-string based only: `role == "admin"` or `role == "service_role"`. There is no permission model for finance actions, dual approval, maker/checker separation, or scoped roles like finance operator vs support vs auditor.
- Admin action endpoints allow any admin to approve/reject deposits and withdrawals. The code records `admin_user_id`, but does not prevent self-approval, same-user repeated approval, or high-risk amount escalation.
- Payment provider callback endpoints are intentionally unauthenticated and rely on HMAC/provider verification. That is acceptable only if secrets are strong and provider verification remains enforced in production. The current configuration allows static status verification in development and requires remote status verification outside explicit development mode.

Medium:

- `POST /rides/join-room` is registered without `requireAuth`. WebSocket room authorization exists elsewhere, but this HTTP route should be reviewed for room enumeration or side effects.
- Ride wallet capture runs asynchronously after marking the ride complete. If capture fails, the API still returns success and only logs/records a recovery job. That is safer for UX but weak for strict financial completion semantics.
- `GET /test-db` is exposed without auth. It leaks database connectivity state and should not be publicly reachable in production.

Positive controls:

- User wallet state/detail endpoints take user ID from the JWT, not request body.
- Ride create/accept/offer/status flows generally prevent acting as another rider/driver.
- Driver accept/offer paths call driver authorization service.
- Admin denials are logged as structured security events.

## 6. Missing Validation

High:

- No request validation exists for many admin finance object creation endpoints beyond JSON parse. Several handlers bind directly into domain structs and rely on repository/database constraints.
- Admin approval/rejection handlers ignore body parse errors in `adminDecision`; malformed JSON becomes an empty reason rather than `400`.
- Path parameters such as deposit IDs, withdrawal IDs, user IDs, transaction IDs, ride IDs, provider statement IDs, and dispute IDs are generally not validated as UUIDs before use.

Medium:

- `limit` and `days` query parameters are bounded in report handlers, which is good, but there is no filtering validation for many report endpoints because filters are minimal or absent.
- Wallet create-deposit and create-withdrawal validate amount, currency, method, destination reference, and idempotency key, but do not validate city/cohort inputs at the HTTP boundary.
- Ride request validation requires pickup/dropoff text but does not strongly validate fare bounds, coordinates, vehicle type, or payment method enum before inserting.
- Provider callbacks validate signature format, replay window, event/status, amount/currency, provider reference, and remote provider status. This is one of the stronger validation areas.

## 7. Race-Condition Risks

Lower risk areas:

- Deposit approval, withdrawal approval, rejection, wallet authorization, wallet capture, and wallet release use transactions and row-level locks.
- Ride offer acceptance uses a transaction and `FOR UPDATE` on offer and ride rows.
- Financial job leasing uses `FOR UPDATE SKIP LOCKED`.
- Provider callback processing locks payment intents by provider reference and records provider events with uniqueness constraints.

Material risks:

- Manual deposit and withdrawal creation are not idempotent at the service/repository layer. Concurrent retries can produce generic conflicts or duplicate attempts depending on schema state.
- Wallet capture is launched in a goroutine after the ride is completed and response flow continues independently. If the process crashes after ride completion but before capture, settlement may be delayed or missed until recovery jobs/reconciliation catch it.
- Ride request with wallet authorization authorizes funds first, then inserts the ride. It attempts release on insert failure, but the two operations are not in one transaction because wallet and ride writes are separated at handler level.
- Manual provider deposit SQL and schema drift can create runtime failures under load that tests may miss because repository SQL is not integration-tested against a real database here.

## 8. Financial Consistency Risks

High:

- Frontend/backend endpoint mismatch is the largest production risk. Users and admins will call endpoints that do not exist.
- Manual deposit path likely fails because of duplicate `amount_minor` in the insert column list.
- Asynchronous wallet capture means ride completion can be visible before wallet settlement is guaranteed.
- Missing transaction reversal and wallet lock/unlock endpoints leave expected admin controls unimplemented.

Medium:

- Manual deposit/withdrawal creation lacks friendly idempotent retry semantics.
- Admin approvals are single-admin actions despite governance structures elsewhere in the codebase.
- The clearing account can go negative on deposit approval/provider credit. That may be intentional accounting, but production finance should explicitly define and reconcile this behavior.
- Many admin finance operations create records/jobs but do not enforce rich business-state transitions at the HTTP layer.

Positive controls:

- Ledger entries are validated for balanced debits/credits.
- Ledger entries are append-only in the schema via update/delete prevention triggers.
- Wallet authorizations move available funds to pending and capture/release with row locks.
- Withdrawal approval checks driver wallet cached available balance before debit.
- Reconciliation reports compare cached balances, ledger projection, open holds, orphaned authorizations, and settlement mismatches.

## 9. Production Readiness Score

Overall score: 58/100.

Breakdown:

- Route coverage for current frontend contract: 35/100.
- Internal wallet/ledger implementation quality: 78/100.
- Authorization and admin control model: 60/100.
- Validation and input hardening: 58/100.
- Race-condition and idempotency posture: 66/100.
- Financial consistency controls: 70/100.
- Operational observability/reporting: 80/100.
- Test posture from current scan: 75/100.

Readiness gates before frontend cutover:

1. Add adapter routes for the exact frontend contract, especially singular `/api/wallet/*` and expected `/admin/finance/*` endpoints.
2. Fix `CreateDepositRequest` SQL and add an integration test against the wallet schema.
3. Implement missing wallet operations: transfer, pay, PIN, lookup user, driver summary, driver earnings, deposit list.
4. Implement missing admin operations: generic deposit/withdrawal list, FX rate, fraud flags, low-balance reminders, lock/unlock, reversal.
5. Add `GET /api/rides/:tripId/settlement` or align the frontend with the implemented route.
6. Strengthen admin authorization with finance-scoped permissions and maker/checker controls.
7. Make manual deposit/withdrawal creation idempotent and return existing records on retry.
8. Decide whether wallet capture must be synchronous for wallet-paid ride completion, or add a durable outbox before returning success.
9. Remove or protect unauthenticated production diagnostic endpoints such as `/test-db`.

## Final Verdict

The backend is a serious finance foundation, not a stub. It has real ledger discipline, locks, authorization holds, provider callback verification, and a broad admin reporting surface.

It is not yet ready for the frontend contract described in the migration report. The primary blocker is API compatibility, followed by the manual deposit SQL defect and missing public/admin wallet operations. With focused adapter endpoints and a short hardening pass, the backend can likely move from partially ready to pilot-ready quickly.
