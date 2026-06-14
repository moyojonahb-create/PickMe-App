# Architecture Baseline V1

## Release Scope

PickMe Go Core V1 is a Fiber-based ride-hailing backend with Supabase JWT authentication, PostgreSQL persistence, and websocket delivery for the rider-driver lifecycle.

This baseline covers:

```text
rider ride request
driver online/presence
driver ride_offer delivery
driver offer submission
rider offer listing and acceptance
ride_started lifecycle
driver_location room fanout
ride_completed lifecycle
duplicate/race/expiration protection
Frontend F1 compatibility routes
```

Out of scope for V1:

```text
Redis
Kafka/NATS
wallet settlement
matching engine
multi-instance websocket fanout
Phase B2 scaling work
```

## Runtime Entry Point

Production entry point:

```text
cmd/server/main.go
```

The old root `main.go` monolith is removed from the release shape. The active server wires:

```text
config.Load
database.NewPool
websocket.Manager
rider ConnectionRegistry
driver ConnectionRegistry
Supabase JWT middleware
rides.RegisterRoutes
rides.RegisterCompatibilityRoutes
drivers.RegisterRoutes
drivers.RegisterCompatibilityRoutes
```

## Core Packages

```text
internal/auth        Supabase HS256 JWT validation
internal/config      environment-backed runtime config
internal/database    PostgreSQL pool and health/test handlers
internal/drivers     driver presence, location, nearby drivers
internal/middleware  auth and CORS middleware
internal/rides       ride request, offers, acceptance, lifecycle transitions
internal/websocket   websocket auth, room authorization, registries, fanout
internal/wallet      placeholder service, not active in V1 ride flow
```

## Canonical Database Tables

Active Go ride flow uses:

```text
public.rides
public.ride_offers
public.driver_sessions
public.driver_locations
```

The active offer flow uses `public.ride_offers` only. Legacy marketplace tables are not part of active Go offer SQL:

```text
app.ride_requests
app.ride_offers
app.rides
app.offers
app.driver_offers
public.active_driver_offers
public.driver_offers
```

This is enforced by `TestOfferSQLDoesNotUseLegacyMarketplaceTables` in `internal/rides/handler_test.go`.

## Canonical HTTP Surface

Legacy-compatible core routes:

```text
POST /rides/request
POST /rides/:id/accept
POST /rides/:id/start
POST /rides/:id/complete
POST /drivers/online
POST /drivers/heartbeat
POST /drivers/offline
POST /drivers/location
GET  /drivers/nearby
GET  /ws
```

Frontend F1 compatibility routes:

```text
POST /api/rides
POST /api/rides/:rideId/offers
GET  /api/rides/:rideId/offers
POST /api/rides/:rideId/offers/:offerId/accept
POST /api/rides/:rideId/offers/:offerId/reject
POST /api/rides/:rideId/status
POST /api/rides/:rideId/complete
POST /api/rides/:rideId/settle
POST /api/drivers/me/presence
POST /api/drivers/me/location
```

## Authentication Boundary

Authenticated mutations derive user identity from the Supabase JWT `sub` claim. Request-body `rider_id` and `driver_id` are accepted only when they match the authenticated subject.

Websocket authentication supports:

```text
Authorization: Bearer {token}
/ws?access_token={token}
/ws?token={token}
```

Websocket role registration:

```text
role=rider   registers rider registry connection
role=driver  registers driver registry connection
room=ride_{ride_id} joins an authorized ride room
```

Room membership is database-authorized before upgrade.

## Canonical Websocket Events

V1 emits exactly these canonical structured events:

```text
ride_offer
ride_accepted
driver_location
ride_started
ride_completed
```

Delivery semantics:

```text
ride_offer       driver registry only, exactly once per registered driver connection
ride_accepted    rider registry for the ride's rider_id
driver_location  ride room when ride_id is present; otherwise global legacy broadcast
ride_started     ride room plus rider/driver registry fallback without room duplication
ride_completed   ride room plus rider/driver registry fallback without room duplication
```

## Offer Lifecycle

Driver offers are stored in `public.ride_offers` with a default 30-second TTL.

Acceptance protection:

```text
SELECT offer FOR UPDATE
SELECT ride FOR UPDATE
offer must be pending
offer must not be expired
ride must still be requested
accepted offer becomes accepted
other pending offers for same ride become expired
duplicate accepts return 409
```

## V1 Scaling Boundary

Websocket registries and room membership are process-local. National launch on a single instance or sticky-session deployment is supported by this baseline. Horizontal multi-instance fanout requires V2 infrastructure such as a shared realtime bus or dedicated websocket gateway.
