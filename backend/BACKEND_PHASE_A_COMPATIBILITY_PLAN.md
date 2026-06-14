# Backend Phase A Compatibility Plan

## Objective

Add the new frontend API contract under `/api` without breaking existing routes or duplicating business logic.

The compatibility layer keeps:

- Existing legacy routes.
- Existing JWT middleware.
- Existing identity derivation from JWT subject.
- Existing database writes.
- Existing websocket broadcasts.

## Route Mapping

| New frontend route | Existing backend behavior | Implementation strategy |
|---|---|---|
| `POST /api/rides` | `POST /rides/request` | Reuse ride request handler logic. |
| `POST /api/rides/:rideId/offers/:offerId/accept` | `POST /rides/:id/accept` | Ignore `offerId` for Phase A because the current backend has no offer table; accept by `rideId`. |
| `POST /api/drivers/me/presence` | `POST /drivers/online`, `POST /drivers/offline`, `POST /drivers/heartbeat` | Adapter maps `status`, `state`, `action`, or `is_online` to the existing presence handlers. |
| `POST /api/drivers/me/location` | `POST /drivers/location` | Reuse driver location handler logic. |
| `POST /api/rides/:rideId/status` | `POST /rides/:id/start` | Phase A maps status updates to the existing start transition. |
| `POST /api/rides/:rideId/complete` | `POST /rides/:id/complete` | Reuse ride completion handler logic. |
| `POST /api/rides/:rideId/settle` | `POST /rides/:id/complete` | Phase A maps settle to the only existing terminal ride operation. No wallet/payment settlement behavior is added. |

## Compatibility Constraints

- `/api` routes must remain protected by the same Supabase JWT middleware as legacy mutation routes.
- `/api` route adapters must call shared private methods, not copy SQL or websocket logic.
- `offerId` is accepted in the route shape but not persisted or interpreted because the current backend has no ride offer persistence model.
- `settle` is a compatibility endpoint only. It does not introduce payment settlement, wallet writes, or fare reconciliation.

## Risk Controls

- Keep legacy routes registered exactly as they are.
- Keep response bodies as close as possible to legacy handler responses.
- Reuse existing authorization checks so clients cannot pass another rider or driver ID.
- Preserve websocket side effects from ride creation, ride acceptance, and driver location updates.

## Verification

After implementation:

```bash
go test ./...
go build ./cmd/server
```
