# Wallet Production Hardening Report

Date: 2026-06-15

Scope: Audit and critical hardening pass for `backend/internal/wallet` and `backend/internal/payments`.

## Executive Summary

Result: **CRITICAL FIXES APPLIED**

The wallet implementation already has several strong production primitives:

- Transaction-scoped wallet mutations.
- `FOR UPDATE` locking for wallet accounts, authorizations, deposits, withdrawals, and settlements.
- Deterministic wallet account IDs.
- Deterministic settlement IDs for wallet ride settlement.
- Ledger balance validation through `ValidateBalancedTransaction`.
- Provider callback signature verification and provider-status cross-checking.
- Reconciliation query covering cached balances, pending holds, active settlements, and cash liabilities.

This pass fixed critical runtime/idempotency issues:

1. Deposit read queries selected decimal `amount` plus `amount_minor` but scanned only one amount destination.
2. Wallet authorization locking selected decimal `amount` into an integer minor-unit field.
3. Provider deposit intent creation called the external provider before checking whether the idempotency key already existed.
4. Manual deposit and withdrawal creation returned a freshly generated object even when the database ignored a duplicate idempotency key.

## Files Changed

| File | Change |
|---|---|
| `backend/internal/wallet/repository.go` | Fixed canonical minor-unit reads; added withdrawal lookup by idempotency key |
| `backend/internal/wallet/admin_flow.go` | Return stored idempotent deposit/withdrawal rows and reject mismatched idempotency reuse |
| `backend/internal/payments/service.go` | Check existing provider/card deposit idempotency before external provider calls; reject mismatched reuse |

## Critical Fixes

### 1. Payment Intent SELECT/Scan Mismatch

Affected functions:

- `GetProviderDepositByScopedIdempotency`
- `GetProviderDepositByProviderReference`
- `GetDepositRequestByIdempotencyKey`
- `GetDepositRequest`

Issue:

The queries selected both `amount` and `amount_minor`, but scanned into only one `AmountMinor` destination. At runtime this can fail with a field-count mismatch and break idempotent deposit lookup and callback processing.

Fix:

Queries now select canonical `amount_minor` only.

### 2. Authorization Amount Read Used Decimal Amount

Affected function:

- `lockAuthorizationByRide`

Issue:

The query selected decimal `amount` into `WalletAuthorization.AmountMinor`. That risks incorrect minor-unit calculations or scan failure depending on driver/database type behavior.

Fix:

The query now selects `amount_minor`.

### 3. Provider Deposit Idempotency Before External Calls

Affected functions:

- `CreateOneMoneyDepositIntent`
- `CreateEcoCashDepositIntent`
- `CreateInnbucksDepositIntent`
- `CreatePayPalDepositIntent`
- `CreateCardDeposit`

Issue:

The service created a provider-side intent before checking whether the local idempotency key already existed. A client retry with the same idempotency key could create duplicate provider-side intents, even if the local DB eventually returned the existing row.

Fix:

The service now looks up an existing scoped provider deposit before calling the external provider or card processor.

If an existing row is found with the same user/provider/operation/idempotency key and matching amount/currency, the stored intent is returned.

If the same idempotency key is reused with different amount/currency, the request fails with `ErrInvalidIdempotencyKey`.

### 4. Manual Deposit/Withdrawal Duplicate Handling

Affected functions:

- `AdminFlowService.CreateDeposit`
- `AdminFlowService.CreateWithdrawal`

Issue:

The repository uses `ON CONFLICT ... DO NOTHING` for duplicate idempotency keys. The service still returned the newly generated in-memory deposit/withdrawal object even if the insert was skipped. That could return an ID that was never persisted.

Fix:

After create, the service now reloads by idempotency key when the repository supports it.

It returns the stored row for exact duplicate retries and rejects mismatched idempotency-key reuse.

## Audit Findings

| Area | Status | Notes |
|---|---|---|
| Idempotency | Improved | Provider and manual create paths now return existing rows before side effects or after conflict |
| Double spending prevention | Mostly strong | Account writes use `FOR UPDATE`; transfers, withdrawals, wallet ride payments, and captures check available/pending balances |
| Duplicate deposit prevention | Improved | Provider callback locks provider reference; provider intent creation now pre-checks idempotency |
| Duplicate withdrawal prevention | Improved | Duplicate idempotency returns persisted withdrawal row instead of a phantom generated ID |
| Race conditions | Mostly controlled | Main money mutations use DB transactions and row locks |
| Settlement consistency | Good but needs schema confirmation | Wallet and active cash settlement use idempotency keys and locked settlement rows |

## Remaining Production Risks

Critical to verify in database before launch:

- `payment_intents(user_id, provider, operation, idempotency_key)` unique index exists.
- `payment_intents(provider, provider_reference)` unique index exists.
- `provider_events(provider, provider_event_id)` unique index exists.
- `withdrawal_requests(idempotency_key)` unique index exists.
- `wallet_transactions(idempotency_key)` unique index exists.
- `wallet_ledger_entries(id)` primary key/unique exists.
- `settlement_records(idempotency_key)` unique index exists.
- `wallet_authorizations(ride_id)` unique index exists.

High priority hardening still needed:

- Add integration tests against Postgres for duplicate provider callbacks, duplicate provider intent requests, duplicate withdrawal requests, and concurrent capture.
- Add provider-reference uniqueness checks to migrations if missing.
- Add idempotency mismatch tests for manual deposits and withdrawals.
- Add alerting on reconciliation mismatches and callback dead letters.
- Add payout-provider state machine for withdrawals after admin approval.

## Race-Condition Review

Strong paths:

- `ApproveDepositAtomically` locks the deposit request and updates ledger/account/payment intent in one transaction.
- `ApproveWithdrawalAtomically` locks the withdrawal and driver wallet account before debiting.
- `CaptureRideFunds` locks wallet authorization by ride and wallet accounts before settlement.
- `PayRideFromWallet` locks existing settlement and ride before debiting wallet balance.
- `PostActiveCashSettlement` locks the settlement row by idempotency key before posting cash liability/platform fee.

Residual risk:

- DB constraints must be present. Without unique indexes, `ON CONFLICT` and duplicate callback protection do not protect production money.
- Some non-atomic fallback paths remain in interfaces for tests/alternate repositories, but `PostgresRepository` uses atomic methods.

## Verification

Backend tests:

```text
cd backend
go test ./...
PASS
```

## Verdict

Wallet and payment code is materially safer after this pass. The critical application-level idempotency and canonical-money read issues were fixed.

Production readiness still depends on confirming the database uniqueness constraints listed above and adding Postgres-backed concurrency/idempotency integration tests.
