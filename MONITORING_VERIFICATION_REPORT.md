# Monitoring Verification Report

Date: 2026-07-02

Scope: Read-only verification of the actual monitoring implementation against `docs/deployment/monitoring.md`. The only file created by this pass is this report.

## Result

Overall status: **PARTIAL PASS**

The documented Prometheus, Grafana, alert, dashboard, and backend `/metrics` paths mostly match the implementation. The main gaps are operational hardening: Prometheus and Grafana are published on host ports without app-level auth in Compose, host CPU/memory/disk alerts have no node-exporter scrape source in Compose, and service healthchecks are process checks rather than readiness checks.

## PASS / FAIL Table

| Item | Status | Evidence | Notes |
|---|---|---|---|
| Prometheus config exists | PASS | `ops/prometheus/prometheus.yml` | Matches doc path. |
| Prometheus alert rules exist | PASS | `ops/prometheus/alerts.yml` | Matches doc path. |
| Alert rule loading | PASS | `rule_files: /etc/prometheus/alerts.yml` | Compose mounts the same file to that path. |
| Scrape interval reasonable | PASS | `scrape_interval: 15s` | Matches pilot monitoring expectations. |
| Backend `/metrics` scrape configured | PASS | target `backend:3000`, path `/metrics` | Correct Docker service DNS and port. |
| Prometheus bearer token configured | PASS | `authorization.credentials_file` | Uses `/etc/prometheus/secrets/backend_metrics_token`. |
| Runtime bearer token file committed | PASS | only `backend_metrics_token.example` exists | Real token is intentionally absent and gitignored. |
| Backend `/metrics` implementation | PASS | `observability.MetricsHandler` | Uses Prometheus default gatherer and text exposition format. |
| `/metrics` protected outside dev | PASS | `backend/cmd/server/main.go` | Non-dev route uses `requireAuth` plus `AdminOnlyWithDB`. |
| Grafana provisioning exists | PASS | `ops/grafana/provisioning/` | Datasource and dashboard provider files exist. |
| Grafana Prometheus datasource | PASS | `ops/grafana/provisioning/datasources/prometheus.yml` | Points to `http://prometheus:9090`, default datasource. |
| Grafana dashboard provider | PASS | `ops/grafana/provisioning/dashboards/pickme.yml` | Loads from `/var/lib/grafana/dashboards/pickme`. |
| Dashboard files listed in docs | PASS | `docs/grafana/*.json` | All eight documented dashboard files exist. |
| Dashboard JSON validity | PASS | `ConvertFrom-Json` over all dashboards | All dashboard JSON files parsed locally. |
| Dashboard mounting | PASS | `docker-compose.yml` | Mounts `./docs/grafana` to Grafana dashboard path read-only. |
| Grafana admin password env | PARTIAL | `GF_SECURITY_ADMIN_PASSWORD: ${GRAFANA_ADMIN_PASSWORD}` | No default password is committed, but Compose does not fail fast if the env var is missing. |
| Prometheus service healthcheck | PARTIAL | process command-line check | Confirms process only, not HTTP readiness. |
| Grafana service healthcheck | PARTIAL | process command-line check | Confirms process only, not `/api/health`. |
| Loki healthcheck | PARTIAL | process command-line check | Confirms process only, not readiness endpoint. |
| App alert metrics exist | PASS | backend metric definitions | API, Postgres, Redis, Asynq, WebSocket, wallet, notification, and risk metrics exist. |
| Host capacity alert metrics scraped | FAIL | no node-exporter service or scrape config | `node_*` alerts will not fire unless external host metrics are added. |
| Prometheus UI exposure | FAIL | `ports: ${PROMETHEUS_PORT:-9090}:9090` | Prometheus has no auth in Compose and may expose metrics/config if host firewall allows public access. |
| Grafana direct port exposure | PARTIAL | `ports: ${GRAFANA_PORT:-3001}:3000` | Grafana has login auth and NGINX allowlist docs, but direct host port bypasses reverse-proxy allowlisting if firewall is open. |
| Docker Compose runtime validation | BLOCKED | `docker compose config` | Docker is not installed in this shell. |
| Prometheus rule validation | BLOCKED | `promtool check rules` | `promtool` is not installed in this shell. |

## Documentation Mismatches

1. `docs/deployment/monitoring.md` says host CPU, memory, and disk alerts apply when node-exporter metrics are scraped, but the implementation does not include a node-exporter service or scrape config.

Exact fix:

```yaml
  node-exporter:
    image: prom/node-exporter:v1.8.2
    command:
      - --path.rootfs=/host
    volumes:
      - /:/host:ro,rslave
    networks:
      - data
    restart: unless-stopped
```

Then add a Prometheus scrape job for `node-exporter:9100`, or document that host capacity alerts require an external Prometheus target.

2. The docs explain that backend `/metrics` is protected, but they do not warn that the Prometheus UI itself is exposed by Compose on a host port.

Exact fix:

```yaml
ports:
  - "127.0.0.1:${PROMETHEUS_PORT:-9090}:9090"
```

Or remove the port mapping and expose Prometheus only through VPN, SSH tunnel, or an authenticated reverse proxy.

3. The docs say to set `GRAFANA_ADMIN_PASSWORD`, but Compose does not require it.

Exact fix:

```yaml
GF_SECURITY_ADMIN_PASSWORD: ${GRAFANA_ADMIN_PASSWORD:?GRAFANA_ADMIN_PASSWORD is required}
```

4. `docs/deployment/monitoring.md` does not mention that Grafana is also host-port exposed in Compose.

Exact fix:

```yaml
ports:
  - "127.0.0.1:${GRAFANA_PORT:-3001}:3000"
```

Or rely only on the NGINX `grafana.pickme.example.com` allowlisted reverse proxy.

## Missing Files

No files documented in `docs/deployment/monitoring.md` are missing.

Operationally missing for full monitoring readiness:

- Node exporter Compose service or external scrape target.
- Prometheus rule validation in CI or staging with `promtool`.
- Runtime-only `ops/prometheus/secrets/backend_metrics_token` on the deployment host.

## Unsafe Configurations

- Prometheus is exposed on `${PROMETHEUS_PORT:-9090}:9090` without built-in authentication.
- Grafana is exposed on `${GRAFANA_PORT:-3001}:3000`; the NGINX config has allowlisting, but the direct Compose port can bypass that protection if the host firewall is open.
- Prometheus, Grafana, and Loki healthchecks only check process command lines, not service readiness.

## Exact Fixes Required

1. Bind Prometheus and Grafana Compose ports to localhost or remove the port mappings.
2. Add node-exporter or remove/disable host capacity alerts until external host metrics are configured.
3. Make `GRAFANA_ADMIN_PASSWORD` fail-fast in Compose.
4. Replace process-only healthchecks with readiness endpoints where available:
   - Prometheus: `/-/ready`
   - Grafana: `/api/health`
   - Loki: `/ready`
5. Run in CI/staging:

```bash
docker compose config
promtool check config ops/prometheus/prometheus.yml
promtool check rules ops/prometheus/alerts.yml
```

## Verification Commands Run

```text
Get-Content docs/deployment/monitoring.md
PASS
```

```text
Get-Content ops/prometheus/prometheus.yml
PASS
```

```text
Get-Content ops/prometheus/alerts.yml
PASS
```

```text
Get-ChildItem ops/grafana/provisioning -Recurse -File
PASS
```

```text
Get-ChildItem docs/grafana -File
PASS
```

```text
Get-ChildItem docs/grafana/*.json | ConvertFrom-Json
PASS
```

```text
rg for backend MetricsHandler and /metrics registration
PASS
```

```text
docker compose config
BLOCKED: docker command is not installed in this shell.
```

```text
promtool check rules ops/prometheus/alerts.yml
BLOCKED: promtool command is not installed in this shell.
```

## Final Assessment

Monitoring implementation is suitable for staging smoke validation after operator secrets are installed. It is not yet production-tight because Prometheus/Grafana direct host-port exposure and missing host metrics could leave monitoring either overexposed or incomplete.
