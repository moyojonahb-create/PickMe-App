# V2 Ledger Schema Implementation Report

## Summary

GO V2.1-B Ledger Schema Foundation was implemented as a database, repository, and validation foundation only.

Preserved:

```text
Go Core V1 ride lifecycle
Frontend F1 contracts
public.rides
public.ride_offers
canonical websocket events
production dispatch behavior
ride completion behavior
```

Not activated:

```text
wallet settlement
deposits
withdrawals
wallet payments
provider integrations
ride completion settlement hooks
frontend wallet flows
```

The wallet package is not wired into production ride flow. This phase only prepares financial storage, persistence boundaries, and validation rules for future V2.1-C Shadow Settlement.

## Files Changed

```text
internal/wallet/types.go
internal/wallet/validation.go
internal/wallet/repository.go
internal/wallet/validation_test.go
internal/wallet/repository_test.go
internal/wallet/schema_test.go
WALLET_LEDGER_SCHEMA.sql
V2_LEDGER_SCHEMA_IMPLEMENTATION_REPORT.md
```

The previous placeholder file was replaced:

```text
internal/wallet/service.go
```

## Migration File Created

Created additive SQL file:

```text
WALLET_LEDGER_SCHEMA.sql
```

Tables:

```text
public.wallet_accounts
public.wallet_transactions
public.wallet_ledger_entries
public.payment_intents
public.provider_events
public.withdrawal_requests
public.settlement_records
public.reconciliation_runs
```

No changes were made to:

```text
public.rides
public.ride_offers
```

## Schema Design

### wallet_accounts

Supports:

```text
rider_wallet
driver_wallet
platform_wallet
cash_liability_wallet
pending_deposit_wallet
provider_clearing_wallet
```

Includes cached balances for operational reads:

```text
cached_available_balance
cached_pending_balance
cached_liability_balance
```

These are not the source of truth. Ledger entries remain authoritative.

### wallet_transactions

Transaction group header for financial operations.

Includes:

```text
transaction_type
status
idempotency_key
currency
total_amount
owner_user_id
ride_id
payment_provider
payment_intent_id
audit metadata
```

### wallet_ledger_entries

Immutable debit and credit lines.

Rules:

```text
amount > 0
entry_type in debit, credit
currency required
transaction_id required
account_id required
updates blocked
deletes blocked
```

Corrections must use reversal transactions.

### payment_intents

Foundation for future EcoCash, Innbucks, Visa, Mastercard, and PayPal payment attempts.

### provider_events

Provider callback audit and deduplication table.

### withdrawal_requests

Future driver withdrawal lifecycle table.

### settlement_records

Future ride settlement audit table for shadow and active settlement.

### reconciliation_runs

Provider and ledger reconciliation batch table.

## Constraints Added

Implemented:

```text
unique idempotency keys
amount > 0 validation
transaction status validation
account type validation
entry type validation
currency validation
provider event uniqueness
reconciliation status validation
wallet ledger immutability triggers
```

Provider event uniqueness:

```text
unique(provider, provider_event_id)
unique(provider, payload_hash)
```

Ledger immutability:

```text
prevent_wallet_ledger_entry_mutation()
trg_wallet_ledger_entries_no_update
trg_wallet_ledger_entries_no_delete
```

## Indexes Added

Indexes support:

```text
wallet lookups
transaction lookups
ride settlement lookups
provider reconciliation
admin reporting
ledger history by account
withdrawal queue inspection
settlement failure inspection
```

Examples:

```text
idx_wallet_accounts_owner
idx_wallet_transactions_idempotency
idx_wallet_transactions_ride
idx_wallet_ledger_entries_account_created
idx_provider_events_reconciliation
idx_withdrawal_requests_driver_status
idx_settlement_records_ride
idx_reconciliation_runs_provider_status
```

## RLS Policies

RLS is enabled on all wallet tables.

Rider/driver visibility:

```text
wallet_accounts: owner_user_id = auth.uid()
wallet_transactions: owner_user_id = auth.uid() or created_by = auth.uid()
wallet_ledger_entries: visible only through owned wallet account
payment_intents: user_id = auth.uid()
withdrawal_requests: driver_id = auth.uid()
```

Admin visibility:

```text
auth.jwt() -> 'app_metadata' ->> 'role' = 'admin'
```

Provider events, settlement records, and reconciliation runs are admin-visible only through RLS policies.

Service role:

```text
Supabase service role bypasses RLS and is intended for trusted Go backend writes only.
```

RLS does not grant public mutation paths. Go remains the decision-making layer.

## Repositories Added

Package:

```text
internal/wallet
```

Repository interfaces:

```text
AccountRepository
TransactionRepository
LedgerRepository
ReconciliationRepository
```

Postgres implementation:

```text
PostgresRepository
```

Implemented persistence foundations:

```text
CreateAccount
GetAccount
CreateTransaction
GetTransactionByIdempotencyKey
PostLedgerEntries
CreateReconciliationRun
```

No settlement logic, provider logic, deposit activation, or withdrawal activation was implemented.

## Validation Layer

Added validation for:

```text
balanced transactions
valid account types
valid owner roles
valid account statuses
valid transaction types
valid transaction states
valid ledger entries
valid currencies
idempotency key shape
```

Double-entry validation requires:

```text
at least two ledger entries
total debits == total credits
transaction total == total debits
all ledger entry currencies match transaction currency
```

## Tests Added

Added:

```text
internal/wallet/validation_test.go
internal/wallet/repository_test.go
internal/wallet/schema_test.go
```

Covered:

```text
ledger entry validation
balanced transaction validation
idempotency validation
account type validation
currency validation
repository persistence calls
repository rejection of unbalanced transactions before writes
schema required table verification
schema constraint verification
ledger immutability trigger verification
RLS policy verification
migration verification that public.rides and public.ride_offers are not modified
```

## Build Results

Executed with normal Windows Go build-cache access:

```text
go test ./...          PASS
go build ./cmd/server PASS
```

Additional focused verification:

```text
go test ./internal/wallet PASS
```

## Operational Risks

### SQL file not yet applied

This phase creates the schema file only. Runtime wallet functionality is not active until the schema is applied and future services are wired.

### Cached balance drift

Cached balances exist for future performance, but ledger entries are the source of truth. Future phases must include balance rebuild and reconciliation checks.

### RLS role source

Admin visibility assumes admin role is stored in trusted Supabase app metadata, not user-editable user metadata.

### Ledger transaction atomicity

The repository validates double-entry shape before writes. Future active settlement must wrap transaction header and ledger entries in one database transaction.

### Provider callback abuse

Provider event dedupe constraints exist, but signature verification and provider logic are intentionally deferred to V2.1-F.

### No active negative-balance enforcement yet

Negative balance prevention is designed into validation and future transaction locking, but active debit checks are not wired because wallet settlement is not active.

## Runtime Verification Plan

### 1. Apply Additive Schema In Staging

Run:

```text
WALLET_LEDGER_SCHEMA.sql
```

Verify:

```text
wallet tables exist
indexes exist
RLS is enabled
ledger immutability triggers exist
public.rides unchanged
public.ride_offers unchanged
```

### 2. Constraint Probe

Attempt:

```text
insert invalid account_type
insert invalid currency
insert zero amount ledger entry
insert duplicate idempotency_key
insert duplicate provider_event_id
update wallet_ledger_entries row
delete wallet_ledger_entries row
```

Expected:

```text
all invalid operations fail
ledger update/delete fails with immutable ledger exception
```

### 3. RLS Probe

With rider and driver JWTs:

```text
rider can view only own wallet accounts
driver can view only own wallet accounts
rider cannot view another rider/driver account
driver cannot view another driver/rider account
non-admin cannot view provider_events
admin can view all wallet reporting tables
```

### 4. Repository Probe

Run focused tests:

```text
go test ./internal/wallet
```

Verify:

```text
validation rejects unbalanced transactions
repository does not write invalid ledgers
schema file contains constraints and RLS policies
```

## Readiness For V2.1-C Shadow Settlement

```text
READY FOR V2.1-C SHADOW SETTLEMENT DESIGN AND IMPLEMENTATION
```

Conditions:

```text
1. Apply WALLET_LEDGER_SCHEMA.sql in staging.
2. Verify constraints and RLS probes.
3. Implement V2.1-C as non-blocking shadow settlement only.
4. Ride completion must continue succeeding if wallet shadow writes fail.
5. No wallet settlement should become active until reconciliation reports pass.
```

## Final Classification

```text
GO V2.1-B Ledger Schema Foundation: IMPLEMENTED
Wallet settlement: NOT ACTIVATED
Deposits: NOT ACTIVATED
Withdrawals: NOT ACTIVATED
Provider integrations: NOT ACTIVATED
Production ride flow: PRESERVED
Frontend contracts: PRESERVED
Websocket contracts: PRESERVED
```
