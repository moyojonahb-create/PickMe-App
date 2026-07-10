# PickMe Go Websocket Protocol

## Endpoint

```text
GET /ws
```

The websocket endpoint requires a valid Supabase access token during the handshake.

Preferred browser-compatible form:

```text
/ws?access_token={supabase_access_token}
```

Also accepted:

```text
Authorization: Bearer {supabase_access_token}
/ws?token={supabase_access_token}
```

Optional query parameters:

```text
/ws?role=rider
/ws?role=driver
/ws?room=ride_{ride_id}
/ws?access_token={token}&role=rider&room=ride_{ride_id}
/ws?access_token={token}&role=driver&room=ride_{ride_id}
```

## Connection Registration

- `role=rider` registers the websocket as the active rider connection for the authenticated JWT subject.
- `role=driver` registers the websocket as the active driver connection for the authenticated JWT subject.
- `room` joins the websocket to that ride room.
- Every websocket is also tracked as a general connected client.

The server keeps only the latest connection for each rider or driver ID.

Legacy `rider_id` and `driver_id` query parameters are no longer trusted as identity. If present for backward compatibility, they must match the JWT subject or the handshake is rejected with `403`.

Room membership is authorized before the websocket upgrade completes. Only the ride's assigned rider or assigned driver can join `ride_{ride_id}`.

## Inbound Message Rate Limiting

Each connection allows up to 30 inbound client messages (any type — `ping`,
`join_room`, `leave_room`, or unrecognized) per rolling 10-second window.
Exceeding it closes the connection with close code `1008` (policy
violation) and reason `rate limit exceeded`. This has no effect on normal
heartbeat, room join/leave traffic, or `driver_location` delivery, since
driver location updates are submitted over HTTP and only ever sent to
clients, never read from them.

## Server Echo Behavior

For compatibility with the previous backend, arbitrary websocket messages sent by the client are logged and echoed twice:

```text
SERVER RECEIVED: {original message}
SERVER RECEIVED: {original message}
```

## Events

### `ride_offer`

Emitted when `POST /rides/request` creates a ride.

Delivery behavior:

- Sent directly to every registered driver connection.
- Also broadcast to every connected websocket client.

Payload:

```json
{
  "event": "ride_offer",
  "ride_id": "ride uuid",
  "rider_id": "rider uuid",
  "pickup_location": "Pickup text",
  "dropoff_location": "Dropoff text",
  "estimated_fare": 12.34,
  "payment_method": "cash"
}
```

### `ride_accepted`

Emitted when `POST /rides/{id}/accept` successfully accepts a requested ride.

Delivery behavior:

- Sent directly to the rider websocket registered with the ride's `rider_id`.

Payload:

```json
{
  "event": "ride_accepted",
  "ride_id": "ride uuid",
  "driver_id": "driver uuid",
  "room": "ride_ride uuid",
  "ride_status": "accepted"
}
```

### `driver_location`

Emitted when `POST /drivers/location` updates driver coordinates.

Delivery behavior:

- If `ride_id` is present, broadcast to room `ride_{ride_id}`.
- If `ride_id` is absent, broadcast to every connected websocket client.

Payload:

```json
{
  "event": "driver_location",
  "room": "ride_ride uuid",
  "ride_id": "ride uuid",
  "driver_id": "driver uuid",
  "latitude": -20.3,
  "longitude": 30.0,
  "speed": 45.5,
  "heading": 180
}
```

When no `ride_id` is present, `room` and `ride_id` are omitted.

## Room Naming

Ride rooms are named with this exact pattern:

```text
ride_{ride_id}
```

The `/rides/join-room` endpoint returns this room name and a localhost websocket URL for compatibility with the current client flow.

Clients must append `access_token` to that URL before connecting.

## Scaling Considerations

The current protocol state is in-memory. Multi-instance deployments need one of these approaches:

- Sticky websocket sessions at the load balancer.
- A shared pub/sub layer for broadcasts and room messages.
- A dedicated realtime service responsible for websocket fanout.
