# PostgreSQL Performance Audit

Date: 2026-06-19

Scope: GO V2.5-C audit and optimization of PostgreSQL hot paths behind ride creation, dispatch offer creation, offer acceptance, wallet operations, websocket room authorization, risk engine writes, and notification writes.

## Result

Overall result: **PASS FOR CODE-LEVEL REMEDIATION**

Implemented safe backend and schema changes without changing API contracts or frontend behavior.

Load-test target remains:

- p95 database latency under `200ms`
- p99 database latency under `500ms`

This pass removes obvious code-level causes of high latency. Final target validation still requires applying the migration and rerunning k6 against the same database.

## Implemented Changes

### Missing Indexes

Added migration:

```text
supabase/migrations/20260619113000_postgres_hot_path_indexes.sql
```

Indexes added:

- `idx_rides_rider_status_created`
- `idx_rides_driver_ride_status`
- `idx_rides_requested_created`
- `idx_ride_offers_ride_pending_expires_created`
- `idx_ride_offers_id_pending_expires`
- `idx_ride_offers_driver_ride`
- `idx_dispatch_shadow_runs_ride_created`
- `idx_dispatch_shadow_candidates_run_driver`
- `idx_driver_sessions_driver_updated`
- `idx_payment_intents_scoped_idempotency`
- `idx_payment_intents_provider_reference`
- `idx_payment_intents_idempotency`
- `idx_wallet_accounts_owner_type_currency`
- `idx_wallet_authorizations_ride`
- `idx_wallet_transactions_owner_created`
- `idx_wallet_ledger_entries_transaction`
- `idx_notification_devices_active_user_seen`
- `idx_notification_history_failed_created`
- `idx_risk_scores_score_updated`
- `idx_risk_events_area_only`

### Query Batching

Updated:

```text
backend/internal/dispatch/repository.go
```

Changes:

- `InsertShadowCandidates` now inserts candidates in one batched `INSERT` instead of one DB round trip per candidate.
- `CreateOfferWave` now inserts/upserts all driver offers in one batched `INSERT ... ON CONFLICT` instead of one DB round trip per offer.

### Reduced Transaction And Lock Risk

Updated:

```text
backend/internal/database/postgres.go
```

Changes:

- Added `statement_timeout`, default `5s`.
- Added `lock_timeout`, default `1s`.
- Added `idle_in_transaction_session_timeout`, default `5s`.
- Added explicit pgxpool tuning:
  - `PGXPOOL_MAX_CONNS`, default `16`
  - `PGXPOOL_MIN_CONNS`, default `2`
  - `PGXPOOL_MAX_CONN_LIFETIME_SECONDS`, default `1800`
  - `PGXPOOL_MAX_CONN_IDLE_SECONDS`, default `300`
  - `PGXPOOL_HEALTH_CHECK_SECONDS`, default `30`

### Prepared Statement Usage

Updated:

```text
backend/internal/database/postgres.go
```

Changes:

- Removed hard-coded `pgx.QueryExecModeSimpleProtocol`.
- Default query execution is now `pgx.QueryExecModeCacheStatement`.
- Added `PGX_QUERY_EXEC_MODE` override:
  - `simple_protocol`
  - `exec`
  - `cache_describe`
  - `describe_exec`
  - default: `cache_statement`

Operational note:

- If using Supabase PgBouncer transaction pooling, set `PGX_QUERY_EXEC_MODE=describe_exec` or `simple_protocol`.
- If using direct Postgres or session pooling, keep the default prepared statement cache.

### Reduced Unnecessary SELECTs

Updated:

```text
backend/internal/rides/handler.go
```

Change:

- Legacy ride acceptance now fetches `rider_id` and `payment_method` in one query instead of fetching payment method first and rider ID after the update.

## Query Audit

### Ride Creation

Execution path:

- `POST /api/rides`
- `backend/internal/rides/handler.go`
- `Handler.Request`

Queries:

| Query | Frequency | Indexes Used / Needed | Risk |
|---|---:|---|---|
| `INSERT INTO public.rides (...) RETURNING id, created_at` | Once per ride request | Primary key on `rides.id`; insert path benefits from reduced secondary-index count but needs rider/status indexes for follow-up reads | Low scan risk; trigger/realtime overhead can add latency |
| Wallet authorization pre-insert, when payment method is wallet | Wallet rides only | `idx_wallet_authorizations_ride`, `idx_wallet_accounts_owner_type_currency` | Row lock on rider wallet is necessary; keep external work outside transaction |

Missing indexes:

- Added `idx_rides_rider_status_created`.
- Added `idx_rides_requested_created`.

N+1 risk:

- None in ride insert itself.

Transaction duration risk:

- Wallet authorization performs account lock and authorization insert before ride insert. This is acceptable but should stay free of external provider calls.

Unnecessary SELECTs:

- None in create path.

FOR UPDATE locks:

- Wallet authorization uses account and authorization locks; necessary for balance correctness.

Slow scans:

- Follow-up rider/status queries were at risk without `rider_id` indexes.

### Dispatch Offer Creation

Execution path:

- Authoritative dispatch from ride request
- `backend/internal/dispatch/service.go`
- `backend/internal/dispatch/repository.go`
- `CreateOfferWave`
- `InsertShadowCandidates`
- `RecordFirstOfferOutcome`

Queries:

| Query | Frequency | Indexes Used / Needed | Risk |
|---|---:|---|---|
| `INSERT INTO public.ride_offers (...) ON CONFLICT (driver_id, ride_id)` | Once per offer wave after batching | `idx_ride_offers_driver_ride`; existing unique constraint/index required for conflict target | Previously N round trips per wave; now one |
| `INSERT INTO public.dispatch_shadow_candidates (...)` | Once per candidate batch after batching | `idx_dispatch_shadow_candidates_run_driver` for later outcome joins | Previously N round trips per candidate; now one |
| `INSERT INTO public.dispatch_shadow_runs (...)` | Once per dispatch run | Primary key, `idx_dispatch_shadow_runs_ride_created` for latest run lookup | Low |
| `INSERT INTO public.dispatch_shadow_outcomes ... SELECT ... FROM dispatch_shadow_runs LEFT JOIN dispatch_shadow_candidates` | First offer / accepted offer | `idx_dispatch_shadow_runs_ride_created`, `idx_dispatch_shadow_candidates_run_driver` | Slow join risk fixed by indexes |
| `UPDATE public.ride_offers SET status='expired' WHERE ride_id=$1 AND status='pending' AND expires_at <= $2` | Per expiry sweep | `idx_ride_offers_ride_pending_expires_created` | Low after partial index |
| `INSERT INTO public.driver_sessions ... ON CONFLICT(driver_id)` | Driver state changes | `idx_driver_sessions_driver_updated`; unique driver index/constraint required by conflict target | Low |

Missing indexes:

- Added ride offer pending partial indexes.
- Added dispatch run/candidate indexes.

N+1 risk:

- Fixed in offer wave creation.
- Fixed in shadow candidate insertion.

Transaction duration risk:

- No explicit transaction in dispatch repository hot path.

Unnecessary SELECTs:

- Outcome recording joins to latest shadow run; necessary for analytics.

FOR UPDATE locks:

- None in dispatch repository.

Slow scans:

- Latest run lookup by `ride_id ORDER BY created_at DESC LIMIT 1` was at risk; fixed.

### Offer Acceptance

Execution path:

- `POST /api/rides/:rideId/offers/:offerId/accept`
- `backend/internal/rides/handler.go`
- `Handler.acceptOffer`

Queries:

| Query | Frequency | Indexes Used / Needed | Risk |
|---|---:|---|---|
| `SELECT ... FROM public.ride_offers WHERE id=$1 FOR UPDATE` | Once per accept | Primary key; `idx_ride_offers_id_pending_expires` helps pending offer paths | Necessary lock |
| `SELECT ... FROM public.rides WHERE id=$1 FOR UPDATE` | Once per accept | Primary key | Necessary lock |
| `UPDATE public.rides SET driver_id=$1, ride_status='accepted' WHERE id=$2 AND ride_status='requested'` | Once per accept | Primary key; `idx_rides_requested_created` helps broader requested filters | Low |
| `UPDATE public.ride_offers SET status='accepted' WHERE id=$1 AND status='pending' AND expires_at > now()` | Once per accept | Primary key plus partial pending index | Low |
| `UPDATE public.ride_offers SET status='expired' WHERE ride_id=$1 AND id != $2 AND status='pending'` | Once per accept | `idx_ride_offers_ride_pending_expires_created` | Can touch all pending offers for ride; acceptable if fanout bounded |
| Dispatch outcome `INSERT ... SELECT ... LEFT JOIN` | Once per accept | Dispatch indexes above | Low after index |

Missing indexes:

- Added `idx_ride_offers_ride_pending_expires_created`.
- Added `idx_ride_offers_id_pending_expires`.

N+1 risk:

- None in accept path.

Transaction duration risk:

- Locks offer and ride while doing validation and updates. No external calls inside transaction; acceptable.

Unnecessary SELECTs:

- Existing SELECTs are needed for ownership/status validation.

Unnecessary FOR UPDATE locks:

- Offer and ride locks are necessary to prevent double acceptance.

Slow joins:

- Dispatch outcome joins fixed by indexes.

### Legacy Ride Accept

Execution path:

- `POST /rides/:id/accept`
- `backend/internal/rides/handler.go`
- `Handler.acceptRide`

Queries:

| Query | Frequency | Indexes Used / Needed | Risk |
|---|---:|---|---|
| `SELECT rider_id, COALESCE(payment_method,'cash') FROM public.rides WHERE id=$1` | Once per accept | Primary key | Low |
| `UPDATE public.rides SET driver_id=$1, ride_status='accepted' WHERE id=$2 AND ride_status='requested'` | Once per accept | Primary key | Low |
| `INSERT INTO public.driver_sessions ... ON CONFLICT(driver_id)` | Once per accept | `idx_driver_sessions_driver_updated` | Low |

Unnecessary SELECTs:

- Reduced from two ride reads to one ride read.

### Wallet Operations

Execution paths:

- `POST /api/wallets/deposits`
- `POST /api/wallets/withdrawals`
- `POST /api/wallets/transfer`
- wallet authorization/capture/release paths
- `backend/internal/wallet/repository.go`

Queries:

| Query | Frequency | Indexes Used / Needed | Risk |
|---|---:|---|---|
| `INSERT INTO public.payment_intents ... ON CONFLICT(user_id, provider, operation, idempotency_key)` | Once per deposit/intent | `idx_payment_intents_scoped_idempotency`; unique constraint required for conflict target | Low |
| `SELECT ... FROM public.payment_intents WHERE user_id=$1 AND provider=$2 AND operation=$3 AND idempotency_key=$4` | Provider deposits | `idx_payment_intents_scoped_idempotency` | Low |
| `SELECT ... FROM public.payment_intents WHERE provider=$1 AND provider_reference=$2` | Provider callbacks | `idx_payment_intents_provider_reference` | Low |
| `SELECT ... FROM public.payment_intents WHERE idempotency_key=$1` | Manual/frontend lookup paths | `idx_payment_intents_idempotency` | Low |
| `INSERT INTO public.wallet_accounts ... ON CONFLICT(id)` then `SELECT ... FROM public.wallet_accounts WHERE id=$1 FOR UPDATE` | Wallet mutation/account ensure | Primary key | Necessary lock |
| `INSERT INTO public.wallet_transactions (...)` | Per wallet transaction | Primary key, `idx_wallet_transactions_owner_created` for reads | Low |
| `INSERT INTO public.wallet_ledger_entries (...)` | Two or more per transaction | `idx_wallet_ledger_entries_transaction` | Batch candidate, but left unchanged to minimize ledger risk |
| `UPDATE public.wallet_accounts SET cached_available_balance=... WHERE id=$1` | Per balance movement | Primary key | Necessary lock/update |
| `SELECT ... FROM public.wallet_authorizations WHERE ride_id=$1 FOR UPDATE` | Wallet ride auth/capture/release | `idx_wallet_authorizations_ride` | Necessary lock |

Missing indexes:

- Added payment intent and wallet indexes above.

N+1 risk:

- Ledger entry insertion remains per entry. Transfer usually writes two rows, so not the dominant p95 source.

Transaction duration risk:

- Wallet mutations hold row locks across validation, transaction insert, ledger entry inserts, and balance updates. This is required for correctness but should remain free of external provider calls.

Unnecessary SELECTs:

- `AuthorizeRideFunds` re-locks authorization after insert to return the row. This is a minor extra read but preserves return shape.

Unnecessary FOR UPDATE locks:

- Account and authorization locks are necessary for balance and settlement correctness.

Slow joins/scans:

- Payment intent lookup by provider reference/idempotency was at risk; fixed.

### WebSocket Room Authorization

Execution path:

- WebSocket room join authorization
- `backend/internal/websocket/authorizer.go`
- `PostgresRoomAuthorizer.CanJoinRideRoom`

Query:

| Query | Frequency | Indexes Used / Needed | Risk |
|---|---:|---|---|
| `SELECT EXISTS (SELECT 1 FROM public.rides WHERE id=$1 AND (rider_id=$2 OR driver_id=$2))` | Every room join | Primary key on `rides.id`; `idx_rides_driver_ride_status` helps driver-side broader lookups | Low by ride ID |

Missing indexes:

- No critical missing index for this exact query because it starts from `id`.

N+1 risk:

- One query per join. Under high websocket reconnect storms this becomes high QPS; cache ride-room auth in Redis later if needed.

FOR UPDATE locks:

- None.

Slow scans:

- Not expected because `id=$1` should use primary key.

### Risk Engine Writes

Execution path:

- `POST /api/risk/events`
- `backend/internal/risk/repository.go`
- `CreateEvent`
- `UpsertScore`
- `UpsertDeviceFingerprint`

Queries:

| Query | Frequency | Indexes Used / Needed | Risk |
|---|---:|---|---|
| `INSERT INTO public.risk_events (...) RETURNING id, created_at` | Once per risk event | Insert; follow-up reads use `idx_risk_events_user_created` and `idx_risk_events_area_created` | Low |
| `SELECT ... FROM public.risk_scores WHERE user_id=$1` | Per score read | Primary/unique user score index from table constraint | Low |
| `INSERT INTO public.risk_scores ... ON CONFLICT(user_id) DO UPDATE` | Per recalculation | Primary/unique user score index | Low |
| `INSERT INTO public.risk_device_fingerprints ... ON CONFLICT(device_fingerprint, user_id)` | Per fingerprint event | Conflict constraint plus `idx_risk_device_fingerprint`, `idx_risk_device_phone` | Low |
| Admin stats `GROUP BY area` | Admin only | `idx_risk_events_area_only` | Medium before index; improved |
| Admin list `ORDER BY risk_score DESC, updated_at DESC` | Admin only | `idx_risk_scores_score_updated` | Medium before index; improved |

N+1 risk:

- None in write path.

Transaction duration risk:

- Admin action uses a short transaction for action insert plus score upsert. Acceptable.

FOR UPDATE locks:

- None.

Slow scans:

- Admin stats/grouping can scan large history. Indexes help, but rollups may be needed later if volume grows.

### Notification Writes

Execution path:

- `POST /api/notifications/device`
- `POST /api/notifications/preferences`
- Asynq notification delivery jobs
- `backend/internal/notification/repository.go`

Queries:

| Query | Frequency | Indexes Used / Needed | Risk |
|---|---:|---|---|
| `INSERT INTO public.notification_devices ... ON CONFLICT(device_token)` | Device registration | Unique device token index from table constraint | Low |
| `INSERT INTO public.notification_preferences ... ON CONFLICT(user_id)` | Preference save | Unique user preference index from table constraint | Low |
| `SELECT ... FROM public.notification_preferences WHERE user_id=$1` | Every notification send | Unique user preference index | Low |
| `SELECT ... FROM public.notification_devices WHERE user_id=$1 AND revoked_at IS NULL ORDER BY last_seen DESC` | Push delivery | `idx_notification_devices_active_user_seen` | Low after partial index |
| `INSERT INTO public.notification_history (...) RETURNING id` | Per channel enqueue | Insert | Low |
| `UPDATE public.notification_history SET status=... WHERE id=$1` | Per delivery result | Primary key | Low |
| Admin failures `WHERE status='failed' ORDER BY created_at DESC LIMIT 20` | Admin stats | `idx_notification_history_failed_created` | Improved |

N+1 risk:

- Bulk notifications call `Notify` per user; that is intentionally outside this request's hot smoke path and is queued by Asynq.

Transaction duration risk:

- No explicit long transaction.

FOR UPDATE locks:

- None.

Slow scans:

- Admin aggregate stats still count history; acceptable for admin but should not be polled at high frequency.

## Remaining Risks

- Live `EXPLAIN (ANALYZE, BUFFERS)` was not run in this local pass, so index usage is code-path estimated.
- Existing uncommitted observability changes affect some diffs; this report only claims the Postgres-specific changes listed above.
- `PGX_QUERY_EXEC_MODE=cache_statement` may not work behind Supabase PgBouncer transaction pooling. Use `describe_exec` or `simple_protocol` for transaction pooler deployments.
- Wallet ledger inserts are still individual inserts. That keeps ledger behavior conservative, but a future batch helper could remove two to five round trips per settlement.
- Admin stats queries still use full counts/groupings. They should not run in the load-test hot path.

## Verification

Backend:

```text
cd backend
$env:GOCACHE=(Resolve-Path .).Path + '\.gocache'
go test ./...
PASS
```

First attempt note:

```text
go test ./...
FAIL due Windows Go build cache access denied under AppData\Local\go-build
```

Rerun with workspace `GOCACHE` passed.
