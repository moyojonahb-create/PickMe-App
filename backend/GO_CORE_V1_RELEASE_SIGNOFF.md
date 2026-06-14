# GO Core V1 Release Signoff

## Release Decision

```text
PRODUCTION READY
```

PickMe Go Core V1 and Frontend F1 are ready for production release from the current repository state after staging only the intended source and release documentation files.

## Audit Of Uncommitted Changes

Tracked changes:

```text
M  go.mod
M  go.sum
D  main.go
```

Untracked source directories:

```text
cmd/
internal/
```

Untracked release and architecture documentation created for this pass:

```text
ARCHITECTURE_BASELINE_V1.md
RELEASE_NOTES_V1.md
DEPLOYMENT_CHECKLIST_V1.md
V2_ROADMAP.md
GO_CORE_V1_RELEASE_SIGNOFF.md
GO_CORE_V1_FINAL_SIGNOFF.md
GO_CORE_V1_ACCEPTANCE_REPORT.md
WEBSOCKET_EVENT_CONTRACT.md
WEBSOCKET_LIFECYCLE_RUNTIME_VERIFICATION.md
RIDE_ROOM_RUNTIME_VERIFICATION.md
RIDE_OFFER_DEDUPLICATION_IMPLEMENTATION_REPORT.md
```

Additional untracked V1 evidence, plans, reviews, route audits, schema reports, and SQL artifacts are present in the working tree. They are documentation/schema artifacts, not generated binaries. They can be included in the release commit as supporting release history.

Generated/local artifacts that must not be committed:

```text
main.exe
pickme-backend.exe
server.exe
server.exe~
*.log
.vscode/
```

`.gitignore` was updated to exclude generated Windows binaries, log files, and local editor settings.

## Go Core V1 Feature Verification

| Feature | Status | Source |
|---|---:|---|
| Modular server entry point | PASS | `cmd/server/main.go` |
| Supabase JWT auth middleware | PASS | `internal/auth/supabase_jwt.go`, `internal/middleware/auth.go` |
| Authenticated ride request | PASS | `internal/rides/handler.go` |
| Authenticated driver presence | PASS | `internal/drivers/handler.go` |
| Driver-targeted ride_offer | PASS | `internal/rides/handler.go` |
| Driver offer submission | PASS | `internal/rides/handler.go` |
| Rider offer listing | PASS | `internal/rides/handler.go` |
| Rider offer acceptance | PASS | `internal/rides/handler.go` |
| Offer TTL expiration | PASS | `internal/rides/handler.go` |
| Race-condition protection | PASS | `internal/rides/handler.go` |
| Driver location update | PASS | `internal/drivers/handler.go` |
| Ride start/complete lifecycle | PASS | `internal/rides/handler.go` |
| Room authorization | PASS | `internal/websocket/authorizer.go` |
| Websocket registries | PASS | `internal/websocket/registry.go` |

## Frontend F1 Integration Verification

Frontend F1 compatibility routes are registered in `internal/rides/handler.go` and `internal/drivers/handler.go`:

```text
POST /api/rides
POST /api/rides/:rideId/offers
GET  /api/rides/:rideId/offers
POST /api/rides/:rideId/offers/:offerId/accept
POST /api/rides/:rideId/offers/:offerId/reject
POST /api/rides/:rideId/status
POST /api/rides/:rideId/complete
POST /api/rides/:rideId/settle
POST /api/drivers/me/presence
POST /api/drivers/me/location
```

Final staging validation in `GO_CORE_V1_FINAL_SIGNOFF.md` verified the full Frontend F1 rider-driver journey.

## Legacy Marketplace Table Verification

Active Go ride offer flow uses:

```text
public.ride_offers
```

The active Go ride flow does not use:

```text
app.ride_requests
app.ride_offers
app.rides
app.offers
app.driver_offers
public.active_driver_offers
public.driver_offers
```

This is verified by `TestOfferSQLDoesNotUseLegacyMarketplaceTables` in `internal/rides/handler_test.go`.

## Canonical Websocket Events

Verified canonical events:

```text
ride_offer
ride_accepted
driver_location
ride_started
ride_completed
```

Delivery contract:

```text
ride_offer       driver registry only
ride_accepted    rider registry
driver_location  ride room when ride_id is supplied
ride_started     ride room plus rider/driver registry fallback
ride_completed   ride room plus rider/driver registry fallback
```

## Build And Test Verification

Release verification executed:

```text
go test ./...          PASS
go build ./cmd/server PASS
```

## Required Git Commands For Release

Use these exact commands from the repository root. The `.gitignore` in this release excludes local binaries, logs, `.env`, `node_modules`, and `.vscode`, so `git add -A` stages source, docs, SQL artifacts, and the root `main.go` deletion without staging local generated artifacts.

```bash
git status --short
git add -A
git status --short
go test ./...
go build ./cmd/server
git commit -m "Release Go Core V1 and Frontend F1 integration"
git tag -a v1.0.0-go-core-f1 -m "PickMe Go Core V1 and Frontend F1 production release"
git push origin HEAD
git push origin v1.0.0-go-core-f1
```

Do not stage:

```text
main.exe
pickme-backend.exe
server.exe
server.exe~
*.log
.vscode/
```

## GitHub Release Tag Recommendation

```text
v1.0.0-go-core-f1
```

GitHub release title:

```text
PickMe Go Core V1 + Frontend F1 Production Release
```

## Final Signoff

```text
GO CORE V1 = PRODUCTION READY
FRONTEND F1 = PRODUCTION READY
```
