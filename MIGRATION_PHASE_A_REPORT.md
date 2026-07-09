# PickMe Migration Phase A Report

Scope: Phase A only. This pass created a reusable Go backend client and migrated the requested ride/driver lifecycle write paths from direct browser-to-Supabase mutation to authenticated browser-to-Go calls.

## Result

Phase A is complete.

- TypeScript: `npx tsc -b --noEmit` passed.
- Production build: `npm run build` passed.
- Local `.env` was created with:
  - `VITE_API_URL=http://localhost:3000`
  - `VITE_WS_URL=ws://localhost:3000/ws`

The first build attempt failed in the sandbox with `spawn EPERM` from esbuild. The build passed after rerunning with approved build permissions.

## Files Changed

- `src/lib/backendClient.ts`
- `src/lib/requestRide.ts`
- `src/components/HeroSection.tsx`
- `src/lib/offerHelpers.ts`
- `src/lib/completeTrip.ts`
- `src/lib/driverLocation.ts`
- `src/lib/ws.ts`
- `src/lib/socket.ts`
- `src/pages/DriverDashboard.tsx`
- `src/components/driver/DriverLiveNav.tsx`
- `src/components/driver/FullScreenNavigation.tsx`
- `src/pages/RideDetail.tsx`
- `src/pages/LiveTrackingPage.tsx`

Local-only file:

- `.env` configured for the local Go backend. It is gitignored.

## Backend Client

Created `src/lib/backendClient.ts` with:

- `getAuthToken()`
- `backendGet()`
- `backendPost()`
- `backendPatch()`
- `backendDelete()`
- `connectBackendWs()`

Behavior:

- Reads `VITE_API_URL`.
- Reads `VITE_WS_URL`.
- Attaches `Authorization: Bearer <supabase access token>` to HTTP calls.
- Adds the Supabase access token to WebSocket handshake query params as `token`.
- Normalizes `401`, `403`, `5xx`, request errors, config errors, and network failures into `BackendError`.

## Endpoints Used

- `POST /api/rides`
- `POST /api/rides/{rideId}/offers/{offerId}/accept`
- `POST /api/rides/{rideId}/status`
- `POST /api/rides/{rideId}/complete`
- `POST /api/rides/{rideId}/settle`
- `POST /api/drivers/me/presence`
- `POST /api/drivers/me/location`
- `GET /ws` via `VITE_WS_URL`

## Removed Supabase Mutations

Ride creation:

- Removed direct `request_cash_ride` / `request_wallet_ride` usage from `src/lib/requestRide.ts`.
- Removed direct `rides.insert` from `src/components/HeroSection.tsx`.

Offer acceptance:

- Removed direct `offers.update(accepted)`, competing `offers.update(rejected)`, and `rides.update(accepted)` from `src/lib/offerHelpers.ts`.
- Removed local direct offer/ride acceptance writes from `src/pages/RideDetail.tsx`.

Driver online/offline:

- Removed browser-side `can_driver_operate` RPC call and `drivers.update({ is_online })` from `src/pages/DriverDashboard.tsx`.

Driver location updates:

- Removed browser-side `live_locations.upsert` from `src/lib/driverLocation.ts`.
- Driver location now sends authenticated WebSocket event `driver.location.update`, with HTTP fallback to `POST /api/drivers/me/location`.

Ride status transitions:

- Removed direct `rides.update({ status })` from:
  - `src/pages/DriverDashboard.tsx`
  - `src/components/driver/DriverLiveNav.tsx`
  - `src/components/driver/FullScreenNavigation.tsx`

Ride completion and settlement:

- Removed direct `complete_trip_with_commission` RPC and `settle-trip` Edge Function invocation from `src/lib/completeTrip.ts`.
- Removed direct `settle-trip` invocation from `src/pages/RideDetail.tsx`.

WebSocket:

- Removed hard-coded ngrok WebSocket fallback from `src/lib/ws.ts`.
- Replaced the unused eager hard-coded socket in `src/lib/socket.ts` with the shared authenticated backend socket wrapper.

## Remaining Supabase Mutations

Intentionally not migrated in Phase A:

- Chat and quick replies through `messages`.
- Calls through `call_sessions` and Agora/WebRTC helpers.
- Wallets, wallet transactions, deposits, withdrawals, tips, and fare adjustments.
- Notifications, including arrival notifications and ride-created notification calls.
- Admin tooling and reporting mutations.
- Profile settings, rider settings, driver onboarding, document upload metadata, student verification, favorites, places cache, fraud flags, disputes, ratings, feedback, and emergency alerts.
- Ride cancellation remains direct in existing cancel flows.
- Offer submission remains direct in driver bidding flows.
- Negotiation request/offer flows remain direct.
- Ride metadata side writes in `RideView` remain direct, including stops, preferences, luggage request, and student discount usage.

## Build Results

`npx tsc -b --noEmit`

- Passed.

`npm run build`

- Passed.
- Warnings remain:
  - Vite CJS Node API deprecation warning.
  - Tailwind ambiguous class warning for `ease-[cubic-bezier(0.32,0.72,0,1)]`.
  - Sentry auth token missing, so release and sourcemap upload were skipped.
  - Some chunks exceed 1000 kB after minification.

## Remaining Blockers

No Phase A TypeScript or production build blocker remains.

Backend contract verification is still required against the actual Go service for:

- Exact request/response shape of `POST /api/rides`.
- Completion response fields used by the driver UI.
- WebSocket event name `driver.location.update`.
- Whether the Go backend accepts WebSocket JWT by `?token=` in browser environments.

Phase B should not start until those endpoint contracts are verified in an integrated local run.
