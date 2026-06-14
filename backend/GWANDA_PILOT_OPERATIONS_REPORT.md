# Gwanda Pilot Operations Report

Report date: 2026-06-12

Pilot scope: Controlled public wallet pilot for Gwanda only

Recommended decision: Conditional go for capped Gwanda pilot; no-go for Bulawayo or nationwide launch

## Executive Summary

PickMe has implemented the core controls required for a controlled Gwanda wallet pilot. The codebase now enforces authenticated ride access, admin-only financial reporting, exact minor-unit money handling, wallet authorization and capture flows, provider callback verification, replay protection, duplicate credit protection, pilot cohort limits, runtime wallet enforcement, and security logging for high-risk denial paths.

The pilot is suitable only as a capped, closely monitored launch. It is not suitable for broader city expansion or nationwide rollout until operational runbooks, provider status verification depth, rate limiting, support workflows, and production observability are exercised under real traffic.

The architecture remains:

- Supabase is storage.
- Go is the source of truth for authorization, wallet behavior, payment validation, reconciliation, fraud controls, and pilot enforcement.
- Business logic must not be moved into frontend clients, Supabase RLS, SQL triggers, SQL functions, or websocket clients.

## Pilot Boundaries

The pilot must be limited to:

- City: Gwanda
- Participants: approved cohort only
- Riders: capped by pilot program enrollment
- Drivers: capped by pilot program enrollment
- Wallet currency: configured pilot currency only
- Payment providers: explicitly configured production providers only
- Card processor: disabled unless a real production processor is configured
- Withdrawals: fail-closed or manually controlled until operations approves payout processing

The current Gwanda pilot defaults in code are:

- Maximum participants: 20
- Maximum drivers: 10
- Wallet balance limit: 5000 minor units
- Daily transaction limit: 2000 minor units
- Monthly transaction limit: 20000 minor units
- Pilot duration: 30 days

Recommended management operating limits:

- Keep the coded participant and driver caps for launch.
- Keep wallet balance capped at 5000 minor units.
- Keep daily spend capped at 2000 minor units.
- Keep monthly spend capped at 20000 minor units.
- Disable withdrawals for the first pilot window unless finance explicitly approves a manual payout process.
- Review reconciliation, dead letters, and denied wallet actions daily before expanding cohort size.

## Required Environment Configuration

Production pilot startup must be configured with:

- `APP_ENV=production`
- `DATABASE_URL`
- `SUPABASE_URL`
- `SUPABASE_JWT_SECRET`
- `SUPABASE_JWT_AUDIENCE=authenticated`
- `SUPABASE_JWT_ISSUER`
- `PUBLIC_WALLET_PILOT_ENABLED=true`
- `PUBLIC_WALLET_PILOT_CITY=Gwanda`
- `PUBLIC_WALLET_PILOT_PROGRAM_ID`
- `WALLET_RIDE_AUTHORIZATION_ENABLED=true`
- `WALLET_AUTHORIZATION_EXPIRATION_WORKER_ENABLED=true`
- Provider callback secrets for every enabled provider
- `CARD_PAYMENTS_ENABLED=false` unless a real production card processor is configured

The mock card processor must not be enabled in production. Startup validation must fail and emit `SECURITY_PAYMENT_PROVIDER_MISCONFIGURATION` if a mock processor is selected outside explicit development mode.

## Security Controls Implemented

Authentication and authorization controls:

- Supabase JWT validation is performed in Go.
- JWT algorithm, signature, expiration, not-before, audience, issuer, and subject are validated.
- Admin-only routes use Go middleware authorization.
- Wallet reporting routes require authentication and admin authorization.
- `/rides` requires authentication.
- Riders can only list their own rides.
- Drivers can only list assigned rides.
- Admins can list all rides.
- Unauthorized ride access returns 403.

Driver and marketplace controls:

- Driver authorization is enforced before driver-only actions.
- Driver eligibility checks are centralized in Go.
- Driver authorization failures are logged with `SECURITY_DRIVER_AUTHZ_FAILURE`.
- Driver location updates validate coordinates and driver identity.
- Location privacy controls prevent unauthorized access to driver location data.
- Websocket ride-room access is authenticated and bound to authorized ride participation.

Payment security controls:

- Provider callbacks require provider-specific signature verification.
- Unsigned, malformed, invalid-signature, and unknown-provider callbacks are rejected.
- Provider event types are allow-listed.
- Replay windows are enforced with callback timestamps.
- Provider event ID uniqueness protects against replay and duplicate credits.
- Provider reference uniqueness protects against repeated confirmation of the same deposit.
- Callback payload hashing protects against identical payload replay.
- Wallet mutation occurs only after callback verification succeeds.
- Provider callback rejection logs use `SECURITY_PROVIDER_CALLBACK_REJECTED`.
- Rejected callbacks are dead-lettered for investigation.

Admin route controls:

- Wallet reporting routes are protected with authentication and admin-only authorization.
- Admin authorization failures are logged with `SECURITY_ADMIN_AUTHZ_FAILURE`.
- Financial report access is restricted to admins.

## Wallet Controls Implemented

Exact money controls:

- Monetary values in live financial paths use signed 64-bit minor units.
- No internal wallet, payment, settlement, refund, chargeback, dispute, reconciliation, or provider callback calculation uses `float64`.
- Decimal API compatibility is accepted only at controlled Go boundaries.
- Sub-cent precision is rejected.
- Negative monetary amounts are rejected.

Ledger and balance controls:

- Wallet balances are represented as minor-unit integers.
- Wallet transactions require balanced ledger entries.
- Repository operations use database transactions for financial mutations.
- Authorization, capture, release, settlement, deposit, refund, chargeback, and dispute flows use minor-unit values.
- Wallet authorization reserves rider funds before ride completion.
- Capture moves authorized funds into completed financial movement.
- Release returns unused held funds.
- Expired authorization handling is available through the authorization expiration worker.

Settlement controls:

- PickMe platform fee is calculated deterministically with integer basis-point math.
- Driver earnings are derived from fare minus platform fee.
- Settlement records use minor-unit fields for fare, platform fee, and driver earnings.
- Settlement calculations must balance before ledger mutation.

Pilot wallet controls:

- Public wallet pilot enforcement runs in Go before wallet mutations.
- Pilot city, cohort, status, balance cap, daily cap, and monthly cap are enforced.
- Denied wallet actions are logged with `SECURITY_WALLET_PILOT_DENIED`.
- Pilot kill-switch controls can disable high-risk wallet actions.

## Pilot Kill Switch Procedures

Available pilot kill-switch categories:

- Disable deposits.
- Disable wallet ride payments.
- Disable refunds.
- Disable wallet adjustments.

Activation triggers:

- Suspected duplicate credit.
- Provider callback forgery attempt.
- Reconciliation drift.
- Unauthorized wallet mutation attempt.
- Provider outage or inconsistent provider status.
- Fraud pattern affecting multiple users.
- Support confirms customer-impacting wallet inconsistency.

Activation procedure:

1. Incident commander declares the incident severity.
2. Operations lead activates the relevant wallet pilot kill switch through approved admin or operations tooling.
3. Engineering verifies that blocked wallet actions fail closed.
4. Support receives customer-facing guidance.
5. Finance runs immediate reconciliation for impacted accounts.
6. Payments engineering reviews provider callbacks and dead-lettered events.
7. Risk determines whether affected pilot accounts should be suspended.
8. Kill switch remains active until finance, engineering, and risk jointly approve reactivation.

Validation after activation:

- Confirm wallet mutations are denied for the disabled category.
- Confirm `SECURITY_WALLET_PILOT_DENIED` logs are present.
- Confirm no new ledger entries are created for denied actions.
- Confirm support has a list of impacted users and recommended response.

Deactivation procedure:

1. Complete incident review.
2. Complete reconciliation for impacted users.
3. Confirm no unresolved duplicate credits or negative balances.
4. Confirm provider status for pending deposits.
5. Obtain approval from engineering, finance, risk, and operations.
6. Deactivate the kill switch.
7. Monitor wallet actions for at least one business day.

## Incident Response Procedures

Severity levels:

- P0: Active financial loss, duplicate credits, unauthorized wallet mutation, or broad callback forgery.
- P1: Single-user wallet inconsistency, provider callback replay spike, reconciliation drift, or admin authorization anomaly.
- P2: Isolated support issue with no confirmed financial drift.
- P3: Non-urgent investigation or audit follow-up.

First 15 minutes:

1. Assign incident commander.
2. Preserve logs and request IDs.
3. Identify impacted users, rides, payment intents, provider references, and provider event IDs.
4. Activate the narrowest relevant kill switch if financial mutation risk remains active.
5. Stop expansion of the pilot cohort.

15 to 60 minutes:

1. Run wallet reconciliation for impacted accounts.
2. Review provider callback dead letters.
3. Compare provider references against provider dashboard or statement data.
4. Confirm whether wallet credit, capture, refund, chargeback, or settlement entries balance.
5. Prepare internal incident summary for leadership.

Within 24 hours:

1. Complete root cause analysis.
2. Document customer impact.
3. Record financial impact in minor units.
4. Confirm whether customer remediation is needed.
5. Update support script and fraud watchlist.
6. Decide whether pilot remains paused, resumes capped, or rolls back.

## Dead-Letter Callback Review Process

Suspicious callbacks must not be discarded. Rejected provider callbacks are stored for investigation with:

- Provider.
- Provider event ID.
- Provider reference.
- Rejection reason.
- Payload.
- Timestamp.

Daily review procedure:

1. Export all provider callback dead letters from the previous operating day.
2. Group by provider, provider event ID, provider reference, and rejection reason.
3. Identify repeated signatures, repeated payload hashes, repeated provider references, and timestamp-window failures.
4. Compare each suspicious provider reference against provider-side transaction status.
5. Confirm whether the related payment intent exists and whether it was already credited.
6. Do not manually credit any wallet from a dead-lettered callback without finance and payments engineering approval.
7. Record the investigation result as one of:
   - confirmed attack
   - duplicate/replay
   - provider retry
   - provider formatting issue
   - internal configuration issue
   - unresolved
8. Escalate confirmed attacks or unresolved duplicate-credit risk to incident response.

## Daily Reconciliation Procedure

Daily reconciliation must be completed before management approves additional pilot expansion.

Procedure:

1. Run wallet reconciliation for all active pilot accounts.
2. Review any `drift_detected` or `variance_detected` results.
3. Compare cached wallet balances with ledger-derived balances.
4. Review open wallet authorizations and expired holds.
5. Confirm settlement entries balance across rider debit, driver credit, and platform fee.
6. Review refunds, chargebacks, disputes, and adjustments from the operating day.
7. Review provider deposits against provider statements or provider dashboards.
8. Review provider callback dead letters and rejection logs.
9. Review denied wallet pilot actions.
10. Confirm no account has a negative available balance unless explicitly expected by a controlled dispute or chargeback state.
11. Produce a daily finance sign-off note containing:
    - total deposits
    - total ride captures
    - total platform fees
    - total driver earnings
    - total refunds
    - total chargebacks
    - outstanding authorizations
    - unresolved reconciliation exceptions

Escalation threshold:

- Any non-zero unexplained variance is a pilot-blocking exception until resolved.
- Any duplicate provider reference credited more than once is a P0 incident.
- Any unauthorized wallet reporting access is a security incident.

## Support Escalation Flow

Level 1 support:

- Receives user reports.
- Verifies user identity through approved support process.
- Checks visible ride/payment status.
- Does not manually modify wallet balances.
- Escalates wallet, payment, fraud, or privacy issues.

Level 2 operations:

- Reviews pilot enrollment, city eligibility, and limit denials.
- Checks whether a kill switch is active.
- Reviews support-safe wallet status and transaction IDs.
- Escalates financial inconsistencies to finance and payments engineering.

Finance operations:

- Reviews reconciliation results.
- Approves or rejects manual remediation.
- Confirms provider settlement and statement data.
- Owns financial sign-off for daily pilot operation.

Payments engineering:

- Reviews provider callbacks, dead letters, signatures, provider references, and idempotency records.
- Confirms whether wallet mutation occurred exactly once.
- Owns technical remediation for payment and wallet defects.

Risk and fraud:

- Reviews suspicious behavior, repeated failed payments, duplicate credits, abnormal refunds, rapid balance cycling, and pilot abuse.
- Recommends account suspension, cohort removal, or pilot pause.

Incident commander:

- Coordinates cross-functional response.
- Owns severity assignment, timeline, communications, and resolution sign-off.

## Fraud Investigation Flow

Fraud signals:

- Repeated rejected callbacks for the same provider reference.
- Repeated deposits just below pilot limits.
- Multiple accounts sharing payment instruments or provider references.
- Rapid balance cycling.
- Abnormal refund activity.
- Duplicate payment attempts.
- Reconciliation variance.
- Unsupported provider event attempts.
- Old timestamp or replay-window callback failures.

Investigation procedure:

1. Preserve relevant logs, callback payloads, provider event IDs, provider references, ride IDs, wallet transaction IDs, and ledger entries.
2. Freeze expansion of the affected cohort segment.
3. Confirm whether wallet credit occurred.
4. Confirm whether the provider independently reports a successful transaction.
5. Check whether the same provider event, reference, or payload appeared previously.
6. Review related ride activity and driver/rider relationships.
7. Run account-level reconciliation.
8. Decide whether to:
   - clear the case
   - monitor the account
   - suspend the account
   - reverse a transaction
   - activate a kill switch
   - escalate to incident response
9. Record final decision, evidence, approvers, and financial impact.

No fraud remediation may bypass the wallet ledger. All corrections must be represented as auditable wallet transactions and ledger entries.

## Operational Logs To Monitor

Required daily review:

- `SECURITY_WALLET_PILOT_DENIED`
- `SECURITY_PROVIDER_CALLBACK_REJECTED`
- `SECURITY_ADMIN_AUTHZ_FAILURE`
- `SECURITY_DRIVER_AUTHZ_FAILURE`
- `SECURITY_LOCATION_ACCESS_DENIED`
- `SECURITY_PAYMENT_PROVIDER_MISCONFIGURATION`

Operational dashboards should track:

- Provider callback acceptance and rejection counts.
- Provider callback dead-letter counts by reason.
- Wallet pilot denial counts by reason.
- Reconciliation variance count.
- Duplicate provider reference attempts.
- Duplicate provider event attempts.
- Open authorization age.
- Refund and chargeback volume.
- Admin authorization failures.
- Driver location access denials.

## Remaining Pilot Risks

The following risks are acceptable only for a capped Gwanda pilot with daily operational review:

- Provider status verification should be validated against real provider APIs or provider statements during live operation.
- Support and finance runbooks must be rehearsed before increasing cohort size.
- Rate limits and abuse throttles should be reviewed under real traffic.
- Websocket scale and cleanup behavior should be monitored closely.
- Redis and database connection behavior should be monitored during peak pilot windows.
- Dead-letter review is an operational obligation, not a passive log sink.
- Manual remediation must require finance and engineering approval.

These risks are not acceptable for Bulawayo or nationwide launch without additional production hardening and operational proof.

## Go/No-Go Recommendation

Gwanda controlled pilot: GO, conditional on the required environment configuration, capped cohort, daily reconciliation, dead-letter review, and active support coverage.

Bulawayo pilot: NO. Expand only after the Gwanda pilot demonstrates stable reconciliation, provider callback integrity, support readiness, and no unresolved financial drift.

Nationwide launch: NO. Nationwide launch requires proven scale, stronger automated monitoring, mature incident response operations, provider status verification depth, support readiness, and completed post-pilot risk review.

## Management Approval Checklist

Before launch, management must confirm:

- Production environment variables are configured.
- Public wallet pilot is enabled only for Gwanda.
- Pilot cohort is loaded and capped.
- Mock card processor is disabled in production.
- Provider callback secrets are configured.
- Wallet authorization worker is enabled.
- Support coverage is staffed for pilot hours.
- Finance owner is assigned for daily reconciliation.
- Payments engineering owner is assigned for callback and dead-letter review.
- Risk owner is assigned for fraud investigations.
- Kill-switch procedure has been rehearsed.
- Customer support scripts are approved.
- Incident commander rotation is assigned.

Approval sign-off:

| Function | Owner | Approved | Date |
| --- | --- | --- | --- |
| Engineering |  |  |  |
| Payments |  |  |  |
| Finance |  |  |  |
| Risk/Fraud |  |  |  |
| Operations |  |  |  |
| Support |  |  |  |
| Management |  |  |  |

