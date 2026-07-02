# Ride Contract Alignment Report

Date: 2026-07-02

Scope: GO V2.6-C emergency fix for launch-blocking ride/offer/status contract drift only. No wallet logic, dispatch architecture, UI redesign, or product feature expansion was performed.

## Result

Overall result: **PASS FOR 5-DRIVER / 10-RIDER CONTROLLED PILOT CODE-LEVEL FIX**

Public launch still requires a live staging smoke test with real rider and driver JWTs, Redis, Asynq, dispatch, WebSocket, and database connectivity.

## Files Changed

- `backend/internal/rides/handler.go`
- `backend/internal/rides/types.go`
- `backend/internal/rides/handler_test.go`
- `src/lib/rideContract.ts`
- `src/lib/offerHelpers.ts`
- `src/lib/requestRide.ts`
- `src/lib/completeTrip.ts`
- `src/lib/rideExpiry.ts`
- `src/hooks/useRideRealtime.ts`
- `src/pages/DriverDashboard.tsx`
- `src/pages/RideDetail.tsx`
- `src/pages/RiderRideDetail.tsx`
- `src/pages/negotiate/DriverRequestsScreen.tsx`
- `src/pages/negotiate/RiderOffersScreen.tsx`
- `RIDE_CONTRACT_ALIGNMENT_REPORT.md`

## Old Contract

- Go created offers in `public.ride_offers`.
- Some active frontend rider/driver screens still read `public.offers` or legacy `ride_requests`.
- Go lifecycle used canonical `ride_status`.
- Some active frontend screens only read legacy `status`.
- Go `/api/rides/:rideId/status` treated any status update as start ride.
- Frontend sent `enroute`, `arrived`, and `in_progress`, but only `in_progress` should start the payable trip.

## New Canonical Contract

- Go owns ride and offer mutations.
- Canonical offer storage is `public.ride_offers`.
- Canonical lifecycle field is `ride_status`.
- Backend responses include compatibility `status`.
- Frontend marketplace offer reads use Go endpoints:
  - `GET /api/rides/open`
  - `GET /api/rides/:rideId`
  - `GET /api/rides/:rideId/offers`
  - `POST /api/rides/:rideId/offers`
  - `POST /api/rides/:rideId/offers/:offerId/accept`
- Frontend normalizes Go `ride_status='ongoing'` to UI `status='in_progress'`.

## Compatibility Mapping

| Canonical / Legacy Input | Frontend Compatibility Status |
|---|---|
| `pending` | `requested` |
| `requested` | `requested` |
| `accepted` | `accepted` |
| `enroute` | `enroute` |
| `arrived` | `arrived` |
| `ongoing` | `in_progress` |
| `in_progress` | `in_progress` |
| `completed` | `completed` |
| `cancelled` / `canceled` | `cancelled` |

## Security And Safety Notes

- `enroute` and `arrived` now update ride state only; they do **not** set `started_at`.
- Only `in_progress` / `ongoing` starts the payable trip.
- Ride completion no longer depends on a stale frontend-only `status='in_progress'` precheck; Go remains the authoritative completion gate.
- Accepting offers mirrors `status='accepted'` for compatibility so active rider/driver screens can still find the trip.
- Starting rides mirrors `status='in_progress'`.
- Completing rides mirrors `status='completed'`.

## Tests Added / Updated

- Added backend lifecycle coverage for intermediate status updates:
  - `enroute` emits `ride_status_updated`
  - `enroute` does not touch `started_at`
  - `enroute` mirrors compatibility `status`
- Extended start ride coverage:
  - `ongoing` returns compatibility `status='in_progress'`
  - start allows `accepted`, `enroute`, or `arrived`
- Extended accept-offer coverage:
  - accepted ride mirrors legacy `status='accepted'`
  - accept response includes compatibility `status`

## Verification

Backend:

```text
cd backend
$env:GOCACHE=(Resolve-Path .).Path + '\.gocache'
go test ./...
PASS
```

Frontend:

```text
npx tsc --noEmit -p tsconfig.app.json
PASS
```

Drift scans:

```text
rg -n "ride_requests" src/pages src/lib src/hooks backend/internal/rides
Only backend banned-table test string remains.
```

```text
rg -n "from('offers')" src/pages src/lib src/hooks
Only src/pages/admin/AdminSystemHealth.tsx analytics check remains.
```

## Remaining Risks

- No live staging ride was run in this shell, so real JWT, WebSocket, Redis, Asynq, and database behavior still need runtime validation.
- `src/pages/admin/AdminSystemHealth.tsx` still reads legacy `offers` for analytics. This is not an active rider/driver marketplace flow, but should be migrated in the next admin cleanup pass.
- The driver active-trip lookup still includes a Supabase read for compatibility. It now normalizes `ride_status`, but a future pass should move that active-trip read fully behind Go.
- Notification provider configuration remains outside this ride-contract fix.

## Pilot Decision

**GO for controlled 5-driver / 10-rider pilot only after one supervised staging ride completes end-to-end.**

Minimum staging smoke before inviting the cohort:

1. Rider requests ride.
2. Driver sees open ride.
3. Driver submits offer.
4. Rider sees `public.ride_offers` offer through Go.
5. Rider accepts offer.
6. Driver and rider both see accepted active ride.
7. Driver sets `enroute`.
8. Driver sets `arrived`.
9. Driver starts ride; UI shows `in_progress`.
10. Driver completes ride; rider and driver can both find completed ride.

Public launch remains **NO-GO** until that staging smoke and the broader launch smoke suite pass with production-like infrastructure.
