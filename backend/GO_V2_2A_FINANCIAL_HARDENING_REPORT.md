# PickMe GO V2.2-A Financial Hardening Foundation Report

## Summary

GO V2.2-A financial hardening foundation is implemented without activating public payments, public providers, ride lifecycle changes, websocket changes, or frontend contract changes.

Architecture remains:

```text
Supabase = Storage
Go = Everything Smart
```

## Files Changed

```text
internal/money/money.go
internal/money/money_test.go
internal/payments/service.go
internal/wallet/active_settlement.go
internal/wallet/admin_flow.go
internal/wallet/admin_http.go
internal/wallet/admin_http_test.go
internal/wallet/authorization.go
internal/wallet/financial_jobs.go
internal/wallet/financial_jobs_test.go
internal/wallet/money.go
internal/wallet/reconciliation.go
internal/wallet/reporting.go
internal/wallet/repository.go
internal/wallet/repository_test.go
internal/wallet/schema_test.go
internal/wallet/settlement.go
internal/wallet/types.go
WALLET_LEDGER_SCHEMA.sql
GO_V2_2A_FINANCIAL_HARDENING_REPORT.md
```

## Schema Changes

Added and tightened additive financial schema:

```text
amount_minor BIGINT columns across wallet/account/payment/ledger/authorization/settlement surfaces
public.financial_jobs
public.financial_metrics
public.provider_statement_imports
public.provider_statement_lines
partial unique index on payment_intents(provider, provider_reference) where provider_reference is not null
scoped payment_intents uniqueness on user_id, provider, operation, idempotency_key
```

`financial_jobs` supports:

```text
cash_settlement
wallet_capture
authorization_release
authorization_expiration
reconciliation_run
provider_callback_processing
```

with statuses:

```text
pending
processing
succeeded
failed
dead_lettered
cancelled
```

## Money Architecture

Recommendation implemented:

```text
integer minor units
```

Added:

```text
internal/money
ParseAmount
FormatAmount
PlatformFee
DriverEarnings
ValidateSplit
CurrencyExponent
```

Settlement split math now uses exact minor-unit basis-point arithmetic. Existing HTTP/request structs still accept numeric JSON for compatibility, but financial calculation and schema now have the exact-money foundation required for the next edge-contract migration.

## Financial Jobs Design

Added durable job primitives:

```text
CreateFinancialJob
LeaseDueFinancialJobs
MarkFinancialJobSucceeded
MarkFinancialJobFailed
MarkFinancialJobDeadLettered
FinancialJobWorker
```

Failure producers now enqueue domain jobs for:

```text
cash settlement failure
wallet capture failure
authorization release failure
authorization expiration failure
reconciliation requires_review
provider callback processing failure
```

The worker framework leases due jobs, dispatches registered handlers, retries with backoff, and dead-letters exhausted or unhandled jobs.

## Provider Statement Design

Added provider statement storage:

```text
provider_statement_imports
provider_statement_lines
```

Lines support:

```text
provider
statement_reference
line_reference
provider_reference
amount_minor
currency
matched_wallet_transaction_id
matched_payment_intent_id
mismatch_reason
metadata
```

Supported reconciliation outcomes include:

```text
matched
amount_mismatch
currency_mismatch
missing_ledger
missing_provider_event
unmatched_provider
ignored
```

## Idempotency Changes

Provider deposit idempotency is scoped by:

```text
user_id
provider
operation
idempotency_key
```

This blocks cross-user global key collisions and keeps provider deposit retries deterministic. Provider callback lookup is hardened with a partial uniqueness invariant on provider references.

## Atomic Admin Transactions

Atomic repository methods now cover:

```text
deposit approval
deposit rejection
withdrawal approval
withdrawal rejection
```

Approval transactions lock the target request, post ledger entries, update cached projections, update request status, and write admin audit action in one database transaction. Rejection transactions lock the target request, update status, and write admin audit action in one transaction.

## Financial Observability

Added:

```text
GET /admin/finance/hardening/summary
```

The endpoint reports:

```text
settlement_failures
callback_failures
reconciliation_drift
expired_authorizations
failed_captures
failed_releases
dead_letter_jobs
pending_jobs
processing_jobs
failed_jobs
stale_processing_jobs
```

## Tests Added

Added or updated coverage for:

```text
exact money parsing and formatting
platform fee calculation
driver earnings calculation
split validation
financial job enqueue SQL
financial job worker success/retry/dead-letter behavior
provider reference uniqueness schema
scoped idempotency schema
provider statement schema
financial hardening summary endpoint
atomic admin repository path selection
```

## Build Results

Verification passed:

```text
go test ./...          PASS
go build ./cmd/server  PASS
```

Both commands were run with a workspace-local Go build cache because the Windows global Go cache/telemetry directories are permission-restricted in this environment. Go emitted a telemetry upload-token warning after success, but both commands exited successfully.

## Migration Plan

```text
1. Apply WALLET_LEDGER_SCHEMA.sql additive hardening changes in an internal database.
2. Backfill *_minor columns from existing numeric amount columns by currency exponent.
3. Validate ledger debit/credit equality using amount_minor.
4. Validate payment_intents scoped idempotency has no duplicate user/provider/operation/key rows.
5. Validate provider_reference duplicates before creating the partial unique index.
6. Keep all provider/public-payment flags disabled.
7. Enable financial_jobs workers internally only after job handlers and runbooks are approved.
8. Run wallet and provider statement reconciliation in shadow/internal mode before any public rollout.
```

## Runtime Verification Plan

```text
1. Confirm public ride, websocket, and frontend contracts are unchanged.
2. Run a cash settlement failure drill and verify a cash_settlement job plus settlement_failure metric.
3. Run a wallet capture failure drill and verify a wallet_capture job plus failed_capture metric.
4. Run an authorization release failure drill and verify authorization_release job plus failed_release metric.
5. Run a provider callback failure drill and verify provider_callback_processing job plus callback_failure metric.
6. Import a sample provider statement and classify matched, unmatched, amount mismatch, and currency mismatch lines.
7. Approve and reject deposits and withdrawals while forcing mid-transaction failures in staging to confirm full rollback.
8. Review /admin/finance/hardening/summary after drills.
9. Keep public payments disabled until finance and CTO signoff.
```

## Updated Readiness Score

```text
Internal pilot readiness: 78 / 100
Public financial platform readiness: 52 / 100
Provider production readiness: 39 / 100
```

Readiness assessment:

```text
GO V2.2-A Financial Platform Hardening Foundation: IMPLEMENTED
Exact-money foundation: IMPLEMENTED
Full edge/API float64 removal: NOT COMPLETE
Durable financial job framework: IMPLEMENTED
Provider statement reconciliation schema: IMPLEMENTED
Scoped idempotency: IMPLEMENTED
Provider reference uniqueness: IMPLEMENTED
Atomic admin finance workflow foundation: IMPLEMENTED
Financial observability summary: IMPLEMENTED
Public money movement: NOT APPROVED
Provider public activation: NOT APPROVED
```

Recommended next phase:

```text
GO V2.2-B Financial Recovery and Provider Reconciliation
```
