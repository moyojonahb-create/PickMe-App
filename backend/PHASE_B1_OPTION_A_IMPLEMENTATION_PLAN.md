# Phase B1 Option A Implementation Plan

## Goal

Refactor Phase B1 offer management to use `public.ride_offers`, aligned directly with `public.rides(id)`.

Do not use:

```text
app.ride_requests
app.ride_offers
app.rides
```

Do not touch:

```text
wallets
frontend
Supabase legacy marketplace tables
```

## Implementation Scope

Files expected to change in the implementation phase:

```text
internal/rides/handler.go
internal/rides/types.go
internal/rides/handler_test.go
```

Migration artifact:

```text
PUBLIC_RIDE_OFFERS_MIGRATION.sql
```

## Route Behavior

Routes remain unchanged:

```text
POST /api/rides/:rideId/offers
GET  /api/rides/:rideId/offers
POST /api/rides/:rideId/offers/:offerId/accept
POST /api/rides/:rideId/offers/:offerId/reject
```

## Submit Offer

Handler: `SubmitOffer`

Required behavior:

1. Require JWT.
2. Driver ID comes from JWT subject.
3. Reject mismatched body `driver_id`.
4. Validate `public.rides.id = rideId` exists.
5. Validate `public.rides.ride_status = 'requested'`.
6. Insert into `public.ride_offers`.
7. Set:
   - `ride_id = rideId`
   - `driver_id = auth subject`
   - `offered_fare = request amount`
   - `offer_price = request amount`
   - `eta_minutes`
   - `status = 'pending'`
   - `expires_at = now + defaultOfferTTL`
8. Return:
   - `offer_id`
   - `ride_id`
   - `driver_id`
   - `amount`
   - `fare`
   - `offered_fare`
   - `eta_minutes`
   - `status`
   - `expires_at`
   - `created_at`

SQL target:

```sql
INSERT INTO public.ride_offers (...)
```

## List Offers

Handler: `ListOffers`

Required behavior:

1. Require JWT.
2. Rider ID comes from JWT subject.
3. Verify rider owns `public.rides.id = rideId`.
4. Query:

```sql
SELECT ...
FROM public.ride_offers
WHERE ride_id = $1
  AND status = 'pending'
  AND expires_at > now()
ORDER BY created_at ASC;
```

5. Return pending non-expired offers.

## Reject Offer

Handler: `RejectOffer`

Required behavior:

1. Require JWT.
2. Driver ID comes from JWT subject.
3. Driver can only decline their own pending offer.
4. Update:

```sql
UPDATE public.ride_offers
SET status = 'declined',
    declined_at = now()
WHERE id = $1
  AND ride_id = $2
  AND driver_id = $3
  AND status = 'pending';
```

5. If zero rows updated, return `409`.

## Accept Offer

Handler: `AcceptOffer`

Required behavior:

1. Require JWT.
2. Rider ID comes from JWT subject.
3. Transaction required.
4. Lock offer:

```sql
SELECT id, ride_id, driver_id, status, expires_at
FROM public.ride_offers
WHERE id = $1
FOR UPDATE;
```

5. Validate:
   - offer exists
   - offer belongs to `rideId`
   - offer is `pending`
   - offer is not expired
6. Lock ride:

```sql
SELECT rider_id, ride_status
FROM public.rides
WHERE id = $1
FOR UPDATE;
```

7. Validate:
   - rider owns ride
   - `ride_status = 'requested'`
8. Update ride:

```sql
UPDATE public.rides
SET driver_id = $1,
    ride_status = 'accepted'
WHERE id = $2
  AND ride_status = 'requested';
```

9. If zero rows updated, return `409`.
10. Update accepted offer:

```sql
UPDATE public.ride_offers
SET status = 'accepted',
    accepted_at = now()
WHERE id = $1
  AND status = 'pending'
  AND expires_at > now();
```

11. Expire losing offers:

```sql
UPDATE public.ride_offers
SET status = 'expired',
    expired_at = now()
WHERE ride_id = $1
  AND id != $2
  AND status = 'pending';
```

12. Commit.
13. Send existing `ride_accepted` websocket event.
14. Return:
   - `ride_id`
   - `offer_id`
   - `driver_id`
   - `ride_status`
   - `room`

## Tests To Update

Update tests to assert SQL uses:

```text
public.ride_offers
```

and does not use:

```text
app.ride_requests
app.ride_offers
app.rides
public.active_driver_offers
```

Required test coverage:

- Submit offer succeeds.
- Submit offer inserts `ride_id`, not `request_id`.
- List offers returns pending non-expired offers.
- Accept offer succeeds.
- Expired offer rejected.
- Duplicate acceptance returns `409`.
- Reject/decline offer succeeds.
- Driver cannot reject another driver's offer.
- Rider cannot accept offer for another rider's ride.

## Runtime Verification Plan

After implementation:

1. Apply `PUBLIC_RIDE_OFFERS_MIGRATION.sql` to Supabase.
2. Start latest backend binary.
3. Verify:
   - `POST /api/rides/:rideId/offers` creates `public.ride_offers` row.
   - `GET /api/rides/:rideId/offers` returns pending non-expired rows.
   - reject sets `status = 'declined'` and `declined_at`.
   - accept updates `public.rides` and `public.ride_offers`.
   - losing offers expire.
   - no writes occur to legacy marketplace tables.

## Risks

- Existing production rows in `public.rides` are compatible with this option because offers reference `public.rides(id)`.
- If `auth.users` and driver identity differ from driver profile identity in future, `driver_id` FK choice may need review.
- Legacy routes that directly accept rides still bypass offers. Keep for compatibility until explicitly deprecated.

## Non-Goals

- No wallet work.
- No frontend changes.
- No `app.ride_requests` integration.
- No `app.ride_offers` integration.
- No `app.rides` integration.
- No Phase B2.
