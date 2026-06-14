# PickMe GO V2.1-F3 Innbucks Provider Pilot Report

## Summary

GO V2.1-F3 Innbucks provider pilot is implemented behind default-off feature flags.

This phase plugs Innbucks into the existing provider framework used by OneMoney and EcoCash. It does not create a public payment launch, Visa, Mastercard, PayPal, ride lifecycle changes, frontend changes, websocket changes, or a separate wallet ledger path.

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
V2_INNBUCKS_PROVIDER_PILOT_REPORT.md
```

## Architecture

Innbucks reuses the existing provider abstraction:

```text
CreateDepositIntent
VerifyCallback
GetTransactionStatus
CreateWithdrawal
GetProviderName
```

Innbucks also reuses the existing provider-neutral wallet flow:

```text
payment_intents
provider_events
wallet_transactions
wallet_ledger_entries
wallet_accounts
reconciliation_runs
```

No duplicate payment logic, ledger logic, reconciliation logic, wallet posting logic, or audit logic was introduced.

## Innbucks Adapter Design

Added:

```text
InnbucksProvider
```

Provider behavior:

```text
provider name: innbucks
deposit reference prefix: IB-
callback verification: HMAC-SHA256 pilot adapter
withdrawals: not implemented
transaction status: stubbed as unknown until provider status API is certified
```

The adapter uses provider-specific callback canonicalization while sharing the same deposit intent, callback processing, provider event audit, wallet credit, and reporting infrastructure.

## Feature Flags

Added:

```text
INNBUCKS_ENABLED=false
INNBUCKS_PILOT_ONLY=true
INNBUCKS_WEBHOOK_SECRET=
```

Innbucks also respects:

```text
PAYMENTS_PROVIDER_ENABLED=false
```

Default behavior:

```text
payment provider framework disabled
Innbucks disabled
Innbucks pilot-only when enabled
no public payment activation
```

## Deposit Flow

Pilot Innbucks deposit flow:

```text
pilot rider requests Innbucks deposit
Go checks PAYMENTS_PROVIDER_ENABLED
Go checks INNBUCKS_ENABLED
Go checks INNBUCKS_PILOT_ONLY and pilot eligibility
InnbucksProvider creates IB- provider reference
Go stores payment_intents row as pending_provider_payment
Innbucks callback reaches Go
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
Payment provider: innbucks
```

## Callback Security

Innbucks callback handling protects against:

```text
duplicate callbacks through provider_events(provider, provider_event_id)
replay attacks through provider event uniqueness and idempotent callback handling
invalid signatures through signature verification and ignored event audit
tampered references through signature verification and locked provider_reference lookup
tampered amounts through signature verification and intent amount comparison
delayed callbacks through intent expiry checks before wallet crediting
```

Invalid but identifiable callbacks are still stored in `provider_events` as ignored, with no wallet credit.

## Pilot Controls

Innbucks deposit intent creation is blocked unless:

```text
PAYMENTS_PROVIDER_ENABLED=true
INNBUCKS_ENABLED=true
user is pilot-eligible when INNBUCKS_PILOT_ONLY=true
```

Rollback controls:

```text
INNBUCKS_ENABLED=false
PAYMENTS_PROVIDER_ENABLED=false
```

These stop new Innbucks payment operations without changing rides, websocket delivery, or posted wallet ledger history.

## Reporting

Added JSON-only admin endpoints:

```text
GET /admin/payments/innbucks/summary
GET /admin/payments/innbucks/transactions
GET /admin/payments/innbucks/reconciliation
GET /admin/payments/innbucks/failures
```

Reporting reuses provider-neutral SQL helpers and filters by:

```text
provider = 'innbucks'
```

Tracked metrics include:

```text
total intents
pending intents
completed intents
processed provider events
duplicate provider events
failed or ignored provider events
completed amount
Innbucks reconciliation runs requiring review
```

## Tests Added

Added coverage for:

```text
Innbucks provider adapter implements provider interface
Innbucks deposit intent creation
Innbucks callback signature verification
tampered Innbucks amount detection
Innbucks pilot gating
Innbucks callback processing into wallet repository
Innbucks deposit HTTP endpoint
Innbucks callback signature header handling
Innbucks admin reporting endpoints
schema support for innbucks provider
```

Existing OneMoney, EcoCash, wallet ledger, provider callback, pilot, reconciliation, ride lifecycle, and websocket tests remain passing.

## Build Results

Verification succeeded:

```text
go test ./...          PASS
go build ./cmd/server  PASS
```

## Runtime Verification Plan

Before enabling Innbucks internally:

```text
1. Keep PAYMENTS_PROVIDER_ENABLED=false and INNBUCKS_ENABLED=false.
2. Confirm existing OneMoney and EcoCash pilot behavior remains unchanged.
3. Configure INNBUCKS_WEBHOOK_SECRET in the internal environment.
4. Enable PAYMENTS_PROVIDER_ENABLED=true.
5. Enable INNBUCKS_ENABLED=true.
6. Keep INNBUCKS_PILOT_ONLY=true.
7. Add a pilot rider.
8. Create an Innbucks deposit intent for the pilot rider.
9. Verify payment_intents provider = innbucks and status = pending_provider_payment.
10. Send a signed paid Innbucks callback.
11. Verify provider_events status processed.
12. Verify wallet_transactions transaction_type deposit and payment_provider innbucks.
13. Verify ledger debits provider_clearing_wallet and credits rider_wallet.
14. Verify rider wallet cached_available_balance increases.
15. Replay the same callback and verify no duplicate wallet credit.
16. Send a tampered callback and verify provider_events records ignored without wallet credit.
17. Review /admin/payments/innbucks/summary, /transactions, /reconciliation, and /failures.
18. Run wallet reconciliation and investigate any drift.
19. Roll back by setting INNBUCKS_ENABLED=false or PAYMENTS_PROVIDER_ENABLED=false.
```

## Operational Risks

```text
real Innbucks production signature rules may differ from the pilot HMAC adapter
INNBUCKS_WEBHOOK_SECRET must remain server-only
provider callbacks rely on signature verification rather than user authentication
provider clearing balances must be reconciled against Innbucks settlement reports
ignored callbacks require operations review
withdrawals through Innbucks remain out of scope
public payments remain blocked until all provider pilot reconciliation is clean
```

## Readiness Assessment

```text
GO V2.1-F3 Innbucks Provider Pilot: IMPLEMENTED
Innbucks provider adapter: IMPLEMENTED
Provider abstraction reuse: IMPLEMENTED
Deposit intent creation: IMPLEMENTED
Callback verification: IMPLEMENTED
Provider event audit: REUSED
Wallet crediting on verified callback: REUSED
Admin reporting APIs: IMPLEMENTED
Pilot-only activation: IMPLEMENTED
Feature flags: DEFAULT SAFE
Public payments: NOT ENABLED
Visa/Mastercard: NOT IMPLEMENTED
PayPal: NOT IMPLEMENTED
Ride lifecycle contracts: UNCHANGED
Websocket contracts: UNCHANGED
Wallet ledger core: UNCHANGED
```

Readiness for Card Gateway:

```text
NOT READY FOR CARD GATEWAY PUBLIC LAUNCH
READY TO USE PROVIDER INTERFACE FOR CARD GATEWAY DESIGN
READY TO DESIGN CARD AUTH/CAPTURE AFTER mobile-money provider pilots reconcile cleanly
READY TO ADD CARD-SPECIFIC PCI/provider rules WITHOUT CHANGING WALLET LEDGER CORE
```
