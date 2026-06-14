# Gwanda Pilot Incident Response Playbook

Report date: 2026-06-12

Scope: Controlled Gwanda pilot incidents

## Incident Roles

| Role | Responsibility |
| --- | --- |
| Incident Commander | Owns severity, coordination, timeline, decisions, and executive updates |
| Engineering Lead | Owns technical diagnosis and remediation |
| Payments Lead | Owns provider callbacks, deposits, wallet credits, and payment verification |
| Finance Lead | Owns reconciliation, financial impact, and remediation approval |
| Operations Lead | Owns kill switches, cohort controls, and launch pause/resume |
| Support Lead | Owns customer communication and ticket triage |
| Risk/Fraud Lead | Owns abuse investigation, suspensions, and fraud decisions |

## Severity Levels

| Severity | Definition | Response |
| --- | --- | --- |
| P0 | Active financial loss, duplicate credits, unauthorized wallet mutation, broad security issue, database outage | Immediate incident bridge, stop affected flows |
| P1 | Single-user financial inconsistency, provider callback anomaly, ride outage, websocket outage, unresolved reconciliation variance | Incident bridge within 15 minutes |
| P2 | Degraded service with workaround, isolated support issue, Redis degradation | Owner assigned same day |
| P3 | Investigation, follow-up, non-urgent operational issue | Track to closure |

## General Incident Procedure

1. Declare incident and severity.
2. Assign incident commander.
3. Open incident timeline.
4. Preserve request IDs, logs, callback payload references, wallet transaction IDs, provider references, ride IDs, and user IDs.
5. Activate the narrowest relevant kill switch.
6. Stop cohort expansion.
7. Notify support and management.
8. Diagnose impact.
9. Reconcile impacted financial records.
10. Decide mitigation, rollback, or continued pause.
11. Document root cause and corrective action.

## Wallet Incident

Triggers:

- Wallet balance drift.
- Negative balance not explained by approved dispute/chargeback handling.
- Authorization/capture/release mismatch.
- Wallet pilot limit bypass.
- Wallet mutation outside approved cohort.

Immediate actions:

1. Activate wallet payment kill switch if ride payments may continue causing drift.
2. Activate deposits/refunds/adjustments kill switches if those paths are implicated.
3. Freeze affected accounts.
4. Run account-level reconciliation.
5. Review ledger entries, wallet transactions, authorizations, captures, releases, refunds, chargebacks, and disputes.
6. Finance approves any remediation.

Escalation:

- P0 if money can move incorrectly.
- P1 if isolated and contained.

## Duplicate Credit

Triggers:

- Same provider event credited more than once.
- Same provider reference credited more than once.
- Same callback payload credited more than once.
- Provider statement shows single payment but wallet shows multiple credits.

Immediate actions:

1. Activate deposit kill switch.
2. Stop provider callback processing if duplicates are ongoing.
3. Identify provider, provider event ID, provider reference, payload hash, payment intent, wallet transaction, and account.
4. Run duplicate scan across provider events and wallet transactions.
5. Compare provider status/statement.
6. Do not manually reverse until finance and payments engineering approve the ledger correction.

Escalation:

- Always P0 until proven contained.

## Provider Outage

Triggers:

- Provider status endpoint unavailable.
- Provider callback volume stops unexpectedly.
- Provider callback rejection spike.
- Provider status mismatch spike.
- Provider dashboard unavailable during deposit activity.

Immediate actions:

1. Disable affected provider deposits.
2. Keep unrelated providers enabled only if finance and payments approve.
3. Dead-letter unverifiable callbacks.
4. Reconcile pending payment intents.
5. Notify support with provider-specific script.

Escalation:

- P1 if no confirmed financial drift.
- P0 if wallet credits may be wrong.

## Ride Outage

Triggers:

- Ride requests failing.
- Ride acceptance failing.
- Ride completion failing.
- Driver offer flow degraded.

Immediate actions:

1. Confirm DB health.
2. Confirm auth health.
3. Confirm websocket health.
4. Confirm driver authorization path.
5. Confirm location update path.
6. Pause cohort expansion.
7. If wallet ride payments are implicated, activate wallet payment kill switch.

Escalation:

- P1 for broad pilot ride outage.
- P2 for isolated user or driver issue.

## Websocket Outage

Triggers:

- Broad disconnects.
- Ride lifecycle events not received.
- Driver location updates not visible.
- Backpressure disconnect spike.

Immediate actions:

1. Confirm HTTP ride endpoints still work.
2. Confirm websocket authentication.
3. Confirm room authorization.
4. Confirm process health and resource usage.
5. Confirm load balancer websocket support.
6. Ask support to advise users to refresh/reconnect if safe.
7. Pause expansion if realtime reliability affects ride operations.

Escalation:

- P1 if ride lifecycle communication is broadly degraded.
- P2 if isolated to a small number of users.

## Database Outage

Triggers:

- `/health` fails.
- Database connection failures.
- Query timeouts.
- Reconciliation cannot run.
- Wallet mutations fail.

Immediate actions:

1. Declare P0.
2. Stop pilot activity.
3. Activate wallet kill switches if service remains partially available.
4. Confirm Supabase/Postgres status.
5. Preserve logs.
6. Do not perform manual database writes outside approved recovery procedure.
7. Confirm latest backup and restore path.

Escalation:

- Always P0 for pilot-impacting DB outage.

## Redis Outage

Triggers:

- `/health/redis` unavailable.
- Driver location TTL failures.
- Redis latency spike.
- Dispatch/location degradation.

Immediate actions:

1. Confirm Redis URL and connection pool health.
2. Confirm driver location writes.
3. Confirm fallback behavior does not corrupt core ride/wallet state.
4. Notify support if driver location freshness is degraded.
5. Pause expansion until Redis health stabilizes.

Escalation:

- P2 if core ride/wallet flows continue.
- P1 if driver location or dispatch degradation materially impacts rides.

## Security Incident

Triggers:

- Admin authorization failure spike.
- Forged provider callbacks.
- Replay attempts.
- Unauthorized ride access attempt.
- Location privacy violation.
- JWT validation anomaly.

Immediate actions:

1. Declare P0 or P1 depending on blast radius.
2. Preserve logs and request IDs.
3. Identify user, IP, route, provider event ID, provider reference, and affected records.
4. Activate affected kill switch.
5. Suspend affected account if risk approves.
6. Rotate provider secrets if callback compromise is suspected.
7. Notify management and legal/compliance owner if customer data or money is affected.

Escalation:

- P0 for confirmed compromise, financial impact, or privacy exposure.
- P1 for blocked attack attempts requiring investigation.

