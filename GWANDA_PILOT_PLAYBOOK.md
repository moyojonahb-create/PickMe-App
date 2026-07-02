# Gwanda Pilot Playbook

Date: 2026-07-02

## Pilot Scope

- 5 approved drivers.
- 10 named riders.
- Gwanda only.
- Cash-first operation.
- Manual wallet/deposit approval.
- Operator-supervised first ride.

## Driver Checklist

- [ ] Account created.
- [ ] Driver profile approved.
- [ ] Vehicle details verified.
- [ ] Phone/WhatsApp confirmed.
- [ ] Location permission enabled.
- [ ] Notifications enabled.
- [ ] Can go online.
- [ ] Can see a test ride request.
- [ ] Can submit an offer.
- [ ] Can complete one staging ride.

## Rider Checklist

- [ ] Account created.
- [ ] Phone/WhatsApp confirmed.
- [ ] Location permission enabled.
- [ ] Notifications enabled.
- [ ] Can set pickup/drop-off.
- [ ] Can request a ride.
- [ ] Can see and accept offer.
- [ ] Can contact driver.
- [ ] Can access SOS.
- [ ] Can rate/report after ride.

## Pilot Admin Checklist

- [ ] Confirm backend `/health/ready`.
- [ ] Confirm Redis and Asynq worker running.
- [ ] Confirm dispatch mode authoritative.
- [ ] Confirm monitoring dashboard access.
- [ ] Confirm pilot support phone is staffed.
- [ ] Confirm rollback command rehearsed.
- [ ] Confirm cash-only fallback instructions.
- [ ] Confirm wallet manual approval operator.
- [ ] Confirm incident log owner.

## Support Process

1. Operator watches admin dashboard, backend logs, Redis/Asynq stats, and emergency alerts.
2. Driver/rider issues are logged with ride id, user id, screenshot, device, and time.
3. Critical live-trip issues move to WhatsApp/phone fallback immediately.
4. Wallet/payment disputes are not manually edited without finance approval.
5. End of day: compile daily pilot report.

## WhatsApp Fallback

- Create one pilot ops group with all 5 drivers and operators.
- Riders should contact support phone, not the driver group.
- If dispatch fails, operator manually pairs rider and driver.
- Operator records manual ride id, pickup, drop-off, fare, driver, rider, and outcome.

## Cash-Only Fallback

- Keep `PAYMENTS_PROVIDER_ENABLED=false` unless provider certification passes.
- Rider confirms fare before trip starts.
- Driver confirms cash collected before completing ride.
- Operator records disputes same day.

## Manual Wallet Approval

- Deposits and withdrawals remain admin-approved.
- Operator confirms reference, amount, account owner, and timestamp.
- Finance owner approves exceptional corrections.

## Emergency Rollback

```bash
IMAGE_TAG=<previous-tag> docker compose --profile worker --profile scheduler up -d --no-deps backend frontend asynq-worker asynq-scheduler
curl -fsS http://localhost:3000/health/ready
```

## Supervised End-To-End Test Ride

1. Rider logs in.
2. Driver logs in and goes online.
3. Rider requests ride.
4. Driver sees request.
5. Driver submits offer.
6. Rider accepts offer.
7. Driver sets enroute.
8. Driver sets arrived.
9. Driver starts ride.
10. Driver completes ride.
11. Rider sees completed ride and rating prompt.
12. Admin verifies ride, logs, metrics, and support timeline.

## Pilot GO Gate

GO only when the supervised ride passes with real JWTs, real devices, Redis enabled, Asynq running, WebSocket connected, `/health/ready` green, and support staffed.
