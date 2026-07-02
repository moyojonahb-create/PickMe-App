# Public Launch Tomorrow Readiness

Date: 2026-07-02

Scope: Emergency launch-critical audit only. No product logic, UI, architecture, or schema changes were made.

## Result

Overall status: **NO-GO FOR PUBLIC LAUNCH TOMORROW**

The repo builds and backend tests pass, but the core ride marketplace/lifecycle is not safe for public launch. The main blocker is contract drift between the frontend and Go ride backend:

- Go writes offers to `public.ride_offers`; active rider screens still read `public.offers` or legacy `ride_requests`.
- Go updates `ride_status` for accept/start/complete; active driver/rider screens mostly read `status`.
- Go start uses `ride_status='ongoing'`; frontend expects `status='in_progress'` and also drives intermediate `enroute` and `arrived` states through an endpoint that currently starts the ride.

This can strand a rider after an offer is accepted, hide active trips from drivers, and prevent trip completion.

## Launch-Critical Flow Table

| Flow | Status | Risk | Exact file causing issue | Fastest safe fix |
|---|---|---:|---|---|
| Rider signup/login | PASS | Medium | `src/hooks/useAuth.tsx:70`, `src/pages/Signup.tsx:86` | Keep Supabase Auth, but pre-create/verify the first pilot accounts if Twilio OTP is not confirmed live. |
| Driver signup/login | PASS | Medium | `src/hooks/useAuth.tsx:87`, `src/lib/businessApi.ts:181` | Pre-approve the 5 pilot driver records before any launch traffic. |
| Rider request ride | PASS | High | `src/lib/requestRide.ts:107`, `backend/internal/rides/handler.go:456` | Creation path exists, but do not launch publicly until downstream offer/status fixes below are done. |
| Driver receives offer/open ride | PASS with risk | High | `src/lib/offerHelpers.ts:116`, `src/hooks/useRideRealtime.ts:47`, `src/pages/negotiate/DriverRequestsScreen.tsx:42` | Use one driver surface for launch. Retire or hide the legacy `ride_requests` screen until it is moved to Go/`rides`. |
| Driver offer / rider accepts offer | FAIL | Critical | `src/lib/offerHelpers.ts:63`, `backend/internal/rides/handler.go:1059`, `src/pages/negotiate/RiderOffersScreen.tsx:52` | Read/write offers through one contract: preferably Go `GET/POST /api/rides/:rideId/offers`; update frontend away from `offers`/`ride_requests`, or maintain backend compatibility rows intentionally. |
| Ride start | FAIL | Critical | `src/pages/DriverDashboard.tsx:568`, `backend/internal/rides/handler.go:1281`, `backend/internal/rides/handler.go:1305` | Align lifecycle contract. Either support `enroute/arrived/in_progress` in Go, or update frontend to use Go `ride_status=ongoing` consistently. |
| Ride complete | FAIL | Critical | `src/lib/completeTrip.ts:7`, `src/lib/completeTrip.ts:15`, `backend/internal/rides/handler.go:1379` | Complete against the same lifecycle field/value. Frontend currently requires `status='in_progress'`; Go requires `ride_status='ongoing'`. |
| Wallet deposit | PASS | Medium | `src/components/wallet/DepositModal.tsx:113`, `backend/internal/wallet/admin_http.go:151` | Launch only manual/admin-approved deposits; do not advertise instant provider deposits. |
| Wallet withdrawal | PASS | Medium | `src/lib/walletPayments.ts:22`, `backend/internal/wallet/admin_http.go:156` | Launch only admin-approved withdrawals with finance operator review. |
| Notifications | BLOCKED | High | `src/hooks/useSendNotification.ts:33`, `.env.example:73`, `backend/internal/notification/service.go:145` | Configure real notification providers and move remaining direct send-notification frontend usage behind Go, or treat notifications as best-effort only for pilot. |
| Admin dashboard | PASS with risk | High | `src/components/admin/AdminGuard.tsx:9`, `src/pages/admin/AdminDashboard.tsx:104` | Usable for one admin, but active ride widgets read `status` and may miss `ride_status` transitions. Fix before public launch. |
| Emergency/SOS | PASS with risk | Medium | `src/components/ride/EmergencyButton.tsx:30`, `backend/internal/business/handler.go:150` | Event write and emergency dial exist. Add operator monitoring/manual escalation for pilot day. |
| WebSocket connection | BLOCKED | Medium | `src/lib/goRideSocket.ts:18`, `backend/cmd/server/main.go:284` | Static route exists and backend tests pass, but no live valid-JWT websocket smoke was run in this shell. Run staging smoke before any pilot. |
| Payment failure handling | PASS with limits | Medium | `backend/cmd/server/main.go:362`, `backend/internal/payments/http.go:65`, `backend/.env.example:86` | Provider failure handling exists, but providers are disabled by default. Keep public payments off unless provider certification is complete. |
| Rollback readiness | PASS with runtime gap | Medium | `RUNBOOK.md:142`, `docker-compose.yml:109` | Run Docker rollback rehearsal on the staging host; local Docker runtime checks were previously blocked. |

## Required Launch Checks

| Check | Status | Evidence |
|---|---|---|
| Backend tests pass | PASS | `cd backend; go test ./...` passed. |
| Frontend typecheck passes | PASS | `npx tsc --noEmit -p tsconfig.app.json` passed. |
| Production build passes | PASS | `npm run build` passed with placeholder public env values after rerun outside sandbox EPERM. |
| No committed live secrets found | PASS | Secret scan found env variable names and docs, not live service keys. |
| Env examples complete enough for staging | PASS with gaps | `.env.example` and `backend/.env.example` include core Supabase, Redis, Asynq, dispatch, observability, notification, and payment flags. Real values still required. |
| Production flags safe | PASS | `APP_ENV=production`, `PAYMENTS_PROVIDER_ENABLED=false`, legacy Edge Functions guarded in `supabase/config.toml`. |
| Redis enabled | PASS | `docker-compose.yml:65` defaults `REDIS_ENABLED=true`. |
| Asynq enabled | PASS | `docker-compose.yml:68`, worker service runs `/app/pickme-worker`. |
| Dispatch authoritative | PASS | `docker-compose.yml:71` defaults `DISPATCH_MODE=authoritative`. |
| `/health/ready` works | BLOCKED runtime | Route is registered at `backend/cmd/server/main.go:292`; no live DB-backed server was running in this shell. |
| `/metrics` protected | PASS static | `backend/cmd/server/main.go:297-301` protects outside local/dev. |
| `/test-db` protected | PASS static | `backend/cmd/server/main.go:297-301` protects outside local/dev and hides DB errors in production. |

## Commands Run

```text
cd backend
$env:GOCACHE=(Resolve-Path .).Path + '\.gocache'
go test ./...
PASS
```

```text
npx tsc --noEmit -p tsconfig.app.json
PASS
```

```text
$env:VITE_SUPABASE_URL='https://example.supabase.co'
$env:VITE_SUPABASE_PUBLISHABLE_KEY='placeholder-anon-key'
$env:VITE_GO_BACKEND_URL='http://localhost:3000'
npm run build
PASS after elevated rerun
```

First build attempt failed with local `esbuild` `spawn EPERM`; rerun with elevated process permissions passed. This is an environment restriction, not a code build failure.

## Public Launch Decision

**NO-GO for public launch tomorrow.**

The build is green, but a public launch depends on a reliable ride lifecycle. The current frontend/backend mismatch around offers and ride statuses is critical enough to block public users.

## Minimum Safe Launch Plan For 5 Drivers And 10 Riders Only

Proceed only as a controlled pilot, not public launch:

1. Pre-register and manually verify 10 rider accounts and 5 driver accounts.
2. Pre-approve the 5 driver profiles in the database/admin dashboard.
3. Use **cash rides only** for the first day. Keep `PAYMENTS_PROVIDER_ENABLED=false`.
4. Keep wallet deposits/withdrawals manual and admin-approved only.
5. Run one full supervised staging ride before the pilot: request, driver sees ride, offer, rider accepts, driver starts, driver completes.
6. If the supervised staging ride hits the status/offer mismatch, stop and patch only that contract before inviting riders.
7. Keep one operator watching admin dashboard, backend logs, Redis/Asynq stats, and emergency alerts.
8. Keep phone/WhatsApp fallback dispatch ready for all 5 drivers.
9. Do not advertise or open signup beyond the named 15-person cohort.
10. Rehearse rollback with `docker compose --profile worker --profile scheduler up -d --no-deps backend frontend asynq-worker asynq-scheduler`.

Pilot GO condition: one real staging ride completes end-to-end with a valid rider JWT, valid driver JWT, Redis enabled, Asynq worker running, and `/health/ready` returning 200.

Public launch GO condition: fix and verify the offer/status contract drift, then rerun the full launch smoke suite and k6 staging smoke.
