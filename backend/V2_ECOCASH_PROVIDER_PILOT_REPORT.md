# PickMe GO V2.1-F2 EcoCash Provider Pilot Report

## Summary

GO V2.1-F2 EcoCash provider pilot is implemented behind default-off feature flags.

This phase plugs EcoCash into the existing OneMoney provider framework. It does not create a public payments launch, Innbucks, Visa, Mastercard, PayPal, ride lifecycle changes, frontend changes, websocket changes, or a separate ledger path.

Architecture remains:

```text
Supabase = Storage
Go = Everything Smart
```

## Files Changed

```text
cmd/server/main.go
internal/config/config.go
internal/payments/provider.go
internal/payments/service.go
internal/payments/http.go
internal/payments/reporting.go
internal/payments/service_test.go
internal/payments/http_test.go
internal/wallet/schema_test.go
internal/wallet/types.go
V2_ECOCASH_PROVIDER_PILOT_REPORT.md
```

## Architecture

EcoCash reuses the existing provider abstraction:

```text
CreateDepositIntent
VerifyCallback
GetTransactionStatus
CreateWithdrawal
GetProviderName
```

EcoCash also reuses the existing wallet repository flow:

```text
payment_intents
provider_events
wallet_transactions
wallet_ledger_entries
wallet_accounts
reconciliation_runs
```

No duplicate payment logic, ledger logic, reconciliation logic, ride lifecycle logic, or websocket contract was introduced.

## EcoCash Adapter Design

Added:

```text
EcoCashProvider
```

Provider behavior:

```text
provider name: ecocash
deposit reference prefix: EC-
callback verification: HMAC-SHA256 pilot adapter
withdrawals: not implemented
transaction status: stubbed as unknown until provider status API is certified
```

The EcoCash adapter has provider-specific canonical callback signing while still using the same shared payment service and wallet posting path as OneMoney.

## Feature Flags

Added:

```text
ECOCASH_ENABLED=false
ECOCASH_PILOT_ONLY=true
ECOCASH_WEBHOOK_SECRET=
```

EcoCash also respects:

```text
PAYMENTS_PROVIDER_ENABLED=false
```

Default behavior:

```text
payment provider framework disabled
EcoCash disabled
EcoCash pilot-only when enabled
no public payment activation
```

## Deposit Flow

Pilot EcoCash deposit flow:

```text
pilot rider requests EcoCash deposit
Go checks PAYMENTS_PROVIDER_ENABLED
Go checks ECOCASH_ENABLED
Go checks ECOCASH_PILOT_ONLY and pilot eligibility
EcoCashProvider creates EC- provider reference
Go stores payment_intents row as pending_provider_payment
EcoCash callback reaches Go
Go verifies callback signature
Go records provider_events row
Go locks payment_intent and wallet accounts
Go posts balanced deposit ledger
Go credits rider wallet cached available balance
Go debits provider clearing cached balance
Go marks payment_intent completed
```

Ledger shape:

```text
Debit:  provider_clearing_wallet
Credit: rider_wallet
Amount: deposit amount
Transaction type: deposit
Payment provider: ecocash
```

## Callback Security

EcoCash callback handling protects against:

```text
duplicate callbacks through provider_events(provider, provider_event_id)
replay attacks through provider event uniqueness and idempotent callback handling
invalid signatures through signature verification and ignored event audit
tampered references through signature verification and locked provider_reference lookup
tampered amounts through signature verification and intent amount comparison
delayed callbacks through intent expiry checks before wallet crediting
```

Invalid but identifiable callbacks are still recorded in `provider_events` as ignored, with no wallet credit.

## Pilot Controls

EcoCash deposit intent creation is blocked unless:

```text
PAYMENTS_PROVIDER_ENABLED=true
ECOCASH_ENABLED=true
user is pilot-eligible when ECOCASH_PILOT_ONLY=true
```

Rollback controls:

```text
ECOCASH_ENABLED=false
PAYMENTS_PROVIDER_ENABLED=false
```

These stop new EcoCash payment operations without changing rides, websocket delivery, or wallet ledger history.

## Reporting

Added JSON-only admin endpoints:

```text
GET /admin/payments/ecocash/summary
GET /admin/payments/ecocash/transactions
GET /admin/payments/ecocash/reconciliation
GET /admin/payments/ecocash/failures
```

Reporting reuses provider-neutral SQL helpers and filters by `provider = 'ecocash'`.

Tracked metrics include:

```text
total intents
pending intents
completed intents
processed provider events
duplicate provider events
failed or ignored provider events
completed amount
EcoCash reconciliation runs requiring review
```

## Tests Added

Added coverage for:

```text
EcoCash provider adapter implements provider interface
EcoCash deposit intent creation
EcoCash callback signature verification
tampered EcoCash reference detection
EcoCash pilot gating
EcoCash callback processing into wallet repository
EcoCash deposit HTTP endpoint
EcoCash callback signature header handling
EcoCash admin reporting endpoints
schema support for ecocash provider
```

Existing OneMoney, wallet ledger, provider callback, pilot, reconciliation, ride lifecycle, and websocket tests remain passing.

## Build Results

Verification succeeded:

```text
go test ./...          PASS
go build ./cmd/server  PASS
```

## Runtime Verification Plan

Before enabling EcoCash internally:

```text
1. Keep PAYMENTS_PROVIDER_ENABLED=false and ECOCASH_ENABLED=false.
2. Confirm existing OneMoney pilot behavior remains unchanged.
3. Configure ECOCASH_WEBHOOK_SECRET in the internal environment.
4. Enable PAYMENTS_PROVIDER_ENABLED=true.
5. Enable ECOCASH_ENABLED=true.
6. Keep ECOCASH_PILOT_ONLY=true.
7. Add a pilot rider.
8. Create an EcoCash deposit intent for the pilot rider.
9. Verify payment_intents provider = ecocash and status = pending_provider_payment.
10. Send a signed paid EcoCash callback.
11. Verify provider_events status processed.
12. Verify wallet_transactions transaction_type deposit and payment_provider ecocash.
13. Verify ledger debits provider_clearing_wallet and credits rider_wallet.
14. Verify rider wallet cached_available_balance increases.
15. Replay the same callback and verify no duplicate wallet credit.
16. Send a tampered callback and verify provider_events records ignored without wallet credit.
17. Review /admin/payments/ecocash/summary, /transactions, /reconciliation, and /failures.
18. Run wallet reconciliation and investigate any drift.
19. Roll back by setting ECOCASH_ENABLED=false or PAYMENTS_PROVIDER_ENABLED=false.
```

## Operational Risks

```text
real EcoCash production signature rules may differ from the pilot HMAC adapter
ECOCASH_WEBHOOK_SECRET must remain server-only
provider callbacks rely on signature verification rather than user authentication
provider clearing balances must be reconciled against EcoCash settlement reports
ignored callbacks require operations review
withdrawals through EcoCash remain out of scope
public payments remain blocked until pilot reconciliation is clean
```

## Readiness Assessment

```text
GO V2.1-F2 EcoCash Provider Pilot: IMPLEMENTED
EcoCash provider adapter: IMPLEMENTED
Provider abstraction reuse: IMPLEMENTED
Deposit intent creation: IMPLEMENTED
Callback verification: IMPLEMENTED
Provider event audit: IMPLEMENTED
Wallet crediting on verified callback: REUSED FROM PROVIDER FRAMEWORK
Admin reporting APIs: IMPLEMENTED
Pilot-only activation: IMPLEMENTED
Feature flags: DEFAULT SAFE
Public payments: NOT ENABLED
Innbucks: NOT IMPLEMENTED
Cards: NOT IMPLEMENTED
PayPal: NOT IMPLEMENTED
Ride lifecycle contracts: UNCHANGED
Websocket contracts: UNCHANGED
Wallet ledger core: UNCHANGED
```

Readiness for Innbucks:

```text
NOT READY FOR INNBUCKS PUBLIC LAUNCH
READY TO USE PROVIDER INTERFACE FOR INNBUCKS DESIGN
READY TO BUILD INNBUCKS ADAPTER AFTER OneMoney and EcoCash pilot callbacks reconcile cleanly
READY TO ADD PROVIDER-SPECIFIC CERTIFICATION RULES WITHOUT CHANGING WALLET LEDGER CORE
```
