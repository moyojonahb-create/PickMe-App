# PickMe GO V2.2 Full Financial Platform Audit

## Executive Summary

PickMe has a credible internal-pilot financial platform foundation. The architecture follows the required rule:

```text
Supabase = Storage
Go = Everything Smart
```

The strongest parts are:

```text
double-entry ledger design
transactional wallet posting paths
row-level account and settlement locking
idempotency keys
pilot-only provider activation
authorization holds before wallet ride completion
admin reporting surfaces
reconciliation run records
feature flags defaulting to off
```

The platform is not production-ready for public money movement. The main gaps are provider certification, exact money representation, durable settlement/capture retries, provider-statement reconciliation, refund/dispute reversals, atomic admin workflows, and stronger operational controls.

## Production Readiness Score

```text
Internal pilot readiness: 72 / 100
Public financial platform readiness: 44 / 100
Provider production readiness: 31 / 100
```

Assessment:

```text
READY for controlled internal wallet/provider pilot
NOT READY for public wallet payment activation
NOT READY for public provider deposits
NOT READY for automated withdrawals
NOT READY for provider production certification
```

## Risk Ranking

### P0 - Must Fix Before Public Money Movement

1. Provider verification is pilot-grade only.

Current providers use HMAC pilot adapters and stubbed provider status checks. Real OneMoney, EcoCash, Innbucks, PayPal, and card processors will require certified webhook verification, timestamp validation, certificate/key rotation, event type allowlists, and provider status confirmation.

Impact:

```text
forged callbacks
tampered payment confirmations
false wallet credits
provider dispute losses
regulatory audit failure
```

Required fix:

```text
implement provider-certified signature verification per provider
validate callback timestamps and replay windows
store provider raw event metadata safely
add provider status polling before/after wallet credit where required
add provider-specific webhook contract tests
```

2. No external provider statement reconciliation.

Current reconciliation checks wallet projections, ledger balances, open authorizations, settlement mismatches, and internal provider events. It does not reconcile against provider settlement files, processor reports, chargeback files, payout batches, bank statements, or provider balances.

Impact:

```text
ledger can be internally balanced but externally wrong
provider short-settlement can go undetected
failed provider captures can appear credited
chargebacks/refunds can be missed
finance cannot close daily books
```

Required fix:

```text
add provider_statement_imports
add provider_statement_lines
match provider lines to payment_intents/provider_events/wallet_transactions
track unmatched_provider, unmatched_ledger, amount_mismatch, currency_mismatch
block public launch until daily provider reconciliation is green
```

3. Money is represented as `float64` in Go.

The database uses numeric amounts, but Go service code uses `float64` and rounding helpers. This is acceptable for prototypes but not for production ledger systems.

Impact:

```text
rounding drift
edge-case imbalance
audit objections
multi-currency scaling risk
hard-to-reproduce settlement mismatches
```

Required fix:

```text
move all money calculations to integer minor units or decimal library
store currency exponent metadata
ban float64 from wallet/payment/settlement request and ledger types
add property tests for rounding, split, refund, and reversal calculations
```

4. Ride completion settlement side effects are asynchronous and not durable.

Cash settlement and wallet capture intentionally do not block ride completion, which is correct for the ride lifecycle. However, failed side effects are logged and partially recorded, not pushed into a durable retry queue with ownership, backoff, and operational recovery states.

Impact:

```text
completed ride without active settlement
captured wallet authorization stuck pending
cash liability missing or delayed
finance dashboard drift
manual recovery load
```

Required fix:

```text
add durable financial_jobs table
enqueue settlement/capture/release/expiration jobs
add retry state, next_attempt_at, attempt_count, failure_reason
add admin retry endpoint and runbook
alert on stale processing/failed jobs
```

5. Admin deposit/withdrawal approval is not fully atomic with final status and audit action.

Admin approval posts ledger entries, then updates the payment/withdrawal request, then writes admin action. These operations are split across repository/service calls. A partial failure can leave posted ledger entries without the expected request status or audit trail.

Impact:

```text
orphan ledger postings
admin action audit gaps
incorrect pending queues
duplicate manual repair
finance close exceptions
```

Required fix:

```text
wrap admin approval/rejection flows in one database transaction
lock target payment_intent or withdrawal_request FOR UPDATE
post ledger, update request, update cached balances, and write admin_action atomically
add reversal-only repair flow for already-posted partial failures
```

## P1 - Required Before Limited External Pilot Expansion

6. Provider callbacks can be accepted before confirmed provider status.

The callback verification path records provider events and credits wallets when the signed event says `paid`. There is no provider status polling or secondary confirmation path for providers that require it.

Required fix:

```text
support callback_received -> verifying -> confirmed -> credited states
call provider GetTransactionStatus for high-risk or delayed callbacks
add callback age limits and provider status mismatch handling
```

7. `payment_intents.provider_reference` is not clearly unique per provider.

Callback processing locks a payment intent by `(provider, provider_reference)`. If duplicate provider references exist, the query can fail or select ambiguously. Random references reduce the probability but do not eliminate the invariant risk.

Required fix:

```text
add UNIQUE(provider, provider_reference) WHERE provider_reference IS NOT NULL
add tests for duplicate provider reference rejection
```

8. Client-supplied idempotency keys are global.

Payment intent creation uses a globally unique idempotency key. If a second user submits the same key, repository lookup by idempotency key can return the existing intent. The service should scope idempotency to actor, operation, and provider.

Required fix:

```text
store actor_user_id + idempotency_key + operation
enforce UNIQUE(user_id, provider, idempotency_key)
on duplicate, verify same user, amount, currency, provider, and wallet account type
return conflict if request parameters differ
```

9. Refunds, reversals, disputes, and chargebacks are not production-complete.

Refund models exist in design and card processor abstraction, but provider deposit refunds and wallet reversal postings are not fully implemented across providers.

Required fix:

```text
implement refund_intents
link refund to original payment_intent and wallet_transaction
post reversal ledger entries only
support partial refunds
support chargeback received, won, lost
add dispute holds and withdrawal availability impact
```

10. Withdrawal automation is intentionally absent.

Manual/admin withdrawals exist, while provider `CreateWithdrawal` methods return disabled. This is safe for pilot but not complete for a financial platform.

Required fix:

```text
keep public withdrawals manual until provider payout reconciliation exists
add provider withdrawal state machine before automation
verify driver KYC/eligibility before payout
add withdrawal velocity and fraud controls
```

11. Authorization expiration worker lacks production-grade job coordination.

The expiration worker scans stale authorizations and expires them. It does not use job leasing, `SKIP LOCKED`, shard keys, distributed ownership, or durable worker state.

Required fix:

```text
move expiration into durable financial_jobs or scheduled reconciliation workflow
use row locking with SKIP LOCKED for batches
record worker run metrics
alert on expired_authorizations > threshold
```

12. Provider clearing account can go negative without external balance controls.

Deposits debit provider clearing and credit rider wallets. Negative provider clearing is acceptable as accounting for receivables, but production needs reconciliation to real provider settlement and ageing.

Required fix:

```text
add provider clearing ageing report
add settlement batch expected/received amounts
alert on provider clearing unresolved after SLA
```

## P2 - Required Before Public Launch

13. Reconciliation queries are full-scan oriented.

Wallet reconciliation aggregates accounts, ledger entries, authorizations, settlements, and liabilities. This will become expensive as ledger volume grows.

Required fix:

```text
add incremental reconciliation windows
add ledger account daily snapshots
partition large ledger/provider tables by month
index reconciliation query predicates
add reconciliation runtime and row-count metrics
```

14. Operational metrics are JSON reports, not live observability.

The platform exposes admin JSON dashboards, but production needs counters, alerts, SLOs, and incident surfaces.

Required fix:

```text
emit metrics for provider callbacks, duplicate callbacks, failed credits, settlement failures, expired holds, drift count
add alert thresholds
add daily close checklist
add incident runbooks
```

15. Admin permission model is too coarse.

Admin endpoints generally check `admin` or `service_role`. Financial operations need tiered permissions and dual approval for large or risky actions.

Required fix:

```text
add finance_viewer, finance_operator, finance_approver, finance_admin
enforce dual approval for large deposits, withdrawals, refunds, waivers
prevent same admin from request and approval
audit permission changes
```

16. Feature flags are environment-level, not live operational controls.

Default-off flags are good. Production rollout will need per-provider, per-cohort, per-country, per-currency, and emergency kill switches without process restarts.

Required fix:

```text
add server-side rollout config table
cache with short TTL
support provider kill switch
support max amount per provider/cohort
support fail-closed behavior
```

17. Liability enforcement is not ready.

Cash liabilities are recorded, but restriction enforcement, repayment workflows, driver communications, waivers, and write-offs are not production-complete.

Required fix:

```text
build liability repayment workflow
add admin waiver/write-off with dual approval
add driver statements
validate liability ageing against ledger daily
keep restrictions advisory until operations signs off
```

## Architecture Assessment

### Wallet Architecture

Strengths:

```text
account model separates rider, driver, platform, provider clearing, and cash liability accounts
cached balances are treated as operational projections
ledger-derived reconciliation exists
wallet authorization holds reduce available balance before wallet rides
pilot gating protects early wallet exposure
```

Weaknesses:

```text
money uses float64 in Go
cached balance mutation still creates operational drift risk
no ledger snapshot/rebuild command exposed as a controlled finance operation
withdrawal availability does not yet include full dispute/refund/chargeback holds
```

### Ledger

Strengths:

```text
double-entry validation exists before posting
ledger entries are append-only by schema trigger
transaction idempotency keys are unique
provider deposits and settlements share the same ledger tables
```

Weaknesses:

```text
admin posting workflows are not fully atomic with request state/audit updates
no explicit ledger correction/reversal service across all products
no daily ledger snapshot table
no standardized ledger metadata schema per source type
```

### Settlement

Strengths:

```text
cash settlement records platform fee or driver liability
wallet ride settlement captures from pre-authorized pending funds
ride completion is protected from settlement side-effect failure
settlement idempotency keys are deterministic
```

Weaknesses:

```text
settlement side effects are asynchronous without durable retry ownership
wallet capture failures only log warnings
cash liability enforcement and repayment are incomplete
no settlement SLA dashboard for stale pending/processing states
```

### Authorization and Expiration

Strengths:

```text
wallet rides reserve funds before ride broadcast
insufficient wallet funds block ride request before driver offer
release and expiration paths return funds to availability
expiration worker exists and is default-off
```

Weaknesses:

```text
authorization is created before ride row insert with best-effort release on insert failure
expiration worker is not durable/distributed
duplicate authorization does not validate same amount/currency on retry
no automated ride cancellation integration beyond service/admin release path
```

### Reconciliation

Strengths:

```text
wallet cached balance vs ledger/open hold reconciliation exists
settlement and liability mismatch counters exist
reconciliation run records are stored
provider reporting endpoints expose internal provider event state
```

Weaknesses:

```text
no external provider statement reconciliation
no bank/processor settlement reconciliation
no chargeback/refund reconciliation
full-scan approach will become expensive
no daily close workflow or signoff state
```

### Provider Integrations

Strengths:

```text
shared provider interface
shared callback processing path
shared provider event audit
pilot-only flags
provider-specific reporting endpoints reuse common reporting
```

Weaknesses:

```text
provider adapters are pilot placeholders
no real provider certification
no provider API status polling
no provider-specific event type allowlists
no callback timestamp/replay-window validation
no provider retry queues or dead-letter handling
```

## Fraud Vectors

```text
forged provider callbacks if pilot HMAC rules are mistaken for production
idempotency key reuse across users
admin-created deposits without dual approval
withdrawal approval without automated velocity checks
cash liability avoidance by drivers before enforcement exists
wallet authorization/capture failures creating service delivered without money movement
delayed provider callbacks after intent expiry requiring manual review
provider clearing imbalance hidden by internally balanced ledger
pilot percentage rollout accidentally exposing non-approved users
```

## Duplicate-Processing Risk Review

Good controls:

```text
provider_events unique provider_event_id
wallet_transactions unique idempotency_key
settlement_records unique idempotency_key
wallet_authorizations unique ride_id and idempotency_key
row locks on accounts, settlements, authorizations, and payment intents
```

Remaining risks:

```text
global idempotency key scope can collide across users
provider_reference uniqueness should be enforced
admin approval retry can partially post before request/audit update
card mock capture protects duplicate capture, but real processors need idempotency contract mapping
invalid callback events without matching intent are marked ignored but require operational review
```

## Scaling Bottlenecks

```text
full-ledger reconciliation scans
single platform provider clearing account per currency
expiration worker sequentially processes stale authorizations
provider reports query live operational tables
no ledger partitioning
no daily account balance snapshots
no durable async job queue for financial side effects
```

## Reporting Gaps

Missing required production reports:

```text
daily finance close summary with signoff
provider settlement batch reconciliation
unmatched provider events
unmatched ledger deposits
stale payment intents by provider
stale settlement_records processing/pending
wallet authorization ageing
provider clearing ageing
refund and chargeback exposure
admin action risk report by admin
cash liability repayment ageing
driver statement export
ledger correction/reversal chain export
```

## Required Fixes

Before internal provider pilot expansion:

```text
1. Add unique provider_reference constraint per provider.
2. Scope idempotency keys by user, provider, and operation.
3. Add provider callback replay-window checks.
4. Add durable financial_jobs for settlement/capture/release/reconciliation retries.
5. Add stale intent and stale settlement admin queues.
6. Add provider event dead-letter workflow.
7. Add exact-money integer/decimal migration plan.
```

Before public wallet rides:

```text
1. Make wallet capture retry durable.
2. Add failed capture remediation workflow.
3. Add cancellation-triggered release integration.
4. Validate authorization amount, fare adjustment, and unused release policies.
5. Add daily wallet reconciliation signoff.
```

Before public provider deposits:

```text
1. Replace pilot HMAC adapters with certified provider verification.
2. Add provider status polling where required.
3. Add provider statement reconciliation.
4. Add chargeback/refund/dispute ledger flows.
5. Add provider settlement SLA reporting.
6. Add fraud and velocity limits.
```

Before automated withdrawals:

```text
1. Add withdrawal available-balance calculation with holds/disputes/liabilities.
2. Add KYC/eligibility checks.
3. Add provider payout state machine.
4. Add provider payout reconciliation.
5. Add dual approval and velocity controls.
```

## Recommended Next Phase

Recommended phase:

```text
GO V2.2-A Financial Platform Hardening Foundation
```

Scope:

```text
exact money representation plan
durable financial job queue
provider reference uniqueness
scoped idempotency
atomic admin finance transactions
provider statement reconciliation schema
daily finance close workflow
production observability metrics
```

Do not proceed to public rollout until:

```text
daily wallet reconciliation is green
provider pilot reconciliation is green
no stale captures or stale authorizations remain unresolved
admin action audit is complete
refund/reversal flows are implemented
provider callback verification is certified
finance signs off
CTO signs off
```

## Final Audit Decision

```text
Financial platform architecture: SOUND FOR INTERNAL PILOT
Ledger direction: SOUND, NEEDS EXACT MONEY AND REVERSAL HARDENING
Settlement engine: PILOT READY, NOT PUBLIC READY
Authorization engine: PILOT READY, NEEDS DURABLE RECOVERY
Reconciliation engine: INTERNAL READY, PROVIDER RECONCILIATION INCOMPLETE
Provider integrations: PILOT SHELLS ONLY
Operational readiness: PARTIAL
Public launch readiness: NOT APPROVED
```
