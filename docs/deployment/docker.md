# Docker Deployment

## Build

```bash
docker compose config
docker compose build
```

## Start Core Stack

```bash
docker compose up -d backend frontend redis prometheus grafana
```

## Start Optional Worker Profiles

The backend image contains three binaries:

- `/app/pickme-server`: HTTP API, WebSockets, health, and metrics.
- `/app/pickme-worker`: Asynq worker only.
- `/app/pickme-scheduler`: Asynq scheduler only. This release has no recurring jobs registered, so the scheduler process is intentionally idle until schedules are added.

The `worker` and `scheduler` profiles must not run the API server.

```bash
docker compose --profile worker --profile scheduler up -d
docker compose --profile worker --profile scheduler ps
```

## Health Checks

```bash
curl -fsS http://localhost:3000/health/live
curl -fsS http://localhost:3000/health/ready
curl -fsS http://localhost:3000/health/dependencies
curl -fsS http://localhost:8080/
```

Worker and scheduler containers do not expose HTTP health endpoints. Their Compose healthchecks verify that the dedicated process is running.

## Metrics

`/metrics` is protected outside explicit development mode. Put a valid admin JWT in:

```text
ops/prometheus/secrets/backend_metrics_token
```

Then restart Prometheus:

```bash
docker compose restart prometheus
```

Prometheus also loads alert rules from:

```text
ops/prometheus/alerts.yml
```

## Rolling Update

```bash
docker compose pull
docker compose build
docker compose up -d --no-deps backend
curl -fsS http://localhost:3000/health/ready
docker compose up -d --no-deps frontend
docker compose --profile worker --profile scheduler up -d --no-deps asynq-worker asynq-scheduler
```

## Rollback

```bash
IMAGE_TAG=<previous-tag> docker compose up -d --no-deps backend frontend
curl -fsS http://localhost:3000/health/ready
```
