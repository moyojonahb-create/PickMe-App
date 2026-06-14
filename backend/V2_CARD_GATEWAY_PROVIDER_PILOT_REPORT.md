# PickMe GO V2.1-F4 Card Gateway Provider Pilot Report

## Summary

GO V2.1-F4 card gateway provider framework and pilot integration is implemented behind default-off controls.

This phase creates a card processor abstraction and a mock card processor for internal pilot testing. It does not launch public card payments, PayPal, real card acquiring, ride lifecycle changes, frontend changes, websocket changes, or a separate wallet ledger path.

Architecture remains:

```text
Supabase = Storage
Go = Everything Smart
```

## Files Changed

```text
cmd/server/main.go
internal/config/config.go
internal/payments/card.go
internal/payments/http.go
internal/payments/http_test.go
internal/payments/reporting.go
internal/payments/service.go
internal/payments/service_test.go
internal/wallet/schema_test.go
internal/wallet/types.go
WALLET_LEDGER_SCHEMA.sql
V2_CARD_GATEWAY_PROVIDER_PILOT_REPORT.md
```

## Architecture

Cards reuse the existing provider-neutral wallet infrastructure:

```text
payment_intents
provider_events
wallet_transactions
wallet_ledger_entries
wallet_accounts
reconciliation_runs
admin provider reporting
```

No duplicate payment system, ledger engine, wallet posting path, reconciliation path, or audit model was introduced.

## Processor Abstraction

Added:

```text
internal/payments/card.go
CardProcessor
MockCardProcessor
```

Processor capabilities:

```text
CreatePaymentIntent
Authorize
Capture
Void
Refund
GetTransactionStatus
GetProcessorName
```

The mock processor is a sandbox reference adapter only. It stores processor references and event IDs, not raw card numbers, PAN, CVV, CVC, expiry, or cardholder data.

## Feature Flags

Added:

```text
CARD_PAYMENTS_ENABLED=false
CARD_PILOT_ONLY=true
```

Cards also respect:

```text
PAYMENTS_PROVIDER_ENABLED=false
```

Default behavior:

```text
payment provider framework disabled
card payments disabled
card access pilot-only when enabled
no public card activation
```

## Authorization Model

Supported processor states:

```text
pending
authorized
captured
voided
refunded
failed
```

Authorization is owned by the card processor abstraction. Wallet ledger posting does not happen until capture succeeds.

## Capture Model

Pilot card deposit flow:

```text
pilot rider requests card deposit
Go checks PAYMENTS_PROVIDER_ENABLED
Go checks CARD_PAYMENTS_ENABLED
Go checks CARD_PILOT_ONLY and pilot eligibility
MockCardProcessor creates processor reference
MockCardProcessor authorizes amount
Go stores payment_intents row as pending_provider_payment
MockCardProcessor captures amount
Go records provider_events row
Go posts existing provider deposit ledger
Go credits rider wallet cached available balance
Go debits provider clearing cached balance
Go marks payment_intent completed
```

Ledger shape:

```text
Debit:  provider_clearing_wallet
Credit: rider_wallet
Amount: captured deposit amount
Transaction type: deposit
Payment provider: card
```

## Refund Model

Refund and void are implemented at the processor abstraction layer:

```text
Void
Refund
```

Wallet refund/reversal ledger posting remains a future controlled phase. This pilot does not expose public card refunds or automate wallet balance reversals.

## Security Controls

Implemented controls:

```text
no raw card data accepted or stored
pilot-only access gate
provider framework feature gate
card-specific feature gate
processor idempotency keys
duplicate capture prevention by processor reference
provider_events idempotency for captured wallet credit
existing wallet repository duplicate callback protection
existing ledger balance enforcement
```

Replay and duplicate protection reuse:

```text
provider_events(provider, provider_event_id)
payment_intents.idempotency_key
wallet_transactions.idempotency_key
```

## Reporting

Added JSON-only admin endpoints:

```text
GET /admin/payments/cards/summary
GET /admin/payments/cards/transactions
GET /admin/payments/cards/reconciliation
GET /admin/payments/cards/failures
```

Reporting reuses provider-neutral SQL helpers and filters by:

```text
provider = 'card'
```

## Tests Added

Added coverage for:

```text
CardProcessor interface compliance
mock card payment intent creation
authorization
capture
duplicate capture prevention
void
refund
no raw PCI-sensitive card fields in processor code
card pilot gating
card deposit wallet repository posting
card provider event callback posting
card deposit HTTP endpoint
card admin reporting endpoints
schema support for card provider and card processor states
```

Existing OneMoney, EcoCash, Innbucks, wallet ledger, provider callback, pilot, reconciliation, ride lifecycle, and websocket tests remain passing.

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

Before enabling card payments internally:

```text
1. Apply additive schema allowing provider = card and card processor states.
2. Keep PAYMENTS_PROVIDER_ENABLED=false and CARD_PAYMENTS_ENABLED=false.
3. Confirm existing OneMoney, EcoCash, and Innbucks pilot behavior is unchanged.
4. Enable PAYMENTS_PROVIDER_ENABLED=true in an internal environment.
5. Enable CARD_PAYMENTS_ENABLED=true.
6. Keep CARD_PILOT_ONLY=true.
7. Add a pilot rider.
8. Create a card deposit for the pilot rider without sending raw card data to PickMe.
9. Verify payment_intents provider = card and status = completed after mock capture.
10. Verify provider_events status processed.
11. Verify wallet_transactions transaction_type deposit and payment_provider card.
12. Verify ledger debits provider_clearing_wallet and credits rider_wallet.
13. Verify rider wallet cached_available_balance increases.
14. Retry the same card deposit idempotency key and verify no duplicate wallet credit.
15. Verify duplicate processor capture returns the existing capture.
16. Review /admin/payments/cards/summary, /transactions, /reconciliation, and /failures.
17. Run wallet reconciliation and investigate any drift.
18. Roll back by setting CARD_PAYMENTS_ENABLED=false or PAYMENTS_PROVIDER_ENABLED=false.
```

## Operational Risks

```text
MockCardProcessor is not a real acquiring integration
real processors will require certified tokenization and callback rules
PCI scope must remain constrained by never accepting raw card numbers
provider clearing balances must be reconciled against processor settlement reports
card refunds are processor-modeled but wallet reversal posting is not public or automated in this phase
public card rollout remains blocked until processor certification, reconciliation, support runbooks, and risk controls are complete
```

## Readiness Assessment

```text
GO V2.1-F4 Card Gateway Provider Pilot: IMPLEMENTED
Card processor abstraction: IMPLEMENTED
Mock processor adapter: IMPLEMENTED
Card authorization model: IMPLEMENTED
Card capture model: IMPLEMENTED
Card void model: IMPLEMENTED
Card refund model: IMPLEMENTED AT PROCESSOR LAYER
Wallet crediting on captured card deposit: REUSED
Provider event audit: REUSED
Admin reporting APIs: IMPLEMENTED
Pilot-only activation: IMPLEMENTED
Feature flags: DEFAULT SAFE
Raw card storage: NOT IMPLEMENTED
Public card payments: NOT ENABLED
PayPal: NOT IMPLEMENTED
Ride lifecycle contracts: UNCHANGED
Websocket contracts: UNCHANGED
Wallet ledger core: UNCHANGED
```

Readiness for PayPal:

```text
NOT READY FOR PAYPAL PUBLIC LAUNCH
READY TO USE PROVIDER/PROCESSOR PATTERN FOR PAYPAL DESIGN
READY TO ADD PAYPAL-SPECIFIC INTENT/CAPTURE/CALLBACK RULES AFTER CARD PILOT RECONCILES CLEANLY
READY TO KEEP WALLET LEDGER CORE UNCHANGED FOR FUTURE PAYMENT PROVIDERS
```
