# Gwanda Finance Reconciliation Guide

Report date: 2026-06-12

Scope: Daily finance close for controlled Gwanda wallet pilot

## Finance Close Principle

Every cent must reconcile across:

- Provider records.
- Payment intents.
- Provider events.
- Wallet transactions.
- Ledger entries.
- Cached wallet balances.
- Ride settlement records.
- Refunds, chargebacks, disputes, and adjustments.

No manual remediation may bypass the Go wallet ledger.

## Daily Reconciliation Schedule

| Time | Action | Owner |
| --- | --- | --- |
| Start of day | Confirm previous day close is approved | Finance |
| Midday | Review deposits, callbacks, dead letters, and support tickets | Finance + Payments |
| End of day | Run full reconciliation and close report | Finance |
| After close | Management receives summary and exceptions | Finance Lead |

## Daily Reconciliation Procedure

1. Export active pilot cohort.
2. Export rides requested, accepted, completed, and cancelled.
3. Export wallet deposits created and completed.
4. Export provider callbacks accepted and rejected.
5. Export dead-letter callback events.
6. Export wallet payments, authorizations, captures, releases, refunds, chargebacks, disputes, and adjustments.
7. Export settlement records.
8. Run wallet reconciliation.
9. Compare cached wallet balances to ledger-derived balances.
10. Compare provider references to provider status data.
11. Verify settlement balances across rider debit, driver credit, and platform fee.
12. Review open and expired authorizations.
13. Review unresolved support tickets with wallet or payment labels.
14. Review fraud alerts.
15. Produce finance close summary.

## Settlement Verification

For each completed wallet ride:

1. Confirm ride status is completed.
2. Confirm rider authorization existed.
3. Confirm capture amount equals completed ride fare.
4. Confirm platform fee is deterministic and integer minor-unit based.
5. Confirm driver earning equals fare minus platform fee.
6. Confirm settlement ledger entries balance.
7. Confirm rider debit plus driver credit plus platform fee net to zero in ledger terms.
8. Confirm no duplicate settlement exists for the same ride.

Escalate if:

- Settlement amount differs from captured amount.
- Driver earning is negative.
- Platform fee is not exactly derived from configured basis points.
- More than one settlement exists for the same ride.
- Ledger entries do not balance.

## Wallet Balance Verification

For each pilot wallet:

1. Calculate ledger-derived available balance.
2. Calculate ledger-derived pending balance.
3. Calculate ledger-derived liability balance.
4. Compare derived balances to cached wallet balances.
5. Confirm no unexplained negative available balance.
6. Confirm open holds match open authorizations.
7. Confirm expired holds are released by the expiration worker.

Escalate if:

- Any non-zero unexplained variance exists.
- Cached balance differs from ledger-derived balance.
- Open authorization is expired and not released.
- Account has unexpected negative balance.

## Provider Payment Verification

For each provider:

1. Export provider-side successful payments for the day.
2. Match each provider reference to exactly one PickMe payment intent.
3. Match each completed provider event to exactly one wallet credit.
4. Confirm amount and currency match.
5. Confirm provider transaction status is successful, completed, or settled.
6. Confirm rejected callbacks did not credit wallets.
7. Confirm dead-letter callbacks are reviewed.

Escalate if:

- Provider shows success but PickMe has no wallet credit.
- PickMe shows wallet credit but provider does not show success.
- Provider reference appears more than once.
- Provider event ID appears more than once.
- Callback payload hash repeats unexpectedly.

## Mismatch Handling

Mismatch severity:

- P0: Duplicate credit, unauthorized credit, unexplained wallet balance drift, or money movement without provider success.
- P1: Single pending provider mismatch, missing callback, or unresolved dead-letter event.
- P2: Delayed provider statement with no wallet impact.

Handling procedure:

1. Open finance exception record.
2. Preserve evidence: account ID, provider, provider reference, provider event ID, payment intent, wallet transaction ID, ledger entries, ride ID, amount minor, currency, and request ID.
3. Assign finance owner and payments engineering owner.
4. Freeze affected account if money movement risk remains.
5. Activate kill switch if issue can recur.
6. Determine whether mismatch is provider delay, callback rejection, duplicate attempt, internal defect, or fraud.
7. Finance approves remediation.
8. Engineering applies remediation only through auditable wallet transactions and ledger entries.
9. Re-run reconciliation.
10. Close exception only when variance is zero or formally explained.

## Daily Finance Close Template

Date:

Pilot day:

Finance owner:

Payments owner:

Total rides requested:

Total rides completed:

Total rides cancelled:

Total deposits created:

Total deposits completed:

Total wallet payments:

Total platform fees:

Total driver earnings:

Total refunds:

Total chargebacks:

Open authorizations:

Expired authorizations:

Callback rejections:

Dead-letter events:

Fraud alerts:

Support tickets:

Reconciliation status:

Unresolved exceptions:

Decision:

- Continue pilot
- Continue with restrictions
- Pause expansion
- Pause pilot

