# Asynq Implementation Report

Date: 2026-06-16

Scope: Implemented GO V2.4-B Asynq background job system for PickMe Zimbabwe.

## Result

Overall result: **PASS**

Implemented Redis-backed Asynq queues, worker server, job handlers, enqueue helpers, retry/dead-letter behavior, Prometheus instrumentation, structured logging, graceful shutdown, and admin queue stats.

## Backend Package

Created:

- `backend/internal/jobs/types.go`
- `backend/internal/jobs/client.go`
- `backend/internal/jobs/runtime.go`
- `backend/internal/jobs/http.go`
- `backend/internal/jobs/metrics.go`
- `backend/internal/jobs/logging.go`

## Dependency

Added:

- `github.com/hibiken/asynq v0.26.0`

## Queues

Configured Redis-backed Asynq queues:

- `critical`
- `default`
- `low`

Queue weights:

- `critical`: 6
- `default`: 3
- `low`: 1

## Jobs

Implemented job types and handlers:

- `ride.offer_retry`
- `notification.push`
- `notification.sms`
- `receipt.email`
- `wallet.reconciliation`
- `fraud.scan`
- `driver.cleanup`
- `student.verification`

## Retry And Dead Letter

Retry support:

- Configured `ASYNQ_RETRY_MAX`.
- Enqueue helpers apply `asynq.MaxRetry`.
- Server uses bounded exponential retry delay.

Dead letter behavior:

- Asynq archived tasks are exposed as `dead_letter` in `/admin/jobs/stats`.
- Exhausted retries increment `jobs_dead_letter_total`.

## Metrics

Added Prometheus metrics:

- `jobs_enqueued_total`
- `jobs_processed_total`
- `jobs_failed_total`
- `jobs_dead_letter_total`
- `jobs_queue_size`

## Structured Logging

Added JSON structured logs for:

- Asynq server startup
- Asynq internal logs
- job processed events
- job failed events
- Redis health failures

## Graceful Shutdown

Implemented signal handling in `backend/cmd/server/main.go`:

- listens for `os.Interrupt`
- listens for `SIGTERM`
- shuts down Asynq runtime
- shuts down Fiber app

## Admin Endpoint

Exposed:

```text
GET /admin/jobs/stats
```

Auth:

- Supabase JWT required
- `middleware.AdminOnly()` required

Response includes per-queue:

- size
- pending
- active
- scheduled
- retry
- dead_letter
- completed
- processed
- failed
- processed_total
- failed_total
- latency_seconds
- paused
- timestamp

## Configuration

Added backend env settings:

```text
ASYNQ_ENABLED=false
ASYNQ_REDIS_URL=
ASYNQ_CONCURRENCY=10
ASYNQ_RETRY_MAX=5
ASYNQ_SHUTDOWN_TIMEOUT_SECONDS=30
```

`ASYNQ_REDIS_URL` defaults to `REDIS_URL` when omitted.

## Verification

Backend:

```text
cd backend
go test ./...
PASS
```

