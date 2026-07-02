# Dispatch V3 Architecture

Date: 2026-06-14

Scope: Backend-only conversion from broadcast dispatch toward authoritative dispatch. Frontend contracts were not changed.

## Summary

Dispatch now supports an opt-in authoritative mode:

```text
DISPATCH_MODE=authoritative
```

When authoritative mode is enabled, new ride requests are no longer broadcast to every connected driver. Instead, the Go backend:

1. Enqueues the ride into a Redis dispatch stream.
2. Acquires a ride dispatch lock.
3. Queries nearby available drivers through Redis-backed geo/presence.
4. Ranks candidates.
5. Acquires driver allocation locks.
6. Creates a targeted offer wave in `public.ride_offers`.
7. Marks selected drivers as `offered`.
8. Emits the existing `ride_offer` websocket event only to selected drivers.
9. Expires stale pending offers before creating a new wave.

Shadow and off modes remain compatible:

- `DISPATCH_MODE=off`: legacy behavior remains.
- `DISPATCH_MODE=shadow`: legacy broadcast remains, plus shadow ranking/reporting.
- `DISPATCH_MODE=authoritative`: targeted Redis-coordinated offer waves.

## Files Changed

| File | Purpose |
|---|---|
| `backend/internal/dispatch/types.go` | Added authoritative mode, queue/lock config, dispatch jobs, offer waves, driver offers |
| `backend/internal/dispatch/service.go` | Added authoritative dispatch orchestration, Redis queue enqueue, ride locks, driver locks, offer waves, offer expiry hook, driver availability hook |
| `backend/internal/dispatch/repository.go` | Added Postgres writes for offer waves, offer expiry, and driver availability state |
| `backend/internal/redis/client.go` | Added Redis Stream enqueue, lock acquire, and compare-release lock operations |
| `backend/internal/rides/handler.go` | Disabled global ride broadcast when authoritative dispatch is enabled; connected ride creation/accept/reject/complete to availability state |
| `backend/internal/config/config.go` | Added dispatch V3 environment settings |
| `backend/cmd/server/main.go` | Wired Redis queue/locks and targeted websocket offer notifier |
| `backend/.env.example` | Documented new dispatch V3 env vars |

## Runtime Flow

### Ride Creation

Endpoint remains unchanged:

```text
POST /api/rides
```

The frontend contract is unchanged. In authoritative mode, `rides.Handler.Request` still creates the ride row and returns the same response shape, but it does not call the old all-driver broadcast path.

Instead, it calls:

```go
dispatch.Service.ObserveRide(ctx, ride)
```

### Redis Queue

The dispatch service writes a job to:

```text
dispatch:rides:<city>:<vehicle_type>
```

Default base queue:

```text
DISPATCH_QUEUE_NAME=dispatch:rides
```

Each job contains:

- ride id
- rider id
- pickup/dropoff
- pickup coordinates
- city
- vehicle type
- estimated fare minor units
- queued timestamp
- attempt number

Current implementation enqueues the job and processes the first wave immediately in-process. This gives the backend an authoritative queue boundary now while leaving room for dedicated worker processes later.

### Ride Lock

Before generating an offer wave, dispatch acquires:

```text
dispatch:lock:ride:<ride_id>
```

Default TTL:

```text
DISPATCH_RIDE_LOCK_TTL_SECONDS=45
```

This prevents multiple backend instances from creating competing offer waves for the same ride.

### Candidate Selection

Candidates come from the existing geo provider:

```text
backend/internal/dispatch/geo_provider.go
```

The provider uses Redis geo and driver presence:

- location freshness
- online state
- `availability=available`
- city
- vehicle type
- distance

Ranking still uses:

- proximity
- freshness
- availability
- fairness placeholder

### Driver Locks

For each selected driver, dispatch acquires:

```text
dispatch:lock:driver:<driver_id>
```

Default TTL:

```text
DISPATCH_DRIVER_LOCK_TTL_SECONDS=45
```

Only locked drivers receive offers. This prevents the same driver from being allocated to multiple offer waves at once.

### Offer Waves

Offer waves are written to:

```text
public.ride_offers
```

Each wave:

- creates pending offers for locked drivers
- sets `expires_at`
- uses the ride estimated fare as the offered fare
- estimates ETA from distance
- reuses the existing frontend-compatible `ride_offer` websocket event

Default offer TTL:

```text
DISPATCH_OFFER_TTL_SECONDS=30
```

### Offer Expiry

Before a new wave is created, stale pending offers for the ride are expired:

```sql
UPDATE public.ride_offers
SET status = 'expired', expired_at = now()
WHERE ride_id = $1
  AND status = 'pending'
  AND expires_at <= now()
```

### Driver Availability

The backend now updates availability across the ride flow:

| Event | Availability |
|---|---|
| Offer wave created | `offered` |
| Driver rejects offer | `available` |
| Rider accepts offer | `busy` |
| Legacy direct ride accept | `busy` |
| Ride completed | `available` |

The persistence target is:

```text
public.driver_sessions
```

## Environment Variables

```text
DISPATCH_MODE=authoritative
DISPATCH_SHADOW_RADIUS_KM=5
DISPATCH_SHADOW_CANDIDATE_LIMIT=20
DISPATCH_SHADOW_SELECTED_LIMIT=3
DISPATCH_SHADOW_RANKING_VERSION=v2.0-b-simple
DISPATCH_OFFER_TTL_SECONDS=30
DISPATCH_RIDE_LOCK_TTL_SECONDS=45
DISPATCH_DRIVER_LOCK_TTL_SECONDS=45
DISPATCH_QUEUE_NAME=dispatch:rides
REDIS_ENABLED=true
REDIS_URL=<redis-url>
```

## Frontend Contract

No frontend API contract was changed.

Existing endpoints remain:

- `POST /api/rides`
- `POST /api/rides/:rideId/offers`
- `GET /api/rides/:rideId/offers`
- `POST /api/rides/:rideId/offers/:offerId/accept`
- `POST /api/rides/:rideId/offers/:offerId/reject`
- `POST /api/rides/:rideId/status`
- `POST /api/rides/:rideId/complete`
- `POST /api/rides/:rideId/settle`

Existing websocket event preserved:

- `ride_offer`

## Required Database Verification

The current code assumes `public.driver_sessions` includes the fields already used by the backend driver service:

- `driver_id`
- `is_online`
- `availability`
- `current_ride_id`
- `last_seen`
- `updated_at`

Before enabling authoritative dispatch in production, verify the live database has these columns and constraints:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_driver_sessions_driver_id_unique
ON public.driver_sessions(driver_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ride_offers_driver_ride_unique
ON public.ride_offers(driver_id, ride_id);

CREATE INDEX IF NOT EXISTS idx_ride_offers_ride_status_expires
ON public.ride_offers(ride_id, status, expires_at);

CREATE INDEX IF NOT EXISTS idx_driver_sessions_availability_last_seen
ON public.driver_sessions(availability, last_seen DESC)
WHERE is_online = true;
```

## Remaining Production Work

This implementation establishes the authoritative dispatch boundary, but these items remain before high-scale launch:

1. Move offer-wave processing from immediate in-process execution to dedicated Redis Stream consumer groups.
2. Add delayed retry waves after offer expiry.
3. Release driver Redis locks immediately on reject/expiry instead of waiting for TTL.
4. Add cross-node websocket fanout through Redis pub/sub.
5. Add dispatch metrics for queue depth, lock contention, offer acceptance rate, and time-to-first-offer.
6. Add fairness scoring beyond the current placeholder.
7. Add city/vehicle partition tuning for large markets.
8. Add migration-backed schema guarantees for driver availability and offer uniqueness.

## Verification

Backend tests:

```text
go test ./...
PASS
```
