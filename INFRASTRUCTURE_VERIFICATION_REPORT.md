# Infrastructure Verification Report

Date: 2026-07-01

Scope: GO V2.6-A.1 infrastructure verification after production infrastructure work. This audit reviewed actual infrastructure files and made only safe infrastructure/config fixes. No frontend, ride, wallet, dispatch, notification, risk, API contract, WebSocket contract, or database schema logic was changed.

## Summary

Staging readiness score: **84/100**  
Production readiness score: **76/100**

The infrastructure is suitable for staging validation, but not yet production-complete. The largest production gap is Asynq process separation: `asynq-worker` and `asynq-scheduler` exist as separate services, but they still run the same `cmd/server` monolith binary rather than dedicated worker/scheduler entrypoints.

## Files Changed During Verification

- `Dockerfile`
- `docker-compose.yml`
- `.gitignore`
- `.github/workflows/cd.yml`
- `ops/nginx/frontend-nginx.conf`
- `ops/prometheus/secrets/backend_metrics_token`
- `INFRASTRUCTURE_VERIFICATION_REPORT.md`

Note: `ops/prometheus/secrets/backend_metrics_token` was removed from tracked files because it is the exact runtime path where operators should place a real admin JWT. The committed placeholder remains `ops/prometheus/secrets/backend_metrics_token.example`.

## PASS / FAIL Table

| Area | Status | Evidence | Notes |
|---|---|---|---|
| Backend Dockerfile exists | PASS | `backend/Dockerfile` | Multi-stage Go build, Alpine runtime. |
| Backend Dockerfile production-safe | PASS | `backend/Dockerfile` | Static build, non-root `pickme`, healthcheck, minimal runtime. |
| Frontend Dockerfile exists | PASS | `Dockerfile` | Multi-stage Node build, NGINX runtime. |
| Frontend Dockerfile production-safe | PASS | `Dockerfile`, `ops/nginx/frontend-nginx.conf` | Fixed during audit to run NGINX as non-root with writable temp/pid paths. |
| Correct Docker build context | PASS | `docker-compose.yml` | Frontend uses repo root, backend uses `./backend`. |
| Docker runtime validation | BLOCKED | `docker compose config` | Docker is not installed in this shell, so runtime validation must run in CI/staging. |
| Compose backend service | PASS | `docker-compose.yml` | Has env, networks, healthcheck, restart policy. |
| Compose frontend service | PASS | `docker-compose.yml` | Has build args, healthcheck, restart policy. |
| Compose Redis service | PASS | `docker-compose.yml`, `ops/redis/redis.conf` | Persistent volume, AOF, healthcheck, restart policy. |
| Compose Asynq worker service | FAIL | `docker-compose.yml` | Separate service exists, but runs same server binary rather than a dedicated worker. |
| Compose Prometheus service | PARTIAL | `docker-compose.yml`, `ops/prometheus/prometheus.yml` | Scrape config exists; no service healthcheck. |
| Compose Grafana service | PARTIAL | `docker-compose.yml`, `ops/grafana/provisioning` | Provisioning exists; no service healthcheck. |
| Optional Loki/logging service | PARTIAL | `docker-compose.yml` | Optional profile exists, but no custom config, volumes, or healthcheck. |
| Compose networks | PASS | `edge`, `data` | Data network is internal. |
| Compose volumes | PASS | Redis, Prometheus, Grafana volumes | Persistent state declared. |
| Compose env file loading | PASS | `env_file` entries | Added explicit optional `.env` / `backend/.env` loading. |
| Prometheus config exists | PASS | `ops/prometheus/prometheus.yml` | 15s scrape/eval interval. |
| Backend `/metrics` scraping | PASS | Prometheus target `backend:3000` | Uses `/metrics`. |
| Metrics admin bearer token | PASS | `authorization.credentials_file` | Actual token file is ignored; example placeholder committed. |
| Grafana provisioning | PASS | `ops/grafana/provisioning` | Datasource and dashboard provider exist. |
| Dashboards mounted | PASS | `docs/grafana` volume | Mounted into Grafana dashboard path. |
| Grafana admin password env | PASS | `GF_SECURITY_ADMIN_PASSWORD` | No default password committed. |
| Asynq graceful shutdown | PARTIAL | `cmd/server/main.go`, systemd `KillSignal=SIGTERM` | Server handles shutdown, but worker is not isolated. |
| Queue stats admin protected | PASS | `backend/internal/jobs/http.go` | `/admin/jobs/stats` uses auth + `AdminOnly`. |
| Reverse proxy config exists | PASS | `ops/nginx/pickme.conf` | NGINX config present. |
| WebSocket upgrade | PASS | `/ws` location | `Upgrade` and `Connection` headers configured. |
| HTTPS redirect | PASS | port 80 server | Redirects to HTTPS. |
| Security headers | PASS | NGINX config | HSTS, nosniff, frame options, referrer policy. |
| Compression | PASS | NGINX config | gzip enabled. |
| Rate limiting | PASS | NGINX config | `limit_req_zone` and API/ws limits. |
| Frontend/backend routing | PASS | NGINX config | Separate frontend and API server names. |
| Systemd backend service | PASS | `ops/systemd/pickme-backend.service` | Restart, env file, journald logging. |
| Systemd Asynq worker | PARTIAL | `ops/systemd/pickme-asynq-worker.service` | Exists, but runs same server binary. |
| Systemd scheduler | PARTIAL | `ops/systemd/pickme-asynq-scheduler.service` | Exists, but runs same server binary. |
| GitHub Actions CI | PASS | `.github/workflows/ci.yml` | Go test, TypeScript, lint, build, Docker builds, Trivy scans. |
| GitHub Actions CD | PASS | `.github/workflows/cd.yml` | Staging and production environments separated. |
| Secrets in workflows | PASS | GitHub secrets references | No secret values committed. |
| `.env` ignored | PASS | `.gitignore` | Root and backend env files ignored. |
| Env examples placeholders | PASS | `.env.example`, `backend/.env.example` | Values are empty/placeholders. |
| Live secrets committed | PASS with caveat | Secret scan | No private live secrets found in infra files. `vite.config.ts` contains a public Supabase anon fallback key, not a service secret, but should still be removed for stricter deploy hygiene. |
| PostgreSQL backup plan | PASS | `docs/deployment/backups-disaster-recovery.md` | `pg_dump` and restore rehearsal documented. |
| Redis backup/AOF plan | PASS | Redis config and backup doc | AOF and RDB backup/restore documented. |
| Supabase Storage backup plan | PASS | backup doc | Storage buckets and restore sampling documented. |
| Restore runbook | PASS | backup doc + `RUNBOOK.md` | Restore and incident recovery steps exist. |
| Production checklist actionable | PASS | `PRODUCTION_CHECKLIST.md` | Clear checkbox format. |
| Operations runbook coverage | PASS | `RUNBOOK.md` | Covers required incident classes. |

## Missing Files

- `backend/cmd/worker/main.go`
- `backend/cmd/scheduler/main.go`
- Dedicated Asynq scheduler implementation/config, if scheduled tasks are intended to run outside the API process.
- Prometheus alert rules file, for example `ops/prometheus/alerts.yml`.
- Loki production config file, for example `ops/loki/loki.yml`.

## Unsafe Or Incomplete Configs

### 1. Asynq Worker Is Not A True Worker

Current state:

- `asynq-worker` and `asynq-scheduler` are separate Compose services.
- Both run the backend image default entrypoint.
- The default entrypoint is `cmd/server`, which starts the HTTP API and the same app wiring.

Risk:

- Worker/scheduler processes duplicate API surface and app startup side effects.
- Scaling workers can accidentally scale HTTP servers and WebSocket managers.

Exact fix:

- Add `backend/cmd/worker/main.go` that initializes Redis, jobs runtime, notification/risk handlers, and blocks on Asynq only.
- Add `backend/cmd/scheduler/main.go` only if recurring jobs are required.
- Update `backend/Dockerfile` to build `pickme-server`, `pickme-worker`, and optionally `pickme-scheduler`.
- Update Compose/systemd worker services to run the dedicated binaries.

### 2. Prometheus, Grafana, Loki Lack Compose Healthchecks

Current state:

- Backend, frontend, Redis, worker, and scheduler have healthchecks.
- Prometheus, Grafana, and Loki do not.

Exact fix:

- Add healthchecks after confirming the final images include `wget`/`curl`, or add small sidecar-compatible probes.
- Validate with `docker compose config` and `docker compose up` in staging.

### 3. Docker Validation Could Not Run Locally

Current state:

```text
docker compose config
FAILED locally: docker command not found
```

Exact fix:

- Run these commands in CI or on the Ubuntu staging host:

```bash
docker compose config
docker compose build
docker compose up -d
curl -fsS http://localhost:3000/health/live
curl -fsS http://localhost:3000/health/ready
curl -fsS http://localhost:3000/health/dependencies
```

### 4. Prometheus Token File Must Be Created At Deploy Time

Current state:

- Prometheus expects `/etc/prometheus/secrets/backend_metrics_token`.
- The real file path is gitignored.
- Only `backend_metrics_token.example` is committed.

Exact fix:

```bash
cp ops/prometheus/secrets/backend_metrics_token.example ops/prometheus/secrets/backend_metrics_token
printf '%s' "$ADMIN_JWT" > ops/prometheus/secrets/backend_metrics_token
docker compose restart prometheus
```

### 5. Public Supabase Anon Fallback Key Remains In Frontend Config

Current state:

- `vite.config.ts` includes a hardcoded Supabase anon fallback key.
- This is not a service-role secret, but it is still a live public credential.

Exact fix:

- Remove the fallback key and require `VITE_SUPABASE_PUBLISHABLE_KEY` at build time.
- This is frontend build hygiene, so it should be handled in a separate frontend/config hardening pass.

## Production Checklist Review

Actionable: **yes**

Missing checklist items to add:

- [ ] `docker compose config` passes in CI/staging.
- [ ] Dedicated Asynq worker binary deployed.
- [ ] Prometheus alert rules loaded.
- [ ] Grafana dashboard import verified after first boot.
- [ ] Prometheus admin JWT installed and rotated.
- [ ] NGINX config tested with `nginx -t`.
- [ ] TLS certificate auto-renewal tested.
- [ ] Staging restore rehearsal completed with evidence.
- [ ] Docker image vulnerability scan reviewed and accepted.
- [ ] `.env` file permissions restricted to deployment user.

## Operations Runbook Review

Coverage status: **PASS**

Covered:

- Backend failure/restart
- Redis failure/restart/full
- Asynq failure/restart
- PostgreSQL/database failover/full
- WebSocket incident
- Wallet incident
- Notification outage
- Rollback
- Disk full
- High CPU
- High RAM

Recommended additions:

- Add command to capture `docker compose ps` and `docker compose logs --since 15m`.
- Add exact owner/escalation contacts for finance, operations, and infrastructure.
- Add Prometheus/Grafana incident checks once alert rules are added.

## Verification Commands Run

```text
rg --files Dockerfile backend/Dockerfile docker-compose.yml ops .github docs/deployment PRODUCTION_CHECKLIST.md RUNBOOK.md
PASS
```

```text
rg for private secret patterns across repo excluding .env, backend/.env, node_modules, .git, backend/.gocache
PASS for infra files; public Supabase anon fallback key remains in vite.config.ts.
```

```text
docker compose config
BLOCKED: docker is not installed in this shell.
```

## Final Assessment

GO V2.6-A.1 status: **PARTIAL PASS**

The infrastructure implementation is strong enough for staging rollout and operator rehearsal. It is not yet clean enough for production signoff because the Asynq worker/scheduler are not dedicated processes, observability services lack healthchecks, and Docker runtime validation has not been executed in an environment with Docker.
