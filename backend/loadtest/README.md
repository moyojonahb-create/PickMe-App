# PickMe Pilot Load Tests

This directory contains GO V2.5-B pilot readiness load-test assets for the Go backend.

## Tools

- k6 for API and WebSocket load tests
- vegeta for fixed-rate HTTP saturation tests
- PowerShell wrappers for Windows operator runs

## Common Environment

```powershell
$env:BASE_URL = "http://localhost:3000"
$env:WS_URL = "ws://localhost:3000/ws"
$env:JWT = "<rider-or-driver-jwt>"
$env:ADMIN_JWT = "<admin-jwt>"
$env:TARGET = "100"
$env:DURATION = "5m"
```

Supported target levels:

- `TARGET=100`
- `TARGET=500`
- `TARGET=1000`
- `TARGET=5000`
- `WS_TARGET=10000`

## k6

```powershell
k6 run .\k6_api_pilot.js
k6 run .\k6_websocket.js
```

## vegeta

```powershell
.\run_vegeta.ps1 -Rate 100 -Duration 5m
```

## Failure Testing

See `failure_testing.md` for Redis, PostgreSQL, notification provider, WebSocket, and queue saturation drills.
