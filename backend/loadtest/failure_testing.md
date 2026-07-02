# Pilot Failure Testing Drills

These drills validate degradation behavior without changing frontend contracts.

## Redis Outage

1. Point `REDIS_URL` or `ASYNQ_REDIS_URL` to an unreachable Redis endpoint in a staging environment.
2. Start the backend.
3. Verify `/health/dependencies` marks Redis or Asynq unhealthy when enabled.
4. Verify `dependency_failures_total{dependency="redis"}` or `dependency_failures_total{dependency="asynq"}` increments.

## PostgreSQL Outage

1. Point `DATABASE_URL` to a staging database firewall block or invalid host.
2. Verify startup fails fast when the pool cannot be created.
3. During runtime, temporarily block database traffic and verify `/health/ready` returns `503`.
4. Verify `dependency_failures_total{dependency="postgresql"}` increments.

## Notification Provider Outage

1. Set `NOTIFICATION_FCM_ENDPOINT`, `NOTIFICATION_SMS_ENDPOINT`, or `NOTIFICATION_EMAIL_ENDPOINT` to a staging endpoint that returns `503`.
2. Enqueue notification jobs with `k6_api_pilot.js`.
3. Verify Asynq retries and dead-letter handling.
4. Verify notification failure metrics and Sentry delivery failure capture.

## High WebSocket Load

1. Set `WS_TARGET=10000`.
2. Run `k6 run .\k6_websocket.js`.
3. Watch `websocket_connections`, `websocket_messages_sent_total`, and `websocket_messages_received_total`.

## Queue Saturation

1. Run `k6_api_pilot.js` with `TARGET=5000`.
2. Reduce `ASYNQ_CONCURRENCY` in staging to force backlog.
3. Verify `/health/dependencies` reports Asynq `saturated` when queue depth reaches the readiness threshold.
4. Verify `system_degradation_events_total{dependency="asynq",reason="saturated"}` increments.
