# Websocket Lifecycle Runtime Verification

## Summary

Go Core V1 websocket lifecycle notifications are **COMPLETE**.

The running backend was rebuilt and restarted from:

```text
C:\Users\ntepemanamafm\Desktop\pickme-go-backend\server.exe
```

Health check:

```text
GET /health -> 200
```

Runtime verification proved:

- `ride_started` is emitted exactly once after a successful transition to `ongoing`.
- `ride_completed` is emitted exactly once after a successful transition to `completed`.
- Ride room members receive both lifecycle events.
- Rider registry connection receives both lifecycle events.
- Driver registry connection receives both lifecycle events.
- Duplicate lifecycle transitions return `409` and do not emit duplicate lifecycle events.

## Runtime Ride

```text
ride_id: 434e61f1-355d-4dbf-956f-c49b1a7fb14c
room: ride_434e61f1-355d-4dbf-956f-c49b1a7fb14c
driver_id: bf25d517-425f-4cf0-9cae-ef644e4729fd
```

The connected Supabase project currently has one auth user, so the same authenticated subject was used as rider and assigned driver for the runtime verification ride.

## HTTP Transition Results

```text
POST /api/rides/:rideId/status   -> 200
POST /api/rides/:rideId/status   -> 409 duplicate
POST /api/rides/:rideId/complete -> 200
POST /api/rides/:rideId/complete -> 409 duplicate
```

## Event Delivery Results

### `ride_started`

All tested websocket connections received exactly one `ride_started` event.

| Connection | Count | Classification |
|---|---:|---|
| `room-member-a` | 1 | VERIFIED |
| `room-member-b` | 1 | VERIFIED |
| `rider-registry` | 1 | VERIFIED |
| `driver-registry` | 1 | VERIFIED |

Payload:

```json
{
  "event": "ride_started",
  "ride_id": "434e61f1-355d-4dbf-956f-c49b1a7fb14c",
  "driver_id": "bf25d517-425f-4cf0-9cae-ef644e4729fd",
  "ride_status": "ongoing",
  "room": "ride_434e61f1-355d-4dbf-956f-c49b1a7fb14c"
}
```

### `ride_completed`

All tested websocket connections received exactly one `ride_completed` event.

| Connection | Count | Classification |
|---|---:|---|
| `room-member-a` | 1 | VERIFIED |
| `room-member-b` | 1 | VERIFIED |
| `rider-registry` | 1 | VERIFIED |
| `driver-registry` | 1 | VERIFIED |

Payload:

```json
{
  "event": "ride_completed",
  "ride_id": "434e61f1-355d-4dbf-956f-c49b1a7fb14c",
  "driver_id": "bf25d517-425f-4cf0-9cae-ef644e4729fd",
  "ride_status": "completed",
  "room": "ride_434e61f1-355d-4dbf-956f-c49b1a7fb14c"
}
```

## Duplicate Transition Protection

Duplicate start:

```text
POST /api/rides/:rideId/status -> 409
```

Duplicate complete:

```text
POST /api/rides/:rideId/complete -> 409
```

No tested connection received more than one `ride_started` or more than one `ride_completed` event for the ride.

## Code Verification

The lifecycle events are emitted only after conditional ride updates succeed:

```sql
UPDATE public.rides
SET ride_status = 'ongoing',
    started_at = NOW()
WHERE id = $1
  AND ride_status = 'accepted'
  AND driver_id = $2
RETURNING rider_id::text, driver_id::text
```

```sql
UPDATE public.rides
SET ride_status = 'completed',
    completed_at = NOW()
WHERE id = $1
  AND ride_status = 'ongoing'
  AND driver_id = $2
RETURNING rider_id::text, driver_id::text
```

This prevents duplicate event emission when the transition does not occur.

## Test Results

```text
go test ./internal/rides PASS
go test ./...            PASS
go build ./cmd/server    PASS
```

The sandboxed Go test run initially hit Windows build-cache access denial. The required test and build commands passed with normal Go build-cache access.

## Final Classification

```text
Go Core V1 websocket lifecycle: COMPLETE
ride_started:                     VERIFIED
ride_completed:                   VERIFIED
room delivery:                    VERIFIED
rider registry delivery:          VERIFIED
driver registry delivery:         VERIFIED
duplicate transition suppression: VERIFIED
```
