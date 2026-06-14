# Phase B1 Runtime Verification

## Summary

Runtime verification was attempted against the actual Supabase database.

Result: **BLOCKED / NEEDS BACKEND CHANGE**

The Phase B1 offer routes reach the live database, but `POST /api/rides/:rideId/offers` fails when inserting into `app.ride_offers` because the backend currently writes:

```text
request_id = public.rides.id
```

The production constraint is:

```text
ride_offers_request_id_fkey: FOREIGN KEY (request_id) REFERENCES app.ride_requests(id) ON DELETE CASCADE
```

So `app.ride_offers.request_id` is not compatible with the Go semantic `rideId` / `public.rides.id` value.

## Runtime Context

The server already running on port `3000` did not include the newest Phase B1 offer routes, so verification was run against the current source on temporary port `3001`.

The temporary verification server was stopped after the run.

No source code changes were kept from the verification helper.

## Constraint Evidence

Production constraints discovered on `app.ride_offers`:

```text
ride_offers_driver_id_fkey: FOREIGN KEY (driver_id) REFERENCES app.profiles(id) ON DELETE CASCADE
ride_offers_pkey: PRIMARY KEY (id)
ride_offers_request_id_driver_id_key: UNIQUE (request_id, driver_id)
ride_offers_request_id_fkey: FOREIGN KEY (request_id) REFERENCES app.ride_requests(id) ON DELETE CASCADE
ride_offers_status_check: CHECK ((status = ANY (ARRAY['pending','accepted','declined','expired','cancelled'])))
```

This means:

- `driver_id` must exist in `app.profiles`.
- `request_id` must exist in `app.ride_requests`.
- `request_id + driver_id` must be unique.
- `status = 'declined'` is valid for reject.

## Flow Verification Results

| Flow | Classification | Runtime Result | Explanation |
|---|---|---|---|
| `POST /api/rides/:rideId/offers` creates row in `app.ride_offers` | **NEEDS BACKEND CHANGE** | `500` from database FK violation | Insert reached `app.ride_offers`, but `request_id = rideId` violates `ride_offers_request_id_fkey` because `request_id` references `app.ride_requests(id)`, not `public.rides(id)`. |
| `GET /api/rides/:rideId/offers` returns pending non-expired offers | **BLOCKED** | Route executed but no created offer existed | Submit offer failed first, so there was no valid pending offer to list. |
| `POST /api/rides/:rideId/offers/:offerId/reject` updates `status = declined`, sets `declined_at` | **BLOCKED** | No valid `offerId` existed | Submit offer failed, so reject could not be verified against a created offer. |
| `POST /api/rides/:rideId/offers/:offerId/accept` validates ownership and accepts offer | **BLOCKED** | No valid `offerId` existed | Submit offer failed, so accept could not be verified against a created offer. |
| Accept updates `public.rides.driver_id` | **BLOCKED** | Not reached | Blocked by submit failure. |
| Accept updates `public.rides.ride_status = accepted` | **BLOCKED** | Not reached | Blocked by submit failure. |
| Accept updates `app.ride_offers.status = accepted` | **BLOCKED** | Not reached | Blocked by submit failure. |
| Accept sets `accepted_at` | **BLOCKED** | Not reached | Blocked by submit failure. |
| Accept expires losing offers | **BLOCKED** | Not reached | Blocked by submit failure. |
| No writes to `public.active_driver_offers` | **BLOCKED** | Runtime query hit database view/rule recursion | Querying scoped rows on `public.active_driver_offers` failed with `infinite recursion detected in rules for relation "active_driver_offers"`. Source scan confirms Phase B1 code no longer writes to this object. |
| No writes to `app.offers` | **VERIFIED** | No rows found for test ride | Scoped verification found no rows for the test ride. Source scan found no writes. |
| No writes to `app.driver_offers` | **VERIFIED** | No rows found for test ride | Scoped verification found no rows for the test ride. Source scan found no writes. |

## Exact Runtime Error

`POST /api/rides/:rideId/offers` returned:

```text
500
ERROR: insert or update on table "ride_offers" violates foreign key constraint "ride_offers_request_id_fkey" (SQLSTATE 23503)
```

## Root Cause

The implementation followed the Phase B1 instruction:

```text
request_id = rideId, if required by NOT NULL constraints
```

But production schema discovery now proves `request_id` is not a compatibility alias for `public.rides.id`; it is a foreign key to:

```text
app.ride_requests(id)
```

Therefore the backend needs one of these backend-side corrections before runtime verification can pass:

1. Do not write `request_id` when inserting into `app.ride_offers`, if the column is nullable.
2. Resolve the correct `app.ride_requests.id` for the ride and write that value to `request_id`.
3. If `public.rides.id` and `app.ride_requests.id` are meant to be the same logical ID, ensure the ride creation path creates or links the corresponding `app.ride_requests` row before offer submission.

No database migration recommendation is made here because the instruction was not to create or modify tables.

## Source Write Target Check

Current source references offer tables as follows:

```text
internal/rides/handler.go -> app.ride_offers only
```

No source writes were found to:

```text
public.active_driver_offers
app.driver_offers
app.offers
public.driver_offers
```

## Final Classification

```text
SubmitOffer: NEEDS BACKEND CHANGE
ListOffers: BLOCKED
RejectOffer: BLOCKED
AcceptOffer: BLOCKED
No writes to public.active_driver_offers: BLOCKED runtime / source clean
No writes to app.offers: VERIFIED
No writes to app.driver_offers: VERIFIED
```

Wallet work was not started. Frontend was not touched.
