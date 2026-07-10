# Environment Management

PickMe uses separate environment files for the browser bundle and backend runtime.

## Frontend Variables

Only `VITE_*` values are exposed to the browser.

Required:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_GO_BACKEND_URL`
- `VITE_GOOGLE_MAPS_API_KEY`

Optional:

- `VITE_API_BASE_URL`
- `VITE_BACKEND_URL`
- `VITE_DD_RUM_ENABLED`
- `VITE_DD_RUM_APPLICATION_ID`
- `VITE_DD_RUM_CLIENT_TOKEN`
- `VITE_DD_RUM_SITE`
- `VITE_DD_RUM_SERVICE`
- `VITE_DD_RUM_ENV`
- `VITE_DD_RUM_VERSION`

Never put Supabase service-role keys, provider tokens, webhook secrets, or Sentry auth tokens in frontend env.

## Backend Required Variables

- `DATABASE_URL`: Supabase PostgreSQL connection string. Must include
  `sslmode=require`, `sslmode=verify-full`, or `sslmode=verify-ca` whenever
  `APP_ENV` is not `development`, `dev`, or `local` — the backend fails to
  start otherwise. `sslmode=prefer`/`allow`/`disable` are rejected in that
  case because they silently allow a plaintext fallback.
- `SUPABASE_URL`: Supabase project URL.
- `SUPABASE_JWT_SECRET`: JWT validation secret.
- `APP_ENV`: `development`, `staging`, or `production`.
- `READINESS_PROFILE`: `development`, `staging`, `pilot`, or `production`.
- `CORS_ALLOW_ORIGINS`: Comma-separated frontend origins. Required and enforced at
  startup whenever `APP_ENV` is not `development`, `dev`, or `local` — the backend
  fails to start rather than falling back to a default origin list.

## Backend Infrastructure Variables

- `PORT`
- `HTTP_REQUEST_TIMEOUT_SECONDS`
- `HTTP_RATE_LIMIT_MAX`
- `HTTP_RATE_LIMIT_WINDOW_SECONDS`
- `PGXPOOL_MAX_CONNS`
- `PGXPOOL_MIN_CONNS`
- `PGXPOOL_MAX_CONN_LIFETIME_SECONDS`
- `PGXPOOL_MAX_CONN_IDLE_SECONDS`
- `PGXPOOL_HEALTH_CHECK_SECONDS`
- `PGX_QUERY_EXEC_MODE`

## Redis and Asynq

- `REDIS_ENABLED`
- `REDIS_URL`
- `REDIS_POOL_SIZE`
- `REDIS_DRIVER_LOCATION_TTL_SECONDS`
- `REDIS_DRIVER_PRESENCE_TTL_SECONDS`
- `ASYNQ_ENABLED`
- `ASYNQ_REDIS_URL`
- `ASYNQ_CONCURRENCY`
- `ASYNQ_RETRY_MAX`
- `ASYNQ_SHUTDOWN_TIMEOUT_SECONDS`

For the Gwanda pilot, use `REDIS_ENABLED=true`, `ASYNQ_ENABLED=true`, and an isolated Redis database index for Asynq.

Process-specific defaults:

- `backend` / `pickme-server`: runs HTTP, WebSockets, health, metrics, and enqueues jobs.
- `asynq-worker` / `pickme-worker`: runs job handlers only and should use `ASYNQ_CONCURRENCY` or `ASYNQ_WORKER_CONCURRENCY`.
- `asynq-scheduler` / `pickme-scheduler`: runs scheduled job registration only. It is idle when no recurring jobs are registered.

## Scaling

- `BACKEND_INSTANCE_COUNT`: optional, defaults to `1`. Declares how many
  `backend`/`pickme-server` replicas you intend to run. This backend
  supports exactly one replica today — the WebSocket driver/rider registries
  and the in-memory rate-limit fallback are per-process only. Setting this
  above `1` does not enable clustering; it only makes the process log a
  `DEPLOYMENT_SINGLE_INSTANCE_CONSTRAINT_VIOLATION` warning at startup. See
  [websocket-scaling.md](websocket-scaling.md) before scaling horizontally.

## Dispatch

- `DISPATCH_MODE`
- `DISPATCH_SHADOW_RADIUS_KM`
- `DISPATCH_SHADOW_CANDIDATE_LIMIT`
- `DISPATCH_SHADOW_SELECTED_LIMIT`
- `DISPATCH_SHADOW_RANKING_VERSION`
- `DISPATCH_OFFER_TTL_SECONDS`
- `DISPATCH_RIDE_LOCK_TTL_SECONDS`
- `DISPATCH_DRIVER_LOCK_TTL_SECONDS`
- `DISPATCH_QUEUE_NAME`

Pilot default: `DISPATCH_MODE=authoritative`.

## Observability

- `SENTRY_DSN`
- `SENTRY_ENVIRONMENT`
- `SENTRY_RELEASE`
- `OTEL_ENABLED`
- `OTEL_EXPORTER_OTLP_ENDPOINT`
- `GRAFANA_ADMIN_PASSWORD`

Prometheus scraping of `/metrics` requires an admin JWT in `ops/prometheus/secrets/backend_metrics_token`.

## Notifications

- `NOTIFICATION_RATE_LIMIT_PER_MINUTE`
- `NOTIFICATION_FCM_ENDPOINT`
- `NOTIFICATION_FCM_TOKEN`
- `NOTIFICATION_SMS_ENDPOINT`
- `NOTIFICATION_SMS_TOKEN`
- `NOTIFICATION_EMAIL_ENDPOINT`
- `NOTIFICATION_EMAIL_TOKEN`

Provider mode is explicit: empty endpoint/token means the HTTP provider is not production-ready for that channel.

## Wallet, Payments, and Pilot

- `PUBLIC_WALLET_PILOT_ENABLED`
- `PUBLIC_WALLET_PILOT_PROGRAM_ID`
- `PUBLIC_WALLET_PILOT_CITY`
- `PAYMENTS_PROVIDER_ENABLED`
- `ONEMONEY_ENABLED`
- `ONEMONEY_WEBHOOK_SECRET`
- `ONEMONEY_STATUS_URL`
- `ECOCASH_ENABLED`
- `ECOCASH_WEBHOOK_SECRET`
- `ECOCASH_STATUS_URL`
- `INNBUCKS_ENABLED`
- `INNBUCKS_WEBHOOK_SECRET`
- `INNBUCKS_STATUS_URL`
- `PAYPAL_ENABLED`
- `PAYPAL_WEBHOOK_SECRET`
- `PAYPAL_STATUS_URL`
- `CARD_PAYMENTS_ENABLED`

Mock card processing is allowed only in explicit development mode.
