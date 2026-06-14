# Phase B1 Option A Runtime Verification

## Summary

Runtime verification was run against the backend connected to the actual Supabase database.

Result: **NEEDS DATABASE CHANGE / BLOCKED**

The running backend is using the Phase B1 Option A code path, but the target table is not present in the connected Supabase database:

```text
public.ride_offers = <nil>
```

`POST /api/rides/:rideId/offers` reaches the live database and fails with:

```text
ERROR: relation "public.ride_offers" does not exist (SQLSTATE 42P01)
```

This confirms the backend is no longer attempting to write `app.ride_offers`, but `PUBLIC_RIDE_OFFERS_MIGRATION.sql` has not been applied to the database currently reached by `DATABASE_URL`.

## Runtime Context

Running backend process:

```text
Path: C:\Users\ntepemanamafm\Desktop\pickme-go-backend\server.exe
```

Runtime route probe used an existing requested ride:

```text
ride_id: 7fe49194-ba36-469f-8c21-63fd8b042d35
rider_id: bf25d517-425f-4cf0-9cae-ef644e4729fd
ride_status: requested
```

The verification JWT subject was:

```text
bf25d517-425f-4cf0-9cae-ef644e4729fd
```

## Flow Results

| Verification item | Classification | Evidence |
|---|---|---|
| `public.ride_offers` table exists | **NEEDS DATABASE CHANGE** | Direct database check returned `to_regclass('public.ride_offers') = null`. |
| `POST /api/rides/:rideId/offers` creates a row in `public.ride_offers` | **NEEDS DATABASE CHANGE** | Route executed with a valid JWT and requested ride, but returned `500` because `public.ride_offers` does not exist. |
| `GET /api/rides/:rideId/offers` returns pending non-expired offers | **BLOCKED** | Submit offer cannot create a row until the table exists. |
| `POST /api/rides/:rideId/offers/:offerId/reject` sets `status = declined` and `declined_at` | **BLOCKED** | No offer row can be created to reject until the table exists. |
| `POST /api/rides/:rideId/offers/:offerId/accept` validates rider ownership and updates ride/offer state | **BLOCKED** | No offer row can be created to accept until the table exists. |
| Accept locks offer row | **BLOCKED** | Source contains `FOR UPDATE`, but runtime cannot reach this path without `public.ride_offers`. |
| Accept locks ride row | **BLOCKED** | Source contains `FOR UPDATE`, but runtime cannot reach this path without a valid offer row. |
| Accept updates `public.rides.driver_id` | **BLOCKED** | Not reached because offer creation is blocked by missing table. |
| Accept updates `public.rides.ride_status = accepted` | **BLOCKED** | Not reached because offer creation is blocked by missing table. |
| Accept sets `public.ride_offers.status = accepted` | **BLOCKED** | Not reached because `public.ride_offers` does not exist. |
| Accept sets `accepted_at` | **BLOCKED** | Not reached because `public.ride_offers` does not exist. |
| Accept expires losing offers | **BLOCKED** | Not reached because `public.ride_offers` does not exist. |

## Route Evidence

Request:

```text
POST /api/rides/7fe49194-ba36-469f-8c21-63fd8b042d35/offers
Authorization: Bearer {valid Supabase-style JWT}
Content-Type: application/json

{"amount":12.75,"eta_minutes":5}
```

Response:

```text
HTTP 500
{"error":"ERROR: relation \"public.ride_offers\" does not exist (SQLSTATE 42P01)"}
```

This is the expected failure mode when the Option A backend is deployed before the Option A table migration.

## Legacy Table Write Check

Source-level scan of `internal/rides/handler.go` found no references to:

```text
app.ride_requests
app.ride_offers
app.rides
app.offers
app.driver_offers
public.active_driver_offers
public.driver_offers
```

Runtime evidence also supports this: the failing route attempted to access `public.ride_offers`, not any legacy marketplace table.

| Legacy table | Classification | Evidence |
|---|---|---|
| `app.ride_requests` | **VERIFIED** | No source reference in offer handler; runtime error targets `public.ride_offers`. |
| `app.ride_offers` | **VERIFIED** | No source reference in offer handler; runtime error targets `public.ride_offers`. |
| `app.rides` | **VERIFIED** | No source reference in offer handler; runtime error targets `public.ride_offers`. |
| `app.offers` | **VERIFIED** | No source reference in offer handler; runtime error targets `public.ride_offers`. |
| `app.driver_offers` | **VERIFIED** | No source reference in offer handler; runtime error targets `public.ride_offers`. |
| `public.active_driver_offers` | **VERIFIED** | No source reference in offer handler; runtime error targets `public.ride_offers`. |
| `public.driver_offers` | **VERIFIED** | No source reference in offer handler; runtime error targets `public.ride_offers`. |

## Required Next Step

Apply:

```text
PUBLIC_RIDE_OFFERS_MIGRATION.sql
```

to the Supabase database used by `DATABASE_URL`, then rerun this runtime verification.

## Final Classification

```text
Table existence: NEEDS DATABASE CHANGE
Submit offer:    NEEDS DATABASE CHANGE
List offers:     BLOCKED
Reject offer:    BLOCKED
Accept offer:    BLOCKED
Legacy writes:   VERIFIED
```

Frontend, wallets, and Phase B2 were not touched.
