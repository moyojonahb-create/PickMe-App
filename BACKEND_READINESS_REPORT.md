# Backend Readiness Report

Date: 2026-06-14

Scope: Local repository backend scan from the perspective of a senior Go backend architect. This audit inspected checked-in backend code, Supabase Edge Functions, SQL migrations/RPCs, and frontend callers that now expect a Go HTTP API. No files were modified except this report.

## Executive Summary

No Go backend implementation is present in this repository. There are no `*.go`, `go.mod`, or `go.sum` files in the workspace. The checked-in backend consists of Supabase Edge Functions and PostgreSQL migrations/RPCs.

The frontend now expects a Go REST API through `VITE_GO_BACKEND_URL` / `VITE_API_BASE_URL` / `VITE_BACKEND_URL`, but the REST endpoints expected by `src/lib/goBackendClient.ts`, `src/lib/walletApi.ts`, `src/lib/requestRide.ts`, `src/lib/offerHelpers.ts`, and related screens are not implemented in this repo.

Current backend readiness for the new frontend contract is therefore low: the database has many legacy finance primitives, but the Go HTTP boundary is missing.

## 1. Implemented Endpoints

### Implemented Supabase Edge Functions

These are deployed as Supabase function names, not Go REST paths:

- `add-driver`
- `admin-api`
- `agora-token`
- `delete-account`
- `dispatch-scheduled`
- `google-maps-key`
- `google-places-search`
- `google-routes`
- `import-osm-places`
- `nominatim-search`
- `push-config`
- `ramz-code-scan`
- `ramz-generate-patch`
- `send-notification`
- `settle-trip`
- `sms-invite`
- `twilio-otp`
- `verify-student`
- `wallet-pin`

### Implemented Admin Action Endpoint

`supabase/functions/admin-api/index.ts` implements a single action-style endpoint:

- `admin-api?action=verify_admin`
- `admin-api?action=get_metrics`
- `admin-api?action=approve_driver`
- `admin-api?action=suspend_driver`
- `admin-api?action=ban_driver`
- `admin-api?action=force_driver_offline`
- `admin-api?action=approve_document`
- `admin-api?action=reject_document`
- `admin-api?action=cancel_trip`
- `admin-api?action=send_notification`
- `admin-api?action=broadcast_notification`
- `admin-api?action=create_landmark`
- `admin-api?action=update_landmark`
- `admin-api?action=delete_landmark`
- `admin-api?action=get_system_events`

This is not compatible with the frontend’s new `/admin/...` Go REST routes.

### Implemented Finance/Wallet RPCs

The migrations define legacy PostgreSQL RPCs, including:

- `request_wallet_ride(jsonb)`
- `pay_ride_from_wallet(uuid)`
- `transfer_funds(uuid, numeric, text)`
- `request_withdrawal(numeric, text, text, text)`
- `admin_approve_withdrawal(uuid, text)`
- `admin_reject_withdrawal(uuid, text)`
- `admin_approve_deposit(uuid, text)`
- `admin_approve_rider_deposit(uuid, text)`
- `admin_lock_wallet(uuid, text)`
- `admin_unlock_wallet(uuid)`
- `admin_reverse_transaction(uuid, text)`
- `admin_set_fx_rate(numeric)`
- `admin_flag_user(uuid, text, text)`
- `admin_resolve_fraud_flag(uuid)`
- `complete_trip_with_commission(uuid)`
- `lookup_user_by_pickme_account(text)`

The frontend migration intentionally removed these from active wallet/finance flows, so they do not satisfy the new REST contract by themselves.

### Implemented Settlement Edge Function

- `settle-trip`

This accepts a JSON body with `tripId`, validates the caller as rider or driver, and inserts into `platform_ledger`. The frontend now expects `/api/rides/:tripId/settle`, not the Supabase function.

## 2. Missing Endpoints Expected By The Frontend

No checked-in backend implements these Go REST routes:

### Ride and Dispatch

- `POST /api/rides`
- `PATCH /api/rides/:rideId`
- `POST /api/rides/:rideId/status`
- `POST /api/rides/:rideId/complete`
- `GET /api/rides/:tripId/settlement`
- `POST /api/rides/:tripId/settle`
- `POST /api/rides/:rideId/offers`
- `POST /api/rides/:rideId/offers/:offerId/accept`
- `POST /api/rides/:rideId/offers/:offerId/reject`
- `POST /api/rides/offers/:offerId/reject`
- `POST /api/drivers/me/presence`
- `POST /api/drivers/me/location`

### Wallet and Finance

- `GET /api/wallet/me`
- `GET /api/wallet/transactions`
- `GET /api/wallet/deposits`
- `POST /api/wallet/deposit`
- `POST /api/wallet/withdraw`
- `POST /api/wallet/transfer`
- `POST /api/wallet/pay`
- `POST /api/wallet/pin`
- `GET /api/wallet/lookup-user`
- `GET /api/wallet/driver/summary`
- `GET /api/wallet/driver/earnings`

The frontend also tries plural fallback aliases:

- `GET /api/wallets/me`
- `GET /api/wallets/me/transactions`
- `GET /api/wallets/deposits`
- `POST /api/wallets/deposits`
- `POST /api/wallets/withdrawals`
- `POST /api/wallets/transfer`
- `POST /api/wallets/pay`
- `GET /api/wallets/lookup-user`
- `GET /api/wallets/driver/summary`
- `GET /api/wallets/driver/earnings`
- `POST /api/wallets/pin`

### Admin

- `GET /admin/finance/wallet-dashboard`
- `GET /admin/finance/earnings`
- `GET /admin/finance/ledger`
- `GET /admin/finance/settlements/summary`
- `GET /admin/finance/health`
- `POST /admin/finance/fx-rate`
- `POST /admin/finance/fraud-flags`
- `POST /admin/finance/fraud-flags/:id/resolve`
- `POST /admin/finance/low-balance-reminders`
- `GET /admin/wallets/deposits`
- `POST /admin/wallets/deposits/:id/approve`
- `POST /admin/wallets/deposits/:id/reject`
- `GET /admin/wallets/withdrawals`
- `POST /admin/wallets/withdrawals/:id/approve`
- `POST /admin/wallets/withdrawals/:id/reject`
- `POST /admin/wallets/users/:userId/lock`
- `POST /admin/wallets/users/:userId/unlock`
- `POST /admin/wallets/transactions/:txId/reverse`

## 3. Wallet Endpoints Implemented Vs Missing

### Implemented

Only legacy/non-Go wallet surfaces are implemented locally:

- `wallet-pin` Supabase Edge Function with `check`, `set`, and `verify` actions.
- PostgreSQL wallet RPCs for pay, transfer, withdrawal request, admin approval/rejection, lock/unlock, reversal, and wallet ride creation.
- Wallet tables and RLS hardening migrations exist.

### Missing For Current Frontend Contract

All current Go wallet REST endpoints are missing from this repo:

- `GET /api/wallet/me`
- `GET /api/wallet/transactions`
- `GET /api/wallet/deposits`
- `POST /api/wallet/deposit`
- `POST /api/wallet/withdraw`
- `POST /api/wallet/transfer`
- `POST /api/wallet/pay`
- `POST /api/wallet/pin`
- `GET /api/wallet/lookup-user`
- `GET /api/wallet/driver/summary`
- `GET /api/wallet/driver/earnings`

## 4. Admin Endpoints Implemented Vs Missing

### Implemented

`admin-api` implements action-query admin operations after checking `user_roles.role = admin`.

Legacy admin RPCs exist:

- Deposit approval.
- Rider deposit approval.
- Withdrawal approval/rejection.
- Wallet lock/unlock.
- Transaction reversal.
- FX rate setting.
- Fraud flag creation/resolution.

### Missing For Current Frontend Contract

All current Go admin finance REST endpoints are missing locally:

- `GET /admin/finance/wallet-dashboard`
- `GET /admin/finance/earnings`
- `GET /admin/finance/ledger`
- `GET /admin/finance/settlements/summary`
- `GET /admin/finance/health`
- `POST /admin/finance/fx-rate`
- `POST /admin/finance/fraud-flags`
- `POST /admin/finance/fraud-flags/:id/resolve`
- `POST /admin/finance/low-balance-reminders`
- `GET /admin/wallets/deposits`
- `POST /admin/wallets/deposits/:id/approve`
- `POST /admin/wallets/deposits/:id/reject`
- `GET /admin/wallets/withdrawals`
- `POST /admin/wallets/withdrawals/:id/approve`
- `POST /admin/wallets/withdrawals/:id/reject`
- `POST /admin/wallets/users/:userId/lock`
- `POST /admin/wallets/users/:userId/unlock`
- `POST /admin/wallets/transactions/:txId/reverse`

## 5. Authorization Weaknesses

Critical:

- No Go REST auth middleware exists in the repo because the Go backend is absent. There is no evidence of JWT verification, admin middleware, route ownership checks, or service-role isolation for the expected Go routes.
- Several Supabase functions have `verify_jwt = false` in `supabase/config.toml`. Some perform their own JWT checks, but the runtime setting removes platform-level verification.

High:

- `twilio-otp` has `verify_jwt = false` and no authenticated-user requirement. It rate-limits by phone number only, so attackers can still create SMS cost exposure across many numbers.
- `sms-invite` has no authentication check in the function body. It can send Twilio SMS using server credentials if callable.
- `send-notification` allows any authenticated user to pass arbitrary `targetUserId` for several notification types. It does not verify that the caller is related to the ride or allowed to notify that user.
- `settle-trip` lets either rider or driver settle a completed ride. That may be acceptable, but it uses service role after validating caller relationship and does not require admin/backend-only execution for ledger insertion.

Medium:

- `admin-api` is action-based and uses service role. It checks admin role, but input validation is light and many actions trust IDs and freeform payloads.
- Admin role checks are split across `user_roles` and `has_role()`. The report did not find a single Go middleware enforcing consistent admin authorization because no Go service is present.
- Some frontend admin/system-health actions still call Supabase tables/RPCs directly, so backend authorization depends heavily on RLS and RPC grants rather than a single audited server boundary.

## 6. Missing Validation

Missing Go-layer validation:

- No checked-in Go handlers validate route params, request bodies, idempotency keys, money precision, enum values, or ownership for the expected REST routes.

Observed weak validation in existing backend surfaces:

- `request_wallet_ride(jsonb)` casts JSON fields directly to numeric, double precision, int, and timestamptz. Invalid JSON values can raise exceptions instead of controlled 400-style responses.
- `request_wallet_ride(jsonb)` validates fare and balance but does not strictly validate coordinate ranges, distance bounds, duration bounds, vehicle type, passenger count upper bounds, town validity, or schedule windows.
- `transfer_funds` does not validate receiver existence independently; non-driver receivers can cause wallet creation for any UUID.
- `admin_reverse_transaction` does not require a non-empty reason and does not lock the original transaction row before checking prior reversal state.
- `admin_lock_wallet` and `admin_unlock_wallet` return success even if no wallet row was affected.
- `admin-api` accepts broad `updateData` for landmarks and freeform notification bodies with little schema validation.
- `twilio-otp` validates phone length but not E.164 format; verification is not bound to a signed-in user.
- `wallet-pin` validates PIN format but uses in-memory rate limiting, which is not durable across cold starts or multiple function instances.

## 7. Race-Condition Risks

High:

- `request_wallet_ride(jsonb)` checks wallet balance without `FOR UPDATE` and does not reserve/hold funds. Multiple wallet ride requests can pass the balance check concurrently because no debit or authorization hold is taken at request time.
- `transfer_funds` duplicate detection is a `COUNT` query over the last 60 seconds with no unique constraint or idempotency key. Two identical concurrent transfers can both pass the duplicate check before either inserts.
- `admin_reverse_transaction` checks for an existing reversal using a description pattern, not a constrained `reversed_transaction_id`. Concurrent reversal requests can both pass the check and double-credit.
- `complete_trip_with_commission(uuid)` can be retried after partial external orchestration; there is no unique constraint on `admin_earnings.ride_id` in the scanned migrations, so duplicate earnings rows are possible if completion logic is re-entered through multiple code paths.

Medium:

- `wallet-pin` rate limiting is per function instance memory. Distributed invocations can bypass attempt limits.
- `twilio-otp` increments attempts in a separate update after reading the current record. Parallel verification attempts may race.
- Driver presence/location endpoints expected by the frontend are absent, so any external implementation must prevent stale writes, out-of-order GPS updates, and unauthorized presence toggles.

Lower:

- `settle-trip` benefits from `platform_ledger.trip_id UNIQUE`, so duplicate ledger inserts are handled. However, it still depends on catching a duplicate insert rather than using an explicit idempotent upsert.

## 8. Financial Consistency Risks

Critical:

- The current frontend expects Go finance endpoints, but no Go finance service is present. In production, wallet UI actions will fail unless an external backend exists and matches these contracts exactly.
- The system is split between new REST expectations and legacy Supabase RPC/database finance logic. Without a single source of truth, the same operation can drift between direct RPC, Edge Function, and Go implementation behavior.

High:

- `request_wallet_ride` validates balance but does not place a hold. A rider can request several wallet rides using the same apparent balance.
- `pay_ride_from_wallet` credits the driver and inserts `admin_earnings`; `complete_trip_with_commission` also contains wallet auto-credit logic. Although it tries to avoid double credit when `wallet_paid` is true, duplicated or out-of-order payment/completion paths remain risky without a transaction-ledger invariant.
- `admin_earnings` appears to lack a unique `ride_id` constraint. Repeated completion or manual correction can duplicate revenue/earnings rows.
- `admin_reverse_transaction` updates wallet balance directly based on any wallet transaction amount. Reversing a positive deposit creates a debit; reversing a negative payment creates a credit. That is expected, but without transaction type rules, reason requirements, row locks, and immutable reversal linkage, financial controls are weak.
- `settle-trip` writes `currency: "ZAR"` even though later migrations changed platform ledger default rows to USD and wallet code generally uses USD. This is a currency consistency problem.
- Deposit approval RPCs credit wallets based on pending deposit rows, but external proof/reference validation is not enforced at the DB function level.

Medium:

- Money values use `numeric` and frontend adapters send both decimal and minor-unit fields. The Go service must choose one canonical representation and reject ambiguous or mismatched amounts.
- Wallet and driver wallet balances are maintained as mutable balances plus transaction tables. There is no scanned reconciliation job that proves balance equals ledger sum.
- Withdrawal approval marks status approved but does not integrate with a payout provider or payout reference state machine.

## 9. Production Readiness Score

Score: 38 / 100

Rationale:

- Go REST backend implementation: 0 / 25. No Go service or route handlers are present in this repo.
- Contract coverage: 5 / 20. Frontend contracts are well identified, but the local backend does not implement them.
- Authorization: 10 / 20. Supabase admin/RPC checks exist, but expected Go middleware is absent and some Edge Functions are weakly exposed.
- Financial integrity: 9 / 20. Some row locks and RLS hardening exist, but holds, idempotency, reconciliation, unique earning constraints, and currency consistency are incomplete.
- Validation and operational readiness: 8 / 15. Some validation exists, but not at the expected Go boundary; no Go tests, health endpoints, observability, migration-to-contract verification, or deployment config were found.
- Existing Supabase backend maturity: 6 bonus context points. There are meaningful legacy primitives, RLS policies, and Edge Functions, but they do not satisfy the migrated frontend contract.

Verdict: Not production ready for the Go-backed frontend migration. The next required step is to implement or attach the Go backend that exposes the REST endpoints listed above, with strict JWT auth, admin middleware, idempotency keys, transaction-scoped wallet operations, and contract tests against the frontend API adapters.

