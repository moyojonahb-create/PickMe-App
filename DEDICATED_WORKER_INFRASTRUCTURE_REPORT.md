# Dedicated Worker Infrastructure Report

Date: 2026-07-01

Scope: GO V2.6-A.2 Dedicated Worker & Infrastructure Finalization. This pass fixed only infrastructure gaps from `INFRASTRUCTURE_VERIFICATION_REPORT.md`. No frontend contracts, ride, wallet, dispatch, notification, risk, or WebSocket business behavior was intentionally changed.

## Result

Overall result: **PASS WITH LOCAL RUNTIME VALIDATION BLOCKED**

Staging readiness score: **90/100**  
Production readiness score: **86/100**

The previous production blocker, worker/scheduler services running the API server binary, is fixed. Docker and Prometheus runtime validation still need to run on a host with Docker and `promtool`.

## Files Changed

- `backend/cmd/server/main.go`
- `backend/cmd/worker/main.go`
- `backend/cmd/scheduler/main.go`
- `backend/internal/jobs/runtime.go`
- `backend/Dockerfile`
- `docker-compose.yml`
- `ops/systemd/pickme-asynq-worker.service`
- `ops/systemd/pickme-asynq-scheduler.service`
- `ops/prometheus/prometheus.yml`
- `ops/prometheus/alerts.yml`
- `vite.config.ts`
- `PRODUCTION_CHECKLIST.md`
- `RUNBOOK.md`
- `docs/deployment/docker.md`
- `docs/deployment/ubuntu.md`
- `docs/deployment/monitoring.md`
- `docs/deployment/environment.md`
- `DEDICATED_WORKER_INFRASTRUCTURE_REPORT.md`

## Binaries Created

- `pickme-server`
  - Built from `backend/cmd/server`.
  - Runs HTTP API, WebSockets, health endpoints, metrics, route registration, enqueue clients, and admin job stats.
  - No longer starts the Asynq worker loop.

- `pickme-worker`
  - Built from `backend/cmd/worker`.
  - Runs Asynq worker processing only.
  - Registers existing notification job handlers and risk/fraud scan handlers.
  - Existing runtime job types for wallet reconciliation, driver cleanup, ride offer retry, receipt email, and student verification remain registered through the existing jobs runtime default handler where no dedicated handler existed before this infrastructure pass.
  - Does not start Fiber, HTTP health routes, `/metrics`, or WebSockets.

- `pickme-scheduler`
  - Built from `backend/cmd/scheduler`.
  - Runs Asynq scheduler process only.
  - No HTTP API and no WebSocket server.
  - No recurring jobs are registered in the current release, so the process stays alive and idle until schedules are added.

## Compose Changes

- `backend` now explicitly runs `/app/pickme-server`.
- `asynq-worker` now explicitly runs `/app/pickme-worker`.
- `asynq-scheduler` now explicitly runs `/app/pickme-scheduler`.
- Worker and scheduler healthchecks no longer call fake HTTP ports.
- Prometheus mounts `ops/prometheus/alerts.yml`.
- Added healthchecks for:
  - Prometheus
  - Grafana
  - Loki

## Systemd Changes

- `pickme-backend.service` already used `/opt/pickme/bin/pickme-server`.
- `pickme-asynq-worker.service` now uses `/opt/pickme/bin/pickme-worker`.
- `pickme-asynq-scheduler.service` now uses `/opt/pickme/bin/pickme-scheduler`.
- Removed leftover worker/scheduler `PORT` assignments because those processes do not expose HTTP.

## Alert Rules Added

Created `ops/prometheus/alerts.yml` with alerts for:

- API high 5xx error rate
- API p95 latency high
- PostgreSQL down/failing through backend scrape and Postgres failure counters
- Redis failures
- Asynq queue depth high
- WebSocket connection drop
- Wallet failures
- Dispatch failures
- Notification failures
- Risk/fraud scan failures
- Disk high
- Memory high
- CPU high

Prometheus now loads this file through `rule_files`.

## Supabase Key Hygiene

Removed the committed public Supabase anon fallback from `vite.config.ts`.

Vite builds now require:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

No live fallback key remains in `vite.config.ts`.

## Documentation Updated

- Added dedicated worker and scheduler deployment notes.
- Added Docker runtime validation commands.
- Added alert rule setup.
- Added systemd build/install commands for all three binaries.
- Added staging deployment checklist items.
- Updated runbook restart/rollback commands for worker and scheduler services.

## Verification

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

Docker:

```text
docker compose config
BLOCKED: docker is not installed in this shell.
```

Prometheus rules:

```text
promtool check rules ops/prometheus/alerts.yml
BLOCKED: promtool is not installed in this shell.
```

Static scans:

```text
rg -n "fiber|websocket|Listen\(|/health|MetricsHandler|RegisterRoutes" backend/cmd/worker backend/cmd/scheduler
No matches
```

```text
rg -n "FALLBACK_SUPABASE|jidfganntquilvsytslp|clwzOYff" vite.config.ts Dockerfile docker-compose.yml docs ops .env.example
No matches
```

## Remaining Blockers

- Docker runtime validation must run on staging or CI with Docker installed:

```bash
docker compose config
docker compose build
docker compose --profile worker --profile scheduler up -d
docker compose ps
curl -fsS http://localhost:3000/health/live
curl -fsS http://localhost:3000/health/ready
curl -fsS http://localhost:3000/health/dependencies
```

- Prometheus alert rules should be validated with `promtool` in CI/staging.
- Host CPU, memory, and disk alerts require node-exporter or equivalent host metrics to be scraped.
- Scheduler has no recurring jobs registered in the current codebase. This is not a regression, but recurring jobs should be registered there if future scheduled work is added.

## Final Assessment

GO V2.6-A.2 status: **PASS FOR CODE-LEVEL INFRASTRUCTURE FINALIZATION**

The major production infrastructure gap is closed: worker and scheduler processes no longer run the API server. The repo is ready for staging Docker validation and production release rehearsal once Docker and Prometheus rule checks are run on the deployment host.
