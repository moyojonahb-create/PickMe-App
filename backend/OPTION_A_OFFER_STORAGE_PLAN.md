# Option A Offer Storage Plan

## Architecture Decision

Option A is selected.

Go remains the brain of PickMe ride logic:

- ride decisions
- matching
- dispatch
- pricing
- offer selection
- race-condition control

Supabase remains:

- storage
- authentication
- files
- realtime backup

Canonical Go runtime tables:

```text
public.rides
public.driver_sessions
public.driver_locations
```

New Go-owned offer storage:

```text
public.ride_offers
```

Legacy marketplace tables must not be used for new Go ride logic:

```text
app.ride_requests
app.ride_offers
app.rides
```

## Why A New `public.ride_offers` Table

The production schema proves `app.ride_offers.request_id` references `app.ride_requests(id)`, while the Go backend canonical ride ID is `public.rides.id`.

Using `app.ride_offers` forces the Go backend into the legacy marketplace model:

```text
app.ride_requests -> app.ride_offers
```

Option A intentionally chooses the Go runtime model:

```text
public.rides -> public.ride_offers
```

`public.active_driver_offers` is not suitable as canonical storage because it has already shown view/rule recursion behavior and should not be written to by new Go logic.

## Ownership

| Table | Storage Owner | Logic Owner | Purpose |
|---|---|---|---|
| `public.rides` | Supabase | Go | Canonical ride/trip lifecycle. |
| `public.driver_sessions` | Supabase | Go | Driver availability and nearby discovery. |
| `public.driver_locations` | Supabase | Go | Latest driver location storage. |
| `public.ride_offers` | Supabase | Go | Canonical Go ride offer lifecycle. |

## Offer Lifecycle

Allowed statuses:

```text
pending
accepted
declined
expired
cancelled
```

Lifecycle rules:

- A driver submits an offer for a requested ride.
- Offers start as `pending`.
- Driver may decline only their own pending offer.
- Rider may accept one pending, non-expired offer for their own ride.
- Accepted offer becomes `accepted`.
- Losing pending offers for that ride become `expired`.
- The accepted offer updates `public.rides.driver_id`.
- The ride becomes `ride_status = 'accepted'`.

## Race Safety

Acceptance must be transactional.

The transaction must:

1. Lock the target offer row.
2. Lock or conditionally update the ride row.
3. Ensure the ride is still `requested`.
4. Ensure the offer is still `pending`.
5. Ensure the offer has not expired.
6. Update the ride to accepted.
7. Mark the accepted offer.
8. Expire other pending offers.

The critical race guard is:

```sql
UPDATE public.rides
SET driver_id = $driver_id,
    ride_status = 'accepted'
WHERE id = $ride_id
  AND ride_status = 'requested';
```

If this updates zero rows, return HTTP `409`.

## Frontend API Contract Preserved

Existing frontend routes remain unchanged:

```text
POST /api/rides/:rideId/offers
GET  /api/rides/:rideId/offers
POST /api/rides/:rideId/offers/:offerId/accept
POST /api/rides/:rideId/offers/:offerId/reject
```

Only backend storage changes.

## Column Mapping

| Go field | `public.ride_offers` column |
|---|---|
| `rideId` | `ride_id` |
| JWT subject for driver | `driver_id` |
| `amount` / `price` / `offered_fare` / `estimated_fare` | `offered_fare` |
| Compatibility amount | `offer_price` |
| `eta_minutes` / `eta` | `eta_minutes` |
| pending state | `status = 'pending'` |
| accepted state | `status = 'accepted'`, `accepted_at = now()` |
| rejected by driver | `status = 'declined'`, `declined_at = now()` |
| losing offers | `status = 'expired'`, `expired_at = now()` |

## Tables Explicitly Excluded

The following tables must not be used by Phase B1 Go offer logic:

```text
app.ride_requests
app.ride_offers
app.rides
app.offers
app.driver_offers
public.active_driver_offers
public.driver_offers
```

## Success Criteria

Phase B1 is complete when:

- Offer submit inserts into `public.ride_offers`.
- Offer list reads from `public.ride_offers`.
- Offer reject updates `public.ride_offers`.
- Offer accept updates `public.ride_offers` and `public.rides` in one transaction.
- No source SQL references `app.ride_requests`, `app.ride_offers`, or `app.rides`.
- Runtime verification confirms no writes to legacy marketplace tables.
