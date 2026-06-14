# Websocket Event Contract

## Scope

Audited packages:

```text
internal/websocket
internal/rides
internal/drivers
```

This is an audit only. No frontend or backend code was changed.

## Executive Summary

The backend currently emits five JSON websocket event names:

```text
ride_offer
ride_accepted
driver_location
ride_started
ride_completed
```

The websocket transport also echoes arbitrary client messages twice as plain text:

```text
SERVER RECEIVED: {message}
SERVER RECEIVED: {message}
```

No backend producer was found for:

```text
driver.location.update
```

## Event Inventory

| Event | Classification | Producer | Consumer | Purpose |
|---|---|---|---|---|
| `ride_offer` | **CANONICAL** | `internal/rides.Handler.Request` | Registered driver websocket connections | Announces a newly requested ride to eligible drivers exactly once per registered driver connection. |
| `ride_accepted` | **CANONICAL** | `internal/rides.acceptRide`, `internal/rides.acceptOffer` | Rider connection registered for the ride's `rider_id` | Notifies rider that a driver/offer accepted the ride. |
| `driver_location` | **CANONICAL** | `internal/drivers.Handler.UpdateLocation` | Ride room members when `ride_id` is present; otherwise all websocket clients | Realtime driver coordinate update. |
| `ride_started` | **CANONICAL** | `internal/rides.startRide` | Ride room members, rider registry connection, driver registry connection | Notifies ride participants that the accepted ride transitioned to `ongoing`. |
| `ride_completed` | **CANONICAL** | `internal/rides.completeRide` | Ride room members, rider registry connection, driver registry connection | Notifies ride participants that the ongoing ride transitioned to `completed`. |
| `driver.location.update` | **BROKEN** | None found | Unknown/potential frontend realtime listener | Not emitted by the backend. Any client waiting for this event will not receive location updates. |
| `SERVER RECEIVED: ...` | **LEGACY** | `internal/websocket.NewHandler` read loop | The same websocket connection that sent the message | Compatibility echo behavior; not a structured JSON event. |

## Payload Schemas

### `ride_offer`

Producer:

```text
internal/rides/handler.go
```

Payload:

```json
{
  "event": "ride_offer",
  "ride_id": "uuid",
  "rider_id": "uuid",
  "pickup_location": "string",
  "dropoff_location": "string",
  "estimated_fare": 12.34,
  "payment_method": "cash"
}
```

Delivery:

- Directly to every registered driver connection exactly once.
- Not globally broadcast to all websocket clients.

### `ride_accepted`

Producer:

```text
internal/rides/handler.go
```

Payload from legacy direct accept:

```json
{
  "event": "ride_accepted",
  "ride_id": "uuid",
  "driver_id": "uuid",
  "room": "ride_uuid",
  "ride_status": "accepted"
}
```

Payload from offer accept:

```json
{
  "event": "ride_accepted",
  "ride_id": "uuid",
  "driver_id": "uuid",
  "offer_id": "uuid",
  "room": "ride_uuid",
  "ride_status": "accepted"
}
```

Delivery:

- Directly to the rider websocket registered with the ride's `rider_id`.

Note:

`offer_id` is present only on the offer-accept path.

### `driver_location`

Producer:

```text
internal/drivers/handler.go
```

Payload with ride room:

```json
{
  "event": "driver_location",
  "room": "ride_uuid",
  "ride_id": "uuid",
  "driver_id": "uuid",
  "latitude": -20.151,
  "longitude": 28.581,
  "speed": 33.3,
  "heading": 91
}
```

Payload without ride room:

```json
{
  "event": "driver_location",
  "driver_id": "uuid",
  "latitude": -20.151,
  "longitude": 28.581,
  "speed": 33.3,
  "heading": 91
}
```

Delivery:

- If `ride_id` is present: `BroadcastRoom("ride_" + ride_id, payload)`.
- If `ride_id` is absent: `Broadcast(payload)` to all connected clients.

### `ride_started`

Producer:

```text
internal/rides/handler.go
```

Payload:

```json
{
  "event": "ride_started",
  "ride_id": "uuid",
  "driver_id": "uuid",
  "ride_status": "ongoing",
  "room": "ride_uuid"
}
```

Delivery:

- Ride room members.
- Rider registry connection, if present and not already in the room.
- Driver registry connection, if present and not already in the room.

### `ride_completed`

Producer:

```text
internal/rides/handler.go
```

Payload:

```json
{
  "event": "ride_completed",
  "ride_id": "uuid",
  "driver_id": "uuid",
  "ride_status": "completed",
  "room": "ride_uuid"
}
```

Delivery:

- Ride room members.
- Rider registry connection, if present and not already in the room.
- Driver registry connection, if present and not already in the room.

## Specific Location Event Verification

### `driver_location`

Classification:

```text
CANONICAL
```

Why:

- It is the only backend-emitted structured location event.
- It is emitted by `internal/drivers.Handler.UpdateLocation`.
- Runtime verification confirmed it reaches ride room members.

### `driver.location.update`

Classification:

```text
BROKEN
```

Why:

- No backend producer exists.
- Runtime location updates emit `driver_location`, not `driver.location.update`.
- Any client listening only for `driver.location.update` will miss backend location updates.

## Recommended Canonical Contract

For the current API generation, use this single canonical location event:

```text
driver_location
```

Payload:

```json
{
  "event": "driver_location",
  "room": "ride_{ride_id}",
  "ride_id": "uuid",
  "driver_id": "uuid",
  "latitude": -20.151,
  "longitude": 28.581,
  "speed": 33.3,
  "heading": 91
}
```

Reasoning:

- It is already emitted by the backend.
- It is runtime verified.
- It avoids introducing duplicate location events before frontend migration/versioning.

Future versioning note:

If PickMe later standardizes on namespaced dotted event names, migrate explicitly to:

```text
driver.location.update
```

Do that through a versioned websocket protocol and a planned frontend migration, not by silently emitting both names indefinitely.

## Final Classification

```text
ride_offer:             CANONICAL
ride_accepted:          CANONICAL
driver_location:        CANONICAL
ride_started:           CANONICAL
ride_completed:         CANONICAL
driver.location.update: BROKEN
SERVER RECEIVED echo:   LEGACY
```
