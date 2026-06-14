# V2 Redis Foundation Report

## Summary

GO V2.0-A Redis Foundation was implemented as an additive hot-state layer.

Preserved:

```text
Go Core V1 ride lifecycle
Frontend F1 HTTP contracts
canonical websocket events
public.rides
public.ride_offers
PostgreSQL as durable source of truth
```

Not implemented in this phase:

```text
Smart Dispatch active mode
Driver Ranking
Wallet
Push Notifications
Kafka
NATS
New frontend work
Navigation
Pricing
Fraud system
```

## Files Changed

```text
cmd/server/main.go
internal/config/config.go
internal/drivers/handler.go
internal/drivers/types.go
internal/drivers/handler_test.go
internal/geo/service.go
internal/geo/service_test.go
internal/redis/client.go
internal/redis/health.go
V2_REDIS_FOUNDATION_REPORT.md
```

## Environment Variables

```text
REDIS_URL
REDIS_ENABLED=true/false
REDIS_DRIVER_LOCATION_TTL_SECONDS
REDIS_DRIVER_PRESENCE_TTL_SECONDS
```

Defaults:

```text
REDIS_ENABLED=false
REDIS_DRIVER_LOCATION_TTL_SECONDS=60
REDIS_DRIVER_PRESENCE_TTL_SECONDS=90
```

If `REDIS_ENABLED=false`, Redis code runs in disabled mode and does not affect V1.

If `REDIS_ENABLED=true` but `REDIS_URL` is invalid or missing, startup logs the Redis configuration problem and continues with Redis disabled.

## Redis Package

Added:

```text
internal/redis
```

Responsibilities:

```text
Redis client initialization
safe disabled mode
PING health check
HSET/HGETALL/EXPIRE support
GEOADD/GEOSEARCH support
graceful Close()
```

The implementation avoids making Redis a hard dependency for V1. Redis failures are surfaced to callers as errors, and integration points log warnings without failing successful PostgreSQL-backed operations.

## Geo Package

Added:

```text
internal/geo
```

Responsibilities:

```text
write driver location hot state
write Redis GEO index
write driver presence hot state
query nearby drivers by latitude/longitude/radius
return distance and location metadata
filter stale drivers by updated_at and TTL
return clean unavailable state when Redis is disabled
```

## Redis Key Schema

### Driver GEO

```text
drivers:geo:{city}:{vehicle_type}
```

Member:

```text
driver_id
```

### Driver Location Hash

```text
driver:{driver_id}:location
```

Fields:

```text
latitude
longitude
heading
speed
city
vehicle_type
updated_at
```

TTL:

```text
REDIS_DRIVER_LOCATION_TTL_SECONDS
```

### Driver Presence Hash

```text
driver:{driver_id}:presence
```

Fields:

```text
state
availability
ride_id
last_seen_at
websocket_instance
push_available
```

TTL:

```text
REDIS_DRIVER_PRESENCE_TTL_SECONDS
```

## Driver Location Integration

When driver location update succeeds:

```text
1. public.driver_locations is written exactly as V1
2. public.driver_sessions is updated exactly as V1
3. driver_location websocket behavior is preserved
4. Redis location hash and GEO index are written if Redis is enabled
```

If Redis write fails:

```text
Redis driver location hot-state warning: ...
```

The HTTP response remains successful when PostgreSQL succeeded.

## Driver Presence Integration

When driver goes online, sends heartbeat, or goes offline:

```text
1. public.driver_sessions behavior is preserved
2. Redis presence hash is written if Redis is enabled
3. Redis failure logs a warning but does not break V1
```

Online with coordinates also attempts a Redis driver location/GEO hot-state write.

## Redis Health Endpoint

Added:

```text
GET /health/redis
```

Response shape:

```json
{
  "enabled": true,
  "connected": true,
  "latency_ms": 1.23
}
```

If Redis is disabled:

```json
{
  "enabled": false,
  "connected": false,
  "latency_ms": 0
}
```

If Redis is enabled but unavailable, the endpoint returns `503` with a sanitized error string. No secrets are exposed.

## Fallback Behavior

Redis must never become the source of truth for:

```text
ride state
accepted offers
wallet balances
payment records
audit logs
```

V2.0-A fail-open guarantees:

```text
Redis disabled: V1 behavior continues
Redis unavailable: V1 behavior continues
Redis write error: warning logged, HTTP success preserved after PostgreSQL success
Redis nearby query unavailable: geo service returns unavailable, future dispatch can fall back to V1
```

## Tests Added

```text
internal/drivers/handler_test.go
internal/geo/service_test.go
```

Covered:

```text
Redis disabled mode does not break driver location updates
Redis unavailable mode does not break PostgreSQL-backed V1 behavior
Location write attempts Redis hash, TTL, and GEO add when enabled
Presence write attempts Redis hash and TTL when enabled
Nearby query returns expected candidates with fake Redis store
TTL/freshness filtering excludes stale/missing driver locations
Disabled nearby query returns clean unavailable state
```

## Verification

Executed with normal Windows Go build-cache access:

```text
go test ./...          PASS
go build ./cmd/server PASS
```

## Operational Risks

### Redis stale GEO members

Redis GEO sets do not expire individual members automatically. V2.0-A filters candidates by the TTL-protected `driver:{driver_id}:location` hash and `updated_at` freshness. Future phases should add periodic GEO cleanup for stale members.

### Missing city and vehicle type

Existing V1 location payloads do not require city or vehicle type. V2.0-A accepts optional `city` and `vehicle_type` fields and falls back to:

```text
city=default
vehicle_type=economy
```

Future dispatch should derive city/zone from coordinates and load vehicle type from durable driver/session state.

### Redis outage

Redis outage only affects hot-state freshness and future matching acceleration. It does not block ride creation, offer submission, ride acceptance, driver location persistence, or lifecycle events.

### Health endpoint exposure

`/health/redis` exposes only enabled/connected/latency/error status. It does not expose `REDIS_URL`, credentials, keys, or values.

## Next Recommended Phase

Recommended GO V2.0-B:

```text
Smart Dispatch shadow mode only
```

Scope:

```text
read Redis GEO candidates
record selected candidates for analysis
do not change ride_offer delivery yet
compare Redis candidate quality against V1 outcomes
add dispatch metrics and dashboards
keep V1 fallback as default
```

Do not activate Smart Dispatch until Redis freshness, candidate quality, and operational visibility are proven in production.
