# PickMe GO V2.1-E3 Authorization Expiration and Reconciliation Report

## Summary

GO V2.1-E3 authorization expiration service and reconciliation dashboard is implemented.

This phase adds operational controls around wallet ride holds and wallet ledger correctness. It does not add provider integrations, frontend changes, websocket changes, OneMoney, EcoCash, Innbucks, cards, or PayPal.

Architecture remains:

```text
Supabase = Storage
Go = Everything Smart
```

## Files Changed

```text
cmd/server/main.go
internal/config/config.go
internal/wallet/admin_http.go
internal/wallet/admin_http_test.go
internal/wallet/authorization.go
internal/wallet/authorization_test.go
internal/wallet/reconciliation.go
internal/wallet/reconciliation_test.go
internal/wallet/reporting.go
internal/wallet/repository.go
internal/wallet/types.go
V2_AUTHORIZATION_EXPIRATION_AND_RECONCILIATION_REPORT.md
```

## Authorization Expiration

Added batch expiration support:

```text
AuthorizationService.ExpireStaleAuthorizations
AuthorizationService.StartExpirationWorker
PostgresRepository.ExpireStaleAuthorizations
```

Expiration behavior:

```text
find wallet_authorizations where status = authorized and expires_at <= now
lock each authorization
release remaining held amount from pending back to available
mark authorization expired
write wallet_authorization_events row
```

This releases stale funds for:

```text
ride abandoned
authorization timeout reached
unstarted or incomplete wallet ride hold
```

Ride cancellation release is supported through the existing release service/admin path:

```text
ReleaseRideFunds
POST /api/wallets/release-ride
```

## Expiration Worker

Added default-off worker config:

```text
WALLET_AUTHORIZATION_EXPIRATION_WORKER_ENABLED=false
WALLET_AUTHORIZATION_EXPIRATION_INTERVAL_SECONDS=60
WALLET_AUTHORIZATION_EXPIRATION_BATCH_LIMIT=100
```

When enabled, the server starts a background worker that periodically expires stale authorizations. It does not alter ride lifecycle or websocket behavior.

## Reconciliation Engine

Added:

```text
internal/wallet/reconciliation.go
ReconciliationService.RunWalletReconciliation
PostgresRepository.RunWalletReconciliation
```

The reconciliation engine compares:

```text
wallet cached balances
wallet ledger-derived balances
open wallet authorizations
active wallet settlements
cash liability ledger/account projections
```

It detects:

```text
balance drift
orphaned authorizations
settlement mismatches
liability mismatches
expired open authorizations
```

Each manual reconciliation run writes:

```text
public.reconciliation_runs
provider = internal
run_type = ledger_balance
status = completed or requires_review
matched_count
mismatch_count
missing_provider_count
missing_ledger_count
```

## Reconciliation Math

Expected available balance:

```text
ledger_credits - ledger_debits - open_authorization_holds
```

Expected pending balance:

```text
open_authorization_holds
```

Expected cash liability balance:

```text
cash_liability_wallet ledger_debits - ledger_credits
```

Drift is reported when any cached projection differs from the expected value by more than a small money tolerance.

## Admin APIs

Added/extended admin JSON endpoints:

```text
GET  /admin/wallets/reconciliation/summary
GET  /admin/wallets/reconciliation/drift
POST /admin/wallets/reconciliation/run
GET  /admin/wallets/authorizations/open
GET  /admin/wallets/authorizations/expired
```

The existing summary endpoint now includes operational metrics:

```text
checked_accounts
balance_drift_count
open_authorizations
expired_authorizations
orphaned_authorizations
settlement_mismatches
liability_mismatches
failed_settlements
reconciliation_runs_requiring_review
latest_reconciliation_run
```

## Operational Metrics

Metrics are exposed as admin JSON fields rather than a Prometheus integration in this phase.

Tracked metrics include:

```text
open authorization count
expired authorization count
balance drift count
orphaned authorization count
settlement mismatch count
liability mismatch count
failed settlement count
reconciliation runs requiring review
latest reconciliation run status
```

## Tests Added

Added coverage for:

```text
stale authorization batch expiration
reconciliation service success path
reconciliation service error propagation
nil reconciliation service no-op
admin reconciliation summary endpoint
admin reconciliation drift endpoint
admin open authorizations endpoint
admin expired authorizations endpoint
admin manual reconciliation run endpoint
```

Existing authorization tests still cover:

```text
release after cancellation
authorization expiration
double release prevention
capture after completion
double capture prevention
ledger correctness
```

## Build Results

Initial sandboxed verification hit Windows Go build-cache access denial under:

```text
C:\Users\ntepemanamafm\AppData\Local\go-build
```

Rerun with normal Go build-cache access succeeded:

```text
go test ./...          PASS
go build ./cmd/server  PASS
```

## Runtime Verification Plan

Before enabling in an internal environment:

```text
1. Apply wallet_authorizations, wallet_authorization_events, and reconciliation_runs schema.
2. Keep WALLET_AUTHORIZATION_EXPIRATION_WORKER_ENABLED=false.
3. Create wallet ride authorization with a short TTL.
4. Confirm available decreases and pending increases.
5. Call /admin/wallets/authorizations/open and verify the hold is visible.
6. Wait until expires_at passes.
7. Call /admin/wallets/authorizations/expired and verify stale hold appears.
8. Enable WALLET_AUTHORIZATION_EXPIRATION_WORKER_ENABLED=true internally.
9. Verify worker marks stale hold expired and releases pending funds.
10. Run POST /admin/wallets/reconciliation/run.
11. Verify public.reconciliation_runs receives a completed or requires_review row.
12. Call /admin/wallets/reconciliation/summary and /drift.
13. Investigate any drift before public wallet activation.
```

## Operational Risks

```text
reconciliation depends on additive authorization tables being migrated before endpoints are used
expiration worker is default-off and must be enabled only after internal verification
cached balance drift may expose prior admin-flow projection gaps and should be reviewed before enforcement
ride cancellation is not a new lifecycle endpoint in this phase; release is available through admin/service path
failed captures still require operational monitoring and manual reconciliation
provider reconciliation remains out of scope
```

## Readiness Assessment

```text
GO V2.1-E3 Authorization Expiration Service: IMPLEMENTED
Expiration worker: IMPLEMENTED, DEFAULT OFF
Reconciliation engine: IMPLEMENTED
Reconciliation dashboard APIs: IMPLEMENTED
Operational metrics: IMPLEMENTED AS JSON ADMIN METRICS
Ride lifecycle contracts: UNCHANGED
Websocket contracts: UNCHANGED
Frontend contracts: UNCHANGED
Provider integrations: NOT STARTED
```

Readiness for provider integration:

```text
NOT READY FOR PROVIDER INTEGRATION
READY FOR INTERNAL AUTHORIZATION EXPIRATION TESTING
READY FOR INTERNAL RECONCILIATION DASHBOARD VALIDATION
READY TO ADD PROVIDER RECONCILIATION ONLY AFTER WALLET DRIFT IS ZERO AND RUNBOOKS EXIST
```
