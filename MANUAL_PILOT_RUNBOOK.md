# Manual Pilot Runbook

Date: 2026-07-02

Scope: local/manual Gwanda controlled pilot operation without Docker or Ubuntu deployment. This runbook assumes the current workstation or manually managed host can run Node, Go, Supabase connectivity, and optionally Redis.

## Required Local Tools

- Node.js 20 or 22.
- Go matching `backend/go.mod`.
- Git.
- Redis, optional but strongly recommended for pilot-like WebSocket, rate-limit, and Asynq behavior.
- Browser with location and notification permissions enabled.

## Environment Files

Root frontend env:

```powershell
Copy-Item .env.example .env
notepad .env
```

Minimum root `.env` values:

```text
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<supabase-publishable-or-anon-key>
VITE_GO_BACKEND_URL=http://localhost:3000
VITE_GOOGLE_MAPS_API_KEY=<browser-google-maps-key-if-used>
PAYMENTS_PROVIDER_ENABLED=false
PUBLIC_WALLET_PILOT_ENABLED=true
PUBLIC_WALLET_PILOT_CITY=Gwanda
```

Backend env:

```powershell
Copy-Item backend/.env.example backend/.env
notepad backend/.env
```

Minimum `backend/.env` values:

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

If Redis is not available for a dry local UI check only:

```text
REDIS_ENABLED=false
ASYNQ_ENABLED=false
```

Do not use that mode for pilot signoff.

## Start Redis Manually

Windows with Redis installed:

```powershell
redis-server
```

Windows with WSL:

```powershell
wsl redis-server
```

Verify:

```powershell
redis-cli ping
```

Expected:

```text
PONG
```

## Start Backend Manually

Terminal 1:

```powershell
cd backend
$env:GOCACHE=(Resolve-Path .).Path + '\.gocache'
go run ./cmd/server
```

Verify:

```powershell
curl.exe -fsS http://localhost:3000/health/live
curl.exe -fsS http://localhost:3000/health/ready
curl.exe -fsS http://localhost:3000/health/dependencies
```

## Start Asynq Worker Manually

Terminal 2:

```powershell
cd backend
$env:GOCACHE=(Resolve-Path .).Path + '\.gocache'
go run ./cmd/worker
```

Only run this when Redis is available and `ASYNQ_ENABLED=true`.

## Start Asynq Scheduler Manually

Terminal 3:

```powershell
cd backend
$env:GOCACHE=(Resolve-Path .).Path + '\.gocache'
go run ./cmd/scheduler
```

The current scheduler may start with no recurring jobs registered. That is acceptable for the controlled pilot.

## Start Frontend Manually

Terminal 4:

```powershell
npm install
npm run dev
```

Open:

```text
http://localhost:5173
```

Alternative if using Bun:

```powershell
bun install
bun run dev
```

## Get Rider, Driver, And Admin JWTs

Preferred browser method:

1. Open `http://localhost:5173`.
2. Log in as the rider, driver, or admin account.
3. Open browser DevTools.
4. Go to Application > Local Storage.
5. Find the Supabase auth key for the configured project.
6. Copy the `access_token` from the current session JSON.

PowerShell helper from the browser console token:

```powershell
$env:RIDER_JWT='<rider-access-token>'
$env:DRIVER_JWT='<driver-access-token>'
$env:ADMIN_JWT='<admin-access-token>'
```

CLI method with Supabase Auth password grant, if password login is enabled:

```powershell
$body = @{
  email = "rider1@example.com"
  password = "<password>"
} | ConvertTo-Json

$resp = Invoke-RestMethod `
  -Method Post `
  -Uri "$env:VITE_SUPABASE_URL/auth/v1/token?grant_type=password" `
  -Headers @{
    apikey = $env:VITE_SUPABASE_PUBLISHABLE_KEY
    "Content-Type" = "application/json"
  } `
  -Body $body

$env:RIDER_JWT = $resp.access_token
```

Repeat with driver and admin credentials.

## Admin Checks

```powershell
curl.exe -fsS -H "Authorization: Bearer $env:ADMIN_JWT" http://localhost:3000/admin/jobs/stats
curl.exe -fsS -H "Authorization: Bearer $env:ADMIN_JWT" http://localhost:3000/metrics
curl.exe -fsS -H "Authorization: Bearer $env:ADMIN_JWT" http://localhost:3000/test-db
```

## One Test Ride

1. Start Redis, backend, worker, optional scheduler, and frontend.
2. Confirm `/health/ready` and `/health/dependencies`.
3. Log in as one rider in one browser profile.
4. Log in as one approved driver in another browser profile or device.
5. Driver goes online and grants location permission.
6. Rider requests a Gwanda ride using cash.
7. Driver sees the open ride or offer card.
8. Driver sends offer.
9. Rider sees offer and accepts.
10. Driver sets enroute.
11. Driver sets arrived.
12. Driver starts ride.
13. Driver completes ride.
14. Rider rates ride.
15. Admin verifies ride state, logs, and job stats.

## Payment Safety

Keep these values for the controlled pilot:

```text
PAYMENTS_PROVIDER_ENABLED=false
ONEMONEY_ENABLED=false
ECOCASH_ENABLED=false
INNBUCKS_ENABLED=false
PAYPAL_ENABLED=false
CARD_PAYMENTS_ENABLED=false
```

Use cash-first operations and manual wallet approval only.
