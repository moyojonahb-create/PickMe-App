# PickMe V2.1-E Active Wallet Settlement Design Review

## Executive Summary

GO V2.1-E should convert the existing wallet foundation from observation and manual operations into controlled active ride settlement. This design does not activate settlement yet. It defines the financial rules, state machines, failure handling, reconciliation, and rollout controls required before PickMe allows wallet balances and driver liabilities to affect real marketplace money movement.

The architecture rule remains mandatory:

```text
Supabase = Storage
Go = Everything Smart
```

Supabase PostgreSQL stores wallet, ledger, settlement, dispute, and reconciliation records. Go owns settlement decisions, idempotency, account locking, balance checks, liability rules, refunds, dispute handling, reconciliation logic, admin workflows, and rollout controls.

The financial source of truth remains:

```text
immutable double-entry ledger entries
```

Cached balances are operational projections only. They must be rebuildable from ledger entries.

## Scope

V2.1-E designs active settlement for:

```text
cash rides
wallet rides
platform 15% commission
driver 85% earnings
driver cash liabilities
refunds
reversals
disputes
settlement reconciliation
liability management
operational reporting
safe rollout
```

Out of scope for this design phase:

```text
implementation code
database migrations
provider integrations
frontend changes
activation of settlement
changes to public.rides
changes to public.ride_offers
changes to websocket contracts
```

## 1. Architecture

### Services

Active settlement should be owned by Go wallet services:

```text
Wallet Service
Settlement Service
Liability Service
Refund Service
Dispute Service
Reconciliation Service
Admin Finance Service
```

### Wallet Service

Responsibilities:

```text
own wallet accounts
derive balances from ledger
lock accounts during financial posting
validate double-entry transactions
enforce idempotency
prevent negative available balances
create reversal transactions
expose wallet history
```

### Settlement Service

Responsibilities:

```text
settle completed rides
calculate platform fee
calculate driver earnings
post active settlement ledgers
maintain settlement state machine
retry failed settlement safely
emit settlement audit records
```

### Liability Service

Responsibilities:

```text
track cash ride platform fee liabilities
age outstanding liabilities
record repayments
calculate driver liability limits
recommend driver restrictions
produce liability reports
```

### Refund Service

Responsibilities:

```text
create full refunds
create partial refunds
create admin refunds
create dispute refunds
post reversal ledger entries
enforce refund idempotency
preserve original settlement audit trail
```

### Dispute Service

Responsibilities:

```text
accept rider and driver disputes
place settlement holds
track investigation status
record evidence metadata
resolve disputes
trigger refunds or releases
produce dispute analytics
```

### Reconciliation Service

Responsibilities:

```text
daily settlement reconciliation
wallet balance reconciliation
driver liability reconciliation
provider clearing reconciliation when providers are added
detect ledger imbalance
detect missing settlement records
detect duplicate settlement records
detect negative wallet balances
```

## 2. Cash Ride Settlement

Business rule:

```text
Rider pays driver directly.
PickMe earns 15%.
Driver owes PickMe the 15% platform fee.
```

For fare `F`:

```text
platform_fee = round(F * 0.15)
driver_keeps_cash = F
driver_net_after_liability = F - platform_fee
```

### Cash Settlement Ledger

At ride completion:

```text
Debit: driver cash_liability_wallet       platform_fee
Credit: platform_wallet                   platform_fee
```

This records PickMe revenue and the driver's payable liability. It does not debit the rider wallet and does not credit the driver wallet because cash moved outside PickMe.

### Liability Tracking

Each cash ride creates or increases:

```text
driver outstanding liability
liability age
liability source ride_id
liability due date
liability status
```

Recommended liability states:

```text
open
partially_paid
paid
overdue
waived
disputed
written_off
```

### Liability Repayment

Repayment options:

```text
driver wallet top-up
manual admin cash collection
deduction from future wallet ride earnings
provider payment when integrations exist
```

Repayment ledger example:

```text
Debit: provider_clearing_wallet or driver_wallet
Credit: driver cash_liability_wallet
```

If repayment is collected manually:

```text
Debit: provider_clearing_wallet
Credit: driver cash_liability_wallet
```

### Suspension Thresholds

Go should calculate restriction recommendations from liability state:

```text
warning threshold: outstanding liability >= configured amount
soft restriction: overdue liability age > configured days
hard restriction: liability exceeds maximum driver credit limit
manual review: repeated overdue liabilities or repayment failures
```

Restrictions should be feature-flagged and advisory first. They must not block drivers until operations has verified accuracy and support workflows.

## 3. Wallet Ride Settlement

Business rule:

```text
Rider wallet pays the full fare.
Driver wallet receives 85%.
Platform wallet receives 15%.
```

For fare `F`:

```text
platform_fee = round(F * 0.15)
driver_earning = F - platform_fee
```

### Wallet Settlement Ledger

At ride completion:

```text
Debit: rider_wallet        full fare
Credit: driver_wallet      driver_earning
Credit: platform_wallet    platform_fee
```

### Atomicity

The following must happen in one database transaction:

```text
lock settlement_record for ride_id
lock rider wallet account
lock driver wallet account
lock platform wallet account
check idempotency key
check rider available balance
create wallet_transaction
create balanced wallet_ledger_entries
update settlement_record status
update cached balances if used
write audit metadata
commit
```

If any step fails, the whole settlement transaction rolls back.

### Rollback Protection

Rollback rules:

```text
posted ledger entries are never updated or deleted
failed in-flight transaction rolls back before posting
posted settlement correction uses reversal transaction
duplicate retry must return existing settlement result
```

Idempotency key:

```text
ride-settlement:{ride_id}:{payment_method}
```

## 4. Failed Settlement Handling

### Insufficient Rider Balance

If wallet ride settlement lacks funds:

```text
settlement_records.status = failed
failure_reason = insufficient_balance
no ledger entries posted
ride lifecycle policy remains separate
admin and rider remediation workflow opens
```

Activation decision:

Before public wallet payments, PickMe should reserve or authorize wallet balance before ride acceptance or before ride start. Settlement at completion should not discover insufficient balance for the first time.

### Settlement Timeout

If settlement processing times out:

```text
status = failed or processing_timeout
retry_allowed = true
idempotency key preserved
no duplicate ledger posting
```

Retries must reload settlement state and ledger transaction by idempotency key before attempting new writes.

### Partial Failure

Partial posted ledgers should not exist if settlement is atomic. If a rare database or operational inconsistency is detected:

```text
mark settlement as reconciliation_required
block automated retry
require finance/admin review
create correction only through reversal transaction
```

### Retry Strategy

Retry classes:

```text
safe retry: timeout before commit, transient DB error, lock timeout
manual retry: reconciliation mismatch, unknown transaction status
no retry: insufficient balance, invalid ride state, unsupported payment method
```

## 5. Refund System

Refunds must be explicit ledger transactions referencing the original settlement.

### Full Refund

Wallet ride full refund:

```text
Debit: platform_wallet
Debit: driver_wallet
Credit: rider_wallet
```

The split depends on business policy. PickMe may choose to absorb the refund instead:

```text
Debit: platform_wallet
Credit: rider_wallet
```

### Partial Refund

Partial refunds must record:

```text
original settlement_id
refund_amount
refund_reason
refund_policy
admin_user_id if admin initiated
driver_share_reversed
platform_share_reversed
```

### Admin Refund

Admin refunds require:

```text
admin_user_id
reason
approval metadata
idempotency key
linked ride_id
linked original transaction_id
```

Large refunds should require dual approval before ledger posting.

### Dispute Refund

Dispute refunds are triggered only after dispute resolution:

```text
dispute status = resolved_refund
refund transaction posted
settlement status = reversed or partially_reversed
audit event recorded
```

## 6. Dispute Model

Disputes should be additive and independent from ride lifecycle.

### Dispute Actors

```text
rider dispute
driver dispute
admin-created dispute
system-created dispute from reconciliation anomaly
```

### Dispute States

```text
opened
under_review
awaiting_rider
awaiting_driver
settlement_held
resolved_no_change
resolved_refund
resolved_driver_credit
resolved_platform_adjustment
closed
```

### Settlement Hold

A hold prevents withdrawals from affected earnings while preserving ledger truth.

Recommended approach:

```text
do not mutate original ledger
create hold/reservation record
reduce available balance projection
release hold or post reversal on resolution
```

### Investigation Metadata

Store:

```text
ride_id
rider_id
driver_id
settlement_id
opened_by
reason
evidence references
admin notes
resolution
created_at
resolved_at
```

## 7. Driver Liability Management

### Liability Aging

Liabilities should be bucketed:

```text
0-1 days
2-7 days
8-14 days
15-30 days
30+ days
```

### Reports

Required liability reports:

```text
driver outstanding liability
driver liability age
liability created today
liability repaid today
overdue liabilities
drivers near restriction threshold
liability write-offs
liability disputes
```

### Driver Restrictions

Restriction levels:

```text
none
warning
cash_ride_limited
cash_ride_blocked
all_dispatch_blocked
manual_review_required
```

Restriction should not be enforced until:

```text
liability calculations are validated
support runbooks exist
drivers have repayment paths
admin override is available
```

## 8. Settlement State Machine

Settlement states:

```text
pending
processing
settled
failed
reversed
disputed
```

### Transitions

```text
pending -> processing
processing -> settled
processing -> failed
failed -> processing
settled -> disputed
settled -> reversed
disputed -> settled
disputed -> reversed
disputed -> failed
```

Invalid transitions:

```text
settled -> processing
reversed -> settled
reversed -> processing
failed -> settled without processing
```

### State Meaning

**pending**

Settlement record exists, ledger not posted.

**processing**

Go has acquired settlement lock and is attempting ledger posting.

**settled**

Ledger transaction posted and balanced.

**failed**

Settlement did not post. Failure reason is recorded.

**disputed**

Settlement is under investigation. Funds may be held from withdrawal availability.

**reversed**

Original settlement has been corrected through reversal/refund ledger entries.

## 9. Reconciliation Strategy

### Daily Reconciliation

Daily reconciliation should verify:

```text
all completed rides have settlement_records
all settled settlement_records have wallet_transactions
all wallet_transactions balance debits and credits
all ledger currencies match transaction currency
cached balances match ledger-derived balances
cash liabilities match completed cash rides
wallet ride debits equal driver credits plus platform credits
```

### Settlement Reconciliation

Checks:

```text
one settlement per completed ride
no duplicate active settlement idempotency keys
settlement amount equals ride fare
platform fee equals 15%
driver earning equals fare - platform fee
payment_method-specific ledger shape is correct
```

### Wallet Reconciliation

Checks:

```text
ledger-derived available balance
cached available balance
held balance
pending balance
negative balance violations
orphan ledger entries
missing wallet account rows
```

### Liability Reconciliation

Checks:

```text
cash ride platform fee liabilities created
liability repayments applied
liability aging correct
overdue thresholds correct
driver restriction recommendations consistent
```

## 10. Operational Reporting

Finance dashboards:

```text
platform revenue by day
platform revenue by payment method
driver earnings by day
cash liability created by day
cash liability outstanding
cash liability repaid
wallet settlement volume
failed settlement count
refund volume
dispute volume
reversal volume
ledger imbalance count
reconciliation mismatch count
```

Operations dashboards:

```text
settlements pending
settlements processing too long
settlements failed by reason
drivers over liability threshold
drivers restricted by liability
refund requests pending
disputes under review
admin adjustments by admin
```

Audit exports:

```text
ledger entries by transaction
settlement records by ride
refund and reversal chains
admin action logs
daily reconciliation summaries
driver liability statements
```

## 11. Activation Strategy

### Phase 1: Shadow Only

Keep existing V2.1-C shadow settlement:

```text
calculate settlement
write shadow settlement_records
write shadow ledger entries
do not affect balances
do not block ride completion
```

Exit criteria:

```text
platform fee calculations verified
cash and wallet ledger shapes verified
zero ride completion regressions
reconciliation reports explain all shadow records
```

### Phase 2: Internal Testing

Enable active settlement only for internal accounts:

```text
wallet payment method available only to test users
cash liability enforcement disabled
refunds admin-only
settlement failures visible but non-public
```

Exit criteria:

```text
no duplicate settlements
no ledger imbalance
no negative balances
successful rollback drills
admin can resolve failed settlement
```

### Phase 3: Limited Driver Cohort

Enable:

```text
cash liability accounting for selected drivers
wallet settlements for selected riders/drivers
manual liability repayment
admin dispute/refund workflow
```

Do not yet enforce hard dispatch restrictions unless operations signs off.

Exit criteria:

```text
liability reporting accurate
drivers understand repayment process
refund workflow proven
dispute holds do not break withdrawals
```

### Phase 4: Public Activation

Enable:

```text
wallet ride payments
cash liability tracking
standard refund workflow
driver withdrawal availability based on ledger-derived balance
liability-based restrictions after grace period
```

Public activation requires:

```text
daily reconciliation green
support runbooks complete
admin audit reviewed
rollback path tested
finance approval
CTO approval
```

## 12. Risk Review

### Double Settlement

Risk:

```text
same completed ride posts settlement twice
```

Controls:

```text
unique settlement ride_id
unique idempotency key
settlement row lock
transaction lookup before posting
retry returns existing result
```

### Lost Settlement

Risk:

```text
ride completed but no settlement posted
```

Controls:

```text
daily completed-ride reconciliation
pending settlement job
admin failed settlement dashboard
manual retry workflow
```

### Duplicate Completion

Risk:

```text
ride completion endpoint is retried
```

Controls:

```text
existing ride lifecycle conflict protection
settlement idempotency independent of ride endpoint idempotency
one settlement per ride
```

### Negative Balances

Risk:

```text
rider wallet or driver wallet goes below zero
```

Controls:

```text
account row locks
available balance check inside transaction
holds for pending withdrawals/disputes
ledger-derived balance rebuilds
negative balance reconciliation alert
```

### Admin Mistakes

Risk:

```text
incorrect refund, adjustment, or liability waiver
```

Controls:

```text
admin action audit
reason required
dual approval for large amounts
reversal-only correction
permission tiers
daily admin action review
```

### Provider Outages

Risk:

```text
provider-funded deposits, withdrawals, or repayment channels fail
```

Controls:

```text
provider clearing accounts
pending states
manual reconciliation
retry queues
provider-specific outage mode
no direct ledger posting from unverified callback
```

## 13. Implementation Roadmap

### V2.1-E1: Active Settlement Core

Deliverables:

```text
settlement state machine
active settlement feature flag
account locking
wallet ride balance checks
cash liability posting
settlement idempotency
active settlement tests
```

Recommended mode:

```text
internal accounts only
```

### V2.1-E2: Liability Management

Deliverables:

```text
liability records
liability aging
liability repayment ledger flow
liability reports
restriction recommendations
admin override design
```

Recommended mode:

```text
advisory restrictions only
```

### V2.1-E3: Refunds and Disputes

Deliverables:

```text
refund transaction model
partial refund support
dispute records
settlement holds
admin resolution endpoints
refund/reversal reconciliation
```

Recommended mode:

```text
admin-only refunds
```

### V2.1-E4: Reconciliation and Public Activation Gate

Deliverables:

```text
daily reconciliation jobs
ledger balance rebuild
settlement mismatch reports
finance dashboards
runbooks
activation checklist
rollback drills
```

Recommended mode:

```text
public activation only after finance and CTO signoff
```

## 14. Final Readiness Assessment

```text
V2.1-E Active Wallet Settlement: APPROVED FOR DESIGN
Implementation: NOT STARTED
Migrations: NOT CREATED
Settlement activation: NOT ENABLED
Production ride flow: UNCHANGED
Frontend contracts: UNCHANGED
Websocket contracts: UNCHANGED
```

Readiness for implementation:

```text
READY TO IMPLEMENT V2.1-E1 ACTIVE SETTLEMENT CORE
NOT READY FOR PUBLIC WALLET PAYMENT ACTIVATION
NOT READY FOR CASH LIABILITY ENFORCEMENT
NOT READY FOR AUTOMATED PROVIDER-DEPENDENT SETTLEMENT
```

Required before activation:

```text
1. Keep shadow settlement running and reconciled.
2. Implement active settlement behind feature flags.
3. Validate account locking and idempotency under concurrent retries.
4. Prove daily reconciliation detects duplicate, missing, and imbalanced settlements.
5. Train operations on failed settlement, refund, dispute, and liability workflows.
6. Get finance and CTO signoff before public rollout.
```
