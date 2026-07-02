# Backend Startup Status

Date: 2026-06-14

Scope: Local scan of `backend/cmd/server/main.go`, backend route registration files, database startup code, payment callback routes, and startup/background worker paths. No code was modified.

## 1. Health Endpoint Path

Primary health endpoint:

| Method | Path | Auth | File | Notes |
|---|---|---|---|---|
| `GET` | `/health` | Public | `backend/cmd/server/main.go`, `backend/internal/database/postgres.go` | Returns JSON `{ "status": "ok", "time": ... }`. It does not check the database. |

Additional health-style endpoint:

| Method | Path | Auth | File | Notes |
|---|---|---|---|---|
| `GET` | `/health/redis` | Public | `backend/cmd/server/main.go`, `backend/internal/redis/health.go` | Reports Redis enabled/connected/latency/error. Calls Redis `PING` only when Redis is enabled. |

## 2. Ping Endpoint Path

No dedicated HTTP `/ping` route is registered.

Ping-like routes:

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/health` | Public | Basic process health; no dependency check. |
| `GET` | `/health/redis` | Public | Redis health; performs Redis `PING` when `REDIS_ENABLED=true`. |
| `GET` | `/test-db` | Public | Database connectivity test using `SELECT NOW()`. |

## 3. Publicly Accessible Routes

These routes are registered without the `requireAuth` middleware. Global middleware still applies: request ID, recover, timeout, rate limit, observability, and CORS.

| Method | Path | File | Public Behavior |
|---|---|---|---|
| `GET` | `/` | `backend/cmd/server/main.go` | Public root status message. |
| `GET` | `/health` | `backend/cmd/server/main.go` | Public process health. |
| `GET` | `/health/redis` | `backend/cmd/server/main.go` | Public Redis health status. |
| `GET` | `/test-db` | `backend/cmd/server/main.go` | Public DB test endpoint. Exposes DB connectivity errors in response body. |
| `USE` | `/ws` | `backend/cmd/server/main.go`, `backend/internal/websocket/handler.go` | Transport route is mounted publicly, but the WebSocket handler validates Supabase JWT tokens from bearer/query params and authorizes rooms. |
| `POST` | `/rides/join-room` | `backend/internal/rides/handler.go` | Registered without `requireAuth`. This appears publicly callable. |
| `POST` | `/api/payments/onemoney/callback` | `backend/internal/payments/http.go` | Public provider callback. Auth depends on callback signature validation in provider handling. |
| `POST` | `/api/payments/ecocash/callback` | `backend/internal/payments/http.go` | Public provider callback. Auth depends on callback signature validation in provider handling. |
| `POST` | `/api/payments/innbucks/callback` | `backend/internal/payments/http.go` | Public provider callback. Auth depends on callback signature validation in provider handling. |
| `POST` | `/api/payments/paypal/callback` | `backend/internal/payments/http.go` | Public provider callback. Auth depends on callback signature validation in provider handling. |

All other route registrations found in the backend are protected by `requireAuth`, and admin/reporting routes additionally use `middleware.AdminOnly()`.

## 4. Is Database Connection Required For Startup?

Yes, partly.

Startup requires:

- `DATABASE_URL` must be present. `config.Load()` returns a fatal error if it is missing.
- `DATABASE_URL` must be parseable by `pgxpool.ParseConfig()`. If parsing fails, `database.NewPool()` returns an error and `main.go` exits with `log.Fatal("Database connection failed:", err)`.

However, the code does not explicitly ping Postgres before starting the Fiber app. `database.NewPool()` builds a `pgxpool.Pool`, but normal route registration happens without a `SELECT 1` or `Ping`.

Practical result:

- Missing or malformed `DATABASE_URL`: fatal before server starts.
- Valid-looking URL with bad credentials: may not be fatal at pool construction time; the error can appear on the first DB query.
- The public `/health` route can still report `ok` even if the database credentials are wrong, because it does not touch Postgres.
- `/test-db` is the explicit DB connectivity check and will fail if Postgres auth fails.

## 5. Is The Current PostgreSQL Authentication Error Fatal?

It depends where the error appears.

Fatal cases:

- If the error is emitted from this startup block:

```go
dbpool, err := database.NewPool(cfg.DatabaseURL)
if err != nil {
    log.Fatal("Database connection failed:", err)
}
```

Then it is fatal and the Fiber server never reaches `app.Listen`.

Non-fatal/background cases:

- `drivers.NewService(dbpool).StartCleanupWorker()` starts a goroutine before the server listens.
- That worker runs an `UPDATE public.driver_sessions ...` every 30 seconds.
- If Postgres authentication fails there, the code logs:

```text
Driver cleanup worker error: ...
```

and continues looping. That error does not stop the process.

Conditionally non-fatal worker case:

- If `WALLET_AUTHORIZATION_EXPIRATION_WORKER_ENABLED=true`, the wallet authorization expiration worker can also hit Postgres after startup.
- Its DB errors are logged as warnings and do not stop the process.

Route/request cases:

- Any authenticated DB-backed route can fail at request time if credentials are wrong.
- `/test-db` will return HTTP 500 with the Postgres error.

Conclusion:

- The current PostgreSQL authentication error is fatal only if it happens during `database.NewPool()` creation.
- If the server starts and then logs Postgres auth errors from the driver cleanup worker or request handlers, the error is not fatal to process startup. It still means DB-backed routes will fail until `DATABASE_URL` credentials are corrected.

## Route Registration Summary

Public startup/status routes:

- `GET /`
- `GET /health`
- `GET /health/redis`
- `GET /test-db`

Public transport/callback routes:

- `USE /ws` with handler-level JWT validation.
- `POST /rides/join-room`
- `POST /api/payments/onemoney/callback`
- `POST /api/payments/ecocash/callback`
- `POST /api/payments/innbucks/callback`
- `POST /api/payments/paypal/callback`

Protected route groups:

- Ride APIs under `/rides` and `/api/rides`.
- Driver APIs under `/drivers` and `/api/drivers`.
- Wallet APIs under `/api/wallets` and `/api/wallet`.
- Dispatch admin APIs under `/admin/dispatch`.
- Reputation admin APIs under `/admin/reputation`.
- Wallet/admin finance APIs under `/admin/wallets`, `/admin/finance`, and `/admin/pilot`.
- Payment deposit APIs under `/api/payments/*/deposits`.
- Payment admin APIs under `/admin/payments`.
