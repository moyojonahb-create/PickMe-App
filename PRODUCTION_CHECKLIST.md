# Production Checklist

## Database

- [ ] Supabase migrations applied.
- [ ] Hot-path indexes applied.
- [ ] `DATABASE_URL` uses production credentials.
- [ ] Pool settings reviewed.
- [ ] Backups and restore drill verified.

## Redis

- [ ] `REDIS_ENABLED=true`.
- [ ] Redis not publicly exposed.
- [ ] AOF enabled.
- [ ] Memory alert configured.

## Asynq

- [ ] `ASYNQ_ENABLED=true`.
- [ ] API service runs `pickme-server`, not the worker binary.
- [ ] Worker service runs `pickme-worker`, not the API binary.
- [ ] Scheduler service runs `pickme-scheduler`, not the API binary.
- [ ] Queue stats endpoint admin protected.
- [ ] Queue depth alerts configured.
- [ ] Dead-letter alert configured.

## Prometheus and Grafana

- [ ] Prometheus has admin JWT for `/metrics`.
- [ ] Prometheus loads `ops/prometheus/alerts.yml`.
- [ ] Prometheus host port is localhost-bound or behind authenticated access.
- [ ] Prometheus config and rules pass `promtool`.
- [ ] Grafana password changed.
- [ ] `GRAFANA_ADMIN_PASSWORD` is required by deployment config.
- [ ] Grafana host port is localhost-bound or behind authenticated access.
- [ ] Dashboards provisioned from `docs/grafana`.
- [ ] Grafana behind VPN, Cloudflare Access, or IP allowlist.

## Sentry and OpenTelemetry

- [ ] `SENTRY_DSN` configured.
- [ ] `SENTRY_ENVIRONMENT` set.
- [ ] `SENTRY_RELEASE` set for deploy.
- [ ] OTLP endpoint configured if tracing is enabled.

## Notifications

- [ ] FCM endpoint/token configured or explicitly disabled.
- [ ] SMS endpoint/token configured or explicitly disabled.
- [ ] Email endpoint/token configured or explicitly disabled.
- [ ] Notification rate limit configured.

## Wallet

- [ ] Wallet pilot flags reviewed.
- [ ] Payment provider switches reviewed.
- [ ] Provider webhook secrets configured.
- [ ] Status verification endpoints configured outside development.

## Dispatch

- [ ] `DISPATCH_MODE=authoritative` for pilot.
- [ ] Redis locks enabled.
- [ ] Offer TTL and lock TTL reviewed.
- [ ] WebSocket delivery tested.

## Risk

- [ ] Risk event endpoints rate limited.
- [ ] Asynq risk jobs enabled if used.
- [ ] Fraud controls tested with staging data.

## Monitoring and Alerts

- [ ] API p95 latency alert.
- [ ] Postgres p95 latency alert.
- [ ] Redis memory alert.
- [ ] Asynq queue depth alert.
- [ ] WebSocket connection drop alert.
- [ ] Notification failure alert.
- [ ] Host CPU, memory, and disk alerts configured with node-exporter or equivalent host metrics.
- [ ] Node exporter target is up in Prometheus.

## Security

- [ ] TLS certificates valid.
- [ ] Cloudflare WAF enabled.
- [ ] CORS origins exact.
- [ ] `/test-db` admin protected outside dev.
- [ ] `/metrics` admin protected outside dev.
- [ ] Secrets stored outside git.
- [ ] Legacy Edge Function emergency override disabled.

## Recovery

- [ ] Rollback tag documented.
- [ ] Database restore rehearsal complete.
- [ ] Redis restore rehearsal complete.
- [ ] Incident contacts assigned.

## Staging Deployment

- [ ] `docker compose config` passes.
- [ ] `promtool check config ops/prometheus/prometheus.yml` passes.
- [ ] `promtool check rules ops/prometheus/alerts.yml` passes.
- [ ] `docker compose build` passes.
- [ ] `docker compose --profile worker --profile scheduler up -d` starts backend, worker, scheduler, Redis, Prometheus, and Grafana.
- [ ] `/health/live`, `/health/ready`, and `/health/dependencies` pass.
- [ ] `/admin/jobs/stats` passes with an admin JWT.
- [ ] Prometheus target `pickme-backend` is up.
- [ ] Grafana dashboards load from provisioning.
