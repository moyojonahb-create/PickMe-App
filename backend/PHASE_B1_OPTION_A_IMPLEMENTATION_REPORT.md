# Phase B1 Option A Implementation Report

## Summary

Phase B1 offer management now uses `public.ride_offers`, aligned directly to `public.rides(id)`.

The existing frontend routes were preserved:

```text
POST /api/rides/:rideId/offers
GET  /api/rides/:rideId/offers
POST /api/rides/:rideId/offers/:offerId/accept
POST /api/rides/:rideId/offers/:offerId/reject
```

No wallet work, frontend work, or legacy marketplace integration was added.

## Files Changed

```text
internal/rides/handler.go
internal/rides/handler_test.go
PHASE_B1_OPTION_A_IMPLEMENTATION_REPORT.md
```

Already present and kept:

```text
PUBLIC_RIDE_OFFERS_MIGRATION.sql
```

## SQL Changes

Offer management was moved away from:

```text
app.ride_offers
```

and now uses:

```text
public.ride_offers
```

### Submit Offer

Now inserts:

```sql
INSERT INTO public.ride_offers (
  id,
  ride_id,
  driver_id,
  offered_fare,
  offer_price,
  eta_minutes,
  status,
  expires_at,
  created_at
)
```

`ride_id` is the frontend route `rideId`, and it references `public.rides(id)`.

### List Offers

Now reads:

```sql
FROM public.ride_offers
WHERE ride_id = $1
  AND status = 'pending'
  AND expires_at > NOW()
```

### Reject Offer

Now updates:

```sql
UPDATE public.ride_offers
SET status = 'declined',
    declined_at = NOW()
WHERE id = $1
  AND ride_id = $2
  AND driver_id = $3
  AND status = 'pending'
```

### Accept Offer

Acceptance now:

- locks the offer from `public.ride_offers`
- locks the ride from `public.rides`
- validates rider ownership
- updates `public.rides.driver_id`
- sets `public.rides.ride_status = 'accepted'`
- updates the accepted offer to `status = 'accepted'`
- sets `accepted_at = NOW()`
- expires losing pending offers with `status = 'expired'` and `expired_at = NOW()`
- sends the existing `ride_accepted` websocket event

## Legacy Table Guard

Added a source-level test that fails if `internal/rides/handler.go` references legacy marketplace tables:

```text
app.ride_requests
app.ride_offers
app.rides
app.offers
app.driver_offers
public.active_driver_offers
public.driver_offers
```

## Migration File Status

`PUBLIC_RIDE_OFFERS_MIGRATION.sql` already existed and was left in place.

It creates `public.ride_offers` with:

- `ride_id` FK to `public.rides(id)`
- `driver_id` FK to `auth.users(id)`
- offer amount columns
- lifecycle status/timestamps
- indexes for pending offer lookup and driver history
- update timestamp trigger

The migration was not applied by this implementation pass.

## Tests

Updated/covered:

```text
TestSubmitOfferSuccessful
TestListOffersReturnsPendingNonExpiredOffers
TestAcceptOfferSuccessful
TestAcceptOfferExpiredOfferRejected
TestAcceptOfferDuplicateAcceptanceAttempt
TestAcceptOfferRaceConditionReturnsConflict
TestRejectOfferSuccessful
TestDriverCannotRejectAnotherDriversOffer
TestRiderCannotAcceptOfferForAnotherRidersRide
TestOfferSQLDoesNotUseLegacyMarketplaceTables
```

## Verification

```text
gofmt ./...              FAILED on Windows path expansion: gofmt treats ./... as a filesystem path.
gofmt -w <go files>      PASS
go fmt ./...             PASS
go test ./...            PASS
go build ./cmd/server    PASS
```

The first sandboxed `go test ./...` run hit Windows Go build-cache access denial. It passed after rerunning with normal Go build-cache access.

## Remaining Risks

- `PUBLIC_RIDE_OFFERS_MIGRATION.sql` must be applied to Supabase before runtime offer verification can pass.
- Legacy direct ride acceptance route `POST /rides/:id/accept` still bypasses offer storage for backward compatibility.
- `defaultOfferTTL` remains a code constant at `30 * time.Second`.
- Runtime verification against Supabase should be run after the migration is applied.
