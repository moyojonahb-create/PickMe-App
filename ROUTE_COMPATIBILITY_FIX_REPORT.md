# Route Compatibility Fix Report

Date: 2026-06-15

Scope: Audited frontend Go API calls in `src/lib`, `src/hooks`, `src/pages`, and `src/components` against registered Go routes in `backend/cmd/server/main.go` and `backend/internal`. Frontend contracts were not changed.

## Summary

Result: **COMPATIBILITY ALIASES IMPLEMENTED**

The main route mismatches from the post-hardening audit were backend-side compatibility gaps. This pass added Go route aliases for:

- Public plural wallet routes that previously depended on singular fallback.
- Wallet admin list routes.
- Admin finance dashboard/report/action routes used by `src/lib/walletApi.ts`.
- `PATCH /api/rides/:rideId`.
- `POST /api/rides/offers/:offerId/reject`.

One route is intentionally registered but not silently executed:

- `POST /admin/wallets/transactions/:txId/reverse` returns `501 Not Implemented` until a ledger-backed reversal workflow exists.

## Files Changed

| File | Purpose |
|---|---|
| `backend/internal/rides/handler.go` | Added ride compatibility routes and handlers for fare patch and unscoped offer reject |
| `backend/internal/rides/handler_test.go` | Added compatibility route coverage for ride patch and unscoped offer reject |
| `backend/internal/wallet/admin_http.go` | Added public plural wallet aliases, wallet admin aliases, admin finance compatibility handlers |
| `backend/internal/wallet/admin_http_test.go` | Added route coverage for wallet/admin compatibility aliases |
| `ROUTE_COMPATIBILITY_FIX_REPORT.md` | This report |

## Frontend Route Mismatches Found And Fixed

| Frontend Caller | Frontend Route | Backend Fix | Status |
|---|---|---|---|
| `src/pages/RiderRideDetail.tsx` | `PATCH /api/rides/:rideId` | Added `h.PatchRide` and route registration | Fixed |
| `src/lib/offerHelpers.ts` | `POST /api/rides/offers/:offerId/reject` | Added unscoped reject alias that resolves `ride_id` from `ride_offers` | Fixed |
| `src/lib/walletApi.ts` | `GET /api/wallets/deposits` | Added plural list alias to existing frontend wallet deposits handler | Fixed |
| `src/lib/walletApi.ts` | `POST /api/wallets/transfer` | Added plural alias to existing transfer handler | Fixed |
| `src/lib/walletApi.ts` | `POST /api/wallets/pay` | Added plural alias to existing wallet ride payment handler | Fixed |
| `src/lib/walletApi.ts` | `POST /api/wallets/pin` | Added plural alias to existing PIN handler | Fixed |
| `src/lib/walletApi.ts` | `GET /api/wallets/lookup-user` | Added plural alias to existing lookup handler | Fixed |
| `src/lib/walletApi.ts` | `GET /api/wallets/driver/summary` | Added plural alias to existing driver summary handler | Fixed |
| `src/lib/walletApi.ts` | `GET /api/wallets/driver/earnings` | Added plural alias to existing driver earnings handler | Fixed |
| `src/lib/walletApi.ts` | `GET /admin/wallets/deposits?...` | Added alias to pending deposit report handler | Fixed |
| `src/lib/walletApi.ts` | `GET /admin/wallets/withdrawals?...` | Added alias to pending withdrawal report handler | Fixed |
| `src/lib/walletApi.ts` | `GET /admin/finance/wallet-dashboard` | Added compatibility dashboard composed from wallet reports | Fixed |
| `src/lib/walletApi.ts` | `GET /admin/finance/earnings` | Added admin earnings report handler | Fixed |
| `src/lib/walletApi.ts` | `GET /admin/finance/ledger` | Added platform ledger report handler | Fixed |
| `src/lib/walletApi.ts` | `GET /admin/finance/settlements/summary` | Added settlement summary handler | Fixed |
| `src/lib/walletApi.ts` | `GET /admin/finance/health` | Added finance health compatibility handler | Fixed |
| `src/lib/walletApi.ts` | `POST /admin/finance/fraud-flags` | Added fraud flag insert handler | Fixed |
| `src/lib/walletApi.ts` | `POST /admin/finance/fraud-flags/:id/resolve` | Added fraud flag resolve handler | Fixed |
| `src/lib/walletApi.ts` | `POST /admin/finance/fx-rate` | Added FX rate insert handler | Fixed |
| `src/lib/walletApi.ts` | `POST /admin/finance/low-balance-reminders` | Added explicit no-op compatibility response | Fixed |
| `src/lib/walletApi.ts` | `POST /admin/wallets/users/:userId/lock` | Added wallet lock compatibility handler | Fixed |
| `src/lib/walletApi.ts` | `POST /admin/wallets/users/:userId/unlock` | Added wallet unlock compatibility handler | Fixed |
| `src/lib/walletApi.ts` | `POST /admin/wallets/transactions/:txId/reverse` | Registered explicit `501` until ledger-backed reversal exists | Registered, not functionally complete |

## Route Behavior Notes

### Ride Patch

`PATCH /api/rides/:rideId` now supports the current frontend fare-edit path:

- Requires authenticated rider.
- Accepts `fare_minor` or `estimated_fare_minor`.
- Updates `public.rides.estimated_fare`.
- Allows updates only while the ride is `requested` or `pending`.

### Unscoped Offer Reject

`POST /api/rides/offers/:offerId/reject` now:

- Requires authenticated driver.
- Resolves `ride_id` from `public.ride_offers`.
- Reuses the same rejection update as the scoped route.
- Marks the dispatch driver availability state as `available` when supported.

### Admin Finance Compatibility

The admin finance aliases return frontend-compatible shapes:

- `wallet-dashboard`: `transactions`, `deposits`, `withdrawals`, `flags`, `failed_rides`, `locked_wallets`
- `earnings`: `earnings`
- `ledger`: `ledger`
- `settlements/summary`: `summary`
- `health`: `health`

Where a real `PostgresReports` instance is available, these handlers query PostgreSQL. In tests or alternate report implementations, they return safe empty compatibility structures.

### Transaction Reversal

`POST /admin/wallets/transactions/:txId/reverse` is registered but intentionally returns:

```text
501 Not Implemented
```

Reason: a safe production reversal must post a balanced ledger transaction with immutable reversal linkage. The old frontend route now reaches Go, but it must not fake a successful money reversal.

## Verification

Backend tests:

```text
cd backend
go test ./...
PASS
```

Focused compatibility tests added:

- `TestFrontendRideCompatibilityAliases`
- `TestFrontendAdminCompatibilityAliases`

## Remaining Compatibility Caveats

- `POST /admin/wallets/transactions/:txId/reverse` still needs a real ledger-backed implementation.
- Admin finance compatibility handlers are intentionally thin adapters. They unblock route contracts, but should be replaced with first-class finance query/service methods before production launch.
- This pass did not migrate remaining direct frontend Supabase writes; it only fixed Go route compatibility.
