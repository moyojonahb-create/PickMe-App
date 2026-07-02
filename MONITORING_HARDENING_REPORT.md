# Monitoring Hardening Report

Date: 2026-07-02

Scope: GO V2.6-A.4 Monitoring Hardening. This pass fixed only monitoring infrastructure issues from `MONITORING_VERIFICATION_REPORT.md`. No product logic, frontend contracts, ride, wallet, dispatch, risk, notification, WebSocket behavior, or database schema changed.

## Result

Overall status: **PASS WITH LOCAL RUNTIME VALIDATION BLOCKED**

The monitoring exposure and host-metric gaps found in the verification report have been addressed in code/config. Docker and `promtool` validation still need to run on a host where those binaries are installed.

## Files Changed

- `docker-compose.yml`
- `ops/prometheus/prometheus.yml`
- `docs/deployment/monitoring.md`
- `PRODUCTION_CHECKLIST.md`
- `RUNBOOK.md`
- `MONITORING_HARDENING_REPORT.md`

## Exact Exposure Changes

Prometheus is now localhost-bound by default:

```yaml
ports:
  - "127.0.0.1:${PROMETHEUS_PORT:-9090}:9090"
```

Grafana is now localhost-bound by default:

```yaml
ports:
  - "127.0.0.1:${GRAFANA_PORT:-3001}:3000"
```

Loki is now localhost-bound when the optional Loki profile is enabled:

```yaml
ports:
  - "127.0.0.1:${LOKI_PORT:-3100}:3100"
```

Remote access must go through VPN, SSH tunnel, Cloudflare Access, or authenticated/allowlisted NGINX.

## Grafana Password Fail-Fast

Docker Compose now requires `GRAFANA_ADMIN_PASSWORD`:

```yaml
GF_SECURITY_ADMIN_PASSWORD: ${GRAFANA_ADMIN_PASSWORD:?GRAFANA_ADMIN_PASSWORD is required}
```

This prevents accidentally starting Grafana without an explicit admin password.

## Node Exporter Decision

Decision: **A - add node-exporter**.

Reason: the existing alert rules already include host CPU, memory, and disk alerts. Adding node-exporter keeps those alerts meaningful instead of removing coverage.

Added Compose service:

- image: `prom/node-exporter:v1.8.2`
- internal network only: `data`
- read-only host mounts for `/proc`, `/sys`, and `/`
- healthcheck that attempts HTTP metrics readiness first and falls back to process verification if the image lacks `wget`/`curl`

Added Prometheus scrape job:

```yaml
- job_name: node-exporter
  static_configs:
    - targets: ["node-exporter:9100"]
```

## Healthcheck Changes

Prometheus healthcheck now tries:

```text
http://127.0.0.1:9090/-/ready
```

Grafana healthcheck now tries:

```text
http://127.0.0.1:3000/api/health
```

Loki healthcheck now tries:

```text
http://127.0.0.1:3100/ready
```

Because the runtime images may not all include `wget` or `curl`, each healthcheck uses this safe fallback pattern:

- use `wget` if available
- else use `curl` if available
- else fall back to verifying the expected process command line

This improves readiness validation where tools exist without making containers permanently unhealthy when minimal images omit HTTP clients.

## Documentation Updates

Updated `docs/deployment/monitoring.md` with:

- localhost-bound Prometheus and Grafana defaults
- remote access guidance through VPN, SSH tunnel, Cloudflare Access, or authenticated NGINX
- node-exporter host metric coverage
- `docker compose config`
- `promtool check config`
- `promtool check rules`
- readiness endpoint list
- healthcheck fallback limitation

Updated `PRODUCTION_CHECKLIST.md` with:

- localhost-bound Prometheus/Grafana checks
- `promtool` checks
- Grafana password required check
- node-exporter target check

Updated `RUNBOOK.md` with:

- monitoring access guidance
- SSH tunnel examples
- monitoring restart commands
- Docker Compose and `promtool` validation commands

## Validation Results

Backend:

```text
cd backend
$env:GOCACHE=(Resolve-Path .).Path + '\.gocache'
go test ./...
PASS
```

Frontend:

```text
npx tsc --noEmit -p tsconfig.app.json
PASS
```

Docker Compose:

```text
docker compose config
BLOCKED: docker is not installed in this shell.
```

Prometheus config:

```text
promtool check config ops/prometheus/prometheus.yml
BLOCKED: promtool is not installed in this shell.
```

Prometheus alert rules:

```text
promtool check rules ops/prometheus/alerts.yml
BLOCKED: promtool is not installed in this shell.
```

Static checks:

```text
rg for localhost-bound Prometheus/Grafana/Loki ports, node-exporter, readiness endpoints, and promtool docs
PASS
```

## Remaining Monitoring Risks

- Docker Compose syntax and image-level healthchecks must still be validated on a host with Docker installed.
- Prometheus config and alert rules must still be validated with `promtool` in CI or staging.
- Node-exporter host mounts are designed for Linux production hosts. Docker Desktop or non-Linux staging environments may need adjusted mount paths.
- Healthchecks fall back to process checks when images do not include `wget` or `curl`; staging operators should manually verify readiness endpoints after first deployment.
- Prometheus, Grafana, and Loki are localhost-bound by default, but host firewall and reverse-proxy access controls still need production review.

## Final Assessment

GO V2.6-A.4 status: **PASS FOR CODE-LEVEL MONITORING HARDENING**

The unsafe direct monitoring exposure is removed from Compose defaults, Grafana startup now fails without an explicit admin password, host capacity alerts now have a node-exporter target, and monitoring docs/runbook/checklist reflect the hardened deployment model.
