# Frontend Sync Verification — Go Core V1 Alignment

**Date:** 2026-06-01
**Branch synced:** `main` (GitHub HEAD)
**Scope:** Read-only verification. No code modified.

---

## 1. Backend socket client

| Check | Result |
|---|---|
| `src/lib/backendSocketClient.ts` exists | ✅ Present |

## 2. Canonical websocket events

Source: `src/lib/backendSocketClient.ts` (lines 11–15, 42–46), `canonicalEvents` set + `BackendSocketEventType` union.

| Event | Declared | Handled |
|---|---|---|
| `ride_offer` | ✅ | ✅ |
| `ride_accepted` | ✅ | ✅ |
| `driver_location` | ✅ | ✅ |
| `ride_started` | ✅ | ✅ |
| `ride_completed` | ✅ | ✅ |

No deprecated event names (`driver.location.update`, etc.) found anywhere in `src/` or `supabase/`.

## 3. API routes (Go Core V1)

All required routes resolved to `backendPost` call sites against the Go API (`VITE_API_URL`):

| Route | Call site |
|---|---|
| `POST /api/rides` | `src/lib/requestRide.ts:119` |
| `POST /api/rides/:rideId/offers` | `src/lib/offerHelpers.ts:183` |
| `POST /api/rides/:rideId/offers/:offerId/accept` | `src/lib/offerHelpers.ts:209`, `src/pages/RideDetail.tsx:287` |
| `POST /api/rides/:rideId/status` | `src/pages/DriverDashboard.tsx:661`, `src/components/driver/FullScreenNavigation.tsx:396`, `src/components/driver/DriverLiveNav.tsx:92,111` |
| `POST /api/rides/:rideId/complete` | `src/lib/completeTrip.ts:11` |
| `POST /api/drivers/me/presence` | `src/pages/DriverDashboard.tsx:317` |
| `POST /api/drivers/me/location` | `src/lib/driverLocation.ts:64` (fallback when WS closed; primary path is `driver_location` WS frame) |

Additional adjacent Go routes also present: `/api/rides/:id/cancel`, `/api/rides/:id/fare`, `/api/rides/:id/settle`.

## 4. Deprecated `driver.location.update`

`rg -n "driver\.location\.update" src/ supabase/` → **no matches**. ✅

## 5. Direct Supabase lifecycle mutations

`rg -n "\.from\(['\"]rides['\"]\)" src/` filtered to `update|insert|delete` → **no matches**.
All ride lifecycle state transitions go through Go Core V1 endpoints. ✅

Chat messages (`messages` table) remain Supabase-backed by design — out of lifecycle scope.

## 6. Negotiate routes

`src/App.tsx` (lines 179–181) — all `/negotiate/*` paths are `<Navigate>` redirects:

- `/negotiate/request` → `/ride`
- `/negotiate/offers/:requestId` → `/ride`
- `/negotiate/driver-requests` → `/driver/dashboard`

Negotiate screens are **not** production entry points. ✅

---

## Verdict

| Item | Status |
|---|---|
| Frontend source matches GitHub HEAD | ✅ |
| All Go Core V1 routes intact | ✅ |
| Canonical WS contracts preserved | ✅ |
| No lifecycle regressions detected | ✅ |
| Ready for V2 planning | ✅ |
