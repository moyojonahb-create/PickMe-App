# Backend Phase A Compatibility Report

## Summary

Phase A compatibility routes have been added under `/api` without removing or changing the existing legacy routes.

All new `/api` mutation routes use the same Supabase JWT middleware as the existing protected routes. Identity continues to be derived from the JWT subject.

## Routes Added

| New route | Internal mapping | Notes |
|---|---|---|
| `POST /api/rides` | `rides.Handler.Request` | Same behavior as `POST /rides/request`; preserves ride creation DB write and `ride_offer` websocket broadcast. |
| `POST /api/rides/:rideId/offers/:offerId/accept` | `rides.Handler.acceptRide` | Same behavior as `POST /rides/:id/accept`; `offerId` is accepted for route compatibility but not used because the current backend has no persisted offer model. |
| `POST /api/drivers/me/presence` | `drivers.Handler.Presence` adapter to `Online`, `Offline`, or `Heartbeat` | Maps `status`, `state`, `action`, `is_online`, or `online` fields to existing driver presence handlers. Defaults to online to preserve the existing driver-online behavior. |
| `POST /api/drivers/me/location` | `drivers.Handler.UpdateLocation` | Same behavior as `POST /drivers/location`; preserves driver location writes, session update, and websocket broadcasts. |
| `POST /api/rides/:rideId/status` | `rides.Handler.startRide` | Same behavior as `POST /rides/:id/start`; transitions accepted rides to `ongoing`. |
| `POST /api/rides/:rideId/complete` | `rides.Handler.completeRide` | Same behavior as `POST /rides/:id/complete`; transitions ongoing rides to `completed`. |
| `POST /api/rides/:rideId/settle` | `rides.Handler.completeRide` | Compatibility endpoint only; maps to existing completion behavior. No new wallet, payment, or settlement feature was added. |

## Existing Routes Preserved

The following routes remain registered and continue using the existing handlers:

```text
POST /rides/request
POST /rides/:id/accept
POST /rides/:id/start
POST /rides/:id/complete
POST /drivers/location
POST /drivers/online
POST /drivers/heartbeat
POST /drivers/offline
```

## Authorization

All new `/api` routes are protected with:

```text
Authorization: Bearer {supabase_access_token}
```

The backend continues to derive rider and driver identity from the Supabase JWT `sub` claim.

## Implementation Notes

- Ride accept, start, and complete behavior was refactored into shared private methods so legacy and `/api` routes use the same logic.
- Driver presence is the only adapter route because the new frontend collapsed online/offline/heartbeat into a single endpoint.
- No SQL was duplicated for the `/api` layer.
- No websocket broadcast behavior was removed.
- No new product feature was added.

## Verification

```text
go test ./...          PASS
go build ./cmd/server PASS
```

The initial sandboxed runs could not access the normal Go build cache. The commands passed after rerunning with permission to use Go's standard cache directory.
