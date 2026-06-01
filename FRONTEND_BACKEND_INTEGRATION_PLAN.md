# PickMe Frontend to Go Backend Integration Plan

Scope: frontend repository `koloi-ride-with-confidence`. This plan identifies direct frontend Supabase mutations and realtime/WebSocket integration points that should migrate from:

`Frontend -> Supabase`

to:

`Frontend -> Go Backend -> Supabase`

The Go backend is assumed to already expose protected HTTP APIs, authenticated WebSocket connections, ride management endpoints, and driver presence endpoints.

## Executive Summary

The frontend still performs several production-critical mutations directly against Supabase:

- Ride creation through Supabase RPCs.
- Offer submission and acceptance through direct table writes.
- Trip status transitions through direct `rides.update`.
- Driver online/offline through direct `drivers.update`.
- Driver GPS through direct `live_locations.upsert`, plus a WebSocket side-send.
- Chat/call state through direct `messages` and `call_sessions` writes.
- Wallet commands through direct Supabase RPCs.

The target architecture should keep Supabase as the database of record, but move all rider/driver lifecycle writes through the Go backend so the backend owns authorization, concurrency control, idempotency, dispatch fanout, presence, and audit logging.

## JWT Usage Standard

Every protected HTTP call should include the current Supabase access token:

`Authorization: Bearer <supabase session access_token>`

Every authenticated WebSocket connection should pass the same JWT during handshake, preferably with:

- `Authorization: Bearer <token>` header where platform allows.
- Fallback `?token=<jwt>` only for environments that cannot set headers.

The Go backend must validate the JWT, map it to `user_id`, verify role/driver state where required, and never trust `user_id`, `driver_id`, `ride_id`, fare, or location identity directly from the client.

## Core Flow Migration Matrix

| Flow | Current Flow | Target Flow | File path | Function name | Risk | Difficulty | Required Go API | JWT usage |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Cash/wallet ride creation | Frontend -> `request_cash_ride` / `request_wallet_ride` RPC -> Supabase | Frontend -> Go ride API -> Supabase RPC/table transaction | `src/lib/requestRide.ts` | `requestRide` | Critical | Medium | `POST /api/rides` | Bearer JWT |
| Rider ride request UI | Frontend state -> `requestRide` -> Supabase | Frontend state -> Go ride API -> Supabase | `src/components/ride/RideView.tsx` | ride request handler around `requestRide` | Critical | Medium | `POST /api/rides` | Bearer JWT |
| Legacy direct ride insert | Frontend -> `rides.insert` | Frontend -> Go ride API -> Supabase | `src/components/HeroSection.tsx` | location/ride request handler | Critical | Medium | `POST /api/rides` | Bearer JWT |
| Negotiation request creation | Frontend -> `ride_requests.insert` | Frontend -> Go negotiation API -> Supabase | `src/pages/negotiate/RiderRequestScreen.tsx` | request submit handler | High | Medium | `POST /api/negotiation/requests` | Bearer JWT |
| Driver offer submission | Frontend -> `offers.insert` | Frontend -> Go matching API -> Supabase | `src/lib/offerHelpers.ts` | `submitOffer` | High | Medium | `POST /api/rides/{rideId}/offers` | Bearer JWT |
| Negotiation offer submission | Frontend -> `ride_offers.insert` | Frontend -> Go negotiation API -> Supabase | `src/pages/negotiate/RiderOffersScreen.tsx` | offer submit handler | High | Medium | `POST /api/negotiation/requests/{id}/offers` | Bearer JWT |
| Alternate driver offer upsert | Frontend -> `ride_offers.upsert` | Frontend -> Go negotiation API -> Supabase | `src/pages/negotiate/DriverRequestsScreen.tsx` | driver offer handler | High | Medium | `PUT /api/negotiation/requests/{id}/offer` | Bearer JWT |
| Offer acceptance helper | Frontend -> `offers.update`, `rides.update`, competing `offers.update` | Frontend -> Go atomic accept endpoint -> Supabase transaction | `src/lib/offerHelpers.ts` | `acceptOffer` | Critical | Medium | `POST /api/rides/{rideId}/offers/{offerId}/accept` | Bearer JWT |
| Ride detail direct offer acceptance | Frontend -> direct offer/ride updates | Frontend -> Go atomic accept endpoint -> Supabase transaction | `src/pages/RideDetail.tsx` | local `acceptOffer` | Critical | Medium | `POST /api/rides/{rideId}/offers/{offerId}/accept` | Bearer JWT |
| Rider ride detail offer acceptance | Frontend -> `acceptOffer` helper | Frontend -> Go atomic accept endpoint | `src/pages/RiderRideDetail.tsx` | `handleAcceptOffer` | Critical | Medium | `POST /api/rides/{rideId}/offers/{offerId}/accept` | Bearer JWT |
| Negotiation offer acceptance | Frontend -> `ride_requests.update`, `ride_offers.update`, competing offers update | Frontend -> Go atomic negotiation accept endpoint | `src/pages/negotiate/RiderOffersScreen.tsx` | accept offer handler | Critical | Medium | `POST /api/negotiation/requests/{id}/offers/{offerId}/accept` | Bearer JWT |
| Driver enroute/arrived/start status | Frontend -> `rides.update` | Frontend -> Go trip state endpoint -> Supabase transaction | `src/pages/DriverDashboard.tsx` | `updateTripStatus` | Critical | Low-Medium | `POST /api/rides/{rideId}/status` | Bearer JWT |
| Driver live nav start/arrived | Frontend -> `rides.update` | Frontend -> Go trip state endpoint | `src/components/driver/DriverLiveNav.tsx` | `handleGo`, `handleArrived` | Critical | Low-Medium | `POST /api/rides/{rideId}/status` | Bearer JWT |
| Full screen nav status | Frontend -> `rides.update` | Frontend -> Go trip state endpoint | `src/components/driver/FullScreenNavigation.tsx` | `handleStatusUpdate` | Critical | Low-Medium | `POST /api/rides/{rideId}/status` | Bearer JWT |
| Trip completion | Frontend -> `complete_trip_with_commission` RPC and `settle-trip` Edge Function | Frontend -> Go complete endpoint -> Supabase RPC/transaction | `src/lib/completeTrip.ts` | `completeTrip`, `settleTrip` | Critical | Medium | `POST /api/rides/{rideId}/complete` | Bearer JWT |
| Driver dashboard completion | Frontend -> `completeTrip` | Frontend -> Go complete endpoint | `src/pages/DriverDashboard.tsx` | `handleCompleteTrip` | Critical | Medium | `POST /api/rides/{rideId}/complete` | Bearer JWT |
| Navigation completion | Frontend -> `completeTrip` | Frontend -> Go complete endpoint | `src/components/driver/DriverLiveNav.tsx`, `src/components/driver/FullScreenNavigation.tsx` | `handleComplete` | Critical | Medium | `POST /api/rides/{rideId}/complete` | Bearer JWT |
| Rider-side completion trigger | Frontend -> `completeTrip` | Frontend -> Go complete endpoint with role rules | `src/pages/RiderRideDetail.tsx` | completion action block | High | Medium | `POST /api/rides/{rideId}/complete` | Bearer JWT |
| Ride cancellation | Frontend -> `rides.update({status:'cancelled'})` | Frontend -> Go cancellation endpoint -> Supabase | Multiple files listed below | cancel handlers | High | Low-Medium | `POST /api/rides/{rideId}/cancel` | Bearer JWT |
| Driver online/offline | Frontend -> `can_driver_operate` RPC, then `drivers.update` | Frontend -> Go presence endpoint -> Supabase | `src/pages/DriverDashboard.tsx` | `toggleOnline` | Critical | Medium | `POST /api/drivers/me/presence` | Bearer JWT |
| Driver GPS update | Frontend -> `live_locations.upsert` + Go WS best-effort send | Frontend -> authenticated Go WS / location API -> Supabase | `src/lib/driverLocation.ts` | `updateDriverLocation` | Critical | Medium | `WS driver.location.update` or `POST /api/drivers/me/location` | WS JWT or Bearer JWT |
| WebSocket connection | Frontend -> unauthenticated/fallback WS URL | Frontend -> authenticated Go WS | `src/lib/ws.ts`, `src/lib/socket.ts` | `getWS`, module socket | Critical | Low-Medium | `GET /ws` | JWT at handshake |
| Live tracking WS receive | Frontend listens to Go WS and Supabase Realtime | Frontend uses authenticated Go WS for live ride channel | `src/pages/LiveTrackingPage.tsx` | WS effect | High | Medium | `WS ride.subscribe`, `driver.location` | JWT at handshake |
| Chat message send | Frontend -> `messages.insert` | Frontend -> Go comms API -> Supabase | `src/components/ride/RideCommunication.tsx`, `src/pages/RideDetail.tsx` | `sendMessage`, `sendQuickReply` | High | Low-Medium | `POST /api/rides/{rideId}/messages` | Bearer JWT |
| Call session lifecycle | Frontend -> `call_sessions.insert/update`, `agora-token` function | Frontend -> Go call API -> Supabase + token service | `src/hooks/useAgoraCall.ts`, `src/hooks/useWebRTCCall.ts` | `startCall`, `answerCall`, `declineCall`, `endCall` | High | Medium | `POST /api/rides/{rideId}/calls`, `POST /api/calls/{id}/answer`, `POST /api/calls/{id}/end`, `POST /api/calls/{id}/token` | Bearer JWT |
| Wallet payment/transfer/withdrawal | Frontend -> Supabase wallet RPCs | Frontend -> Go wallet API -> Supabase RPC/ledger | `src/lib/walletPayments.ts` | `payRideFromWallet`, `transferFunds`, `requestWithdrawal` | Critical | Medium | `/api/wallet/*` | Bearer JWT |

## Ride Creation Flows

### `src/lib/requestRide.ts` - `requestRide`

Current Flow:

`RideView -> requestRide -> supabase.rpc('request_cash_ride'|'request_wallet_ride') -> rides`

Target Flow:

`RideView -> POST /api/rides -> Go validates JWT, fare, route, wallet/cash method -> Supabase transaction`

Risk level: Critical.

Migration difficulty: Medium.

Required API endpoint: `POST /api/rides`.

Required JWT token usage: Supabase access token as Bearer token.

Notes:

- Preserve offline queue behavior, but replay must call Go instead of Supabase directly.
- Go should own fare validation, wallet preauthorization/hold, notification dispatch, and ride event emission.

### `src/components/ride/RideView.tsx` - Ride request handler

Current Flow:

`Frontend -> requestRide -> Supabase`, then additional direct inserts for `student_discount_usage`, `ride_stops`, `ride_preferences`, `notifications`, and `luggage_requests`.

Target Flow:

`Frontend -> POST /api/rides` with optional stops/preferences/luggage/passenger metadata -> `Go -> Supabase`.

Risk level: Critical.

Migration difficulty: Medium-High because related metadata is currently saved after ride creation.

Required API endpoint: `POST /api/rides`.

Required JWT token usage: Bearer JWT.

### `src/components/HeroSection.tsx` - Direct `rides.insert`

Current Flow:

`Frontend -> rides.insert`.

Target Flow:

`Frontend -> POST /api/rides`.

Risk level: Critical because it bypasses the fixed server-side ride creation RPC path.

Migration difficulty: Medium.

Required API endpoint: `POST /api/rides`.

Required JWT token usage: Bearer JWT.

### `src/pages/negotiate/RiderRequestScreen.tsx` - Negotiation request

Current Flow:

`Frontend -> ride_requests.insert`.

Target Flow:

`Frontend -> POST /api/negotiation/requests -> Go -> Supabase`.

Risk level: High.

Migration difficulty: Medium.

Required API endpoint: `POST /api/negotiation/requests`.

Required JWT token usage: Bearer JWT.

## Ride Acceptance Flows

### `src/lib/offerHelpers.ts` - `acceptOffer`

Current Flow:

`Frontend -> offers.update(accepted) + rides.update(driver_id,status) + offers.update(rejected competing)`

Target Flow:

`Frontend -> POST /api/rides/{rideId}/offers/{offerId}/accept -> Go SELECT FOR UPDATE -> Supabase`.

Risk level: Critical.

Migration difficulty: Medium.

Required API endpoint: `POST /api/rides/{rideId}/offers/{offerId}/accept`.

Required JWT token usage: Bearer JWT from rider.

### `src/pages/RideDetail.tsx` - local `acceptOffer`

Current Flow:

Directly fetches driver row, accepts offer, rejects competing offers, assigns ride.

Target Flow:

Same Go atomic accept endpoint.

Risk level: Critical.

Migration difficulty: Medium.

Required API endpoint: `POST /api/rides/{rideId}/offers/{offerId}/accept`.

Required JWT token usage: Bearer JWT.

### `src/pages/RiderRideDetail.tsx` - `handleAcceptOffer`

Current Flow:

Calls `acceptOffer` helper.

Target Flow:

Call Go accept endpoint.

Risk level: Critical.

Migration difficulty: Low after helper migration.

Required API endpoint: `POST /api/rides/{rideId}/offers/{offerId}/accept`.

Required JWT token usage: Bearer JWT.

### `src/pages/negotiate/RiderOffersScreen.tsx` - negotiation accept

Current Flow:

`Frontend -> ride_requests.update(accepted) + ride_offers.update(accepted) + competing ride_offers.update(rejected)`.

Target Flow:

`Frontend -> POST /api/negotiation/requests/{requestId}/offers/{offerId}/accept`.

Risk level: Critical.

Migration difficulty: Medium.

Required JWT token usage: Bearer JWT.

## Ride Start and Status Transition Flows

### `src/pages/DriverDashboard.tsx` - `updateTripStatus`

Current Flow:

`Frontend -> rides.update({ status: nextStatus })`, plus direct notification insert for arrival.

Target Flow:

`Frontend -> POST /api/rides/{rideId}/status`, body `{ status, expectedStatus }`.

Risk level: Critical.

Migration difficulty: Low-Medium.

Required API endpoint: `POST /api/rides/{rideId}/status`.

Required JWT token usage: Bearer JWT from assigned driver.

### `src/components/driver/DriverLiveNav.tsx` - `handleGo`, `handleArrived`

Current Flow:

Direct `rides.update` to `in_progress` and `arrived`.

Target Flow:

Go trip status endpoint validates assigned driver and allowed transition.

Risk level: Critical.

Migration difficulty: Low-Medium.

Required API endpoint: `POST /api/rides/{rideId}/status`.

Required JWT token usage: Bearer JWT.

### `src/components/driver/FullScreenNavigation.tsx` - `handleStatusUpdate`

Current Flow:

Direct `rides.update`, direct arrival notification insert.

Target Flow:

Go trip status endpoint emits notification/event.

Risk level: Critical.

Migration difficulty: Low-Medium.

Required API endpoint: `POST /api/rides/{rideId}/status`.

Required JWT token usage: Bearer JWT.

## Ride Completion Flows

### `src/lib/completeTrip.ts` - `completeTrip`, `settleTrip`

Current Flow:

`Frontend -> rides.select -> complete_trip_with_commission RPC -> settle-trip Edge Function`.

Target Flow:

`Frontend -> POST /api/rides/{rideId}/complete -> Go validates caller, ride state, idempotency -> Supabase transaction/RPC -> settlement`.

Risk level: Critical.

Migration difficulty: Medium.

Required API endpoint: `POST /api/rides/{rideId}/complete`.

Required JWT token usage: Bearer JWT.

### Completion callers

Current callers:

- `src/pages/DriverDashboard.tsx` - `handleCompleteTrip`.
- `src/components/driver/DriverLiveNav.tsx` - `handleComplete`.
- `src/components/driver/FullScreenNavigation.tsx` - `handleComplete`.
- `src/pages/RiderRideDetail.tsx` - rider-side completion action block.

Target Flow:

All callers use one Go completion endpoint.

Risk level: Critical.

Migration difficulty: Low once `completeTrip` wrapper is migrated.

## Driver Online/Offline Flows

### `src/pages/DriverDashboard.tsx` - `toggleOnline`

Current Flow:

`Frontend -> can_driver_operate RPC -> drivers.update({ is_online }) -> local GPS timer starts/stops`.

Target Flow:

`Frontend -> POST /api/drivers/me/presence`, body `{ online: true|false } -> Go checks driver approval, wallet, fatigue, identity selfie status -> Supabase`.

Risk level: Critical.

Migration difficulty: Medium.

Required API endpoint: `POST /api/drivers/me/presence`.

Required JWT token usage: Bearer JWT.

### Admin force offline

Current Flow:

- `src/pages/admin/AdminDashboard.tsx` calls `VITE_SUPABASE_URL/functions/v1/admin-api?action=force_driver_offline`.
- `src/lib/ramzActions.ts` directly updates `drivers.is_online=false` for stale/fatigued drivers.

Target Flow:

`Frontend/Admin -> POST /api/admin/drivers/{driverId}/force-offline -> Go -> Supabase`.

Risk level: High.

Migration difficulty: Medium.

Required JWT token usage: Bearer JWT with admin role verified by Go.

## Driver Location Update Flows

### `src/pages/DriverDashboard.tsx` - `startLocationTracking`

Current Flow:

Browser geolocation every 10 seconds -> `updateDriverLocation`.

Target Flow:

Browser geolocation -> authenticated Go WebSocket `driver.location.update` or `POST /api/drivers/me/location`.

Risk level: Critical.

Migration difficulty: Medium.

Required API endpoint: `WS driver.location.update` preferred, fallback `POST /api/drivers/me/location`.

Required JWT token usage: WebSocket handshake JWT or Bearer JWT.

### `src/lib/driverLocation.ts` - `updateDriverLocation`

Current Flow:

`Frontend -> live_locations.upsert`, then `getWS().send(driver_location)`.

Target Flow:

`Frontend -> Go location ingest -> Go validates driver identity and impossible jumps -> Supabase latest location + dispatch fanout`.

Risk level: Critical.

Migration difficulty: Medium.

Required API endpoint: `WS driver.location.update`.

Required JWT token usage: authenticated WebSocket.

## WebSocket Connection Inventory

| File | Current usage | Target | Risk | Difficulty | JWT usage |
| --- | --- | --- | --- | --- | --- |
| `src/lib/ws.ts` | `VITE_WS_URL` or hard-coded fallback, singleton `new WebSocket(WS_URL)` | `createAuthenticatedWS(token)` against Go `/ws` | Critical | Low-Medium | JWT at handshake |
| `src/lib/socket.ts` | Eager hard-coded `new WebSocket("wss://swell-pouch-delegator.ngrok-free.dev/ws")` | Remove or replace with shared authenticated WS client | Critical | Low | JWT at handshake |
| `src/lib/driverLocation.ts` | Sends `driver_location` JSON if WS open | Use typed authenticated message after handshake | Critical | Medium | WS JWT |
| `src/pages/LiveTrackingPage.tsx` | Uses `getWS()` and listens for `driver_location` | Subscribe to ride/driver channel on authenticated Go WS | High | Medium | WS JWT |

## `VITE_WS_URL` Usage

| File | Current usage | Target |
| --- | --- | --- |
| `src/lib/ws.ts` | `const WS_URL = import.meta.env.VITE_WS_URL || hard-coded ngrok` | Require `VITE_GO_BACKEND_WS_URL` or `VITE_WS_URL` in production; no hard-coded fallback |

## `VITE_SUPABASE_URL` Usage

| File | Current usage | Target |
| --- | --- | --- |
| `src/integrations/supabase/client.ts` | Creates Supabase browser client | Keep for auth/session and read-only Realtime during transition |
| `src/lib/supabaseClient.ts` | Exports Supabase URL/key | Keep for Supabase auth client; avoid for protected writes |
| `src/lib/geo_osm.ts` | Fetches `nominatim-search` Edge Function | Migrate to `GET /api/geo/search` if Go owns geocoding |
| `src/components/FavoritesSheet.tsx` | Fetches `nominatim-search` Edge Function | Migrate to `GET /api/geo/geocode` |
| `src/hooks/useAdminAuth.tsx` | Fetches `admin-api?action=verify_admin` | Migrate to `GET /api/admin/me` |
| `src/hooks/useGooglePlacesAutocomplete.ts` | Fetches `mapbox-search` Edge Function | Migrate to `GET /api/places/search` |
| `src/pages/admin/AdminDashboard.tsx` | Fetches `admin-api` actions including force offline | Migrate to `/api/admin/*` |
| `src/hooks/useSendNotification.ts` | Fetches `send-notification` | Migrate to Go notification API |
| `src/pages/Signup.tsx` | Fetches `twilio-otp` | Migrate to Go auth/OTP API or keep Supabase Edge during auth transition |
| `src/pages/StudentVerificationPage.tsx` | Fetches `verify-student` | Migrate to `POST /api/student-verification` |
| `src/hooks/useWalletPin.ts` | Fetches `wallet-pin` | Migrate to `POST /api/wallet/pin/*` |
| `src/lib/requestRide.ts` | Fetches `send-notification` after ride creation | Go ride creation should emit notification itself |
| `src/components/ride/RideView.tsx` | Fetches `sms-invite` | Migrate to Go SMS invite endpoint |
| `src/test/walletRlsLive.test.ts` | Uses Supabase env for tests | Keep as integration test config or replace with Go API tests |

## Supabase Mutation Inventory - Frontend Production Code

Core ride and matching:

- `src/lib/requestRide.ts`: `request_cash_ride`, `request_wallet_ride`, `send-notification`.
- `src/components/HeroSection.tsx`: `rides.insert`.
- `src/components/ride/RideView.tsx`: `student_discount_usage.insert`, `ride_stops.insert`, `ride_preferences.insert`, `notifications.insert`, `luggage_requests.insert`, `rides.update(cancelled)`.
- `src/lib/offerHelpers.ts`: `offers.insert`, `offers.update(rejected)`, `offers.update(accepted)`, `rides.update(accepted)`, competing `offers.update(rejected)`.
- `src/pages/RideDetail.tsx`: `offers.update`, `rides.update`, `messages.insert`, ride cancellation.
- `src/pages/RiderRideDetail.tsx`: `rides.update(fare)`, `acceptOffer`, ride cancellation, favorite location insert.
- `src/pages/negotiate/RiderRequestScreen.tsx`: `ride_requests.insert`.
- `src/pages/negotiate/RiderOffersScreen.tsx`: `ride_offers.insert`, `ride_requests.update`, `ride_offers.update`.
- `src/pages/negotiate/DriverRequestsScreen.tsx`: `ride_offers.upsert`.

Trip lifecycle:

- `src/pages/DriverDashboard.tsx`: `drivers.update(is_online)`, `rides.update(status)`, `notifications.insert`, `completeTrip`.
- `src/components/driver/DriverLiveNav.tsx`: `rides.update(in_progress|arrived)`, `completeTrip`.
- `src/components/driver/FullScreenNavigation.tsx`: `rides.update(status)`, `notifications.insert`, `completeTrip`.
- `src/lib/completeTrip.ts`: `complete_trip_with_commission`, `settle-trip`.
- `src/components/ride/CancellationPolicy.tsx`: `cancellation_fees.insert`, `rides.update(cancelled,cancellation_fee)`.

Driver onboarding/profile:

- `src/components/driver/DriverApplicationForm.tsx`: `drivers.insert`.
- `src/components/driver/DriverRegistrationWizard.tsx`: `drivers.insert`, `driver_documents.insert`.
- `src/components/driver/DriverReviewForm.tsx`: `drivers.upsert`, `drivers.update`, `drivers.insert`.
- `src/components/driver/DocumentUpload.tsx`: `driver_documents.insert`.
- `src/components/driver/DriverAvatarUpload.tsx`: `drivers.update(avatar_url)`.
- `src/components/settings/DriverSettingsPanel.tsx`: `drivers.update`.
- `src/hooks/useFatigueMonitor.ts`: `driver_sessions.insert`.

Location and presence:

- `src/lib/driverLocation.ts`: `live_locations.upsert`.
- `src/components/admin/LoadPulsePanel.tsx`: `live_locations.delete`.
- `src/lib/ramzActions.ts`: `drivers.update(is_online=false)`, `driver_sessions.update`, `live_locations.delete`.

Wallet and payments:

- `src/lib/walletPayments.ts`: `pay_ride_from_wallet`, `transfer_funds`, `request_withdrawal`, admin withdrawal RPCs, account lookup RPC.
- `src/hooks/useWallet.ts`: `wallets.insert`, `wallets.update`, `wallet_transactions.insert`.
- `src/components/wallet/DepositModal.tsx`: deposit request insert.
- `src/pages/DriverDepositPage.tsx`: `deposit_requests.insert`.
- `src/pages/admin/AdminDepositsPage.tsx`: `admin_approve_deposit`.
- `src/pages/admin/AdminRiderDepositsPage.tsx`: `admin_approve_rider_deposit`, rider deposit rejection update.
- `src/pages/admin/AdminWalletDashboard.tsx`: admin wallet RPCs.
- `src/pages/admin/AdminRatePage.tsx`: `admin_set_fx_rate`.
- `src/components/ride/TippingModal.tsx`: `tips.insert`.
- `src/components/luggage/FareAdjustmentModal.tsx`: `fare_adjustments.update`, `rides.update(fare)`.
- `src/components/luggage/LuggagePreviewSheet.tsx`: `fare_adjustments.insert`.

Communication and safety:

- `src/components/ride/RideCommunication.tsx`: `messages.insert`.
- `src/hooks/useAgoraCall.ts`: `agora-token`, `call_sessions.insert`, `call_sessions.update`.
- `src/hooks/useWebRTCCall.ts`: `call_sessions.insert`, `call_sessions.update`.
- `src/components/ride/EmergencyButton.tsx`: `emergency_alerts.insert`.
- `src/components/ride/DisputeForm.tsx`: `disputes.insert`.
- `src/components/ride/DriverRatingModal.tsx`: `driver_ratings.insert`.
- `src/components/driver/DriverFeedback.tsx`: `driver_feedback.insert`.
- `src/lib/rideSignals.ts`: Supabase broadcast channel for rider-coming signal.

User profile, favorites, preferences, notifications:

- `src/components/auth/AuthForm.tsx`: profile update.
- `src/pages/Auth.tsx`: profile phone update.
- `src/pages/Signup.tsx`: profile phone update and OTP Edge Function fetches.
- `src/pages/EditProfile.tsx`: profile update.
- `src/pages/RiderProfile.tsx`: profile avatar update.
- `src/components/FavoritesSheet.tsx`: favorite location insert/delete.
- `src/components/NotificationCenter.tsx`: notifications mark read updates.
- `src/components/settings/RiderPreferencesSettings.tsx`: rider preferences update.
- `src/components/settings/RiderSettingsPanel.tsx`: rider settings upsert.
- `src/lib/fraudDetection.ts`: fraud flag insert.
- `src/lib/placeCache.ts`: places cache insert.
- `src/lib/push.ts`: push Edge Function calls.

Admin and internal tooling:

- `src/pages/admin/AdminDrivers.tsx`: driver status update.
- `src/pages/admin/AdminDriverDetail.tsx`: driver status/details updates.
- `src/pages/admin/AdminDisputes.tsx`: dispute updates.
- `src/pages/admin/AdminLandmarks.tsx`: landmark insert/update/delete.
- `src/pages/admin/AdminPromos.tsx`: promo insert/update/delete.
- `src/pages/admin/AdminStudents.tsx`: student profile update and admin list RPC.
- `src/pages/admin/AdminSystemHealth.tsx`: system error log insert/update.
- `src/pages/admin/AdminTownPricing.tsx`: town pricing update.
- `src/pages/admin/AdminTrips.tsx`: ride cancellation update.
- `src/pages/admin/ImportOsmPlaces.tsx`: import Edge Function.
- `src/components/admin/RamzCodeScanPanel.tsx`, `src/lib/ramzAudit.ts`, `src/lib/ramzActions.ts`, `src/lib/ramzCodeScan.ts`, `src/lib/ramzPatch.ts`: internal RAMZ/maintenance mutations and Edge Function calls.

## Migration Priority

### Priority 0 - Must route through Go before public beta

1. Ride creation.
2. Offer acceptance.
3. Trip status transitions.
4. Trip completion/payment settlement.
5. Driver online/offline.
6. Driver location ingest.
7. Wallet commands.

### Priority 1 - Should route through Go during internal pilot hardening

1. Offer submission.
2. Ride cancellation.
3. Chat message send.
4. Call session lifecycle.
5. Notifications generated by lifecycle events.

### Priority 2 - Can remain Supabase temporarily

1. Read-only queries.
2. Admin reporting reads.
3. Favorite locations.
4. Profile edits.
5. Static/cached place search, if not security-sensitive.

## Frontend Migration Pattern

1. Add `src/lib/backendClient.ts`.
2. Implement `getAuthToken()` using `supabase.auth.getSession()`.
3. Add typed helpers:
   - `backendPost(path, body)`
   - `backendPatch(path, body)`
   - `connectBackendWs({ token })`
4. Replace direct lifecycle mutations with backend helpers.
5. Keep Supabase reads and Realtime subscriptions temporarily.
6. After Go emits targeted WebSocket events, replace broad Supabase Realtime listeners in ride/driver flows.

## Required Go Endpoint Summary

Ride:

- `POST /api/rides`
- `GET /api/rides/{rideId}`
- `POST /api/rides/{rideId}/cancel`
- `POST /api/rides/{rideId}/status`
- `POST /api/rides/{rideId}/complete`

Matching:

- `GET /api/drivers/me/open-rides`
- `POST /api/rides/{rideId}/offers`
- `POST /api/rides/{rideId}/offers/{offerId}/accept`
- `POST /api/rides/{rideId}/offers/{offerId}/decline`

Negotiation:

- `POST /api/negotiation/requests`
- `POST /api/negotiation/requests/{requestId}/offers`
- `POST /api/negotiation/requests/{requestId}/offers/{offerId}/accept`

Driver:

- `GET /api/drivers/me`
- `POST /api/drivers/me/presence`
- `POST /api/drivers/me/location`

Wallet:

- `POST /api/wallet/pay-ride`
- `POST /api/wallet/transfers`
- `POST /api/wallet/withdrawals`
- `POST /api/wallet/pin/*`

Communication:

- `POST /api/rides/{rideId}/messages`
- `POST /api/rides/{rideId}/calls`
- `POST /api/calls/{callId}/answer`
- `POST /api/calls/{callId}/decline`
- `POST /api/calls/{callId}/end`
- `POST /api/calls/{callId}/token`

WebSocket:

- `GET /ws`
- Event: `driver.location.update`
- Event: `ride.subscribe`
- Event: `ride.status.updated`
- Event: `ride.offer.created`
- Event: `ride.offer.accepted`
- Event: `message.created`

## Acceptance Criteria

The migration is complete when:

- No rider/driver production lifecycle writes call `.insert`, `.update`, `.delete`, `.upsert`, or mutating `supabase.rpc` directly from the browser.
- All critical writes include Bearer JWT to the Go backend.
- Go validates role, ride membership, driver assignment, status transition, fare, and idempotency.
- WebSocket connections authenticate before any subscription or location update.
- Supabase browser client remains only for auth, safe reads, and temporary Realtime subscriptions.
- Public beta build has no hard-coded WebSocket fallback URL.
