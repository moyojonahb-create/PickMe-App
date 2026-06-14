# Ride Room Runtime Verification

## Scope

Runtime verification was executed against the running backend and Supabase.

No frontend code was modified. Redis, Kafka, and Phase B2 were not started.

## Runtime Context

Running backend:

```text
GET /health -> 200
Process: server.exe
Path: C:\Users\ntepemanamafm\Desktop\pickme-go-backend\server.exe
```

Transport used:

```text
Raw websocket connection to /ws?access_token={jwt}
```

The backend currently accepts raw websocket clients at `/ws`; a probe message received the legacy echo response:

```text
SERVER RECEIVED: hello
```

Auth fixture limitation:

```text
The connected Supabase project currently exposes one auth.users row.
```

The same authenticated user was used as rider and driver for runtime room checks. This is valid for authorization mechanics because the backend derives identity from JWT `sub`, and the created verification ride was assigned to that same user before room/location checks.

## Verification Results

| Requirement | Classification | Evidence |
|---|---|---|
| `ride_{rideId}` rooms exist | **VERIFIED** | Rider and driver websocket connections opened with `room=ride_e9a66ddb-e3d5-475c-8129-fd7b783186aa`. |
| Rider can join room | **VERIFIED** | Authenticated rider websocket opened successfully with `role=rider&room=ride_e9a66ddb-e3d5-475c-8129-fd7b783186aa`. |
| Driver can join room | **VERIFIED** | Authenticated assigned driver websocket opened successfully with `role=driver&room=ride_e9a66ddb-e3d5-475c-8129-fd7b783186aa`. |
| Unauthorized users are rejected | **VERIFIED** | JWT for unassigned user was rejected during handshake with HTTP `403`; websocket client saw `Unexpected server response: 403`. |
| Driver location updates are delivered to room members | **VERIFIED** | `POST /api/drivers/me/location` returned `200`; both rider and driver room sockets received `driver_location`. |
| `ride_accepted` event reaches rider | **VERIFIED** | Rider socket received `{"event":"ride_accepted", ...}` after offer acceptance. |
| `ride_started` event reaches rider | **VERIFIED** | Re-verified after lifecycle implementation; room members plus rider/driver registry sockets received exactly one `ride_started`. |
| `ride_completed` event reaches rider | **VERIFIED** | Re-verified after lifecycle implementation; room members plus rider/driver registry sockets received exactly one `ride_completed`. |
| Websocket disconnect cleanup works | **PARTIALLY IMPLEMENTED** | Runtime sockets closed cleanly; source calls `manager.RemoveClient` and `manager.LeaveRoom` in `defer`. There is no runtime introspection endpoint to prove manager room counts after disconnect. |
| Connection registry cleanup works | **PARTIALLY IMPLEMENTED** | Runtime registered rider socket closed cleanly and a later accept succeeded without crashing; source deletes rider/driver registry entries in `defer`. There is no runtime endpoint to inspect registry counts. |

## Runtime Event Evidence

### `ride_accepted`

Received by rider websocket:

```json
{
  "driver_id": "bf25d517-425f-4cf0-9cae-ef644e4729fd",
  "event": "ride_accepted",
  "offer_id": "20d2e61a-0545-4e29-82b6-60ae435f9ac8",
  "ride_id": "afa843b5-7e68-4a4c-8ca6-c93fe9c49360",
  "ride_status": "accepted",
  "room": "ride_afa843b5-7e68-4a4c-8ca6-c93fe9c49360"
}
```

### `driver_location`

Received by rider and driver room members:

```json
{
  "event": "driver_location",
  "room": "ride_e9a66ddb-e3d5-475c-8129-fd7b783186aa",
  "ride_id": "e9a66ddb-e3d5-475c-8129-fd7b783186aa",
  "driver_id": "bf25d517-425f-4cf0-9cae-ef644e4729fd",
  "latitude": -20.151,
  "longitude": 28.581,
  "speed": 33.3,
  "heading": 91
}
```

## Authorization Checks

Room authorization is enforced before websocket upgrade:

```sql
SELECT EXISTS (
  SELECT 1
  FROM public.rides
  WHERE id = $1
    AND (
      rider_id = $2
      OR driver_id = $2
    )
)
```

Runtime unauthorized probe:

```text
opened=false
closed=true
error=Unexpected server response: 403
```

## Disconnect And Registry Cleanup

Source behavior:

```text
manager.RemoveClient(kws)
manager.LeaveRoom(roomID, kws)
drivers.Delete(userID)
riders.Delete(userID)
```

Classification:

```text
PARTIALLY IMPLEMENTED
```

Reason:

- Cleanup paths exist in source.
- Runtime sockets closed without crashing.
- There is no admin/debug endpoint exposing websocket manager room size, client count, or registry count after disconnect, so cleanup cannot be fully proven externally.

## Lifecycle Update

The previously broken lifecycle notifications were implemented and re-verified in:

```text
WEBSOCKET_LIFECYCLE_RUNTIME_VERIFICATION.md
```

`ride_started` and `ride_completed` are now delivered to:

- ride room members
- rider registry connection
- driver registry connection

Remaining operational improvement:

```text
Add internal/runtime-observable diagnostics for websocket manager and registry cleanup if operational verification is required without reading process memory.
```

## Final Classification

```text
ride rooms:                  VERIFIED
rider room join:             VERIFIED
driver room join:            VERIFIED
unauthorized join rejection: VERIFIED
driver location fanout:      VERIFIED
ride_accepted delivery:      VERIFIED
ride_started delivery:       VERIFIED
ride_completed delivery:     VERIFIED
disconnect cleanup:          PARTIALLY IMPLEMENTED
registry cleanup:            PARTIALLY IMPLEMENTED
```
