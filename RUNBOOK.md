# Operations Runbook

## Backend Restart

Docker:

```bash
docker compose restart backend
curl -fsS http://localhost:3000/health/ready
docker compose logs --since 15m backend
```

Systemd:

```bash
sudo systemctl restart pickme-backend
sudo systemctl status pickme-backend
journalctl -u pickme-backend --since "15 minutes ago"
```

## Redis Restart

```bash
docker compose restart redis
docker compose logs --tail=100 redis
curl -fsS http://localhost:3000/health/dependencies
```

## Monitoring Access

Prometheus, Grafana, and Loki are localhost-bound by default. Use a VPN, SSH tunnel, Cloudflare Access, or authenticated/allowlisted NGINX route for remote access.

SSH tunnel examples:

```bash
ssh -L 9090:127.0.0.1:9090 -L 3001:127.0.0.1:3001 ops@<host>
curl -fsS http://127.0.0.1:9090/-/ready
curl -fsS http://127.0.0.1:3001/api/health
```

Validate config after monitoring changes:

```bash
docker compose config
promtool check config ops/prometheus/prometheus.yml
promtool check rules ops/prometheus/alerts.yml
```

Restart monitoring:

```bash
docker compose restart node-exporter prometheus grafana
docker compose logs --tail=100 prometheus grafana node-exporter
```

## Asynq Restart

```bash
docker compose --profile worker restart asynq-worker
docker compose --profile scheduler restart asynq-scheduler
curl -fsS -H "Authorization: Bearer $ADMIN_JWT" http://localhost:3000/admin/jobs/stats
docker compose --profile worker --profile scheduler logs --since 15m asynq-worker asynq-scheduler
```

Systemd:

```bash
sudo systemctl restart pickme-asynq-worker pickme-asynq-scheduler
sudo systemctl status pickme-asynq-worker
sudo systemctl status pickme-asynq-scheduler
journalctl -u pickme-asynq-worker -u pickme-asynq-scheduler --since "15 minutes ago"
```

## Database Failover

1. Confirm Supabase incident status.
2. Pause deploys.
3. Point `DATABASE_URL` to the promoted database endpoint.
4. Restart backend.
5. Run `/health/ready` and a ride lifecycle smoke test.

## Notification Outage

1. Check provider endpoint and token status.
2. Check Asynq queue depth and dead-letter count.
3. Disable affected channel at provider/config level if needed.
4. Continue critical ride/wallet flows.

## Wallet Incident

1. Stop payment provider callbacks at ingress if duplicate credits are suspected.
2. Preserve logs and database snapshots.
3. Run reconciliation reports.
4. Do not manually mutate balances without finance approval.

## Ride Incident

1. Check API health, database health, Redis health, and dispatch queue depth.
2. Check WebSocket connection metrics.
3. If dispatch is degraded, pause pilot onboarding and notify operations.

## WebSocket Incident

1. Confirm `/ws` upgrade through NGINX.
2. Check Redis Pub/Sub status.
3. Check backend logs for auth failures and room authorization denials.
4. Restart backend only after capturing connection counts.

## High CPU

1. Check request rate and rate-limit rejections.
2. Check k6 or external traffic.
3. Run `docker compose ps` or `systemctl status pickme-backend pickme-asynq-worker pickme-asynq-scheduler`.
4. Scale backend or worker vertically based on the hot process.
5. Capture process profile before restart if possible.

## High RAM

1. Check Redis memory and backend RSS.
2. Check WebSocket connection count.
3. Restart affected process if memory is rising without bound.

## Disk Full

1. Stop noncritical services.
2. Check Docker logs and volumes.
3. Rotate logs.
4. Confirm Redis AOF/RDB and Prometheus retention.

## Redis Full

1. Do not switch to eviction without incident approval.
2. Increase memory or purge noncritical cache keys.
3. Preserve Asynq queues.

## Database Full

1. Contact Supabase support or increase plan/storage.
2. Stop high-volume background writes if needed.
3. Do not delete ledger/wallet records.

## Rollback

Docker:

```bash
IMAGE_TAG=<previous-tag> docker compose --profile worker --profile scheduler up -d --no-deps backend frontend asynq-worker asynq-scheduler
curl -fsS http://localhost:3000/health/ready
```

Git:

```bash
git checkout <known-good-sha>
docker compose build
docker compose up -d
```
