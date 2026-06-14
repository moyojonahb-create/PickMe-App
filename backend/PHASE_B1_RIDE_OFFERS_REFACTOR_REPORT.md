# Phase B1 Ride Offers Refactor Report

## Summary

Phase B1 offer management now uses `app.ride_offers` as the canonical source of truth.

No frontend routes were changed. No Supabase migrations were created. Wallet logic was not touched.

## Files Changed

```text
internal/rides/handler.go
internal/rides/types.go
internal/rides/handler_test.go
PHASE_B1_RIDE_OFFERS_REFACTOR_REPORT.md
```

## Routes Preserved

```text
POST /api/rides/:rideId/offers
GET  /api/rides/:rideId/offers
POST /api/rides/:rideId/offers/:offerId/accept
POST /api/rides/:rideId/offers/:offerId/reject
```

## Exact SQL Table Changes

Removed from offer management:

```text
public.active_driver_offers
```

Added as canonical offer table:

```text
app.ride_offers
```

No writes were added to:

```text
public.active_driver_offers
app.driver_offers
app.offers
public.driver_offers
```

## Column Mappings

| Go semantic field | `app.ride_offers` column | Notes |
|---|---|---|
| `rideId` | `ride_request_id` | Canonical ride reference. |
| `rideId` compatibility | `request_id` | Populated with the same ride ID for NOT NULL compatibility. |
| Authenticated driver ID | `driver_id` | Always derived from JWT subject. |
| Request `amount` | `offered_fare` | Preferred frontend field. |
| Request `price` | `offered_fare` | Compatibility input. |
| Request `offered_fare` | `offered_fare` | Compatibility input. |
| Request `estimated_fare` | `offered_fare` | Legacy compatibility input. |
| Offer price compatibility | `offer_price` | Populated with same amount as `offered_fare`. |
| Request `eta_minutes` / `eta` | `eta_minutes` | `eta_minutes` preferred; `eta` retained for compatibility. |
| Pending offer | `status = 'pending'` | Created by submit offer. |
| Accepted offer | `status = 'accepted'`, `accepted_at = NOW()` | Set inside acceptance transaction. |
| Rejected offer | `status = 'declined'`, `declined_at = NOW()` | Go reject maps to DB declined. |
| Losing offers | `status = 'expired'` | Accepted offer is excluded with `id != acceptedOfferID`. |
| Offer expiry | `expires_at` | Set to `NOW + defaultOfferTTL`. |

## Flow Changes

### Submit Offer

`SubmitOffer` now:

- Authenticates driver via JWT subject.
- Rejects mismatched `driver_id` if supplied.
- Validates ride exists in `public.rides`.
- Validates `ride_status = 'requested'`.
- Inserts into `app.ride_offers`.
- Sets `ride_request_id`, `request_id`, `driver_id`, `offered_fare`, `offer_price`, `eta_minutes`, `status`, `expires_at`, and `created_at`.

### List Offers

`ListOffers` now:

- Authenticates rider via JWT subject.
- Verifies rider owns the ride.
- Reads from `app.ride_offers`.
- Returns only pending, non-expired offers for `ride_request_id = rideId`.

### Reject Offer

`RejectOffer` now:

- Authenticates driver via JWT subject.
- Updates only that driver's own pending offer.
- Maps Go reject to `status = 'declined'`.
- Sets `declined_at = NOW()`.

### Accept Offer

`AcceptOffer` now:

- Authenticates rider via JWT subject.
- Runs inside a transaction.
- Locks the offer row with `FOR UPDATE`.
- Validates offer belongs to the ride.
- Validates offer is pending and not expired.
- Locks and validates the ride row with `FOR UPDATE`.
- Validates rider ownership.
- Validates `ride_status = 'requested'`.
- Updates `public.rides` with accepted driver and `ride_status = 'accepted'`.
- Updates accepted `app.ride_offers` row to accepted and sets `accepted_at`.
- Expires other pending offers for the same ride without touching the accepted offer.
- Sends the existing `ride_accepted` websocket event.

## Race Condition Controls

The accept path uses:

```sql
SELECT ... FROM app.ride_offers WHERE id = $1 FOR UPDATE
SELECT ... FROM public.rides WHERE id = $1 FOR UPDATE
UPDATE public.rides ... WHERE id = $1 AND ride_status = 'requested'
UPDATE app.ride_offers ... WHERE id = $1 AND status = 'pending' AND expires_at > NOW()
```

If another request already accepted the ride or changed the offer, the handler returns HTTP `409`.

## Tests Added / Updated

Updated existing accept-offer tests to use `app.ride_offers`.

Added/covered:

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
```

## Build / Test Results

```text
gofmt ./...              PASS
go test ./...            PASS
go build ./cmd/server    PASS
```

The sandboxed Go commands initially hit Windows build-cache access denial. They passed after rerunning with permission to use Go's standard build cache.

## Remaining Risks

- `defaultOfferTTL` is still a code constant, currently `30 * time.Second`.
- The backend assumes `app.ride_offers.request_id` accepts the same UUID as `ride_request_id`.
- The backend assumes `offered_fare` and `offer_price` can both be populated from the same numeric amount.
- The backend does not implement wallet settlement or payment integrity in Phase B1.
- Legacy `POST /rides/:id/accept` still directly accepts a ride without `app.ride_offers`; this was preserved to avoid breaking existing routes.
- No Supabase migrations were created or modified, per instruction.
