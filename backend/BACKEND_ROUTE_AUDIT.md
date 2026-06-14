# Backend Route Audit

## Root Cause Classification

**Wrong binary running**

The source code registers the `/api` compatibility routes and the latest local `server.exe` contains those route strings. The process currently serving `localhost:3000` is an older Go temporary build-cache binary that was started before the `/api` compatibility routes were built.

## Evidence Summary

- Source calls `rides.RegisterCompatibilityRoutes(...)` and `drivers.RegisterCompatibilityRoutes(...)` from `cmd/server/main.go`.
- Local `server.exe` contains `/api/rides` and `/api/drivers/me/*` route strings.
- `main.exe` and `pickme-backend.exe` did not show `/api/rides` route strings.
- The running process is:

```text
ProcessName: server
Path: C:\Users\ntepemanamafm\AppData\Local\go-build\a5\a5423180ba3c99cb1722fb8044e13943dc30b6e81809e65da4d41f47c96ff3b9-d\server.exe
StartTime: 31/05/2026 19:01:50
```

- The current workspace `server.exe` was built later:

```text
C:\Users\ntepemanamafm\Desktop\pickme-go-backend\server.exe
LastWriteTime: 31/05/2026 19:18:06
```

- Runtime probe against `localhost:3000`:

```text
GET  /health       -> 200
POST /rides/request -> 401
POST /api/rides     -> 404
```

That combination means the running backend has the protected legacy routes, but not the newer `/api` compatibility routes.

## Source Route Table

Routes registered by the current source code:

```text
USE  /ws

GET  /
GET  /health
GET  /test-db

GET  /rides
POST /rides/request
POST /rides/:id/accept
POST /rides/:id/start
POST /rides/:id/complete
POST /rides/join-room

POST /api/rides
POST /api/rides/:rideId/offers/:offerId/accept
POST /api/rides/:rideId/status
POST /api/rides/:rideId/complete
POST /api/rides/:rideId/settle

POST /drivers/location
POST /drivers/online
POST /drivers/heartbeat
POST /drivers/offline
GET  /drivers/nearby

POST /api/drivers/me/presence
POST /api/drivers/me/location
```

## `/api` Group Verification

There is no separate Fiber group object for `/api`; the compatibility routes are mounted directly with absolute paths:

```go
app.Post("/api/rides", requireAuth, h.Request)
app.Post("/api/rides/:rideId/offers/:offerId/accept", requireAuth, h.AcceptOffer)
app.Post("/api/rides/:rideId/status", requireAuth, h.UpdateStatus)
app.Post("/api/rides/:rideId/complete", requireAuth, h.CompleteRide)
app.Post("/api/rides/:rideId/settle", requireAuth, h.SettleRide)

app.Post("/api/drivers/me/presence", requireAuth, h.Presence)
app.Post("/api/drivers/me/location", requireAuth, h.UpdateLocation)
```

This is valid Fiber registration. The lack of an `api := app.Group("/api")` is not the cause of the 404s.

## Registration Call Verification

`cmd/server/main.go` calls both compatibility registration functions:

```go
rideHandler := rides.NewHandler(dbpool, wsManager, riderRegistry, driverRegistry)
driverHandler := drivers.NewHandler(dbpool, wsManager)

rides.RegisterRoutes(app, rideHandler, requireAuth)
rides.RegisterCompatibilityRoutes(app, rideHandler, requireAuth)
drivers.RegisterRoutes(app, driverHandler, requireAuth)
drivers.RegisterCompatibilityRoutes(app, driverHandler, requireAuth)
```

Therefore the routes are not missing from source registration.

## Binary Comparison

Known local binaries:

```text
main.exe           17,483,776 bytes  30/05/2026 23:06:06
pickme-backend.exe 17,506,304 bytes  31/05/2026 00:28:51
server.exe         17,598,464 bytes  31/05/2026 19:18:06
```

String scan results:

```text
server.exe contains:
- /api/rides
- /api/rides/:rideId/offers/:offerId/accept
- /api/rides/:rideId/status
- /api/rides/:rideId/complete
- /api/rides/:rideId/settle
- /api/drivers/me/presence
- /api/drivers/me/location

main.exe:
- no /api/rides route string found

pickme-backend.exe:
- no /api/rides route string found
```

The running Go build-cache binary also does not contain `/api/rides`; it does contain older route strings such as `/rides/request` and `/drivers/location`.

## Runtime Behavior

Observed against `localhost:3000`:

```text
GET  /              -> 200
GET  /health        -> 200
GET  /test-db       -> 200
POST /rides/request -> 401 Authorization header is required
POST /api/rides     -> 404 Cannot POST /api/rides
```

Expected if the latest source or latest `server.exe` were running:

```text
POST /api/rides -> 401 Authorization header is required
```

Because the runtime returns `404`, the running process does not have the compatibility routes mounted.

## Duplicate Entrypoint Check

Current source has one active server entrypoint:

```text
cmd/server/main.go
```

The old root `main.go` is deleted in the working tree. The old binaries remain in the workspace:

```text
main.exe
pickme-backend.exe
server.exe
```

These binaries are different builds from different points in time. Only the latest `server.exe` contains the `/api` compatibility routes.

## Exact Cause

The backend currently responding on `localhost:3000` is not the latest compatibility build.

It is an older temporary binary under:

```text
C:\Users\ntepemanamafm\AppData\Local\go-build\a5\...\server.exe
```

That process was started at:

```text
31/05/2026 19:01:50
```

The compatibility build was produced later at:

```text
31/05/2026 19:18:06
```

So runtime verification is hitting an old running process. The `/api` routes are registered in source and present in the latest built `server.exe`, but they are absent from the currently running binary.

## Final Classification

```text
Wrong binary running
```

Not:

- Route never registered
- Route registered but not mounted
- Wrong repository/build
- Runtime configuration issue
