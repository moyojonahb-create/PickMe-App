# Post-Hardening Verification Report

Date: 2026-06-15

Scope: Final post-hardening verification audit for PickMe Zimbabwe after Go backend monorepo merge, Dispatch V3, Redis locks/queues, WebSocket Redis Pub/Sub, wallet hardening, secrets cleanup, and partial frontend business-write migration. Source code was not modified.

## Executive Summary

Result: **CONDITIONAL INTERNAL GO, PRODUCTION NO-GO**

The repository is materially stronger than the pre-hardening state. The Go backend is present, compiles, registers core ride/driver/wallet/payment/business endpoints, uses Supabase JWT auth, wires Redis into dispatch and WebSocket room fanout, and passes `go test ./...`.

However, production launch is still blocked by route-contract gaps, remaining direct frontend Supabase writes, legacy Supabase Edge Functions with business logic, incomplete multi-instance targeted driver delivery, unverified live database constraints, and missing operational readiness evidence.

Readiness score before hardening: **45 / 100**

Readiness score after hardening: **68 / 100**

## Pass/Fail Table

| Check | Status | Evidence | Required Fix |
|---|---:|---|---|
| Secrets removed from committed files | Pass with caveat | Secret-pattern scan found no matches in non-ignored source/docs/env examples. `.env` files are ignored. | Also scan git history before public release. |
| `.env` and `backend/.env` ignored | Pass | `git check-ignore -v .env backend/.env` returns root and backend ignore rules. | Keep real env files out of commits. |
| Backend env vars documented | Pass | `backend/.env.example`, `backend/internal/config/config.go` document/load required and optional vars. | Keep deployment env in platform secrets. |
| Go backend startup requirements | Pass with caveat | `config.Load()` requires `DATABASE_URL`; `auth.NewSupabaseJWT()` requires `SUPABASE_JWT_SECRET`; `SUPABASE_URL` derives issuer. DB connection failure is fatal in `cmd/server/main.go`. | Production must set valid `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_JWT_SECRET`. |
| `/health` route | Pass by code registration | `backend/cmd/server/main.go` registers `GET /health`; `backend/internal/database/postgres.go` returns static JSON. | Runtime smoke test in deployment. |
| `/test-db` route | Pass by code registration, runtime not re-run | `backend/cmd/server/main.go` registers `GET /test-db`; handler runs `SELECT NOW()`. | Runtime smoke test against production DB before launch. |
| Frontend points to Go | Pass for examples | `.env.example` sets `VITE_GO_BACKEND_URL=http://localhost:3000`; `src/lib/goBackendClient.ts` reads `VITE_GO_BACKEND_URL`, `VITE_API_BASE_URL`, `VITE_BACKEND_URL`. | Ensure deployed frontend env uses the public Go API URL. |
| Wallet frontend routes match backend routes | Partial fail | Public wallet routes mostly match via singular fallback. Admin list/dashboard/finance routes do not all match registered backend routes. | Add backend aliases or update frontend adapters. |
| Ride frontend routes match backend routes | Partial fail | Core `POST /api/rides`, offers, status, complete, settle are registered. `PATCH /api/rides/:rideId` and `/api/rides/offers/:offerId/reject` are called but not registered. | Add compatibility routes or remove frontend calls. |
| Dispatch V3 env enablement | Pass | `DISPATCH_MODE`, Redis, queue, lock TTL, offer TTL vars are loaded in `backend/internal/config/config.go`. | Add worker consumer groups and retry waves before scale. |
| Dispatch V3 wiring | Pass with scaling caveat | `backend/cmd/server/main.go` wires Redis queue/locker into dispatch. | Move first-wave processing from in-process to workers. |
| WebSocket Redis Pub/Sub wired | Pass with targeted-send caveat | `websocket.NewManager().WithPubSub(redisClient)` and `StartPubSub()` are called in `main.go`. | Move driver/rider targeted registries to Redis or route targeted events through Pub/Sub. |
| Wallet idempotency tests | Partial fail | Tests cover authorization duplicate, active settlement duplicate key, provider duplicate callback, validation. No direct regression tests found for newest provider pre-call idempotency or manual deposit/withdrawal duplicate reload. | Add explicit unit/integration tests. |
| Backend test suite | Pass | `cd backend; go test ./...` passes. | Add Postgres-backed concurrency tests. |
| Business-write endpoints registered | Pass | `backend/internal/business/handler.go` registers ratings, disputes, emergency events, tips, fraud flags, notifications, ride stops, preferences, admin business actions. | Replace generic admin mutation routes with narrower services before production. |
| Remaining direct frontend Supabase writes listed | Fail | Multiple direct writes remain in frontend. | Migrate remaining browser writes behind Go. |
| Remaining Supabase Edge Functions with business logic listed | Fail | Multiple functions still perform business writes/decisions and several have `verify_jwt = false`. | Disable, migrate, or hard-gate legacy functions. |
| Live DB constraints/indexes verified | Partial fail | Migrations contain many indexes, but targeted unique financial constraints were not all found by local scan. | Confirm live schema and add missing migrations. |
| Monitoring/backup/DR readiness | Fail | No production monitoring, alerting, backup/restore drill evidence found in code. | Add deployment runbooks, alerts, dashboards, backup restore tests. |

## Exact Files Checked

- `backend/cmd/server/main.go`
- `backend/internal/config/config.go`
- `backend/internal/database/postgres.go`
- `backend/internal/auth/supabase_jwt.go`
- `backend/internal/middleware/auth.go`
- `backend/internal/rides/handler.go`
- `backend/internal/drivers/handler.go`
- `backend/internal/dispatch/service.go`
- `backend/internal/dispatch/repository.go`
- `backend/internal/redis/client.go`
- `backend/internal/websocket/manager.go`
- `backend/internal/websocket/handler.go`
- `backend/internal/wallet/admin_http.go`
- `backend/internal/wallet/admin_flow.go`
- `backend/internal/wallet/repository.go`
- `backend/internal/payments/http.go`
- `backend/internal/payments/service.go`
- `backend/internal/business/handler.go`
- `src/lib/goBackendClient.ts`
- `src/lib/walletApi.ts`
- `src/lib/requestRide.ts`
- `src/lib/offerHelpers.ts`
- `src/lib/completeTrip.ts`
- `src/lib/driverLocation.ts`
- `src/lib/businessApi.ts`
- `src/pages/DriverDashboard.tsx`
- `src/pages/RideDetail.tsx`
- `src/pages/RiderRideDetail.tsx`
- `src/pages/negotiate/RiderRequestScreen.tsx`
- `src/pages/negotiate/RiderOffersScreen.tsx`
- `src/pages/negotiate/DriverRequestsScreen.tsx`
- `.gitignore`
- `.env.example`
- `backend/.env.example`
- `supabase/config.toml`
- `supabase/functions/*`
- `supabase/migrations/*`

## Startup Verification

Required for startup:

- `DATABASE_URL`
- `SUPABASE_JWT_SECRET`

Required for correct JWT issuer validation:

- `SUPABASE_URL`

Optional but production-relevant:

- `PORT`
- `APP_ENV`
- `SUPABASE_JWT_AUDIENCE`
- `SUPABASE_JWT_ISSUER`
- `REDIS_ENABLED`
- `REDIS_URL`
- `DISPATCH_MODE`
- `PAYMENTS_PROVIDER_ENABLED`
- provider webhook/status secrets
- wallet pilot and authorization flags

`backend/cmd/server/main.go` makes PostgreSQL startup fatal. Redis is not fatal: an invalid Redis config logs and falls back to disabled Redis.

`/health` does not check DB. `/test-db` checks DB with `SELECT NOW()`.

## Frontend To Backend Contract Findings

### Wallet Routes

| Feature | Frontend Route | Backend Route | Status |
|---|---|---|---|
| Wallet balance | `GET /api/wallets/me`, fallback `/api/wallet/me` | Both registered | Pass |
| Wallet transactions | `GET /api/wallets/me/transactions`, fallback `/api/wallet/transactions` | Both registered | Pass |
| Wallet deposits list | `GET /api/wallets/deposits`, fallback `/api/wallet/deposits` | Singular registered; plural list not registered | Pass only if plural returns 404/405 |
| Wallet deposit create | `POST /api/wallets/deposits`, fallback `/api/wallet/deposit` | Both registered | Pass |
| Withdrawal create | `POST /api/wallets/withdrawals`, fallback `/api/wallet/withdraw` | Both registered | Pass |
| Transfer | `POST /api/wallets/transfer`, fallback `/api/wallet/transfer` | Singular only | Pass only if plural returns 404/405 |
| Pay ride | `POST /api/wallets/pay`, fallback `/api/wallet/pay` | Singular only | Pass only if plural returns 404/405 |
| Wallet PIN | `POST /api/wallets/pin`, fallback `/api/wallet/pin` | Singular only | Pass only if plural returns 404/405 |
| Lookup user | `GET /api/wallets/lookup-user`, fallback `/api/wallet/lookup-user` | Singular only | Pass only if plural returns 404/405 |
| Driver summary | `GET /api/wallets/driver/summary`, fallback `/api/wallet/driver/summary` | Singular only | Pass only if plural returns 404/405 |
| Driver earnings | `GET /api/wallets/driver/earnings`, fallback `/api/wallet/driver/earnings` | Singular only | Pass only if plural returns 404/405 |
| Admin deposits list | `GET /admin/wallets/deposits?...` | `GET /admin/wallets/deposits/pending` only | **Fail** |
| Admin withdrawals list | `GET /admin/wallets/withdrawals?...` | `GET /admin/wallets/withdrawals/pending` only | **Fail** |
| Admin approve/reject deposit | `POST /admin/wallets/deposits/:id/approve|reject` | Registered | Pass |
| Admin approve/reject withdrawal | `POST /admin/wallets/withdrawals/:id/approve|reject` | Registered | Pass |
| Admin wallet dashboard | `GET /admin/finance/wallet-dashboard` | Not found | **Fail** |
| Admin earnings | `GET /admin/finance/earnings` | Not found | **Fail** |
| Admin ledger | `GET /admin/finance/ledger` | Not found | **Fail** |
| Admin settlement summary | `GET /admin/finance/settlements/summary` | Not found | **Fail** |
| Admin finance health | `GET /admin/finance/health` | Not found | **Fail** |
| Admin fraud flags | `POST /admin/finance/fraud-flags`, resolve | Not found | **Fail** |
| Admin FX rate | `POST /admin/finance/fx-rate` | Not found | **Fail** |
| Low balance reminders | `POST /admin/finance/low-balance-reminders` | Not found | **Fail** |
| Settlement read | `GET /api/rides/:tripId/settlement` | Registered in wallet routes | Pass |
| Settlement execute | `POST /api/rides/:tripId/settle` | Registered in ride routes as `:rideId` | Pass |

### Ride Routes

| Feature | Frontend Route | Backend Route | Status |
|---|---|---|---|
| Ride creation | `POST /api/rides` | Registered | Pass |
| Driver offer creation | `POST /api/rides/:rideId/offers` | Registered | Pass |
| Offer list | `GET /api/rides/:rideId/offers` | Registered | Pass |
| Offer accept | `POST /api/rides/:rideId/offers/:offerId/accept` | Registered | Pass |
| Offer reject scoped | `POST /api/rides/:rideId/offers/:offerId/reject` | Registered | Pass |
| Offer reject unscoped | `POST /api/rides/offers/:offerId/reject` | Not registered | **Fail** |
| Ride status | `POST /api/rides/:rideId/status` | Registered | Pass |
| Ride completion | `POST /api/rides/:rideId/complete` | Registered | Pass |
| Ride patch | `PATCH /api/rides/:rideId` | Not registered | **Fail** |
| Driver presence | `POST /api/drivers/me/presence` | Registered | Pass |
| Driver location | `POST /api/drivers/me/location` | Registered | Pass |

## Dispatch V3 Verification

Status: **Pass for staging, not complete for high-scale production**

Verified:

- `DISPATCH_MODE` supports opt-in authoritative mode.
- Redis queue and lock interfaces are wired through `WithQueue(redisClient)` and `WithLocker(redisClient)`.
- Dispatch jobs are enqueued through `EnqueueDispatchJob`.
- Ride locks and driver locks use Redis.
- Offer waves write through the dispatch repository.
- Existing frontend ride contracts were preserved.

Remaining blockers:

- First offer wave is still processed in-process after queue enqueue.
- No Redis Stream consumer group worker exists yet.
- Retry waves after offer expiry are not a durable worker workflow.
- Driver offer delivery still uses a local `driverRegistry.Get(offer.DriverID)` in `backend/cmd/server/main.go`; a driver connected to another backend instance can miss a targeted offer.

## WebSocket Verification

Status: **Partial pass**

Verified:

- `backend/cmd/server/main.go` creates `websocket.NewManager().WithPubSub(redisClient)`.
- `StartPubSub(context.Background())` is called.
- `backend/internal/websocket/manager.go` supports Redis-backed room fanout, local delivery, event sequencing, and Pub/Sub delivery.
- `backend/internal/websocket/handler.go` supports authenticated connect, room join/recovery, heartbeats, and duplicate connection replacement.

Remaining blockers:

- Room broadcast is cross-instance; targeted driver/rider registry sends are still local-memory.
- No durable replay buffer exists for long reconnects.
- No metrics for socket count, rooms, dropped messages, pub/sub failures, or ping timeouts were found.

## Wallet And Payment Verification

Status: **Improved, not fully production-certified**

Verified:

- Backend tests pass.
- Wallet repository uses transaction-scoped operations and row locks in critical paths.
- Recent hardening exists in `backend/internal/wallet/repository.go`, `backend/internal/wallet/admin_flow.go`, and `backend/internal/payments/service.go`.
- Tests exist for duplicate authorization, double capture/release prevention, active cash settlement duplicate key, callback signature/status validation, duplicate provider event/reference crediting once, and idempotency validation.

Gaps:

- No direct regression test names were found for manual deposit idempotency duplicate reload.
- No direct regression test names were found for manual withdrawal idempotency duplicate reload.
- No direct regression test names were found for provider intent retry returning the existing local record before calling the provider.
- Local migration scan did not find all expected unique financial indexes by name/pattern, including payment intent scoped idempotency/provider reference, provider event uniqueness, settlement idempotency, wallet authorization ride uniqueness, and ride offer driver/ride uniqueness.

Required fixes:

- Add Postgres-backed tests for duplicate provider intent request, duplicate provider callback, duplicate manual deposit, duplicate withdrawal, and concurrent capture.
- Add or verify live unique constraints for all wallet idempotency and provider callback keys.
- Add reconciliation alerting.

## Remaining Direct Frontend Supabase Writes

These violate the target rule `Frontend -> Go API -> PostgreSQL` and should be migrated behind Go:

| Area | Files | Operation |
|---|---|---|
| Call signaling | `src/hooks/useAgoraCall.ts`, `src/hooks/useWebRTCCall.ts` | Insert/update call session status |
| Driver sessions/fatigue | `src/hooks/useFatigueMonitor.ts` | Insert `driver_sessions` |
| Profile/auth metadata | `src/pages/Signup.tsx`, `src/pages/Auth.tsx`, `src/components/auth/AuthForm.tsx`, `src/pages/EditProfile.tsx`, `src/pages/RiderProfile.tsx` | Update/upsert `profiles` |
| Favorites | `src/components/FavoritesSheet.tsx`, `src/pages/RiderRideDetail.tsx` | Insert/delete `favorite_locations` |
| Messages | `src/pages/RideDetail.tsx`, `src/components/ride/RideCommunication.tsx` | Insert `messages` |
| Driver onboarding | `src/components/driver/DriverApplicationForm.tsx`, `src/components/driver/DriverRegistrationWizard.tsx`, `src/components/driver/DocumentUpload.tsx`, `src/components/driver/DriverReviewForm.tsx` | Insert/update `drivers`, `driver_documents`, `profiles` |
| Driver self-service | `src/components/driver/DriverAvatarUpload.tsx`, `src/components/settings/DriverSettingsPanel.tsx`, `src/components/driver/DriverFeedback.tsx` | Update `drivers`, insert `driver_feedback` |
| Rider settings | `src/components/settings/RiderSettingsPanel.tsx`, `src/components/settings/RiderPreferencesSettings.tsx` | Upsert/update rider settings/preferences |
| Dev/admin audit tooling | `src/lib/ramzAudit.ts`, `src/lib/placeCache.ts` | Insert `ramz_patch_audit`, `places_cache` |

Remaining frontend RPCs:

- `src/pages/DriverDashboard.tsx`: `can_driver_operate`, `is_top_driver`
- `src/pages/negotiate/DriverRequestsScreen.tsx`: `is_top_driver`
- `src/components/driver/DemandHeatmap.tsx`: `update_demand_zones`
- `src/lib/ramzActions.ts`: `expire_old_rides`, `auto_resolve_noise_fraud_flags`, `cleanup_old_messages`
- `src/lib/rideExpiry.ts`: `expire_old_rides`

## Remaining Supabase Edge Functions With Business Logic

`supabase/config.toml` sets `verify_jwt = false` for multiple functions. Some functions may perform their own auth checks, but platform-level JWT verification is disabled.

| Function | Business Logic Remaining | Risk |
|---|---|---:|
| `admin-api` | Admin driver/document/trip/landmark/notification actions | Critical |
| `settle-trip` | Settlement and `platform_ledger` insertion | Critical |
| `wallet-pin` | Wallet PIN and wallet row creation/update | High |
| `add-driver` | Driver creation and system event writes | High |
| `dispatch-scheduled` | Scheduled dispatch logic | High |
| `send-notification` | Notification writes/broadcasts | High |
| `verify-student` | Student verification attempts and decision logic | High |
| `twilio-otp` | Phone verification writes and OTP attempts | High |
| `delete-account` | Multi-table account deletion | High |
| `import-osm-places` | Places delete/insert import | Medium |
| `ramz-code-scan`, `ramz-generate-patch` | Dev/admin automation | Medium |
| `google-routes`, `google-places-search`, `google-maps-key`, `nominatim-search` | External service proxying | Medium |
| `agora-token`, `push-config`, `sms-invite` | Token/config/SMS surfaces | Medium |

## Ranked Launch Blockers

### Critical

1. **Wallet/admin route mismatches remain.**
   - Files: `src/lib/walletApi.ts`, `backend/internal/wallet/admin_http.go`
   - Fix: register aliases for `/admin/wallets/deposits`, `/admin/wallets/withdrawals`, `/admin/finance/wallet-dashboard`, `/admin/finance/earnings`, `/admin/finance/ledger`, `/admin/finance/settlements/summary`, `/admin/finance/health`, `/admin/finance/fraud-flags`, `/admin/finance/fx-rate`, and `/admin/finance/low-balance-reminders`, or update frontend calls.

2. **Ride route mismatches remain.**
   - Files: `src/pages/RiderRideDetail.tsx`, `src/lib/offerHelpers.ts`, `backend/internal/rides/handler.go`
   - Fix: add `PATCH /api/rides/:rideId` and `POST /api/rides/offers/:offerId/reject`, or remove those frontend paths.

3. **Direct frontend Supabase writes remain.**
   - Files: listed in the direct-write table.
   - Fix: migrate all remaining browser writes to Go endpoints.

4. **Legacy Supabase Edge Functions still contain business logic.**
   - Files: `supabase/functions/*`, `supabase/config.toml`
   - Fix: migrate, disable, or hard-gate these functions; remove duplicated business authority.

5. **Cross-instance targeted driver offer delivery is incomplete.**
   - Files: `backend/cmd/server/main.go`, `backend/internal/websocket/registry.go`, `backend/internal/websocket/manager.go`
   - Fix: publish targeted driver/rider events over Redis or maintain Redis presence with connection routing.

### High

6. **Wallet idempotency fixes lack direct regression tests.**
   - Files: `backend/internal/wallet/admin_flow_test.go`, `backend/internal/payments/service_test.go`
   - Fix: add explicit tests for newly fixed duplicate/manual/provider-intent paths.

7. **Live DB financial constraints are not fully verified by local migration scan.**
   - Files: `supabase/migrations/*`, `backend/internal/wallet/schema_test.go`
   - Fix: add migrations or live schema checks for idempotency/provider/settlement/authorization uniqueness.

8. **Dispatch Redis queue is not yet a durable worker system.**
   - Files: `backend/internal/dispatch/service.go`
   - Fix: add Redis Stream consumer groups, retries, dead-letter queues, and queue metrics.

9. **Monitoring and alerting are not production complete.**
   - Files: `backend/internal/middleware/production.go`, deployment docs
   - Fix: add metrics export, structured logs, alert rules, dashboards, and SLOs.

10. **Backups and disaster recovery are not evidenced.**
    - Files: docs/config
    - Fix: document RPO/RTO, verify Supabase PITR/backups, run restore drills.

### Medium

11. Generic admin business mutation endpoints are too broad for production.
12. Supabase Realtime subscriptions still exist heavily on the frontend and should be reduced as Go WebSocket coverage grows.
13. Provider callback routes are unauthenticated by HTTP auth by design; keep signature/status verification and add rate limits.
14. `/health` is shallow and should not be used as DB readiness.
15. Runtime `/test-db` was verified by code path and tests, but not re-executed as an HTTP smoke test in this audit.

## Verification Commands Run

```bash
git check-ignore -v .env backend/.env
rg -n "(?i)(service_role|jwt_secret|supabase.*secret|database_url|postgresql://|sk_live|AIza|twilio|paypal|ecocash|innbucks|onemoney|secret\s*=|api[_-]?key\s*=)" --glob "!node_modules/**" --glob "!backend/.gocache/**" --glob "!dist/**" --glob "!android/**" --glob "!.git/**"
rg -n "(app\.(Get|Post|Patch|Delete|Put)|RegisterRoutes|RegisterCompatibilityRoutes|Use\()" backend/cmd backend/internal
rg -n "(goBackend\.(get|post|patch|delete)|apiFetch|/api/|/admin/)" src/lib src/hooks src/components src/pages
rg -n "\.(insert|update|upsert|delete)\(" src --glob "!src/test/**"
rg -n "supabase\.rpc\(" src --glob "!src/test/**"
cd backend; go test ./...
```

Backend test result:

```text
PASS: go test ./...
```

## Final GO / NO-GO Recommendation

| Launch Stage | Recommendation | Reason |
|---|---:|---|
| Internal testing | **GO** | Backend compiles/tests pass; auth, DB config, Redis wiring, core APIs exist. Use non-production money and controlled users. |
| 100 users | **CONDITIONAL GO** | Only after fixing wallet/admin and ride route mismatches, running HTTP smoke tests for `/health` and `/test-db`, and confirming deployment env. |
| 1,000 users | **NO-GO** | Remaining direct Supabase writes, Edge Function business logic, incomplete targeted cross-instance delivery, and missing ops evidence are too risky. |
| 10,000 users | **NO-GO** | Dispatch workers, replay, monitoring, DB constraints, and Go-only business boundary are incomplete. |
| 100,000 users | **NO-GO** | Requires full multi-region/multi-instance architecture, tested workers, observability, DR, load testing, and complete contract alignment. |

## Prioritized Roadmap

1. Fix frontend/backend route mismatches for wallet admin, admin finance, ride patch, and unscoped offer reject.
2. Migrate remaining direct frontend Supabase writes to Go.
3. Disable or migrate Supabase Edge Functions that still own business logic.
4. Add Redis Pub/Sub or Redis presence routing for targeted driver/rider WebSocket sends.
5. Add Redis Stream consumer groups for dispatch with retry waves and dead-letter queues.
6. Add wallet/payment idempotency integration tests against Postgres.
7. Add migrations and live checks for all wallet, settlement, provider, offer, and driver-session uniqueness constraints.
8. Add production metrics, dashboards, alerting, request tracing, and incident runbooks.
9. Run smoke tests for `/health`, `/test-db`, auth-protected endpoints, wallet flows, and ride lifecycle in staging.
10. Run load tests at 100, 1,000, 10,000, and 100,000 simulated users before scaling launch.
