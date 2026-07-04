# Controlled Pilot Preparation Report

Date: 2026-07-02

Scope: PickMe controlled Gwanda pilot preparation using the current local/manual setup. Docker and Ubuntu deployment were intentionally skipped. No backend features, architecture, wallet logic, dispatch logic, or WebSocket contracts were changed.

## Result

Overall status: **NO-GO UNTIL BACKEND RIDE TEST FAILURES ARE RESOLVED**

The repository can be prepared for a controlled pilot from the current manual setup, but the current code verification is not clean. Frontend typecheck passes, while backend ride tests fail in the current workspace. The pilot should not invite the full 5-driver / 10-rider cohort until those failures are resolved and one live supervised ride passes with real Supabase users, database connectivity, Redis, Asynq, and WebSocket behavior.

## Files Changed

- `MANUAL_PILOT_RUNBOOK.md`
- `PILOT_USER_SETUP.md`
- `SUPERVISED_RIDE_TEST_SCRIPT.md`
- `CONTROLLED_PILOT_PREPARATION_REPORT.md`

No product code was changed.

## Manual Commands

### Frontend

```powershell
npm install
npm run dev
```

Open:

```text
http://localhost:5173
```

### Backend

```powershell
cd backend
$env:GOCACHE=(Resolve-Path .).Path + '\.gocache'
go run ./cmd/server
```

### Redis

```powershell
redis-server
redis-cli ping
```

Expected:

```text
PONG
```

### Asynq Worker

```powershell
cd backend
$env:GOCACHE=(Resolve-Path .).Path + '\.gocache'
go run ./cmd/worker
```

### Asynq Scheduler

```powershell
cd backend
$env:GOCACHE=(Resolve-Path .).Path + '\.gocache'
go run ./cmd/scheduler
```

### Health

```powershell
curl.exe -fsS http://localhost:3000/health/live
curl.exe -fsS http://localhost:3000/health/ready
curl.exe -fsS http://localhost:3000/health/dependencies
```

### Admin-Protected Checks

```powershell
curl.exe -fsS -H "Authorization: Bearer $env:ADMIN_JWT" http://localhost:3000/admin/jobs/stats
curl.exe -fsS -H "Authorization: Bearer $env:ADMIN_JWT" http://localhost:3000/metrics
curl.exe -fsS -H "Authorization: Bearer $env:ADMIN_JWT" http://localhost:3000/test-db
```

## Required Environment

Frontend `.env`:

```text
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable-or-anon-key>
VITE_GO_BACKEND_URL=http://localhost:3000
VITE_GOOGLE_MAPS_API_KEY=<browser-google-maps-key-if-used>
PAYMENTS_PROVIDER_ENABLED=false
PUBLIC_WALLET_PILOT_ENABLED=true
PUBLIC_WALLET_PILOT_CITY=Gwanda
```

Backend `backend/.env`:

```text
DATABASE_URL=postgresql://<user>:<password>@<host>:5432/<db>?sslmode=require
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_JWT_SECRET=<supabase-jwt-secret>
PORT=3000
APP_ENV=production
READINESS_PROFILE=pilot
CORS_ALLOW_ORIGINS=http://localhost:5173,http://localhost:8080
REDIS_ENABLED=true
REDIS_URL=redis://localhost:6379/0
ASYNQ_ENABLED=true
ASYNQ_REDIS_URL=redis://localhost:6379/1
DISPATCH_MODE=authoritative
PAYMENTS_PROVIDER_ENABLED=false
PUBLIC_WALLET_PILOT_ENABLED=true
PUBLIC_WALLET_PILOT_CITY=Gwanda
```

## Payment Safety

Required controlled pilot posture:

- `PAYMENTS_PROVIDER_ENABLED=false`
- `ONEMONEY_ENABLED=false`
- `ECOCASH_ENABLED=false`
- `INNBUCKS_ENABLED=false`
- `PAYPAL_ENABLED=false`
- `CARD_PAYMENTS_ENABLED=false`
- Cash-first rides.
- Manual wallet approval only.
- No manual balance edits without finance approval.

## Verification

Required code verification and current result:

```text
cd backend
$env:GOCACHE=(Resolve-Path .).Path + '\.gocache'
go test ./...
FAIL
```

Current backend failures are in `backend/internal/rides`:

- `TestRequestSendsRideOfferExactlyOnceThroughDriverNotifier`
- `TestSubmitOfferSuccessful`
- `TestListOffersReturnsPendingNonExpiredOffers`
- `TestAcceptOfferSuccessful`
- `TestAcceptOfferDuplicateAcceptanceAttempt`
- `TestAcceptOfferRaceConditionReturnsConflict`
- `TestRiderCannotAcceptOfferForAnotherRidersRide`
- `TestCompleteRideEmitsRideCompletedExactlyOnce`

```text
npx tsc --noEmit -p tsconfig.app.json
PASS
```

```text
$env:VITE_SUPABASE_URL='https://example.supabase.co'
$env:VITE_SUPABASE_PUBLISHABLE_KEY='placeholder-anon-key'
$env:VITE_GO_BACKEND_URL='http://localhost:3000'
npm run build -- --logLevel error
BLOCKED in this shell by local escalation/usage limit before execution
```

## GO / NO-GO

**NO-GO for controlled pilot execution until backend ride tests pass.**

**GO for manual preparation only:** operators can create env files, set up pilot users, rehearse commands, and prepare the supervised test script.

**NO-GO for inviting the full 5-driver / 10-rider cohort until backend tests pass and the supervised ride test passes.**

## Remaining Blockers

1. Real Supabase rider, driver, and admin JWTs must be obtained and tested.
2. Backend ride tests must pass.
3. `npm run build` must be rerun in an environment allowed to execute the Vite/esbuild production build.
4. Backend must connect to the real pilot database.
5. Redis must be running for pilot-like rate limiting, WebSocket Pub/Sub, and Asynq behavior.
6. Asynq worker must run successfully if `ASYNQ_ENABLED=true`.
7. One supervised end-to-end ride must pass.
8. Notification providers must either be configured or explicitly treated as best-effort with WhatsApp fallback.
9. Payments must remain cash-first and provider-disabled.
