# Infrastructure Performance Tuning

Do not change ride, wallet, dispatch, notification, or risk business behavior during infra tuning.

## PostgreSQL Pool

Start pilot values:

- `PGXPOOL_MAX_CONNS=16`
- `PGXPOOL_MIN_CONNS=2`
- `PGXPOOL_MAX_CONN_LIFETIME_SECONDS=1800`
- `PGXPOOL_MAX_CONN_IDLE_SECONDS=300`
- `PGXPOOL_HEALTH_CHECK_SECONDS=30`
- `PGX_QUERY_EXEC_MODE=cache_statement` for direct Postgres/session pooling.
- `PGX_QUERY_EXEC_MODE=describe_exec` for PgBouncer transaction pooling.

## Redis

Start pilot values:

- `REDIS_POOL_SIZE=16`
- `REDIS_DRIVER_LOCATION_TTL_SECONDS=60`
- `REDIS_DRIVER_PRESENCE_TTL_SECONDS=90`

Redis maxmemory policy is `noeviction` because silent eviction can corrupt counters, locks, and job queues.

## Asynq

Start pilot values:

- `ASYNQ_CONCURRENCY=10`
- `ASYNQ_RETRY_MAX=5`
- `ASYNQ_SHUTDOWN_TIMEOUT_SECONDS=30`

Watch:

- queue depth
- retry count
- dead-letter count
- latency seconds

## HTTP

Start pilot values:

- `HTTP_REQUEST_TIMEOUT_SECONDS=15`
- `HTTP_RATE_LIMIT_MAX=120`
- `HTTP_RATE_LIMIT_WINDOW_SECONDS=60`

Use Cloudflare and NGINX rate limiting before requests reach the Go process.

## Memory and CPU

Initial host sizing for Gwanda pilot:

- 2 vCPU minimum
- 4 GB RAM minimum
- 40 GB disk minimum

Scale vertically first during pilot. Add a second backend instance only after Redis Pub/Sub and sticky WebSocket behavior have been verified in staging.
