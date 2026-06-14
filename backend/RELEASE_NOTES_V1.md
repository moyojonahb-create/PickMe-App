# Release Notes V1

## Release

```text
PickMe Go Core V1 / Frontend F1 Integration
Recommended tag: v1.0.0-go-core-f1
Status: PRODUCTION READY
```

## Highlights

- Modularized backend from the deleted root `main.go` into `cmd/server` and `internal/...` packages.
- Added Supabase JWT authentication for ride, driver, and websocket mutation paths.
- Added Frontend F1 `/api/...` compatibility routes.
- Added driver-targeted `ride_offer` delivery through the driver websocket registry.
- Removed duplicate `ride_offer` global broadcast behavior.
- Added canonical offer flow backed by `public.ride_offers`.
- Added offer expiration, duplicate acceptance protection, and transaction-based race protection.
- Added ride lifecycle websocket delivery for `ride_accepted`, `ride_started`, and `ride_completed`.
- Added room-authorized `driver_location` fanout for active ride rooms.
- Added stale websocket cleanup in registries and websocket manager send paths.

## Canonical Events

```text
ride_offer
ride_accepted
driver_location
ride_started
ride_completed
```

## Frontend F1 Compatibility

The release supports:

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

## Production Validation

Final signoff evidence is recorded in:

```text
GO_CORE_V1_FINAL_SIGNOFF.md
```

The final staging validation verified:

```text
rider and driver authenticated accounts
ride creation
driver ride_offer registry delivery
driver offer submission
rider offer list retrieval
rider offer acceptance
ride_accepted delivery
ride_started registry and room delivery
driver_location room delivery
ride_completed registry and room delivery
final database state
duplicate protection
offer expiration
concurrent accept race protection
```

## Verification

Release verification commands:

```text
go test ./...
go build ./cmd/server
```

Both passed during release preparation.

## Known V1 Limits

- Websocket registries are process-local.
- Multi-instance deployments require sticky sessions or a shared fanout layer.
- Wallet settlement is not active in V1.
- Matching engine is not active in V1.
- Redis/Kafka/NATS are not part of V1.
- Driver location without `ride_id` still uses legacy global websocket broadcast behavior for compatibility.
