# Database Alignment Report

## Scope

This report audits SQL in the Go backend source against the provided production table reality.

Production tables provided:

```text
rides
driver_sessions
driver_locations
active_driver_offers
wallets
wallet_transactions
```

Known absent tables:

```text
drivers
driver_wallets
```

The repository does not include database migrations or column definitions. Table existence is therefore verified against the list above. Column alignment is classified from the SQL contract in source; columns that cannot be conclusively verified without schema introspection are called out.

## Executive Summary

Overall classification: **PARTIALLY ALIGNED**

The backend does not reference nonexistent tables such as `drivers` or `driver_wallets`. Core ride, driver session, and driver location SQL targets real tables. However:

- `active_driver_offers` exists in production but is not used by ride acceptance.
- `wallets` and `wallet_transactions` exist in production but there is no wallet SQL in the backend.
- Admin topups are not implemented.
- Several flows assume specific columns on `rides`, `driver_sessions`, and `driver_locations`; these must be verified against the actual column definitions.

## SQL Inventory

### Database Health

Location: `internal/database/postgres.go`

```sql
SELECT NOW()
```

Classification: **ALIGNED**

- Tables referenced: none.
- Columns referenced: none.
- Functions referenced: `NOW()` PostgreSQL built-in.
- Nonexistent tables: none.
- Nonexistent functions: none.

## Driver Flows

### Driver Cleanup Worker

Location: `internal/drivers/service.go`

```sql
UPDATE public.driver_sessions
SET is_online = false
WHERE is_online = true
AND last_seen < NOW() - INTERVAL '2 minutes'
```

Classification: **PARTIALLY ALIGNED**

- Table referenced: `driver_sessions` - real table.
- Columns referenced: `is_online`, `last_seen`.
- Duplicate column concern: uses `is_online`, not `status`; no duplicate naming issue in source.
- Functions referenced: `NOW()`, `INTERVAL` - PostgreSQL built-ins.
- Risk: requires `driver_sessions.is_online` and `driver_sessions.last_seen` to exist.

### Driver Location Updates

Location: `internal/drivers/handler.go`

```sql
INSERT INTO public.driver_locations (
	driver_id,
	latitude,
	longitude,
	speed,
	heading,
	updated_at
)
VALUES ($1,$2,$3,$4,$5,NOW())
ON CONFLICT (driver_id)
DO UPDATE SET
	latitude = EXCLUDED.latitude,
	longitude = EXCLUDED.longitude,
	speed = EXCLUDED.speed,
	heading = EXCLUDED.heading,
	updated_at = NOW()
```

```sql
UPDATE public.driver_sessions
SET latitude = $1,
    longitude = $2,
    speed = $3,
    heading = $4,
    last_seen = NOW(),
    is_online = true
WHERE driver_id = $5
```

Classification: **PARTIALLY ALIGNED**

- Tables referenced: `driver_locations`, `driver_sessions` - real tables.
- Columns referenced:
  - `driver_locations.driver_id`
  - `driver_locations.latitude`
  - `driver_locations.longitude`
  - `driver_locations.speed`
  - `driver_locations.heading`
  - `driver_locations.updated_at`
  - `driver_sessions.latitude`
  - `driver_sessions.longitude`
  - `driver_sessions.speed`
  - `driver_sessions.heading`
  - `driver_sessions.last_seen`
  - `driver_sessions.is_online`
  - `driver_sessions.driver_id`
- Duplicate column concern: uses `latitude` / `longitude`, not `lat` / `lng`; no duplicate naming issue in source.
- Functions referenced: `NOW()` - PostgreSQL built-in.
- Risk: `ON CONFLICT (driver_id)` requires a unique or primary key constraint on `driver_locations.driver_id`.
- Risk: updating `driver_sessions` after location insert does not create a session if none exists.

### Driver Online

Location: `internal/drivers/handler.go`

```sql
INSERT INTO public.driver_sessions (
	driver_id,
	latitude,
	longitude,
	heading,
	speed,
	vehicle_type,
	is_online,
	last_seen
)
VALUES ($1,$2,$3,$4,$5,$6,true,NOW())
ON CONFLICT (driver_id)
DO UPDATE SET
	latitude = EXCLUDED.latitude,
	longitude = EXCLUDED.longitude,
	heading = EXCLUDED.heading,
	speed = EXCLUDED.speed,
	vehicle_type = EXCLUDED.vehicle_type,
	is_online = true,
	last_seen = NOW()
```

Classification: **PARTIALLY ALIGNED**

- Table referenced: `driver_sessions` - real table.
- Columns referenced: `driver_id`, `latitude`, `longitude`, `heading`, `speed`, `vehicle_type`, `is_online`, `last_seen`.
- Duplicate column concern: uses `is_online`, not `status`; uses `latitude` / `longitude`, not `lat` / `lng`.
- Functions referenced: `NOW()` - PostgreSQL built-in.
- Risk: `ON CONFLICT (driver_id)` requires a unique or primary key constraint on `driver_sessions.driver_id`.
- Important: no `drivers` table is referenced, which matches production reality.

### Driver Heartbeat

Location: `internal/drivers/handler.go`

```sql
UPDATE public.driver_sessions
SET last_seen = NOW(),
    is_online = true
WHERE driver_id = $1
```

Classification: **PARTIALLY ALIGNED**

- Table referenced: `driver_sessions` - real table.
- Columns referenced: `last_seen`, `is_online`, `driver_id`.
- Duplicate column concern: uses `is_online`, not `status`.
- Functions referenced: `NOW()` - PostgreSQL built-in.
- Risk: assumes heartbeat should fail if no existing `driver_sessions` row exists.

### Driver Offline

Location: `internal/drivers/handler.go`

```sql
UPDATE public.driver_sessions
SET is_online = false,
    last_seen = NOW()
WHERE driver_id = $1
```

Classification: **PARTIALLY ALIGNED**

- Table referenced: `driver_sessions` - real table.
- Columns referenced: `is_online`, `last_seen`, `driver_id`.
- Duplicate column concern: uses `is_online`, not `status`.
- Functions referenced: `NOW()` - PostgreSQL built-in.

### Nearby Drivers Query

Location: `internal/drivers/handler.go`

```sql
SELECT
	driver_id,
	latitude,
	longitude,
	vehicle_type,
	speed,
	heading,
	last_seen,
	(
		6371 * acos(
			LEAST(
				1,
				GREATEST(
					-1,
					cos(radians($1)) *
					cos(radians(latitude)) *
					cos(radians(longitude) - radians($2)) +
					sin(radians($1)) *
					sin(radians(latitude))
				)
			)
		)
	) AS distance_km
FROM public.driver_sessions
WHERE is_online = true
  AND latitude IS NOT NULL
  AND longitude IS NOT NULL
  AND last_seen >= NOW() - INTERVAL '5 minutes'
  AND (...) <= $3
ORDER BY distance_km ASC
LIMIT 50
```

Classification: **PARTIALLY ALIGNED**

- Table referenced: `driver_sessions` - real table.
- Columns referenced: `driver_id`, `latitude`, `longitude`, `vehicle_type`, `speed`, `heading`, `last_seen`, `is_online`.
- Duplicate column concern: uses `latitude` / `longitude`, not `lat` / `lng`; no duplicate naming issue in source.
- Functions referenced: `acos`, `LEAST`, `GREATEST`, `cos`, `radians`, `sin`, `NOW`, `INTERVAL` - PostgreSQL built-ins.
- Nonexistent functions: none.
- Risk: no PostGIS dependency; formula uses built-in math only.
- Risk: table scan risk unless indexes exist on `is_online`, `last_seen`, and possibly location columns.

## Ride Flows

### Ride List

Location: `internal/rides/handler.go`

```sql
SELECT id, rider_id, pickup_location, dropoff_location,
       estimated_fare, ride_status, created_at
FROM public.rides
ORDER BY created_at DESC
LIMIT 20
```

Classification: **PARTIALLY ALIGNED**

- Table referenced: `rides` - real table.
- Columns referenced: `id`, `rider_id`, `pickup_location`, `dropoff_location`, `estimated_fare`, `ride_status`, `created_at`.
- Duplicate column concern: uses `ride_status`, not `status`.
- Risk: requires production `rides` table to use `ride_status` column name.

### Ride Creation

Location: `internal/rides/handler.go`

```sql
INSERT INTO public.rides (
	rider_id,
	pickup_location,
	dropoff_location,
	estimated_fare,
	payment_method,
	payment_status,
	ride_status,
	created_at
)
VALUES ($1,$2,$3,$4,$5,'pending','requested',NOW())
RETURNING id, created_at
```

Classification: **PARTIALLY ALIGNED**

- Table referenced: `rides` - real table.
- Columns referenced: `rider_id`, `pickup_location`, `dropoff_location`, `estimated_fare`, `payment_method`, `payment_status`, `ride_status`, `created_at`, `id`.
- Duplicate column concern: uses `ride_status`, not `status`.
- Functions referenced: `NOW()` - PostgreSQL built-in.
- Risk: requires `payment_status` and `payment_method` columns to be on `rides`. If production payment state moved into `wallet_transactions`, this insert will break.
- Risk: `active_driver_offers` table exists but ride creation does not write offers there.

### Ride Acceptance

Location: `internal/rides/handler.go`

```sql
UPDATE public.rides
SET driver_id = $1,
    ride_status = 'accepted'
WHERE id = $2
  AND ride_status = 'requested'
```

```sql
SELECT rider_id FROM public.rides WHERE id = $1
```

Classification: **PARTIALLY ALIGNED**

- Table referenced: `rides` - real table.
- Columns referenced: `driver_id`, `ride_status`, `id`, `rider_id`.
- Duplicate column concern: uses `ride_status`, not `status`.
- Nonexistent tables: none.
- Major schema alignment issue: production has `active_driver_offers`, but this flow ignores `active_driver_offers` and ignores the `/offers/:offerId` route parameter.
- Risk: if production requires offer validation via `active_driver_offers`, this flow is functionally incomplete even though the SQL references real tables.

### Ride Start / Status Update

Location: `internal/rides/handler.go`

```sql
SELECT COALESCE(driver_id::text, '') FROM public.rides WHERE id = $1
```

```sql
UPDATE public.rides
SET ride_status = 'ongoing',
    started_at = NOW()
WHERE id = $1
  AND ride_status = 'accepted'
  AND driver_id = $2
```

Classification: **PARTIALLY ALIGNED**

- Table referenced: `rides` - real table.
- Columns referenced: `driver_id`, `id`, `ride_status`, `started_at`.
- Duplicate column concern: uses `ride_status`, not `status`.
- Functions referenced: `COALESCE`, `NOW()` - PostgreSQL built-ins.
- Risk: requires `started_at` column on `rides`.

### Ride Completion

Location: `internal/rides/handler.go`

```sql
SELECT COALESCE(driver_id::text, '') FROM public.rides WHERE id = $1
```

```sql
UPDATE public.rides
SET ride_status = 'completed',
    completed_at = NOW()
WHERE id = $1
  AND ride_status = 'ongoing'
  AND driver_id = $2
```

Classification: **PARTIALLY ALIGNED**

- Table referenced: `rides` - real table.
- Columns referenced: `driver_id`, `id`, `ride_status`, `completed_at`.
- Duplicate column concern: uses `ride_status`, not `status`.
- Functions referenced: `COALESCE`, `NOW()` - PostgreSQL built-ins.
- Risk: requires `completed_at` column on `rides`.
- Risk: no wallet or wallet transaction write occurs on completion.

### Ride Room Authorization

Location: `internal/websocket/authorizer.go`

```sql
SELECT EXISTS (
	SELECT 1
	FROM public.rides
	WHERE id = $1
	  AND (
		rider_id = $2
		OR driver_id = $2
	  )
)
```

Classification: **PARTIALLY ALIGNED**

- Table referenced: `rides` - real table.
- Columns referenced: `id`, `rider_id`, `driver_id`.
- Duplicate column concern: none.
- Functions referenced: `EXISTS` - SQL standard/PostgreSQL supported.

### Driver Location Ride Ownership Check

Location: `internal/drivers/handler.go`

```sql
SELECT EXISTS (
	SELECT 1
	FROM public.rides
	WHERE id = $1
	  AND driver_id = $2
	  AND ride_status IN ('accepted', 'ongoing')
)
```

Classification: **PARTIALLY ALIGNED**

- Table referenced: `rides` - real table.
- Columns referenced: `id`, `driver_id`, `ride_status`.
- Duplicate column concern: uses `ride_status`, not `status`.
- Functions referenced: `EXISTS` - SQL standard/PostgreSQL supported.

## Wallet Operations

Location: `internal/wallet/service.go`

Current state:

```go
// Package wallet is reserved for payment and wallet-specific domain logic.
// It is intentionally empty today because the current backend only persists
// ride payment metadata and has no wallet workflows to move.
```

Classification: **BROKEN**

- Production tables exist: `wallets`, `wallet_transactions`.
- Backend references: none.
- Nonexistent tables referenced: none.
- Problem: no wallet reads, no wallet writes, no transaction ledger, no idempotency, no balance mutation path.
- If frontend or admin tooling expects wallet behavior through Go backend, it is not implemented.

## Admin Topups

Location: no implementation found.

Classification: **BROKEN**

- Production tables likely relevant: `wallets`, `wallet_transactions`.
- Backend references: none.
- Nonexistent tables referenced: none.
- Problem: no admin topup SQL, no wallet transaction insert, no audit path.

## Nonexistent Table Audit

Search result:

```text
public.drivers            not referenced
public.driver_wallets     not referenced
drivers table             not referenced as SQL table
driver_wallets table      not referenced
```

Classification: **ALIGNED**

The backend does not reference the absent `drivers` or `driver_wallets` tables.

## Existing Production Tables Not Used

### `active_driver_offers`

Classification: **PARTIALLY ALIGNED**

- Exists in production.
- Not referenced by backend SQL.
- Impact: `/api/rides/:rideId/offers/:offerId/accept` accepts a route `offerId`, but the handler ignores it and updates `rides` directly.
- If production offer assignment is supposed to be validated through `active_driver_offers`, this is a backend/schema mismatch.

### `wallets`

Classification: **BROKEN**

- Exists in production.
- Not referenced by backend SQL.
- Impact: no wallet balance or account state is managed by the Go backend.

### `wallet_transactions`

Classification: **BROKEN**

- Exists in production.
- Not referenced by backend SQL.
- Impact: no ledger write on ride completion, settlement, or topup.

## Duplicate Column Naming Audit

Potential duplicate naming areas:

```text
status vs ride_status
lat/lng vs latitude/longitude
online/status vs is_online
```

Observed source usage:

- Ride state uses `ride_status` only.
- Driver coordinates use `latitude` and `longitude` only.
- Driver online state uses `is_online` only.
- Request query params use `lat` and `lng`, but SQL uses `latitude` and `longitude`.
- Compatibility presence request accepts `status`, `state`, `action`, `is_online`, and `online`, but SQL writes only `is_online`.

Classification: **PARTIALLY ALIGNED**

No duplicate database column references were found in SQL, but production must confirm the real column names are `ride_status`, `latitude`, `longitude`, and `is_online`.

## Nonexistent Function Audit

Functions/operators referenced:

```text
NOW()
INTERVAL
COALESCE()
EXISTS
LEAST()
GREATEST()
acos()
cos()
radians()
sin()
```

Classification: **ALIGNED**

These are PostgreSQL built-ins or standard SQL constructs supported by PostgreSQL. No custom or nonexistent database functions are referenced in source.

## Flow Classification Summary

| Flow | Classification | Reason |
|---|---|---|
| Driver online/offline flow | **PARTIALLY ALIGNED** | Uses real `driver_sessions` table; assumes specific session columns and conflict key. |
| Driver location updates | **PARTIALLY ALIGNED** | Uses real `driver_locations` and `driver_sessions`; assumes columns and unique `driver_id` on `driver_locations`. |
| Nearby drivers query | **PARTIALLY ALIGNED** | Uses real `driver_sessions`; no nonexistent functions; assumes latitude/longitude/session columns. |
| Ride creation | **PARTIALLY ALIGNED** | Uses real `rides`; assumes payment columns live on `rides`; does not create `active_driver_offers`. |
| Ride acceptance | **PARTIALLY ALIGNED** | Uses real `rides`; ignores production `active_driver_offers` and `offerId`. |
| Ride completion | **PARTIALLY ALIGNED** | Uses real `rides`; no wallet transaction settlement. |
| Wallet operations | **BROKEN** | `wallets` and `wallet_transactions` exist but backend has no wallet SQL. |
| Admin topups | **BROKEN** | No admin topup implementation or wallet transaction insert exists. |

## Final Classification

```text
PARTIALLY ALIGNED
```

The backend is table-aligned for the currently implemented ride and driver flows, but not fully schema-aligned for the production model because `active_driver_offers`, `wallets`, and `wallet_transactions` are not integrated. No SQL references nonexistent `drivers` or `driver_wallets` tables.
