# WebSocket Scaling Report

Date: 2026-06-15

Scope: Backend websocket scaling implementation for `backend/internal/websocket`, with Redis Pub/Sub fanout through `backend/internal/redis`. Frontend contracts were not changed.

## Summary

The websocket layer has been upgraded from single-instance in-memory delivery to Redis-backed cross-instance room delivery.

Implemented:

- Redis Pub/Sub primitives.
- Cross-instance room fanout.
- Per-room event sequencing for Redis-delivered room events.
- Server heartbeats.
- Pong/read-deadline enforcement.
- Reconnect replacement for duplicate rider/driver sockets.
- Room recovery through authenticated `join_room` messages.
- Room membership cleanup on disconnect.
- `ws_ready`, `pong`, `room_joined`, `room_left`, and `join_room_denied` control events.

## Files Changed

| File | Change |
|---|---|
| `backend/internal/redis/client.go` | Added `Publish` and blocking `Subscribe` using a dedicated Redis connection |
| `backend/internal/websocket/manager.go` | Added Redis room fanout, local-only delivery, event sequencing, heartbeat pings, per-client room tracking |
| `backend/internal/websocket/handler.go` | Added reconnect replacement, read deadlines, pong handler, room recovery/control messages |
| `backend/cmd/server/main.go` | Wired websocket manager to Redis Pub/Sub at startup |

## Architecture

### Before

```text
Backend instance A
  in-memory rooms
  in-memory rider registry
  in-memory driver registry

Backend instance B
  separate in-memory rooms
  separate rider registry
  separate driver registry
```

If a rider connected to instance A and a driver connected to instance B, `BroadcastRoom` only reached local sockets on the instance that emitted the event.

### After

```text
Backend instance A
  local room delivery
  Redis PUBLISH pickme:ws:rooms

Redis
  Pub/Sub room bus

Backend instance B
  Redis SUBSCRIBE pickme:ws:rooms
  local room delivery
```

`Manager.BroadcastRoom(roomID, payload)` now:

1. Delivers to local sockets in `roomID`.
2. Publishes an internal room envelope to Redis.
3. Other instances receive the envelope.
4. Other instances ignore same-node messages.
5. Other instances sequence-check the message.
6. Other instances deliver the original payload to local sockets in the room.

The frontend still receives the original payload, not the Redis envelope.

## Redis Pub/Sub

Added Redis methods:

```go
Publish(ctx, channel, payload)
Subscribe(ctx, channel, handler)
```

Subscription uses a dedicated Redis connection so blocking `SUBSCRIBE` does not consume or corrupt a pooled command connection.

Default channel:

```text
pickme:ws:rooms
```

## Cross-Instance Room Delivery

Room events are wrapped internally:

```json
{
  "node_id": "backend-node-id",
  "room_id": "ride_<ride_id>",
  "seq": 1,
  "sent_at": "2026-06-15T...",
  "payload": {}
}
```

Only `payload` is delivered to websocket clients. The envelope is backend-only.

## Event Sequencing

The manager now keeps:

- Local outbound sequence per room.
- Highest seen inbound sequence per remote node and room.

Duplicate or out-of-order Redis messages from the same node/room are ignored.

This gives best-effort ordering for room fanout. It does not yet persist sequence history across backend restarts.

## Heartbeats

Implemented server-side heartbeat pings:

```text
defaultPingInterval = 25s
defaultPongWait = 60s
```

The handler sets a pong handler that extends the read deadline. Dead clients are removed when ping/write or read deadline fails.

## Reconnect Logic

When a new authenticated rider or driver connection appears for the same user:

1. The old socket is removed from the manager.
2. The old registry entry is deleted.
3. The new socket becomes the active registered connection.

This prevents duplicate same-user sockets from holding stale driver/rider registry state.

## Room Recovery

On connect, the server still joins the authenticated query-string room when present.

The server now also accepts authenticated control messages:

```json
{ "type": "join_room", "room_id": "ride_<ride_id>" }
```

The backend validates the room with `RoomAuthorizer.CanJoinRideRoom` before joining.

Responses:

- `room_joined`
- `room_left`
- `join_room_denied`
- `pong`
- `ws_ready`

## Production Notes

This implementation makes websocket delivery horizontally viable for ride rooms, but several production items remain:

1. Add a Redis Streams or database-backed event replay buffer for missed messages after long disconnects.
2. Persist sequence checkpoints if strict resume ordering is required.
3. Add metrics: connected sockets, rooms, publish failures, subscribe restarts, dropped backpressure clients, ping timeouts.
4. Add per-user connection limits and rate limits for control messages.
5. Add explicit room leave on ride completion/cancellation.
6. Add Redis Pub/Sub integration tests with a real Redis test container or mock RESP server.
7. Move direct driver/rider single-recipient registries to Redis presence for cross-instance targeted sends.

## Verification

Backend tests:

```text
cd backend
go test ./...
PASS
```

## Verdict

The websocket service now supports cross-instance room delivery for ride rooms and has basic production survivability features: heartbeats, reconnect replacement, room recovery, and event sequencing. It is ready for multi-instance staging, but not yet complete for strict replay/resume guarantees at high scale.
