# PickMe GO V2.1-F1 OneMoney Provider Pilot Report

## Summary

GO V2.1-F1 OneMoney provider framework and pilot integration is implemented behind default-off feature flags.

This phase creates the first external payment-provider architecture for PickMe. It does not launch public payments, EcoCash, Innbucks, Visa, Mastercard, PayPal, ride lifecycle changes, frontend changes, or websocket contract changes.

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
internal/wallet/repository.go
internal/wallet/provider_repository_test.go
internal/wallet/schema_test.go
internal/wallet/types.go
WALLET_LEDGER_SCHEMA.sql
V2_ONEMONEY_PROVIDER_PILOT_REPORT.md
```

## Provider Architecture

Added:

```text
internal/payments
```

Core provider interface:

```text
CreateDepositIntent
VerifyCallback
GetTransactionStatus
CreateWithdrawal
GetProviderName
```

Implemented:

```text
OneMoneyProvider
```

Future providers can plug into the same interface without changing wallet ledger semantics.

## Feature Flags

Added:

```text
PAYMENTS_PROVIDER_ENABLED=false
ONEMONEY_ENABLED=false
ONEMONEY_PILOT_ONLY=true
ONEMONEY_WEBHOOK_SECRET=
```

Default behavior:

```text
provider framework disabled
OneMoney disabled
OneMoney restricted to pilot users when enabled
no public payment activation
```

## Deposit Flow

Implemented pilot OneMoney deposit intent flow:

```text
pilot rider requests OneMoney deposit
Go checks provider and pilot flags
OneMoneyProvider creates provider reference
Go stores payment_intents row as pending_provider_payment
user pays externally through OneMoney
OneMoney callback reaches Go
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
Payment provider: onemoney
```

## Callback Security

Implemented protections for:

```text
replay attacks through unique provider_events(provider, provider_event_id)
duplicate callbacks through idempotent callback handling
tampered amount through signature verification and amount comparison
tampered reference through signature verification and locked intent lookup
invalid provider signatures through signature_valid=false provider event audit
delayed callbacks through intent expiry checks before wallet crediting
```

Callback verification uses an HMAC-SHA256 canonical payload in the reference adapter. Real OneMoney certification can replace only the provider adapter while preserving the ledger, event, and reconciliation shell.

## Pilot Controls

OneMoney deposit intent creation is blocked unless:

```text
PAYMENTS_PROVIDER_ENABLED=true
ONEMONEY_ENABLED=true
user is pilot-eligible when ONEMONEY_PILOT_ONLY=true
```

Non-pilot users receive a forbidden response and no provider intent is created.

## Reporting

Added JSON-only endpoints:

```text
GET /admin/payments/onemoney/summary
GET /admin/payments/onemoney/transactions
GET /admin/payments/onemoney/reconciliation
GET /admin/payments/onemoney/failures
```

Tracked fields include:

```text
total intents
pending intents
completed intents
processed provider events
duplicate provider events
failed or ignored provider events
completed amount
OneMoney reconciliation runs requiring review
```

## Reconciliation Integration

OneMoney participates through existing financial primitives:

```text
payment_intents
provider_events
wallet_transactions
wallet_ledger_entries
wallet_accounts cached projections
reconciliation_runs provider = onemoney
```

The wallet reconciliation engine will see OneMoney ledger entries and cached-balance impact through the same account projection checks used for wallet drift detection.

## Tests Added

Added coverage for:

```text
provider interface compliance
OneMoney deposit intent creation
callback signature verification
tampered callback detection
feature flag disabled behavior
OneMoney disabled behavior
pilot gating
callback processing into wallet repository
invalid signature callback audit path
OneMoney deposit HTTP endpoint
callback endpoint signature header handling
admin reporting endpoints
schema support for onemoney provider and completed deposits
repository ledger-posting and wallet-crediting guard
```

## Build Results

Verification succeeded:

```text
go test ./...          PASS
go build ./cmd/server  PASS
```

## Runtime Verification Plan

Before enabling in an internal environment:

```text
1. Apply additive schema that allows provider = onemoney and pending_provider_payment/completed intents.
2. Keep PAYMENTS_PROVIDER_ENABLED=false and ONEMONEY_ENABLED=false.
3. Confirm existing rides, wallet authorization, cash settlement, and pilot framework behavior is unchanged.
4. Configure ONEMONEY_WEBHOOK_SECRET in the internal environment.
5. Enable PAYMENTS_PROVIDER_ENABLED=true.
6. Enable ONEMONEY_ENABLED=true.
7. Keep ONEMONEY_PILOT_ONLY=true.
8. Add a pilot rider.
9. Create a OneMoney deposit intent for the pilot rider.
10. Verify payment_intents status pending_provider_payment with provider_reference.
11. Send a signed paid callback.
12. Verify provider_events status processed.
13. Verify wallet_transactions transaction_type deposit and payment_provider onemoney.
14. Verify ledger debits provider_clearing_wallet and credits rider_wallet.
15. Verify rider wallet cached_available_balance increases.
16. Replay the same callback and verify no duplicate wallet credit.
17. Send a tampered callback and verify provider_events records ignored without wallet credit.
18. Review /admin/payments/onemoney/summary, /transactions, /reconciliation, and /failures.
19. Run wallet reconciliation and investigate any drift before wider provider work.
20. Roll back by setting ONEMONEY_ENABLED=false or PAYMENTS_PROVIDER_ENABLED=false.
```

## Operational Risks

```text
real OneMoney production signature rules may differ from the pilot HMAC adapter
ONEMONEY_WEBHOOK_SECRET must be managed as a server secret only
provider callbacks are unauthenticated by user session and rely on signature verification
provider clearing balances can go negative by design and must be reconciled against provider settlement reports
expired or ignored callbacks require operations review
public payment rollout remains blocked until pilot reconciliation is clean
withdrawals through OneMoney are intentionally not implemented
```

## Readiness Assessment

```text
GO V2.1-F1 OneMoney Provider Framework: IMPLEMENTED
Provider abstraction: IMPLEMENTED
OneMoney reference provider: IMPLEMENTED
Deposit intent creation: IMPLEMENTED
Callback verification: IMPLEMENTED
Provider event audit: IMPLEMENTED
Wallet crediting on verified callback: IMPLEMENTED
Admin reporting APIs: IMPLEMENTED
Pilot-only activation: IMPLEMENTED
Feature flags: DEFAULT SAFE
Public payments: NOT ENABLED
EcoCash: NOT IMPLEMENTED
Innbucks: NOT IMPLEMENTED
Cards: NOT IMPLEMENTED
PayPal: NOT IMPLEMENTED
Ride lifecycle contracts: UNCHANGED
Websocket contracts: UNCHANGED
```

Readiness for EcoCash:

```text
NOT READY FOR ECOCASH PUBLIC LAUNCH
READY TO USE PROVIDER INTERFACE FOR ECOCASH DESIGN
READY TO BUILD ECOCASH ADAPTER AFTER ONEMONEY PILOT CALLBACKS RECONCILE CLEANLY
READY TO ADD PROVIDER-SPECIFIC CERTIFICATION RULES WITHOUT CHANGING WALLET LEDGER CORE
```
