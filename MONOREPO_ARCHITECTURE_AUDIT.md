# Full PickMe Monorepo Architecture Audit

Date: 2026-06-14

Scope: Local repository audit of the PickMe monorepo, including frontend, backend, Supabase functions/migrations/config, docs, root config, and environment examples. No source code was changed as part of this audit.

## Executive Summary

PickMe is now a transitional monorepo:

- Frontend remains at the repository root as a Vite React TypeScript app.
- Go backend lives under `backend/` and exposes REST, WebSocket, wallet, dispatch, reputation, payment, and admin reporting routes.
- Supabase remains a major runtime dependency for Auth, Postgres, Storage, Edge Functions, Realtime, and several direct frontend data flows.
- Redis is supported by the Go backend for driver presence/location hot state, but not for pub/sub, queues, or locks.
- Lovable remains present in auth integration, development tooling, README metadata, and AI Gateway Edge Functions.

The architecture is functional but still hybrid. The most important risks are duplicated realtime systems, direct frontend Supabase writes, overlapping Supabase Edge Function and Go backend responsibilities, and frontend/backend route naming mismatches.

## 1. Go Backend

The Go backend is a Fiber service under `backend/`. It uses PostgreSQL through `pgxpool`, Supabase JWT verification, admin middleware, optional Redis for driver geo state, a process-local WebSocket manager, and domain packages under `backend/internal/`.

### Route Groups

Core:

- `GET /`
- `GET /health`
- `GET /health/redis`
- `GET /test-db`

WebSocket:

- `/ws`

Ride routes:

- `GET /rides`
- `POST /rides/request`
- `POST /rides/:id/accept`
- `POST /rides/:id/start`
- `POST /rides/:id/complete`
- `POST /rides/join-room`
- `POST /api/rides`
- `POST /api/rides/:rideId/offers`
- `GET /api/rides/:rideId/offers`
- `POST /api/rides/:rideId/offers/:offerId/accept`
- `POST /api/rides/:rideId/offers/:offerId/reject`
- `POST /api/rides/:rideId/status`
- `POST /api/rides/:rideId/complete`
- `POST /api/rides/:rideId/settle`

Driver routes:

- `POST /drivers/location`
- `POST /drivers/online`
- `POST /drivers/heartbeat`
- `POST /drivers/offline`
- `GET /drivers/nearby`
- `POST /api/drivers/me/presence`
- `POST /api/drivers/me/location`

Wallet public routes:

- `POST /api/wallets/deposits`
- `GET /api/wallets/deposits/:id`
- `GET /api/wallets/me`
- `GET /api/wallets/me/transactions`
- `POST /api/wallets/withdrawals`
- `GET /api/wallets/withdrawals/:id`
- `POST /api/wallets/authorize-ride`
- `POST /api/wallets/capture-ride`
- `POST /api/wallets/release-ride`
- `GET /api/wallet/me`
- `GET /api/wallet/transactions`
- `GET /api/wallet/deposits`
- `POST /api/wallet/deposit`
- `POST /api/wallet/rider-deposits`
- `POST /api/wallet/withdraw`
- `POST /api/wallet/withdrawals`
- `POST /api/wallet/transfer`
- `POST /api/wallet/pay`
- `POST /api/wallet/pay-ride`
- `POST /api/wallet/pin`
- `GET /api/wallet/lookup-user`
- `POST /api/wallet/lookup-user`
- `GET /api/wallet/driver/summary`
- `GET /api/wallet/driver/earnings`
- `GET /api/rides/:tripId/settlement`

Wallet/admin finance routes:

- `GET /admin/wallets/deposits/pending`
- `POST /admin/wallets/deposits/:id/approve`
- `POST /admin/wallets/deposits/:id/reject`
- `GET /admin/wallets/withdrawals/pending`
- `POST /admin/wallets/withdrawals/:id/approve`
- `POST /admin/wallets/withdrawals/:id/reject`
- `GET /admin/wallets/admin-actions`
- `GET /admin/wallets/reconciliation/summary`
- `GET /admin/wallets/reconciliation/drift`
- `POST /admin/wallets/reconciliation/run`
- `GET /admin/wallets/authorizations/open`
- `GET /admin/wallets/authorizations/expired`
- `GET /admin/wallets/shadow-settlements/summary`
- `GET /admin/wallets/shadow-settlements/recent`
- `GET /admin/wallets/shadow-settlements/failed`
- `GET /admin/wallets/active-settlements/summary`
- `GET /admin/wallets/driver-liabilities`
- `GET /admin/wallets/active-settlements/failed`
- Many `/admin/finance/...` operational readiness, recovery, pilot, close, governance, release, exception, and control-room reports.

Payments routes:

- `POST /api/payments/onemoney/deposits`
- `POST /api/payments/onemoney/callback`
- `POST /api/payments/ecocash/deposits`
- `POST /api/payments/ecocash/callback`
- `POST /api/payments/innbucks/deposits`
- `POST /api/payments/innbucks/callback`
- `POST /api/payments/paypal/deposits`
- `POST /api/payments/paypal/callback`
- `POST /api/payments/cards/deposits`
- Admin payment summary, transaction, reconciliation, and failure routes for OneMoney, EcoCash, Innbucks, PayPal, and card payments.

Dispatch and reputation admin routes:

- `/admin/dispatch/shadow/...`
- `/admin/reputation/...`

### Backend Components

| Feature | File | Purpose |
|---|---|---|
| Server bootstrap | `backend/cmd/server/main.go` | Loads config, creates DB/Redis clients, wires middleware, services, routes, workers, and WebSocket handler. |
| Config | `backend/internal/config/config.go` | Reads backend, auth, Redis, dispatch, wallet, and payment env vars. Requires `DATABASE_URL`. |
| Database | `backend/internal/database/*` | PostgreSQL pool setup, health check, and test handler. |
| Supabase JWT auth | `backend/internal/auth/supabase_jwt.go` | Verifies Supabase JWTs for API and WebSocket auth. |
| Authorization service | `backend/internal/authz/*` | Looks up user roles and supports admin checks. |
| Middleware | `backend/internal/middleware/*` | Request ID, recover, timeout, rate limit, CORS, observability, admin-only enforcement. |
| Rides handler | `backend/internal/rides/handler.go` | Ride request, offer, accept/reject, status, complete, settle, and WebSocket event production. |
| Rides repository | `backend/internal/rides/repository.go` | Postgres persistence for rides, offers, and status transitions. |
| Ride money model | `backend/internal/rides/money_json.go`, `backend/internal/rides/types.go` | Normalizes decimal USD money payloads and avoids exposing new minor-unit fields to frontend. |
| Drivers handler | `backend/internal/drivers/handler.go` | Driver presence, location, heartbeat, nearby admin lookup, and compatibility API routes. |
| Geo service | `backend/internal/geo/service.go` | Writes driver presence/location hot state to Redis and queries nearby drivers. |
| Redis client | `backend/internal/redis/client.go` | Minimal Redis RESP client, pooling, GEO, hash, expiry, ping, TLS/auth support. |
| Dispatch reporting | `backend/internal/dispatch/reporting.go` | Admin shadow dispatch reports. |
| Dispatch geo provider | `backend/internal/dispatch/geo_provider.go` | Reads Redis geo candidates for dispatch shadow logic. |
| Reputation reporting | `backend/internal/reputation/reporting.go` | Admin driver reputation and event reports. |
| Reputation calibration | `backend/internal/reputation/calibration_reporting.go` | Admin score distribution and calibration analysis. |
| Wallet HTTP | `backend/internal/wallet/admin_http.go` | Wallet public compatibility routes plus admin finance/wallet operations. |
| Wallet flows | `backend/internal/wallet/*flow*.go`, `backend/internal/wallet/service*.go` | Deposit, withdrawal, transfer, ride authorization, capture/release, recovery and governance flows. |
| Wallet reporting | `backend/internal/wallet/reporting.go` | Admin reports for settlement, liabilities, pilot, finance, recovery, and readiness. |
| Wallet jobs | `backend/internal/wallet/financial_jobs.go` | Financial job registration/execution helpers. |
| Payments HTTP | `backend/internal/payments/http.go` | Payment provider deposit and callback endpoints. |
| Payment providers | `backend/internal/payments/*` | OneMoney, EcoCash, Innbucks, PayPal, card payment abstractions and reports. |
| WebSocket handler | `backend/internal/websocket/handler.go` | Accepts WebSocket clients, joins ride rooms, echoes/broadcasts events. |
| WebSocket manager | `backend/internal/websocket/manager.go` | Process-local room and client registry, broadcast and send loops. |
| WebSocket registries | `backend/internal/websocket/registry.go` | Tracks rider and driver socket connections by user ID. |
| WebSocket auth | `backend/internal/websocket/auth.go`, `authorizer.go` | Extracts tokens, validates Supabase JWTs, authorizes ride rooms and driver registration. |

## 2. Supabase Usage

Supabase is still deeply embedded in the app. It provides Auth, Postgres direct access, Edge Functions, Storage, and Realtime. The frontend has a Go client now, but many non-wallet flows still read and write Supabase tables directly.

### Supabase Clients

| Feature | File | Operation | Table/RPC | Status |
|---|---|---|---|---|
| Browser Supabase client | `src/integrations/supabase/client.ts` | `createClient` | Supabase Auth/Postgres/Storage/Realtime | Auth |
| Client re-export | `src/lib/supabaseClient.ts` | Re-export | Supabase client | Auth |
| Edge Function clients | `supabase/functions/*/index.ts` | `createClient` | Supabase service/anon clients | Business Logic |
| Auth session for Go calls | `src/lib/goBackendClient.ts` | `supabase.auth.getSession()` | Access token | Auth |
| WebSocket token fetch | `src/lib/goRideSocket.ts` | `supabase.auth.getSession()` | Access token | Auth |

### Frontend Database, RPC, Storage, and Realtime Usage

| Feature | File | Operation | Table/RPC | Status |
|---|---|---|---|---|
| Driver bootstrap | `src/App.tsx` | Read | `drivers` | Read-only |
| Auth profile write | `src/components/auth/AuthForm.tsx`, `src/pages/Auth.tsx`, `src/pages/Signup.tsx` | Update/insert | `profiles` | Write |
| Phone OTP | `src/components/auth/PhoneOtpVerification.tsx` | Edge Function invoke | `twilio-otp` | Auth |
| Driver application | `src/components/driver/DriverApplicationForm.tsx`, `DriverRegistrationWizard.tsx` | Insert | `drivers`, `driver_documents` | Write |
| Driver documents | `src/components/driver/DocumentUpload.tsx`, `DriverRegistrationWizard.tsx` | Storage upload, insert | `driver-documents`, `driver_documents` | Storage |
| Driver avatars | `src/components/driver/DriverAvatarUpload.tsx`, `src/pages/EditProfile.tsx`, `src/pages/RiderProfile.tsx` | Storage upload/signed URL, update | `driver-avatars`, `drivers`, `profiles` | Storage |
| Driver earnings fallback data | `src/components/driver/DriverEarningsDashboard.tsx` | Read | `drivers`, `rides`, `driver_ratings` | Read-only |
| Demand heatmap | `src/components/driver/DemandHeatmap.tsx` | RPC/read | `update_demand_zones`, `ride_demand_zones` | Business Logic |
| Driver dashboard policy | `src/pages/DriverDashboard.tsx` | RPC/read/write | `can_driver_operate`, `is_top_driver`, `rides`, `profiles`, `ride_preferences`, `notifications` | Business Logic |
| Driver fatigue | `src/hooks/useFatigueMonitor.ts` | Read/insert | `drivers`, `driver_sessions` | Business Logic |
| Live driver tracking | `src/hooks/useDriverTracking.ts`, `useNearbyDrivers.ts`, `pages/LiveTrackingPage.tsx` | Read/realtime | `live_locations`, `rides`, `drivers`, `profiles` | Realtime |
| Ride detail | `src/pages/RideDetail.tsx`, `RiderRideDetail.tsx` | Read/write/realtime | `rides`, `offers`, `messages`, `drivers`, `profiles`, `favorite_locations` | Business Logic |
| Ride communication | `src/components/ride/RideCommunication.tsx` | Read/insert | `messages` | Write |
| Ride cancellation fee | `src/components/ride/CancellationPolicy.tsx` | Insert/update | `cancellation_fees`, `rides` | Business Logic |
| Ride preferences/stops | `src/components/ride/RideView.tsx` | Insert/read | `ride_stops`, `ride_preferences`, `student_discount_usage`, `profiles`, `notifications` | Business Logic |
| Ride ratings/tips/disputes | `src/components/ride/DriverRatingModal.tsx`, `TippingModal.tsx`, `DisputeForm.tsx` | Insert | `driver_ratings`, `tips`, `disputes` | Write |
| Emergency alerts | `src/components/ride/EmergencyButton.tsx`, `AdminEmergencyAlerts.tsx` | Insert/read/realtime | `emergency_alerts`, `user_roles` | Realtime |
| Notifications | `src/components/NotificationCenter.tsx`, `RidePaymentNotifier.tsx`, `GlobalRideNotifier.tsx` | Read/update/realtime | `notifications`, `drivers` | Realtime |
| Student verification | `src/pages/StudentVerificationPage.tsx`, `hooks/useStudentProfile.ts`, `admin/AdminStudents.tsx` | Storage upload, Edge Function, read/update | `student-verification`, `verify-student`, `student_profiles`, `institutions`, `student_discount_usage` | Storage |
| Deposit proof upload | `src/components/wallet/DepositModal.tsx`, `src/pages/DriverDepositPage.tsx` | Storage upload | `rider-deposit-proofs`, `deposit-proofs` | Storage |
| Admin deposit proof view | `src/pages/admin/AdminWalletDashboard.tsx`, `AdminDepositsPage.tsx`, `AdminRiderDepositsPage.tsx` | Signed URL | `deposit-proofs`, `rider-deposit-proofs` | Storage |
| Admin dashboard | `src/pages/admin/AdminDashboard.tsx` | Read/realtime, Edge Function fetch | `drivers`, `profiles`, `live_locations`, `rides`, `admin-api` | Realtime |
| Admin driver tools | `src/pages/admin/AdminDrivers.tsx`, `AdminDriverDetail.tsx`, `AdminDriversMap.tsx` | Read/update/realtime | `drivers`, `profiles`, `driver_documents`, `live_locations` | Business Logic |
| Admin reports/system health | `src/pages/admin/AdminReports.tsx`, `AdminSystemHealth.tsx`, `LoadPulsePanel.tsx` | Read/insert/update/delete/realtime | `rides`, `drivers`, `system_error_logs`, `emergency_alerts`, `disputes`, `fraud_flags`, `offers`, `messages`, `live_locations` | Business Logic |
| Admin promos/pricing/landmarks | `src/pages/admin/AdminPromos.tsx`, `AdminTownPricing.tsx`, `AdminLandmarks.tsx` | Read/insert/update/delete | `promo_codes`, `town_pricing`, `koloi_landmarks` | Write |
| Places cache | `src/lib/placeCache.ts` | Read/insert/update/delete | `places_cache` | Business Logic |
| RAMZ actions | `src/lib/ramzActions.ts`, `ramzAudit.ts`, `ramzCodeScan.ts`, `ramzPatch.ts` | RPC/read/write/function invoke | `expire_old_rides`, `auto_resolve_noise_fraud_flags`, `cleanup_old_messages`, `ramz_patch_audit`, `ramz-code-scan`, `ramz-generate-patch` | Business Logic |
| Ride expiry | `src/lib/rideExpiry.ts` | RPC | `expire_old_rides` | Business Logic |
| WebRTC/Agora calls | `src/hooks/useWebRTCCall.ts`, `useAgoraCall.ts` | Realtime/read/update/function invoke | `call_sessions`, `agora-token` | Realtime |
| Ride request negotiation | `src/pages/negotiate/*` | Read/realtime/RPC | `ride_requests`, `ride_offers`, `is_top_driver` | Realtime |

### Supabase Edge Functions

| Feature | File | Operation | Table/RPC | Status |
|---|---|---|---|---|
| Admin API | `supabase/functions/admin-api/index.ts` | Admin action endpoint | `drivers`, `rides`, `profiles`, `notifications`, `system_events`, `driver_documents`, `koloi_landmarks` | Business Logic |
| Add driver | `supabase/functions/add-driver/index.ts` | Admin driver creation | `user_roles`, `drivers`, `system_events` | Business Logic |
| Delete account | `supabase/functions/delete-account/index.ts` | Deletes user data | Multiple user/driver tables | Business Logic |
| Scheduled dispatch | `supabase/functions/dispatch-scheduled/index.ts` | RPC execution | `dispatch_scheduled_rides`, `expire_old_rides` | Business Logic |
| Google maps key | `supabase/functions/google-maps-key/index.ts` | Secret broker | `GOOGLE_MAPS_API_KEY` | Auth |
| Google places/search/routes | `supabase/functions/google-places-search`, `google-routes`, `nominatim-search` | External API proxy | Google/Nominatim | Business Logic |
| Import OSM places | `supabase/functions/import-osm-places/index.ts` | Admin import | `koloi_landmarks` | Business Logic |
| Notifications | `supabase/functions/send-notification/index.ts` | Insert notifications | `notifications`, `drivers` | Business Logic |
| Settlement legacy | `supabase/functions/settle-trip/index.ts` | Ledger insert | `rides`, `drivers`, `platform_ledger` | Business Logic |
| SMS/OTP | `supabase/functions/sms-invite`, `twilio-otp` | Twilio SMS | `phone_verifications` | Auth |
| Student verification | `supabase/functions/verify-student/index.ts` | AI-assisted verification | `student_profiles`, `student_verification_attempts`, `student-verification` | Business Logic |
| Wallet PIN legacy | `supabase/functions/wallet-pin/index.ts` | PIN check/set/verify | `wallet_pins`, `wallets` | Business Logic |
| RAMZ AI | `supabase/functions/ramz-code-scan`, `ramz-generate-patch` | Lovable AI Gateway | `user_roles` | Business Logic |
| Push config | `supabase/functions/push-config/index.ts` | VAPID public key | Env | Business Logic |

### Supabase Security Note

`supabase/config.toml` disables platform JWT verification for these functions:

- `admin-api`
- `google-routes`
- `twilio-otp`
- `import-osm-places`
- `settle-trip`
- `agora-token`
- `google-maps-key`
- `nominatim-search`
- `google-places-search`
- `ramz-code-scan`
- `ramz-generate-patch`

Some functions perform their own JWT checks, but the platform-level guard is off for all listed functions.

## 3. Redis Usage

Redis usage is present in the Go backend.

| Feature | File | Purpose |
|---|---|---|
| Redis config | `backend/internal/config/config.go` | Reads `REDIS_URL`, `REDIS_ENABLED`, TTLs, and pool size. |
| Redis client | `backend/internal/redis/client.go` | RESP client with ping, hash, expiry, geo add/search, TLS, auth, and pooling. |
| Redis health | `backend/internal/redis/health.go` | Exposes `/health/redis`. |
| Driver location hot state | `backend/internal/geo/service.go` | Stores driver location hash and GEO index with TTLs. |
| Driver presence hot state | `backend/internal/geo/service.go`, `backend/internal/drivers/handler.go` | Stores online/heartbeat/offline state. |
| Nearby driver lookup | `backend/internal/geo/service.go` | Uses Redis GEO search for nearby driver candidates. |
| Dispatch geo provider | `backend/internal/dispatch/geo_provider.go` | Reads Redis candidates for dispatch shadow ranking. |

No Redis pub/sub, queue, or distributed lock implementation was detected. Redis is currently used as optional hot-state infrastructure, not as a message bus.

## 4. WebSocket Architecture

There are two realtime systems:

- Go WebSocket at `/ws` for ride events and driver location.
- Supabase Realtime/Broadcast for messages, admin dashboards, WebRTC signaling, notifications, nearby drivers, and legacy ride flows.

### Go WebSocket Flow

- Frontend connects through `src/lib/goRideSocket.ts`.
- It derives `ws://` or `wss://` from `VITE_GO_BACKEND_URL`, `VITE_API_BASE_URL`, or `VITE_BACKEND_URL`.
- It sends `access_token` and `room=ride_<rideId>` as query parameters.
- Backend validates Supabase JWT and authorizes ride room membership.
- Backend room state is process-local in `backend/internal/websocket/manager.go`.

### Event Map

| Event | Producer | Consumer |
|---|---|---|
| `ride_offer` | Go rides handler after driver offer | Frontend `useRideRealtime`, `goRideSocket` listeners |
| `ride_accepted` | Go rides handler after rider accepts offer | Frontend ride detail/realtime screens |
| `ride_started` | Go rides handler after trip start/status transition | Frontend active ride screens |
| `ride_completed` | Go rides handler after completion | Frontend active ride/payment screens |
| `driver_location` | Go drivers handler after location update | Frontend ride tracking socket consumers |
| Ride room join | Frontend `connectGoRideSocket`; backend WebSocket handler | Backend WebSocket manager/room authorizer |
| Ride messages | Frontend Supabase Realtime | `messages` table subscribers |
| Admin dashboard updates | Supabase Realtime | Admin dashboard and driver map pages |
| Nearby drivers | Supabase Realtime | `useNearbyDrivers`, tracking screens |
| WebRTC signaling | Supabase broadcast | `useWebRTCCall` |
| Agora call session updates | Supabase Realtime | `useAgoraCall` |
| Notifications | Supabase Realtime | Notification center and ride payment notifier |
| Emergency alerts | Supabase Realtime | Admin emergency alert panel |

### Reconnect Logic

`src/lib/goRideSocket.ts` opens a WebSocket and returns a cleanup function. It logs errors but does not implement retry/backoff. Supabase Realtime subscriptions rely on the Supabase client behavior and manual cleanup in individual hooks/components.

## 5. Lovable Dependencies

| Feature | File | Purpose |
|---|---|---|
| Lovable auth wrapper | `src/integrations/lovable/index.ts` | Auto-generated wrapper around `@lovable.dev/cloud-auth-js`; sets Supabase session from Lovable OAuth tokens. |
| Google/Apple OAuth | `src/pages/Auth.tsx`, `src/pages/Signup.tsx`, `src/components/auth/AuthForm.tsx` | Calls `lovable.auth.signInWithOAuth`. |
| Development component tagging | `vite.config.ts` | Uses `lovable-tagger` only in development mode. |
| Lovable package deps | `package.json`, `bun.lockb`, `package-lock.json` | `@lovable.dev/cloud-auth-js` and `lovable-tagger`. |
| Lovable README metadata | `README.md` | Lovable project/edit/deploy documentation remains in root README. |
| Lovable AI Gateway | `supabase/functions/verify-student`, `ramz-code-scan`, `ramz-generate-patch` | Calls `https://ai.gateway.lovable.dev/v1/chat/completions` using `LOVABLE_API_KEY`. |

Can the app continue without Lovable?

YES, with feature degradation. Core React, Supabase, and Go backend flows can run without Lovable if Lovable OAuth, development tagging, RAMZ AI, and AI-assisted student verification are disabled or replaced. The current code still imports Lovable for OAuth and AI flows, so those specific features are not Lovable-independent today.

## 6. Frontend -> Backend Communication

Primary Go adapter:

- `src/lib/goBackendClient.ts`
- Base URL: `VITE_GO_BACKEND_URL || VITE_API_BASE_URL || VITE_BACKEND_URL`
- Auth: Supabase bearer token from `supabase.auth.getSession()`

Primary WebSocket adapter:

- `src/lib/goRideSocket.ts`
- Endpoint: `/ws`

| Frontend Function | Endpoint | Backend Handler |
|---|---|---|
| `requestRide` | `POST /api/rides` | `rides.Handler.Request` via compatibility route |
| `submitOffer` | `POST /api/rides/:rideId/offers` | `rides.Handler.SubmitOffer` |
| `acceptOffer` | `POST /api/rides/:rideId/offers/:offerId/accept` | `rides.Handler.AcceptOffer` |
| `rejectOffer` | `POST /api/rides/:rideId/offers/:offerId/reject` | `rides.Handler.RejectOffer` |
| Driver/rider cancel/status | `POST /api/rides/:rideId/status` | `rides.Handler.UpdateStatus` |
| Complete trip | `POST /api/rides/:tripId/complete` | `rides.Handler.CompleteRide` |
| Settle trip | `POST /api/rides/:tripId/settle` | `rides.Handler.SettleRide` |
| Read settlement | `GET /api/rides/:tripId/settlement` | Wallet frontend settlement handler in `wallet.RegisterOperationRoutes` |
| Patch ride | `PATCH /api/rides/:rideId` | No matching backend route detected |
| Driver presence | `POST /api/drivers/me/presence` | `drivers.Handler.Presence` |
| Driver location | `POST /api/drivers/me/location` | `drivers.Handler.UpdateLocation` |
| Go ride socket | `/ws?access_token=...&room=ride_:id` | `websocket.NewHandler` |
| Wallet balance | `GET /api/wallets/me`, fallback `GET /api/wallet/me` | Plural: `walletStateHandler`; singular: `frontendWalletStateHandler` |
| Wallet transactions | `GET /api/wallets/me/transactions`, fallback `GET /api/wallet/transactions` | Plural: `walletTransactionsHandler`; singular: `frontendWalletTransactionsHandler` |
| Wallet deposits list | `GET /api/wallets/deposits`, fallback `GET /api/wallet/deposits` | Plural list missing; singular `frontendWalletDepositsHandler` exists |
| Wallet deposit create | `POST /api/wallets/deposits`, fallback `POST /api/wallet/deposit` | Plural `createDepositHandler`; singular `frontendDepositHandler` |
| Withdrawal create | `POST /api/wallets/withdrawals`, fallback `POST /api/wallet/withdraw` | Plural `createWithdrawalHandler`; singular `frontendWithdrawalHandler` |
| Transfer funds | `POST /api/wallets/transfer`, fallback `POST /api/wallet/transfer` | Plural missing; singular `frontendTransferHandler` exists |
| Pay ride | `POST /api/wallets/pay`, fallback `POST /api/wallet/pay` | Plural missing; singular `frontendPayRideHandler` exists |
| Wallet PIN | `POST /api/wallets/pin`, fallback `POST /api/wallet/pin` | Plural missing; singular `frontendPINHandler` exists |
| Lookup user | `GET /api/wallets/lookup-user`, fallback `GET /api/wallet/lookup-user` | Plural missing; singular `frontendLookupUserGetHandler` exists |
| Driver wallet summary | `GET /api/wallets/driver/summary`, fallback `GET /api/wallet/driver/summary` | Plural missing; singular `frontendDriverSummaryHandler` exists |
| Driver earnings | `GET /api/wallets/driver/earnings`, fallback `GET /api/wallet/driver/earnings` | Plural missing; singular `frontendDriverEarningsHandler` exists |
| Admin earnings | `GET /admin/finance/earnings` | No direct route found in scanned Go route registrations |
| Admin wallet dashboard | `GET /admin/finance/wallet-dashboard` | No direct route found in scanned Go route registrations |
| Admin deposits list | `GET /admin/wallets/deposits` | Frontend route differs from backend `GET /admin/wallets/deposits/pending` |
| Admin deposit approve/reject | `POST /admin/wallets/deposits/:id/approve|reject` | Implemented |
| Admin withdrawals list | `GET /admin/wallets/withdrawals` | Frontend route differs from backend `GET /admin/wallets/withdrawals/pending` |
| Admin withdrawal approve/reject | `POST /admin/wallets/withdrawals/:id/approve|reject` | Implemented |
| Admin fraud flags | `POST /admin/finance/fraud-flags`, `POST /admin/finance/fraud-flags/:id/resolve` | No direct route found in scanned Go route registrations |
| Admin lock/unlock wallet | `POST /admin/wallets/users/:userId/lock|unlock` | No direct route found in scanned Go route registrations |
| Admin reverse transaction | `POST /admin/wallets/transactions/:txId/reverse` | No direct route found in scanned Go route registrations |
| Admin FX rate | `POST /admin/finance/fx-rate` | No direct route found in scanned Go route registrations |
| Admin ledger | `GET /admin/finance/ledger` | No direct route found in scanned Go route registrations |
| Admin settlements summary | `GET /admin/finance/settlements/summary` | No direct route found in scanned Go route registrations |
| Admin finance health | `GET /admin/finance/health` | No direct route found in scanned Go route registrations |
| Low balance reminders | `POST /admin/finance/low-balance-reminders` | No direct route found in scanned Go route registrations |

## 7. External Services

| Service | Purpose | Config Location |
|---|---|---|
| Supabase Auth/Postgres/Storage/Realtime | Auth, database, storage, realtime, Edge Functions | `src/integrations/supabase/client.ts`, `supabase/config.toml`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_*` |
| Go backend | REST and WebSocket API | `src/lib/goBackendClient.ts`, `src/lib/goRideSocket.ts`, `VITE_GO_BACKEND_URL`, `VITE_API_BASE_URL`, `VITE_BACKEND_URL` |
| Google Maps JavaScript API | Maps UI and geocoding/routing helpers | `VITE_GOOGLE_MAPS_API_KEY`, map hooks/components |
| Google Places API | Place autocomplete/search | `src/hooks/useGooglePlacesAutocomplete.ts`, `supabase/functions/google-places-search`, `GOOGLE_MAPS_API_KEY` |
| Google Routes/Directions | Route calculation | `src/hooks/useGoogleRoute.ts`, `supabase/functions/google-routes`, `GOOGLE_MAPS_API_KEY` |
| Nominatim/OpenStreetMap | Geocoding and landmark import fallback | `src/lib/geo_osm.ts`, `supabase/functions/nominatim-search`, `import-osm-places` |
| OSRM | Route calculation fallback | `src/lib/osrm.ts`, `src/lib/osrmSteps.ts`, `src/hooks/useOSRMRoute.ts` |
| Twilio | OTP and SMS invite | `supabase/functions/twilio-otp`, `sms-invite`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` |
| Agora | Voice/video call token and RTC client | `src/hooks/useAgoraCall.ts`, `agora-rtc-sdk-ng`, `supabase/functions/agora-token`, `AGORA_APP_ID`, `AGORA_APP_CERT` |
| PayPal | Backend payment provider | `backend/internal/payments`, `PAYPAL_*` |
| EcoCash | Backend payment provider | `backend/internal/payments`, `ECOCASH_*` |
| Innbucks | Backend payment provider | `backend/internal/payments`, `INNBUCKS_*` |
| OneMoney | Backend payment provider | `backend/internal/payments`, `ONEMONEY_*` |
| Card payments | Backend card deposit abstraction | `backend/internal/payments`, `CARD_PAYMENTS_ENABLED`, `CARD_PILOT_ONLY` |
| Stripe | No active implementation detected | Not detected |
| Firebase/FCM | No active implementation detected; docs mention push roadmap | Not detected |
| OneSignal | No active implementation detected | Not detected |
| Web Push/VAPID | Browser push config/subscription | `src/lib/push.ts`, `supabase/functions/push-config`, `VAPID_PUBLIC_KEY` |
| Sentry | Frontend error tracking and sourcemaps | `src/main.tsx`, `vite.config.ts`, `@sentry/react`, `SENTRY_AUTH_TOKEN`, `VITE_APP_VERSION` |
| Datadog RUM | Optional frontend RUM | `src/integrations/datadog/rum.ts`, `VITE_DD_RUM_*` |
| Lovable Cloud/Auth/AI | OAuth wrapper, development tagging, AI Gateway | `src/integrations/lovable/index.ts`, `vite.config.ts`, `LOVABLE_API_KEY` |

## 8. Environment Variables

### Frontend Variables

| Variable | Required | Purpose |
|---|---:|---|
| `VITE_SUPABASE_URL` | Required | Supabase project URL. Vite config currently has a public fallback. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Required | Supabase anon/publishable key. Vite config currently has a public fallback. |
| `VITE_GOOGLE_MAPS_API_KEY` | Required for Google maps features | Browser Google Maps key. No fallback is intentionally provided. |
| `VITE_GO_BACKEND_URL` | Required for Go API/WS | Preferred Go backend base URL. |
| `VITE_API_BASE_URL` | Optional fallback | Alternate Go backend base URL. |
| `VITE_BACKEND_URL` | Optional fallback | Alternate Go backend base URL. |
| `VITE_APP_VERSION` | Optional | Sentry release / app version. |
| `VITE_DD_RUM_ENABLED` | Optional | Enables Datadog RUM. |
| `VITE_DD_RUM_APPLICATION_ID` | Optional | Datadog RUM app id. |
| `VITE_DD_RUM_CLIENT_TOKEN` | Optional | Datadog RUM client token. |
| `VITE_DD_RUM_SITE` | Optional | Datadog site. |
| `VITE_DD_RUM_SERVICE` | Optional | Datadog service name. |
| `VITE_DD_RUM_ENV` | Optional | Datadog environment. |
| `VITE_DD_RUM_VERSION` | Optional | Datadog app version. |

### Backend Variables

| Variable | Required | Purpose |
|---|---:|---|
| `DATABASE_URL` | Required | PostgreSQL connection string; backend fails startup without it. |
| `PORT` | Optional | Backend port, default `3000`. |
| `APP_ENV` | Optional | App environment, default `production`. |
| `SUPABASE_URL` | Required for issuer derivation | Supabase project URL. |
| `SUPABASE_JWT_SECRET` | Required for auth | JWT verification secret. |
| `SUPABASE_JWT_AUDIENCE` | Optional | Defaults to `authenticated`. |
| `SUPABASE_JWT_ISSUER` | Optional | Defaults to `SUPABASE_URL + /auth/v1` when URL exists. |
| `CORS_ALLOW_ORIGINS` | Optional | Defaults to production frontend origins. |
| `HTTP_REQUEST_TIMEOUT_SECONDS` | Optional | Request timeout, default `15`. |
| `HTTP_RATE_LIMIT_MAX` | Optional | Rate limit max, default `120`. |
| `HTTP_RATE_LIMIT_WINDOW_SECONDS` | Optional | Rate limit window, default `60`. |
| `REDIS_URL` | Optional | Redis connection string. |
| `REDIS_ENABLED` | Optional | Enables Redis hot state. |
| `REDIS_DRIVER_LOCATION_TTL_SECONDS` | Optional | Location TTL, default `60`. |
| `REDIS_DRIVER_PRESENCE_TTL_SECONDS` | Optional | Presence TTL, default `90`. |
| `REDIS_POOL_SIZE` | Optional | Redis pool size, default `16`. |
| `DISPATCH_MODE` | Optional | Dispatch mode, default `off`. |
| `DISPATCH_SHADOW_RADIUS_KM` | Optional | Shadow dispatch radius, default `5`. |
| `DISPATCH_SHADOW_CANDIDATE_LIMIT` | Optional | Candidate limit, default `20`. |
| `DISPATCH_SHADOW_SELECTED_LIMIT` | Optional | Selected limit, default `3`. |
| `DISPATCH_SHADOW_RANKING_VERSION` | Optional | Ranking version, default `v2.0-b-simple`. |
| `WALLET_ACTIVE_SETTLEMENT_ENABLED` | Optional | Active wallet settlement flag. |
| `WALLET_ACTIVE_CASH_SETTLEMENT_ENABLED` | Optional | Active cash settlement flag. |
| `WALLET_RIDE_AUTHORIZATION_ENABLED` | Optional | Ride authorization flag. |
| `WALLET_RIDE_AUTHORIZATION_TTL_MINUTES` | Optional | Authorization TTL, default `30`. |
| `WALLET_AUTHORIZATION_EXPIRATION_WORKER_ENABLED` | Optional | Enables expiration worker. |
| `WALLET_AUTHORIZATION_EXPIRATION_INTERVAL_SECONDS` | Optional | Worker interval, default `60`. |
| `WALLET_AUTHORIZATION_EXPIRATION_BATCH_LIMIT` | Optional | Batch limit, default `100`. |
| `WALLET_INTERNAL_PILOT_ENABLED` | Optional | Internal wallet pilot flag. |
| `WALLET_INTERNAL_PILOT_PERCENTAGE` | Optional | Internal pilot rollout percentage. |
| `PUBLIC_WALLET_PILOT_ENABLED` | Optional | Public wallet pilot flag. |
| `PUBLIC_WALLET_PILOT_PROGRAM_ID` | Optional | Public wallet pilot program id. |
| `PUBLIC_WALLET_PILOT_CITY` | Optional | Public wallet pilot city, default `Gwanda`. |
| `PAYMENTS_PROVIDER_ENABLED` | Optional | Master payment provider flag. |
| `ONEMONEY_ENABLED`, `ECOCASH_ENABLED`, `INNBUCKS_ENABLED`, `PAYPAL_ENABLED`, `CARD_PAYMENTS_ENABLED` | Optional | Provider feature flags. |
| `ONEMONEY_WEBHOOK_SECRET`, `ECOCASH_WEBHOOK_SECRET`, `INNBUCKS_WEBHOOK_SECRET`, `PAYPAL_WEBHOOK_SECRET` | Required when provider callbacks are enabled | Provider webhook verification. |
| Provider `*_STATUS_URL` and `*_STATUS_TOKEN` | Optional/provider-specific | Provider status reconciliation. |

### Supabase Edge Function Variables

| Variable | Required | Purpose |
|---|---:|---|
| `SUPABASE_URL` | Required | Edge Function Supabase URL. |
| `SUPABASE_ANON_KEY` | Required for anon clients | Supabase anon key. |
| `SUPABASE_SERVICE_ROLE_KEY` | Required for service functions | Service-role database access. |
| `GOOGLE_MAPS_API_KEY` | Required for maps functions | Google Places/Routes/Maps key. |
| `TWILIO_ACCOUNT_SID` | Required for SMS | Twilio account SID. |
| `TWILIO_AUTH_TOKEN` | Required for SMS | Twilio auth token. |
| `TWILIO_PHONE_NUMBER` | Required for SMS | Twilio sender number. |
| `AGORA_APP_ID` | Required for Agora | Agora app id. |
| `AGORA_APP_CERT` | Required for Agora tokens | Agora certificate. |
| `LOVABLE_API_KEY` | Required for RAMZ/student AI | Lovable AI Gateway key. |
| `VAPID_PUBLIC_KEY` | Required for push config | Browser push public key. |

### Config Gap

`.env.example` does not fully document the current monorepo contract. In particular, the Go backend URL variables, Supabase frontend variables, backend `DATABASE_URL`, backend JWT variables, Redis variables, wallet flags, and provider variables should be consolidated into a monorepo env reference.

## 9. Architecture Violations

| Severity | Issue | Evidence | Risk |
|---|---|---|---|
| High | Direct frontend business writes remain | Ride cancellation fees, messages, disputes, emergency alerts, ratings, tips, ride stops/preferences, student discount usage, promos, pricing, landmarks, admin health actions | Business invariants are split between frontend, Supabase RLS/RPC, Edge Functions, and Go. |
| High | Duplicate realtime systems | Go `/ws` plus Supabase Realtime/Broadcast channels | Harder ordering, retries, fanout, and operational debugging. |
| High | Go WebSocket state is process-local | `backend/internal/websocket/manager.go` | Horizontal scaling needs sticky sessions or external fanout. |
| High | Frontend/backend wallet route naming mismatch | Frontend calls plural wallet routes first; backend implements several singular aliases but not all plural aliases | Fallback only works on selected errors; `401`, `403`, network, or `500` on plural paths can block valid singular routes. |
| High | Frontend route without backend match | `PATCH /api/rides/:rideId` in `RiderRideDetail.tsx` | Rider edit/cancel patch flow may fail. |
| High | Admin finance route mismatch | Frontend expects `/admin/finance/earnings`, `/wallet-dashboard`, `/ledger`, `/health`; scanned backend routes emphasize many other `/admin/finance/...` reports | Admin finance screens may partially fail. |
| High | Admin wallet list mismatch | Frontend expects `/admin/wallets/deposits` and `/admin/wallets/withdrawals`; backend has `/pending` variants | Admin list screens may miss backend routes unless aliases exist elsewhere. |
| Medium | Supabase Edge Functions overlap Go responsibilities | `admin-api`, `settle-trip`, `wallet-pin`, notification/maps functions coexist with Go backend | Multiple server boundaries for the same business domains. |
| Medium | Supabase functions disable platform JWT verification | `supabase/config.toml` has `verify_jwt = false` for many functions | Security depends on custom function checks; unauthenticated functions need careful rate limiting and input validation. |
| Medium | Lovable remains in auth path | `src/integrations/lovable/index.ts` and auth screens | Removing Lovable requires OAuth replacement. |
| Medium | Redis does not provide locks/pub-sub | Redis client only used for hot geo state | Dispatch and WebSocket scaling still need coordination primitives if multi-instance. |
| Medium | Root app is not a clean `frontend/` package | Frontend remains at root while backend is under `backend/` | Monorepo is transitional; tooling and docs must be explicit. |
| Medium | `.env.example` incomplete | Missing many current frontend/backend/env variables | Onboarding and deployment are fragile. |
| Low | Legacy wallet Supabase logic remains | Supabase `wallet-pin` and finance RPC migrations still exist | Useful as migration history, but can confuse active architecture ownership. |
| Low | Direct finance storage remains in frontend | Deposit proof uploads and signed URLs still use Supabase Storage | Acceptable if intentional, but storage authorization remains outside Go. |

## 10. Readiness Score

| Area | Score | Rationale |
|---|---:|---|
| Frontend | 72 / 100 | Mature Vite/React app with many flows, but still contains direct business writes and multiple realtime systems. |
| Backend | 78 / 100 | Go backend is present, structured, and testable; startup requires env, and some frontend route contracts still mismatch. |
| Wallet | 76 / 100 | Wallet backend is substantial and frontend is mostly Go-oriented; plural/singular aliases and admin route mismatches remain. |
| Realtime | 64 / 100 | Go WebSocket exists, but no retry client and process-local rooms; Supabase Realtime still carries many flows. |
| Maps | 74 / 100 | Google, OSRM, OSM, and Nominatim paths exist; multiple providers increase fallback strength but also complexity. |
| Security | 68 / 100 | Go JWT/admin middleware exists, but direct Supabase writes and `verify_jwt = false` Edge Functions leave uneven enforcement. |
| Architecture | 66 / 100 | The monorepo direction is right, but the system remains hybrid with duplicated boundaries and incomplete route convergence. |

Overall readiness score: 71 / 100

Verdict: The monorepo is operationally promising but not fully converged. The next architecture step should be contract convergence: make frontend API routes match Go exactly, move remaining business writes behind Go or explicit Edge Function ownership, and choose one primary realtime path per domain.
