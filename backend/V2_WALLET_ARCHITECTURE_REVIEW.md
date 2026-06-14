# PickMe V2.1 Wallet Architecture Review

## Executive Summary

PickMe V2.1 should introduce a ledger-first wallet and settlement platform without changing the current production ride lifecycle.

The mandatory architecture rule remains:

```text
Supabase = Storage
Go = Everything Smart
```

Supabase PostgreSQL stores durable financial records. Go owns wallet rules, settlement decisions, provider handling, reconciliation logic, admin approval workflows, fraud checks, and all business decisions.

The core financial principle is non-negotiable:

```text
Immutable ledger entries are the source of truth.
Cached balances are derived data only.
```

V2.1 must launch first in shadow/accounting mode. Ride completion must not fail because of wallet settlement until wallet correctness, reconciliation, and operational workflows have been validated in staging and production observation.

## Scope

V2.1 wallet infrastructure must support:

```text
rider wallet
driver wallet
platform wallet
deposits
withdrawals
ride settlement
15% platform commission
refunds
reversals
admin approvals
provider reconciliation
financial auditability
```

Payment methods:

```text
Cash
EcoCash
Innbucks
Visa
Mastercard
PayPal
```

Out of scope for this architecture phase:

```text
implementation code
database migrations
active wallet settlement
ride lifecycle changes
websocket contract changes
frontend changes
provider production credentials
```

## 1. Wallet Service Architecture

### Wallet Service Responsibilities

The Wallet Service owns PickMe financial truth.

Responsibilities:

```text
create wallet accounts
record immutable ledger entries
derive balances
enforce double-entry accounting
enforce idempotency
prevent negative available balances
settle completed rides
record platform fees
record driver earnings
record cash liabilities
process refunds and reversals
expose wallet balances and transaction history
produce financial audit trails
```

The Wallet Service must not depend on mutable balance updates as truth. Every state change must be traceable to a transaction group and ledger entries.

### Payment Service Responsibilities

The Payment Service integrates with external providers:

```text
EcoCash
Innbucks
Visa
Mastercard
PayPal
```

Responsibilities:

```text
create payment intents
submit provider charge or payout requests
receive provider callbacks
normalize provider statuses
verify callback signatures
deduplicate provider events
store provider references
retry safe provider operations
send approved financial events to Wallet Service
```

Payment Service does not decide marketplace settlement rules. It handles provider communication and returns verified payment facts to Go wallet logic.

### Admin Approval Responsibilities

Admin workflows are required for high-risk or manually verified movements:

```text
manual deposit approval
withdrawal approval
withdrawal rejection
admin adjustment approval
refund approval
reconciliation exception resolution
cash liability correction
```

Admin actions must be recorded with:

```text
admin_user_id
action
reason
before status
after status
timestamp
metadata
```

Admin approval does not directly mutate balances. It authorizes Go to create ledger transaction groups.

### Reconciliation Responsibilities

Reconciliation compares PickMe ledger state with provider facts.

Responsibilities:

```text
match provider events to payment intents
match deposits to provider confirmations
match withdrawals to payout confirmations
detect missing callbacks
detect duplicate callbacks
detect amount mismatches
detect currency mismatches
detect settlement mismatches
produce reconciliation runs
flag manual review items
```

### Risk and Fraud Responsibilities

Risk checks should be a decision layer inside Go, not Supabase.

Initial controls:

```text
deposit velocity checks
withdrawal velocity checks
device/session risk checks
duplicate callback detection
large withdrawal review
negative balance prevention
cash liability monitoring
driver cash debt thresholds
admin action audit
```

Risk may block or require manual approval for wallet operations. It should not rewrite ledger history.

## 2. Wallet Account Model

Wallet accounts represent accounting buckets, not just user balances.

Recommended wallet account types:

```text
rider_wallet
driver_wallet
platform_wallet
cash_liability_wallet
pending_deposit_wallet
provider_clearing_wallet
```

### Account Types

**rider_wallet**

Stores spendable rider funds. Used for wallet ride payments, refunds, and promotional credits if added later.

**driver_wallet**

Stores driver earnings and payable balances. Used for ride earnings, bonuses, cash liability offsets, and withdrawals.

**platform_wallet**

Stores PickMe platform revenue, including the 15% commission.

**cash_liability_wallet**

Tracks money owed to PickMe by drivers for cash rides. Cash rides do not move rider funds through PickMe, but the platform fee must still be recorded as driver liability.

**pending_deposit_wallet**

Temporary holding account for deposits that have been initiated but not confirmed or approved.

**provider_clearing_wallet**

Represents settlement in transit between PickMe and external providers. Used for card/mobile-money clearing, withdrawal settlement, and provider reconciliation.

### Balance Types

Each account may expose derived balances:

```text
available_balance
pending_balance
held_balance
liability_balance
```

These may be cached for performance, but must be rebuildable from ledger entries.

## 3. Ledger Model

PickMe should use immutable double-entry accounting.

Every financial transaction creates:

```text
one transaction group
two or more ledger entries
total debits == total credits
one idempotency key
one source reference
auditable metadata
```

### Core Ledger Concepts

**wallet_transactions**

Transaction group header.

Fields:

```text
id
transaction_type
status
idempotency_key
currency
total_amount
source_type
source_id
ride_id
payment_provider
payment_intent_id
created_by
approved_by
approved_at
metadata jsonb
created_at
updated_at
```

Statuses:

```text
pending
posted
reversed
failed
cancelled
requires_approval
```

**wallet_ledger_entries**

Immutable debit/credit lines.

Fields:

```text
id
transaction_id
account_id
entry_type debit|credit
amount
currency
ride_id
source_type
source_id
payment_provider
metadata jsonb
created_at
```

Rules:

```text
entries are append-only
posted entries are never updated
corrections use reversal entries
debits and credits must balance per transaction
```

**wallet_accounts**

Stores account identity and cached balances.

Fields:

```text
id
owner_user_id
owner_role
account_type
currency
status
cached_available_balance
cached_pending_balance
cached_liability_balance
last_ledger_entry_id
created_at
updated_at
```

Cached balances are operational convenience only.

## 4. Ride Settlement Flow

Platform fee:

```text
15% of completed ride fare
```

Driver gross earning:

```text
85% of completed ride fare
```

### Cash Ride Settlement

Business rule:

```text
Rider pays driver directly.
Driver owes PickMe 15% platform fee.
```

Ledger effect:

```text
Debit: driver cash liability account        15% platform fee
Credit: platform revenue account            15% platform fee
```

Optional informational record:

```text
driver_cash_collected = full fare
driver_net_after_fee = 85% fare
platform_fee_due = 15% fare
```

No rider wallet debit occurs for cash rides.

### Wallet Ride Settlement

Business rule:

```text
Rider wallet pays full fare.
Driver wallet receives 85%.
Platform wallet receives 15%.
```

Ledger effect:

```text
Debit: rider wallet                         100% fare
Credit: driver wallet                        85% fare
Credit: platform revenue account             15% fare
```

The rider wallet debit must be blocked if available funds are insufficient once active settlement is enabled.

### Failed Payment

If external payment fails:

```text
payment_intent status = failed
no posted wallet settlement
ledger transaction status = failed or not created
provider event recorded
```

Ride lifecycle should not be coupled to provider failure until active wallet settlement is launched.

### Refund

Full refund:

```text
Debit: platform revenue account, if commission reversal required
Debit: driver wallet, if driver earning reversal required
Credit: rider wallet
```

Partial refund:

```text
same pattern, proportional or rule-driven amount
```

Refunds must reference the original transaction and use a new reversal transaction group.

### Cancelled Ride

Cancellation settlement depends on cancellation policy:

```text
no charge
cancellation fee
driver compensation
platform fee
```

V2.1 should support this ledger shape but not activate cancellation settlement until ride cancellation rules exist.

### Admin Adjustment

Admin adjustments create explicit transaction groups:

```text
transaction_type = admin_adjustment
requires approved_by
requires reason
requires metadata
```

No manual SQL balance edits are allowed.

## 5. Deposit Flow

Supported deposits:

```text
rider wallet deposit
driver top-up
cash liability top-up
```

### Deposit Lifecycle

1. User requests deposit.
2. Go creates `payment_intent`.
3. Go creates pending wallet transaction if needed.
4. Provider receives payment request.
5. Provider callback arrives.
6. Payment Service verifies callback signature.
7. Provider event is stored idempotently.
8. Go approves or rejects deposit.
9. Wallet Service posts ledger entries.

### Pending Deposit Ledger

On confirmed provider payment:

```text
Debit: provider clearing wallet
Credit: rider or driver wallet
```

If using pending holding first:

```text
Debit: provider clearing wallet
Credit: pending deposit wallet
Debit: pending deposit wallet
Credit: rider or driver wallet
```

### Duplicate Callback Handling

Use:

```text
provider_event_id unique
provider_reference unique per provider
idempotency_key unique
payment_intent_id
callback_signature_hash
```

Duplicate callbacks should return success to provider after confirming the original event was already processed.

## 6. Withdrawal Flow

### Driver Withdrawal Request

1. Driver requests withdrawal.
2. Go checks available driver wallet balance.
3. Go creates `withdrawal_request` with `pending_approval`.
4. Funds are held or reserved.
5. Admin approves or rejects.
6. Payment Service submits provider payout.
7. Provider callback confirms success/failure.
8. Wallet Service posts final ledger entries.

### Withdrawal Approval Ledger

On approval and payout processing:

```text
Debit: driver wallet
Credit: provider clearing wallet
```

On provider success:

```text
provider clearing wallet is reconciled against payout confirmation
```

On failed payout:

```text
Debit: provider clearing wallet
Credit: driver wallet
```

Rejected withdrawal:

```text
no final debit
release hold/reservation
record admin rejection reason
```

## 7. Platform Revenue

PickMe revenue is the 15% platform fee.

For every completed ride settlement:

```text
platform_fee = fare * 0.15
driver_earning = fare * 0.85
```

### Cash Ride Revenue

Cash rides create platform revenue and driver liability:

```text
driver owes PickMe 15%
platform recognizes fee receivable
```

Reports must distinguish:

```text
earned platform revenue
collected platform revenue
outstanding driver liability
overdue driver liability
```

### Wallet Ride Revenue

Wallet rides settle immediately in ledger:

```text
rider paid
driver credited 85%
platform credited 15%
```

## 8. API Surface

Recommended user endpoints:

```text
GET  /api/wallets/me
GET  /api/wallets/me/transactions
POST /api/wallets/deposits
POST /api/wallets/withdrawals
GET  /api/wallets/deposits/:id
GET  /api/wallets/withdrawals/:id
```

Recommended internal/admin endpoints:

```text
POST /internal/wallets/rides/:rideId/settle-shadow
POST /internal/wallets/rides/:rideId/settle
POST /admin/wallets/deposits/:id/approve
POST /admin/wallets/deposits/:id/reject
POST /admin/wallets/withdrawals/:id/approve
POST /admin/wallets/withdrawals/:id/reject
GET  /admin/wallets/reconciliation
GET  /admin/wallets/reconciliation/:id
GET  /admin/wallets/platform-revenue
GET  /admin/wallets/driver-liabilities
GET  /admin/wallets/failed-settlements
```

Provider callback endpoints:

```text
POST /api/payments/ecocash/callback
POST /api/payments/innbucks/callback
POST /api/payments/card/callback
POST /api/payments/paypal/callback
```

Callbacks must verify signatures and never trust client-supplied status alone.

## 9. Database Schema Proposal

Additive tables only:

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

### wallet_accounts

Purpose:

```text
financial accounts by user or platform entity
```

Important constraints:

```text
unique(owner_user_id, account_type, currency)
status in active, frozen, closed
cached balances cannot be treated as source of truth
```

### wallet_transactions

Purpose:

```text
transaction group header
```

Important constraints:

```text
unique(idempotency_key)
status controlled by Go
posted transactions cannot be mutated
```

### wallet_ledger_entries

Purpose:

```text
immutable debit and credit entries
```

Important constraints:

```text
append-only
amount > 0
entry_type in debit, credit
currency required
transaction_id required
```

### payment_intents

Purpose:

```text
provider payment attempt state
```

Fields:

```text
id
user_id
amount
currency
provider
payment_method
status
provider_reference
idempotency_key
expires_at
metadata
created_at
updated_at
```

### provider_events

Purpose:

```text
raw provider callback audit and dedupe
```

Fields:

```text
id
provider
provider_event_id
provider_reference
event_type
signature_valid
payload_hash
payload jsonb
received_at
processed_at
status
```

### withdrawal_requests

Purpose:

```text
driver payout request lifecycle
```

Statuses:

```text
pending_approval
approved
rejected
processing
paid
failed
cancelled
```

### settlement_records

Purpose:

```text
ride settlement audit record
```

Fields:

```text
id
ride_id
driver_id
rider_id
fare
platform_fee
driver_earning
payment_method
settlement_mode shadow|active
status
wallet_transaction_id
error
created_at
updated_at
```

### reconciliation_runs

Purpose:

```text
provider and ledger reconciliation batch tracking
```

Fields:

```text
id
provider
run_type
status
started_at
completed_at
matched_count
mismatch_count
missing_provider_count
missing_ledger_count
metadata jsonb
```

## 10. Security and Integrity

### Double Spending

Controls:

```text
transaction isolation
row-level account locking in Go transaction
available balance check before posting debit
idempotency key per client financial operation
ledger balancing validation
```

### Duplicate Callbacks

Controls:

```text
unique provider_event_id
unique provider_reference where appropriate
payload hash
idempotent callback processing
safe duplicate success response
```

### Replay Attacks

Controls:

```text
provider signature verification
timestamp tolerance
nonce or event id uniqueness
payload hash comparison
reject stale callbacks
```

### Negative Balance Prevention

Controls:

```text
available balance check inside DB transaction
wallet account row lock
hold/reservation for withdrawals
no direct mutable balance edits
```

### Unauthorized Withdrawals

Controls:

```text
JWT auth
owner checks
driver role checks
withdrawal account ownership
admin approval for payouts
device/session risk checks
```

### Admin Abuse

Controls:

```text
admin action audit
dual approval for large adjustments
reason required
no manual ledger mutation
admin permission tiers
reconciliation review
```

### Ledger Tampering

Controls:

```text
append-only ledger design
no update/delete APIs for posted entries
reversal transactions only
periodic ledger balance checks
hash chain optional in later phase
restricted database grants
```

## 11. Operational Reporting

Required reports:

```text
platform revenue by day
platform revenue by payment method
driver earnings by day
rider wallet balances
driver wallet balances
pending deposits
pending withdrawals
failed settlements
cash liability by driver
overdue driver liabilities
provider clearing balances
reconciliation mismatches
refunds and reversals
admin adjustments
```

Critical dashboards:

```text
total platform revenue
collected revenue
uncollected cash liability
withdrawal backlog
deposit failure rate
provider callback delay
ledger imbalance count
reconciliation mismatch count
negative balance attempts
```

## 12. Migration Strategy

Migration must be zero-disruption.

### Phase 1: Add Wallet Schema

Add wallet tables only. No ride behavior changes.

### Phase 2: Create Wallet Accounts

Backfill accounts for existing riders, drivers, and platform entities.

### Phase 3: Shadow Settlement

After ride completion:

```text
attempt shadow settlement
write settlement_records
write ledger transaction in shadow mode
log warning on failure
do not fail ride completion
```

### Phase 4: Reconciliation

Run reports against:

```text
completed rides
settlement_records
wallet_transactions
wallet_ledger_entries
provider_events
```

### Phase 5: Admin Deposit/Withdrawal Flow

Enable deposit and withdrawal records with admin approval, still isolated from ride completion.

### Phase 6: Active Wallet Settlement

Only after staging validation:

```text
wallet rides require sufficient rider balance
ride completion posts active settlement
provider-funded wallet deposits are reconciled
withdrawal flow is operational
rollback plan tested
```

Cash rides continue working throughout.

## 13. Risk Review

### Financial Risks

```text
ledger imbalance
duplicate provider callback credit
incorrect platform fee calculation
negative wallet balance
unreconciled provider clearing balance
cash liability under-collection
```

### Operational Risks

```text
admin approval backlog
manual reconciliation workload
provider downtime
withdrawal payout delays
support team unable to explain balances
```

### Fraud Risks

```text
fake deposit callbacks
withdrawal account takeover
driver cash liability avoidance
refund abuse
admin collusion
duplicate payout attempts
```

### Technical Risks

```text
race conditions on balance checks
idempotency gaps
incorrect rollback behavior
long-running DB transactions
insufficient observability
schema exposed through Supabase Data API without correct RLS posture
```

## 14. Implementation Phases

### V2.1-A Wallet Architecture

Deliverable:

```text
architecture review and implementation plan
```

Status:

```text
this document
```

### V2.1-B Ledger Schema

Deliverables:

```text
additive wallet SQL
ledger constraints
idempotency constraints
RLS posture
repository interfaces
unit tests for balancing rules
```

### V2.1-C Shadow Settlement

Deliverables:

```text
ride completion shadow settlement hook
cash ride liability calculation
wallet ride hypothetical settlement
settlement_records
non-blocking failure behavior
```

### V2.1-D Deposit and Withdrawal Admin Flow

Deliverables:

```text
deposit request lifecycle
withdrawal request lifecycle
admin approval endpoints
provider event audit
manual reconciliation views
```

### V2.1-E Active Wallet Settlement

Deliverables:

```text
wallet payment method activation
available balance enforcement
active ledger posting
refund/reversal support
cash liability enforcement policy
```

### V2.1-F Provider Integrations

Deliverables:

```text
EcoCash integration
Innbucks integration
Visa/Mastercard integration
PayPal integration
provider callback verification
provider reconciliation jobs
```

## Final Recommendation

PickMe should approve V2.1 wallet infrastructure only as a ledger-first architecture.

Recommended launch posture:

```text
1. Build immutable ledger tables.
2. Run ride settlement in shadow mode first.
3. Validate platform fee, driver earning, and cash liability calculations.
4. Add deposits and withdrawals with admin approval.
5. Reconcile provider events before allowing active settlement.
6. Activate wallet rides only after staging and operational validation.
```

Final architecture classification:

```text
V2.1 Wallet Infrastructure: APPROVED FOR DESIGN
Implementation: NOT STARTED
Migrations: NOT CREATED
Production ride flow: UNCHANGED
Wallet settlement: NOT ACTIVATED
```
