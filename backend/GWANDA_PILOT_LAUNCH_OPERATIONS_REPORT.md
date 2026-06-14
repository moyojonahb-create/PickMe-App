# Gwanda Pilot Launch Operations Report

Report date: 2026-06-12

Readiness score: 91/100

Launch decision scope: Controlled Gwanda pilot only

## Executive Summary

PickMe is approved for a controlled Day 1 Gwanda pilot after completion of driver authorization, admin route hardening, driver location privacy, exact money migration, wallet pilot runtime enforcement, provider callback security, and production hardening.

This report defines the Day 1 operating model. It does not approve Bulawayo expansion or nationwide launch. Expansion must be gated by reconciliation evidence, support readiness, provider callback integrity, incident-free operation, and management approval.

Architecture remains:

- Supabase is storage.
- Go is the source of truth for business logic, wallet controls, payment validation, pilot enforcement, fraud controls, reconciliation, and launch decisions.
- No pilot logic may be moved into frontend clients, SQL triggers, SQL functions, Supabase RLS, or websocket clients.

## Day 1 Launch Checklist

### Environment Variables

Required production environment:

- `APP_ENV=production`
- `PORT`
- `DATABASE_URL`
- `SUPABASE_URL`
- `SUPABASE_JWT_SECRET`
- `SUPABASE_JWT_AUDIENCE=authenticated`
- `SUPABASE_JWT_ISSUER`
- `CORS_ALLOW_ORIGINS`
- `HTTP_REQUEST_TIMEOUT_SECONDS=15`
- `HTTP_RATE_LIMIT_MAX=120`
- `HTTP_RATE_LIMIT_WINDOW_SECONDS=60`

Required Redis configuration if Redis is enabled:

- `REDIS_ENABLED=true`
- `REDIS_URL`
- `REDIS_POOL_SIZE=16`
- `REDIS_DRIVER_LOCATION_TTL_SECONDS=60`
- `REDIS_DRIVER_PRESENCE_TTL_SECONDS=90`

Required wallet pilot configuration:

- `PUBLIC_WALLET_PILOT_ENABLED=true`
- `PUBLIC_WALLET_PILOT_CITY=Gwanda`
- `PUBLIC_WALLET_PILOT_PROGRAM_ID`
- `WALLET_RIDE_AUTHORIZATION_ENABLED=true`
- `WALLET_RIDE_AUTHORIZATION_TTL_MINUTES=30`
- `WALLET_AUTHORIZATION_EXPIRATION_WORKER_ENABLED=true`
- `WALLET_AUTHORIZATION_EXPIRATION_INTERVAL_SECONDS=60`
- `WALLET_AUTHORIZATION_EXPIRATION_BATCH_LIMIT=100`

Required payment configuration:

- `PAYMENTS_PROVIDER_ENABLED=true` only if production providers are ready.
- `ONEMONEY_ENABLED`, `ECOCASH_ENABLED`, `INNBUCKS_ENABLED`, or `PAYPAL_ENABLED` only for approved providers.
- Provider webhook secret for each enabled provider.
- Provider status URL for each enabled provider.
- Provider status token for each enabled provider when required.
- `CARD_PAYMENTS_ENABLED=false` unless a real production card processor replaces the mock processor.

Provider variables by provider:

- `ONEMONEY_WEBHOOK_SECRET`
- `ONEMONEY_STATUS_URL`
- `ONEMONEY_STATUS_TOKEN`
- `ECOCASH_WEBHOOK_SECRET`
- `ECOCASH_STATUS_URL`
- `ECOCASH_STATUS_TOKEN`
- `INNBUCKS_WEBHOOK_SECRET`
- `INNBUCKS_STATUS_URL`
- `INNBUCKS_STATUS_TOKEN`
- `PAYPAL_WEBHOOK_SECRET`
- `PAYPAL_STATUS_URL`
- `PAYPAL_STATUS_TOKEN`

### Production Configuration Verification

Before opening the pilot:

1. Confirm `APP_ENV=production`.
2. Confirm server starts without `SECURITY_PAYMENT_PROVIDER_MISCONFIGURATION`.
3. Confirm mock card processor is not enabled.
4. Confirm HTTP request IDs are present in responses.
5. Confirm request timeout and Fiber read/write/idle timeouts are configured.
6. Confirm global rate limits return 429 under controlled test load.
7. Confirm Redis health endpoint is healthy if Redis is enabled.
8. Confirm database health endpoint is healthy.
9. Confirm logs are collected centrally.
10. Confirm logs do not expose JWTs, payment secrets, provider tokens, or raw card data.

### Provider Secret Verification

For each enabled provider:

1. Confirm webhook secret exists.
2. Confirm status verification endpoint exists.
3. Confirm status token exists where required.
4. Send a signed provider callback test with a valid provider event ID.
5. Confirm invalid signature is rejected.
6. Confirm old timestamp is rejected.
7. Confirm duplicate provider event does not credit twice.
8. Confirm duplicate provider reference does not credit twice.
9. Confirm provider status mismatch blocks wallet credit.
10. Confirm rejected callbacks are dead-lettered.

### Wallet Pilot Configuration Verification

Current coded Gwanda defaults:

- Participants: 20
- Drivers: 10
- Wallet balance limit: 5000 minor units
- Daily transaction limit: 2000 minor units
- Monthly transaction limit: 20000 minor units
- Pilot duration: 30 days

Day 1 launch limit:

- 5 drivers
- 10 riders
- Withdrawals disabled or manually finance-controlled
- Provider set limited to approved provider list

Verification:

1. Confirm pilot enabled for Gwanda only.
2. Confirm all enrolled riders are in the approved cohort.
3. Confirm all enrolled drivers are approved for driver operations.
4. Confirm non-cohort wallet mutation fails closed.
5. Confirm non-Gwanda wallet mutation fails closed.
6. Confirm balance cap enforcement.
7. Confirm daily cap enforcement.
8. Confirm monthly cap enforcement.
9. Confirm denied pilot actions emit `SECURITY_WALLET_PILOT_DENIED`.

### Cohort Verification

Before launch:

1. Export enrolled pilot riders.
2. Export enrolled pilot drivers.
3. Confirm each rider has a valid authenticated user ID.
4. Confirm each driver has a valid authenticated user ID and driver authorization record.
5. Confirm every driver is operationally assigned to Gwanda.
6. Confirm no test, employee, or inactive user is accidentally included unless explicitly approved.
7. Confirm support has the pilot cohort list.
8. Confirm finance has the pilot cohort list for reconciliation.
9. Freeze Day 1 cohort changes after final approval.

### Kill Switch Verification

Required kill-switch checks:

1. Disable deposits in a controlled test and verify wallet deposits fail closed.
2. Disable wallet ride payments in a controlled test and verify wallet payment fails closed.
3. Disable refunds in a controlled test and verify refund action fails closed.
4. Disable wallet adjustments in a controlled test and verify adjustment fails closed.
5. Confirm `SECURITY_WALLET_PILOT_DENIED` appears for blocked action.
6. Confirm no ledger entries are created for blocked actions.
7. Confirm support receives the active kill-switch state.

### Callback Verification

Before launch:

1. Valid signed callback succeeds.
2. Unsigned callback fails.
3. Malformed signature fails.
4. Invalid signature fails.
5. Unsupported event fails.
6. Old timestamp fails.
7. Duplicate event fails without duplicate credit.
8. Duplicate provider reference fails without duplicate credit.
9. Provider status mismatch fails.
10. Dead-letter job is created for suspicious callbacks.

### Reconciliation Verification

Before launch:

1. Run wallet reconciliation.
2. Confirm no `drift_detected` result.
3. Confirm cached wallet balances equal ledger-derived balances.
4. Confirm open authorizations are expected.
5. Confirm expired authorization worker is running if enabled.
6. Confirm provider deposits reconcile to provider status data.
7. Confirm settlement entries balance across rider debit, driver credit, and platform fee.
8. Confirm refund, dispute, and chargeback queues are empty or explained.

### Backup Verification

Before launch:

1. Confirm latest Supabase/Postgres backup timestamp.
2. Confirm restore procedure owner.
3. Confirm restore procedure has been rehearsed or documented.
4. Confirm backup includes wallet ledger tables, provider events, payment intents, ride tables, driver state, pilot enrollment, and financial jobs.
5. Confirm logs are retained for callback and wallet investigations.
6. Confirm incident commander can access backup status during an outage.

## Daily Operations Dashboard

The Day 1 dashboard should be reviewed at launch start, midday, end of day, and during any incident.

| Metric | Purpose | Target | Escalation Trigger |
| --- | --- | --- | --- |
| Rides requested | Demand and funnel health | Within pilot expectation | Sudden zero or unexplained spike |
| Rides completed | Marketplace completion | Increasing with demand | Completion drop below expected pilot baseline |
| Rides cancelled | Marketplace quality | Low and explainable | Spike after driver/rider issue |
| Deposits created | Payment demand | Expected by cohort size | Spike, repeated failures, or unusual user pattern |
| Deposits approved/completed | Provider and wallet health | Matches provider success | Created/completed mismatch |
| Wallet payments | Wallet ride adoption | Expected by completed wallet rides | Payment failures or authorization failures |
| Callback rejections | Provider security signal | Near zero except tests | Any repeated reason or provider reference |
| Dead-letter events | Investigation queue | Zero unresolved | Any unresolved event at daily close |
| Settlement mismatches | Financial integrity | Zero | Any non-zero unexplained variance |
| Support tickets | Customer friction | Low and handled same day | Repeated same issue or wallet complaint |
| Fraud alerts | Abuse detection | Zero confirmed | Duplicate credit, replay, rapid cycling |
| Admin auth failures | Security monitoring | Zero or explainable | Any unexplained admin route denial |
| Redis health | Location and dispatch support | Healthy if enabled | Redis unavailable or high latency |
| Websocket disconnects | Realtime health | Low and explainable | Broad disconnect or fanout failure |
| DB health | Core platform availability | Healthy | Any failed health check |

Recommended dashboard slices:

- By hour.
- By provider.
- By city.
- By rider cohort.
- By driver cohort.
- By transaction type.
- By rejection reason.

## Pilot Rollout Plan

### Week 1

Target:

- 5 drivers
- 10 riders

Entry conditions:

- All Day 1 checklist items approved.
- Provider callback verification passed.
- Wallet reconciliation starts clean.
- Support and finance coverage confirmed.

Exit conditions:

- No unresolved reconciliation variance.
- No duplicate credit.
- No unresolved dead-letter callback.
- No P0 or unresolved P1 incident.
- Support tickets handled within pilot SLA.

### Week 2

Target:

- 10 drivers
- 20 riders

Entry conditions:

- Week 1 exit conditions satisfied.
- Daily reconciliation completed for all Week 1 days.
- Provider status verification is stable.
- Support has updated scripts from Week 1 issues.

Exit conditions:

- Same as Week 1.
- No capacity issue in Redis, database, websocket fanout, or support process.

### Week 3

Target:

- 20 drivers
- 50 riders

Important approval note:

The requested Week 3 target exceeds the current coded Gwanda defaults of 10 drivers and 20 participants. Week 3 requires management approval and an explicit pilot program limit increase through Go-controlled operations and storage-backed pilot configuration.

Entry conditions:

- Week 2 exit conditions satisfied.
- Management approves expanded pilot limits.
- Finance confirms no unresolved variance.
- Risk confirms no unresolved fraud pattern.
- SRE confirms rate limit, Redis, DB, and websocket health.

### Week 4

Target:

- 30 drivers
- 100 riders

Important approval note:

The requested Week 4 target also exceeds current coded defaults and should be treated as a new launch gate, not automatic expansion.

Entry conditions:

- Week 3 exit conditions satisfied.
- Support can handle projected ticket volume.
- Finance can complete daily close on time.
- Provider callback and status checks remain stable.
- Engineering confirms no scale bottleneck from Week 3.

## Stop Conditions

Stop expansion immediately if any condition occurs:

- Duplicate wallet credit.
- Any unexplained reconciliation variance.
- Provider callback status mismatch affecting real deposits.
- Provider outage with pending wallet credits.
- Unauthorized wallet mutation attempt.
- Admin route authorization failure that cannot be explained.
- Location privacy incident.
- P0 incident.
- Unresolved P1 incident.
- Dead-letter callback not reviewed by daily close.
- Support cannot respond within pilot SLA.
- Database health instability.
- Redis outage affecting driver location operations.
- Websocket outage affecting ride lifecycle communication.
- Error rate or rate-limit rejection spike affecting legitimate pilot users.

## Launch Day Timeline

### T-24 Hours

- Freeze cohort.
- Verify production environment.
- Verify provider secrets and status endpoints.
- Run backup check.
- Run reconciliation baseline.
- Confirm support and incident commander coverage.

### T-4 Hours

- Run health checks.
- Send provider callback test.
- Confirm Redis and DB health.
- Confirm logs and dashboards.
- Confirm kill-switch access.
- Confirm support scripts.

### T-30 Minutes

- Confirm no active incidents.
- Confirm cohort list.
- Confirm finance owner online.
- Confirm payments engineering owner online.
- Confirm support owner online.
- Confirm management approval.

### Launch

- Enable pilot access for Week 1 cohort.
- Monitor dashboard continuously for first two hours.
- Review callback, dead-letter, wallet, websocket, Redis, and DB health.

### End Of Day

- Complete finance reconciliation.
- Review support tickets.
- Review dead-letter events.
- Review fraud signals.
- Produce Day 1 close note.
- Decide continue, pause, or reduce scope.

