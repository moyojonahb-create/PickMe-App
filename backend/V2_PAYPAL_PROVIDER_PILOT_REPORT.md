# PickMe GO V2.1-F5 PayPal Provider Pilot Report

## Summary

GO V2.1-F5 PayPal provider pilot is implemented behind default-off feature flags.

This phase plugs PayPal into the existing provider framework used by OneMoney, EcoCash, Innbucks, and the card pilot. It does not create a public payment launch, ride lifecycle changes, frontend changes, websocket changes, a separate PayPal wallet system, duplicate ledger logic, or duplicate reconciliation logic.

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
internal/wallet/types.go
V2_PAYPAL_PROVIDER_PILOT_REPORT.md
```

## Architecture

PayPal reuses the existing provider abstraction:

```text
CreateDepositIntent
VerifyCallback
GetTransactionStatus
CreateWithdrawal
GetProviderName
```

PayPal also reuses the provider-neutral financial primitives:

```text
payment_intents
provider_events
wallet_transactions
wallet_ledger_entries
wallet_accounts
reconciliation_runs
admin provider reporting
```

No PayPal-specific wallet ledger path was added.

## PayPal Adapter

Added:

```text
PayPalProvider
```

Provider behavior:

```text
provider name: paypal
deposit reference prefix: PP-
callback verification: HMAC-SHA256 pilot adapter
withdrawals: not implemented
transaction status: stubbed as unknown until PayPal status API integration is certified
```

The adapter uses PayPal-specific pilot callback canonicalization while sharing the same deposit intent creation, callback processing, provider event audit, wallet credit, and reporting infrastructure.

## Feature Flags

Added:

```text
PAYPAL_ENABLED=false
PAYPAL_PILOT_ONLY=true
PAYPAL_WEBHOOK_SECRET=
```

PayPal also respects:

```text
PAYMENTS_PROVIDER_ENABLED=false
```

Default behavior:

```text
provider framework disabled
PayPal disabled
PayPal restricted to pilot users when enabled
no public PayPal activation
```

## Deposit Flow

Pilot PayPal deposit flow:

```text
pilot rider requests PayPal deposit
Go checks PAYMENTS_PROVIDER_ENABLED
Go checks PAYPAL_ENABLED
Go checks PAYPAL_PILOT_ONLY and pilot eligibility
PayPalProvider creates PP- provider reference
Go stores payment_intents row as pending_provider_payment
PayPal callback reaches Go
Go verifies callback signature
Go records provider_events row
Go locks payment_intent and wallet accounts
Go posts existing provider deposit ledger
Go credits rider wallet cached available balance
Go debits provider clearing cached balance
Go marks payment_intent completed
```

Ledger shape:

```text
Debit:  provider_clearing_wallet
Credit: rider_wallet
Amount: PayPal deposit amount
Transaction type: deposit
Payment provider: paypal
```

## Callback Security

PayPal callback handling protects against:

```text
duplicate callbacks through provider_events(provider, provider_event_id)
replay attacks through provider event uniqueness and idempotent callback handling
invalid signatures through signature verification and ignored event audit
tampered references through signature verification and locked provider_reference lookup
tampered amounts through signature verification and intent amount comparison
delayed callbacks through existing intent expiry checks before wallet crediting
```

Invalid but identifiable callbacks are still routed to `provider_events` as ignored, with no wallet credit.

## Pilot Controls

PayPal deposit intent creation is blocked unless:

```text
PAYMENTS_PROVIDER_ENABLED=true
PAYPAL_ENABLED=true
user is pilot-eligible when PAYPAL_PILOT_ONLY=true
```

Rollback controls:

```text
PAYPAL_ENABLED=false
PAYMENTS_PROVIDER_ENABLED=false
```

These stop new PayPal payment operations without changing rides, websocket delivery, or posted wallet ledger history.

## Reporting

Added JSON-only admin endpoints:

```text
GET /admin/payments/paypal/summary
GET /admin/payments/paypal/transactions
GET /admin/payments/paypal/reconciliation
GET /admin/payments/paypal/failures
```

Reporting reuses provider-neutral SQL helpers and filters by:

```text
provider = 'paypal'
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
PayPal reconciliation runs requiring review
```

## Tests Added

Added coverage for:

```text
PayPal provider adapter implements provider interface
PayPal deposit intent creation
PayPal callback signature verification
tampered PayPal reference detection
PayPal pilot gating
PayPal callback processing into wallet repository
PayPal deposit HTTP endpoint
PayPal callback signature header handling
PayPal admin reporting endpoints
```

Existing OneMoney, EcoCash, Innbucks, card, wallet ledger, provider callback, pilot, reconciliation, ride lifecycle, and websocket tests remain passing.

## Build Results

Initial sandboxed verification hit Windows Go build-cache access denial under:

```text
C:\Users\ntepemanamafm\AppData\Local\go-build
```

The escalated rerun was blocked by the environment usage-limit gate, so verification was rerun with a workspace-local Go build cache:

```text
$env:GOCACHE = (Resolve-Path .).Path + '\.gocache'
go test ./...          PASS
go build ./cmd/server  PASS
```

## Runtime Verification Plan

Before enabling PayPal internally:

```text
1. Confirm schema supports provider = paypal in payment_intents, provider_events, wallet ledger rows, withdrawals, and reconciliation_runs.
2. Keep PAYMENTS_PROVIDER_ENABLED=false and PAYPAL_ENABLED=false.
3. Confirm OneMoney, EcoCash, Innbucks, and card pilot behavior is unchanged.
4. Configure PAYPAL_WEBHOOK_SECRET in the internal environment.
5. Enable PAYMENTS_PROVIDER_ENABLED=true.
6. Enable PAYPAL_ENABLED=true.
7. Keep PAYPAL_PILOT_ONLY=true.
8. Add a pilot rider.
9. Create a PayPal deposit intent for the pilot rider.
10. Verify payment_intents provider = paypal and status = pending_provider_payment.
11. Send a signed paid PayPal callback.
12. Verify provider_events status processed.
13. Verify wallet_transactions transaction_type deposit and payment_provider paypal.
14. Verify ledger debits provider_clearing_wallet and credits rider_wallet.
15. Verify rider wallet cached_available_balance increases.
16. Replay the same callback and verify no duplicate wallet credit.
17. Send a tampered callback and verify provider_events records ignored without wallet credit.
18. Review /admin/payments/paypal/summary, /transactions, /reconciliation, and /failures.
19. Run wallet reconciliation and investigate any drift.
20. Roll back by setting PAYPAL_ENABLED=false or PAYMENTS_PROVIDER_ENABLED=false.
```

## Operational Risks

```text
real PayPal webhook signature verification differs from the pilot HMAC adapter
PAYPAL_WEBHOOK_SECRET must remain server-only
provider callbacks rely on signature verification rather than user authentication
provider clearing balances must be reconciled against PayPal settlement reports
ignored callbacks require operations review
PayPal withdrawals remain out of scope
public PayPal rollout remains blocked until provider certification, reconciliation, support runbooks, fraud controls, and finance signoff are complete
```

## Readiness Assessment

```text
GO V2.1-F5 PayPal Provider Pilot: IMPLEMENTED
PayPal provider adapter: IMPLEMENTED
Provider abstraction reuse: IMPLEMENTED
Deposit intent creation: IMPLEMENTED
Callback verification: IMPLEMENTED
Provider event audit: REUSED
Wallet crediting on verified callback: REUSED
Admin reporting APIs: IMPLEMENTED
Pilot-only activation: IMPLEMENTED
Feature flags: DEFAULT SAFE
Public PayPal payments: NOT ENABLED
PayPal withdrawals: NOT IMPLEMENTED
Ride lifecycle contracts: UNCHANGED
Websocket contracts: UNCHANGED
Wallet ledger core: UNCHANGED
```

Readiness for full financial platform review:

```text
READY FOR INTERNAL PROVIDER PILOT REVIEW
READY FOR CROSS-PROVIDER RECONCILIATION VALIDATION
NOT READY FOR PUBLIC PAYMENT LAUNCH
NOT READY FOR PAYPAL PRODUCTION CERTIFICATION
READY TO BEGIN FULL FINANCIAL PLATFORM REVIEW AFTER PROVIDER PILOTS RECONCILE CLEANLY
```
