# Phase B1 Implementation Report

## Files changed

- `internal/rides/handler.go`
  - Added offer lifecycle handlers for submit, list, reject, and offer-based acceptance.
  - Integrated `public.active_driver_offers` into ride acceptance.
  - Added transactional offer acceptance that validates `offerId`, ride ownership, pending state, and expiration.
  - Added automatic expiration of remaining pending offers after acceptance.
  - Preserved existing legacy direct ride acceptance path via `/rides/:id/accept`.
  - Added a production `pgxpool.Pool` wrapper to support a testable DB interface.
- `internal/rides/types.go`
  - Added offer request and response types.
  - Added `OfferRecord` domain type.
- `internal/rides/handler_test.go`
  - Added tests for successful offer acceptance, expired offer rejection, duplicate acceptance, and race-condition conflict handling.
- `cmd/server/main.go`
  - Updated backend initialization to wrap the `pgxpool.Pool` into the rides DB abstraction.

## Routes added

- `POST /api/rides/:rideId/offers`
  - Driver submits a new offer for a ride.
- `GET /api/rides/:rideId/offers`
  - Rider retrieves active pending offers for a ride.
- `POST /api/rides/:rideId/offers/:offerId/reject`
  - Driver rejects a pending offer.
- `POST /api/rides/:rideId/offers/:offerId/accept`
  - Updated to validate `offerId` and perform offer-based assignment via transaction.

## Database integration changes

- Added direct writes to `public.active_driver_offers` for driver offer submission.
- Added rider-facing pending offer query filtered by `ride_id`, `status = 'pending'`, and `expires_at > NOW()`.
- Added transactional acceptance logic:
  - validate offer exists and belongs to ride
  - validate offer status is `pending`
  - validate offer has not expired
  - validate ride belongs to authenticated rider
  - update `public.rides` to assign `driver_id` and mark `ride_status = 'accepted'`
  - update accepted offer state to `accepted`
  - expire remaining `pending` offers for the ride
- Added a `rides.NewDB` wrapper to bridge production `*pgxpool.Pool` with the new `rides.DB` test interface.

## Tests added

- `internal/rides/handler_test.go`
  - `TestAcceptOfferSuccessful`
  - `TestAcceptOfferExpiredOfferRejected`
  - `TestAcceptOfferDuplicateAcceptanceAttempt`
  - `TestAcceptOfferRaceConditionReturnsConflict`

## Validation results

- `go test ./...` passed successfully.
- `go build ./cmd/server` passed successfully.

## Remaining risks

- No database migrations were added, so the implementation assumes `active_driver_offers` has columns:
  - `id`
  - `ride_id`
  - `driver_id`
  - `status`
  - `expires_at`
  - `created_at`
  - `updated_at`
- The code does not yet add rider or driver websocket notifications for new offer creation.
- Wallet/payment settlement and platform fee handling remain out of scope for Phase B1.
- The legacy ride request broadcast behavior is preserved but may need refinement for scale.
- Additional schema validation should be performed against the actual production database before deployment.
