# Deployment Checklist V1

## Pre-Deploy

```text
[ ] Confirm release branch is clean except intended V1 source/docs changes.
[ ] Confirm generated binaries and logs are not staged.
[ ] Confirm .env is not staged.
[ ] Confirm Supabase production DATABASE_URL is configured in the deployment environment.
[ ] Confirm SUPABASE_URL is configured.
[ ] Confirm SUPABASE_JWT_SECRET is configured.
[ ] Confirm SUPABASE_JWT_AUDIENCE is authenticated or intentionally overridden.
[ ] Confirm SUPABASE_JWT_ISSUER matches {SUPABASE_URL}/auth/v1 or is intentionally overridden.
[ ] Confirm PORT is configured by the hosting platform or defaults to 3000.
[ ] Confirm CORS origins include production frontend origins.
```

## Database

```text
[ ] public.rides exists and supports V1 ride lifecycle columns.
[ ] public.ride_offers exists and supports offer_price/offered_fare/eta/status/expires_at timestamps.
[ ] public.driver_sessions exists with driver_id conflict target.
[ ] public.driver_locations exists with driver_id conflict target.
[ ] Legacy marketplace tables are not required by active Go ride flow.
[ ] Production indexes support ride_id/status/expires_at offer lookups.
```

## Build

```text
[ ] go test ./...
[ ] go build ./cmd/server
```

## Runtime Smoke

```text
[ ] GET /health returns 200.
[ ] GET /test-db returns database success.
[ ] Unauthenticated POST /api/rides returns 401.
[ ] Authenticated malformed POST /api/rides reaches handler and returns 400.
[ ] Driver websocket connects with /ws?access_token={token}&role=driver.
[ ] Rider websocket connects with /ws?access_token={token}&role=rider.
```

## End-to-End Ride Smoke

```text
[ ] Driver goes online through POST /api/drivers/me/presence.
[ ] Rider creates ride through POST /api/rides.
[ ] Driver receives exactly one ride_offer.
[ ] Rider receives zero ride_offer events.
[ ] Driver submits offer through POST /api/rides/{rideId}/offers.
[ ] Rider lists offers through GET /api/rides/{rideId}/offers.
[ ] Rider accepts offer through POST /api/rides/{rideId}/offers/{offerId}/accept.
[ ] Rider receives ride_accepted.
[ ] Rider and driver can join ride_{rideId}.
[ ] Driver starts ride through POST /api/rides/{rideId}/status.
[ ] Rider and driver receive ride_started through room and/or registry.
[ ] Driver sends location through POST /api/drivers/me/location with ride_id.
[ ] Rider room receives driver_location.
[ ] Driver completes ride through POST /api/rides/{rideId}/complete.
[ ] Rider and driver receive ride_completed.
[ ] Final DB ride status is completed.
[ ] Accepted offer status is accepted.
```

## Protection Checks

```text
[ ] Duplicate offer accept returns 409.
[ ] Duplicate ride start returns 409.
[ ] Duplicate ride complete returns 409.
[ ] Expired offer accept returns 409.
[ ] Expired offer is omitted from active offer list.
[ ] Concurrent accepts produce exactly one success and one conflict.
```

## Post-Deploy Monitoring

```text
[ ] Watch backend startup logs for database connection errors.
[ ] Watch websocket auth failures and room authorization failures.
[ ] Watch 500 rates on /api/rides and /api/drivers/me/location.
[ ] Watch duplicate ride_offer complaints from drivers.
[ ] Watch missing lifecycle event complaints from riders/drivers.
[ ] Watch Supabase connection pool usage.
```

## Rollback

```text
[ ] Keep previous backend artifact/image available.
[ ] Roll back application artifact first.
[ ] Do not roll back production data without a separate database recovery plan.
[ ] Preserve logs for failed ride IDs and websocket event timestamps.
```
