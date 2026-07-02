# Monitoring

Dashboards are stored in `docs/grafana` and provisioned by Docker Compose into Grafana.

Included dashboards:

- `api-dashboard.json`
- `dispatch-dashboard.json`
- `notifications-dashboard.json`
- `pilot-readiness-dashboard.json`
- `postgresql-dashboard.json`
- `redis-dashboard.json`
- `wallet-dashboard.json`
- `websockets-dashboard.json`

## Prometheus

Prometheus config:

```text
ops/prometheus/prometheus.yml
```

Alert rules:

```text
ops/prometheus/alerts.yml
```

The backend `/metrics` endpoint is admin protected outside local/dev/test. Put an admin JWT in:

```text
ops/prometheus/secrets/backend_metrics_token
```

Prometheus is bound to localhost by default:

```text
127.0.0.1:${PROMETHEUS_PORT:-9090}:9090
```

Use a VPN, SSH tunnel, Cloudflare Access, or authenticated NGINX route to view Prometheus remotely. Do not expose Prometheus directly to the public internet.

Host CPU, memory, and disk alerts use the bundled `node-exporter` Compose service and Prometheus scrape job.

## Grafana

Grafana provisioning:

```text
ops/grafana/provisioning/
```

Set `GRAFANA_ADMIN_PASSWORD` before first start.

Grafana is bound to localhost by default:

```text
127.0.0.1:${GRAFANA_PORT:-3001}:3000
```

Use a VPN, SSH tunnel, Cloudflare Access, or the allowlisted `grafana.pickme.example.com` NGINX route for remote access.

## Sentry

Set:

- `SENTRY_DSN`
- `SENTRY_ENVIRONMENT`
- `SENTRY_RELEASE`

## OpenTelemetry

Set:

- `OTEL_ENABLED=true`
- `OTEL_EXPORTER_OTLP_ENDPOINT=https://otel-collector.example.com`

## Pilot Alert Minimums

- API 5xx error rate > 5% for 5 minutes.
- API p95 > 500 ms for 5 minutes.
- Postgres dependency failures for 2 minutes.
- Redis dependency failures for 2 minutes.
- Asynq pending or retry queue depth > 1000 for 10 minutes.
- Dispatch, wallet, notification, or risk failures for 5 minutes.
- WebSocket active connections drop by more than 20 compared with 10 minutes ago.
- Host disk, memory, or CPU usage > 85% for 10 minutes when node-exporter metrics are scraped.

Before staging launch, run:

```bash
docker compose config
docker compose up -d node-exporter prometheus grafana
docker compose logs --tail=100 prometheus
```

Validate Prometheus config and rules with:

```bash
promtool check config ops/prometheus/prometheus.yml
promtool check rules ops/prometheus/alerts.yml
```

Readiness checks:

- Prometheus: `http://localhost:9090/-/ready`
- Grafana: `http://localhost:3000/api/health`
- Loki: `http://localhost:3100/ready`

The Compose healthchecks try HTTP readiness first with `wget` or `curl`. If the image does not include either tool, they fall back to a process check and staging operators must validate readiness with the commands above from the host.
