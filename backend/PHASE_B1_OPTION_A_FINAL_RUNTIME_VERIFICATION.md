# Phase B1 Option A Final Runtime Verification

## Summary

Runtime verification was executed against the running backend and the Supabase database connected by `DATABASE_URL`.

Overall result: **PARTIALLY VERIFIED WITH FIXTURE BLOCKERS**

Verified end to end:

- `public.ride_offers` exists.
- `POST /api/rides/:rideId/offers` inserts into `public.ride_offers`.
- `GET /api/rides/:rideId/offers` returns pending offers.
- `POST /api/rides/:rideId/offers/:offerId/reject` sets `status = 'declined'` and populates `declined_at`.
- `POST /api/rides/:rideId/offers/:offerId/accept` updates `public.rides.driver_id`, `public.rides.ride_status`, accepted offer status, and `accepted_at`.
- Duplicate acceptance returns `409`.
- Expired offer acceptance returns `409`.
- Concurrent duplicate acceptance of the same offer produces exactly one success and one conflict.
- No writes occurred to legacy marketplace tables checked by row counts/source evidence.

Blocked:

- True losing-offer expiration with two distinct drivers.
- True two-driver competing acceptance race.

Reason:

```text
The connected Supabase auth schema has only 1 auth.users row.
```

Because `public.ride_offers.driver_id` references `auth.users(id)` and the table enforces one pending offer per `(ride_id, driver_id)`, a valid two-driver runtime fixture cannot be created without adding/fabricating auth users. That was not done.

## Runtime Context

Running backend:

```text
Process: server.exe
Path: C:\Users\ntepemanamafm\Desktop\pickme-go-backend\server.exe
Health: GET /health -> 200
```

Database protocol note:

```text
Direct verification queries used pgx simple protocol to match the backend's Supabase/PgBouncer configuration.
```

Available auth fixtures:

```text
auth.users count available to verifier: 1
```

## Verification Results

| Item | Classification | Evidence |
|---|---|---|
| `public.ride_offers` table exists | **VERIFIED** | `to_regclass('public.ride_offers')` returned `ride_offers`. |
| `POST /api/rides/:rideId/offers` inserts into `public.ride_offers` | **VERIFIED** | Offer `2ee03a15-736e-40eb-84e9-d241a670072e` inserted for ride `f4f32323-82dd-47c1-bde0-66da938f37bb`. |
| `GET /api/rides/:rideId/offers` returns pending offers | **VERIFIED** | Pending offer `2ee03a15-736e-40eb-84e9-d241a670072e` was returned by the list endpoint. |
| Reject sets `status = 'declined'` | **VERIFIED** | Rejected offer status became `declined`. |
| Reject populates `declined_at` | **VERIFIED** | `declined_at = 2026-05-31T22:27:13Z`. |
| Accept updates `public.rides.driver_id` | **VERIFIED** | Ride `4302f6e8-90e4-4fe0-b110-b7b8d1e1d3cc` set `driver_id = bf25d517-425f-4cf0-9cae-ef644e4729fd`. |
| Accept updates `public.rides.ride_status = 'accepted'` | **VERIFIED** | Ride `4302f6e8-90e4-4fe0-b110-b7b8d1e1d3cc` became `accepted`. |
| Accepted offer becomes `accepted` | **VERIFIED** | Offer `a24118d1-96dd-4bfc-9c5d-eb2f68c0306b` became `accepted`. |
| Accepted offer populates `accepted_at` | **VERIFIED** | `accepted_at = 2026-05-31T22:27:15Z`. |
| Losing offers become `expired` | **BLOCKED** | Only one `auth.users` row exists, so a second distinct driver offer cannot be created under the FK and unique pending-offer constraint. |
| Losing offers populate `expired_at` | **BLOCKED** | Same blocker as above. |
| Duplicate acceptance returns conflict | **VERIFIED** | Second accept returned `409` with `{"error":"Offer is not pending"}`. |
| Expired offer rejected | **VERIFIED** | Accepting an expired offer returned `409` with `{"error":"Offer has expired"}`. |
| Same-offer concurrent duplicate protected | **VERIFIED** | Concurrent accepts returned `map[200:1 409:1]`; accepted offer count remained `1`. |
| True two-driver race condition protected | **BLOCKED** | Requires rider plus two valid driver JWT subjects; only one `auth.users` row exists. |

## Transaction Safety

Source verification confirms the accept path uses transaction-safe locking:

```sql
SELECT id, ride_id, driver_id, status, expires_at
FROM public.ride_offers
WHERE id = $1
FOR UPDATE
```

```sql
SELECT rider_id, ride_status
FROM public.rides
WHERE id = $1
FOR UPDATE
```

Runtime evidence confirms same-offer concurrent duplicate acceptance is protected:

```text
codes = map[200:1 409:1]
accepted offer count = 1
```

The full two-driver race remains blocked by missing auth fixtures, not by a known backend or database failure.

## Legacy Table Write Verification

Row counts were captured before and after runtime verification where direct table counts were available.

| Table | Classification | Evidence |
|---|---|---|
| `app.ride_requests` | **VERIFIED** | Row count unchanged at `0`. |
| `app.ride_offers` | **VERIFIED** | Row count unchanged at `0`. |
| `app.rides` | **VERIFIED** | Row count unchanged at `0`. |
| `app.offers` | **VERIFIED** | Row count unchanged at `0`. |
| `app.driver_offers` | **VERIFIED** | Row count unchanged at `0`. |
| `public.active_driver_offers` | **VERIFIED** | Offer handler has no source reference; runtime writes targeted `public.ride_offers`. |

## Final Classification

```text
Submit offer:                  VERIFIED
List offers:                   VERIFIED
Reject offer:                  VERIFIED
Accept single offer:           VERIFIED
Duplicate accept conflict:     VERIFIED
Expired offer rejection:       VERIFIED
Same-offer concurrency:        VERIFIED
Losing offer expiration:       BLOCKED
Two-driver race verification:  BLOCKED
Legacy table writes:           VERIFIED
```

## Remaining Blocker

Create at least two additional valid Supabase auth users, or provide existing rider/driver test subjects, then rerun:

```text
1. create ride as rider
2. submit offer as driver A
3. submit offer as driver B
4. accept driver A offer
5. verify driver B offer becomes expired and expired_at is populated
6. concurrently accept competing offers and verify exactly one succeeds
```

Frontend, wallets, and Phase B2 were not touched.
