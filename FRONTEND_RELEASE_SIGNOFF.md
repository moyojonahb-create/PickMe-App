# PickMe Frontend Release Signoff

Date: 2026-06-01

Scope: frontend production release readiness against Go Core V1.

## Release Decision

Status: RELEASE CANDIDATE APPROVED FOR STAGING / PILOT.

Public production release is approved only after the live Go Core V1 staging checklist in `FRONTEND_DEPLOYMENT_CHECKLIST.md` is completed with rider and driver test accounts.

## Contract Alignment Summary

| Area | Result | Evidence |
| --- | --- | --- |
| Go is source of truth | PASS | Ride creation, offer submission, offer acceptance, status updates, cancellation, fare update, completion, settlement, driver presence, and driver location commands route through Go APIs. |
| Supabase role | PASS | Supabase remains auth, storage, read hydration, chat/messages, analytics/admin reporting, and non-lifecycle metadata storage. |
| Canonical websocket events | PASS | Frontend handles `ride_offer`, `ride_accepted`, `driver_location`, `ride_started`, and `ride_completed`. |
| Legacy negotiation routes | PASS | `/negotiate/*` routes redirect to canonical Go-backed ride/driver surfaces. Source files remain but are no longer production entry points. |
| Active rider detail route | FIXED | `/ride/:rideId` now renders the Go-event-backed `RiderRideDetail` screen instead of the legacy Supabase-realtime `RideDetail`. |

## Canonical Event Verification

| Event | Consumer | Result |
| --- | --- | --- |
| `ride_offer` | `useRideRealtime`, `RideView`, `RiderRideDetail`, `DriverDashboard` | PASS |
| `ride_accepted` | `useRideRealtime`, active ride detail screens | PASS |
| `driver_location` | `driverLocation`, `RiderRideDetail`, `LiveTrackingPage` | PASS |
| `ride_started` | `useRideRealtime`, driver navigation lifecycle | PASS |
| `ride_completed` | `useRideRealtime`, driver navigation lifecycle, rider completion flow | PASS |

## Ride Action Routing

| Action | Frontend Route | Result |
| --- | --- | --- |
| Rider requests ride | `POST /api/rides` | PASS |
| Driver submits offer | `POST /api/rides/:rideId/offers` | PASS |
| Rider accepts offer | `POST /api/rides/:rideId/offers/:offerId/accept` | PASS |
| Driver updates ride status | `POST /api/rides/:rideId/status` | PASS |
| Rider/admin cancels ride | `POST /api/rides/:rideId/cancel` | PASS |
| Rider fare update | `POST /api/rides/:rideId/fare` | PASS |
| Driver completes ride | `POST /api/rides/:rideId/complete` | PASS |
| Settlement | `POST /api/rides/:rideId/settle` | PASS |
| Driver presence | `POST /api/drivers/me/presence` | PASS |
| Driver location fallback | `POST /api/drivers/me/location` | PASS |

## WebSocket Readiness

| Capability | Result | Evidence |
| --- | --- | --- |
| Central typed router | PASS | `src/lib/backendSocketClient.ts` owns event parsing and dispatch. |
| Reconnect | PASS | Exponential reconnect with 30s max backoff. |
| Heartbeat | PASS | Client sends `ping`, expects `pong`, closes stale socket on timeout. |
| JWT refresh | PASS | Reconnect path calls `refreshSession()` before opening a fresh socket. |
| Room join | PASS | `join_ride` sent per ride room. |
| Room rejoin | PASS | Tracked rooms are rejoined after reconnect. |
| Send queue | PASS | Short reconnect windows queue outbound messages with a bounded queue. |

## Direct Supabase Mutation Audit

No production-routed core ride lifecycle mutation remains in the canonical rider/driver flow.

Allowed Supabase writes still present:

- Chat/messages.
- Favorites.
- Driver/rider profile and settings.
- Driver registration and documents.
- Luggage, ride preferences, student discount usage, notifications, disputes, ratings, tips.
- Admin reporting/system-health records and non-lifecycle maintenance.

Known non-production legacy source:

- `src/pages/negotiate/*` still contains Supabase-native negotiation logic, but the routes are redirected and are not production entry points.

## Build Verification

Command: `npm run build`

Result: PASS.

Notes:

- Build completed successfully in 3m 31s after extending timeout.
- Non-blocking warnings remain: Vite CJS API deprecation, Tailwind ambiguous `ease-[...]` class, missing Sentry auth token for sourcemap upload, and large chunk warnings.

## Release Conditions

Before public release:

1. Complete live staging E2E with Go Core V1 websocket server.
2. Confirm environment variables: `VITE_API_URL`, `VITE_WS_URL`, Supabase URL/key, map keys, Sentry auth token if sourcemaps are required.
3. Verify mobile background/resume websocket reconnection on Android via Capacitor.
4. Verify telemetry/logging for websocket state changes and backend command failures.
5. Keep Supabase Realtime fallback enabled only for non-authoritative display/storage fallback.

## Final Signoff

Frontend code status: SIGNED OFF AS RELEASE CANDIDATE.

Production runtime status: PENDING LIVE STAGING SIGNOFF.

