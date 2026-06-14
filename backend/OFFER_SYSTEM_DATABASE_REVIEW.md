# Offer System Database Review

## Audit summary

The current repository evidence shows:

- `internal/rides/handler.go` inserts only into `public.rides` on ride request.
- `internal/rides/handler.go` updates `public.rides` directly in `acceptRide`.
- The compatibility route `POST /api/rides/:rideId/offers/:offerId/accept` ignores `offerId` entirely and accepts by `rideId` alone.
- No repository file references `public.active_driver_offers`.
- No current SQL persists any driver offer lifecycle state.

## Actual SQL usage affecting offers

### Ride request

- Inserts into `public.rides`:
  - `rider_id`
  - `pickup_location`
  - `dropoff_location`
  - `estimated_fare`
  - `payment_method`
  - `payment_status = 'pending'`
  - `ride_status = 'requested'`
  - `created_at = NOW()`

### Ride acceptance

- Updates `public.rides`:
  - sets `driver_id = $1`
  - sets `ride_status = 'accepted'`
- Condition:
  - `WHERE id = $2 AND ride_status = 'requested'`
- This is the only current assignment guard.

## Key gaps discovered

1. `active_driver_offers` is not used anywhere in the backend despite existing in production schema.
2. `offerId` is accepted in the compatibility route shape but not mapped to any database field.
3. The backend assumes a single-driver acceptance model, not a marketplace with multiple competing offers.
4. There is no offer state model to support `pending`, `accepted`, `rejected`, `expired`, or `updated`.
5. There is no `offer` entity tracking driver-side metadata such as proposed price, ETA, or proposed fee.
6. There is no mechanism preventing a driver from accepting a ride that was offered to another driver.
7. There is no offer expiration or cleanup logic.

## Recommended minimal database contract

The safest Phase B1 implementation should introduce a normalized offer table while preserving the existing `rides` table shape.

### Suggested `active_driver_offers` contract

Fields should minimally include:

- `id` — primary key / offer UUID
- `ride_id` — foreign key to `public.rides`
- `driver_id` — candidate driver
- `status` — `pending`, `accepted`, `rejected`, `expired`, `canceled`
- `expires_at` — deterministic expiration time
- `created_at`
- `updated_at`
- `accepted_at` / `rejected_at` (optional for audit)
- `offer_price` / `estimated_fare` / `platform_fee` (optional metadata)
- `payload` or `metadata` JSONB for future fields without schema churn

### Operational constraints

- Add unique index on `(ride_id, driver_id, status)` or `(ride_id, id)` depending on behavior.
- Add compound index on `(ride_id, status, expires_at)` for rider offer listing.
- Add index on `(driver_id, status)` for candidate offer lookup.
- Keep offer state transitions managed by SQL predicates.

## Existing schema assumptions validated by repo

The current code relies on `public.rides` having:

- `driver_id`
- `ride_status`
- `payment_method`
- `payment_status`
- `created_at`
- `started_at`
- `completed_at`

The offer subsystem should not require guessing these columns beyond what current SQL uses.

## Database review conclusion

The backend is currently missing the `active_driver_offers` persistence layer entirely. Phase B1 must add offer table usage before it can safely support multiple offers, rider choice, and robust assignment semantics.
