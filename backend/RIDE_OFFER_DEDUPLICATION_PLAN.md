# Ride Offer Deduplication Plan

## Scope

Audit target:

```text
ride_offer websocket delivery
```

No code was changed. This is a plan for review.

## Current Behavior

`internal/rides.Handler.Request` creates a ride, builds a `RideOfferBroadcast`, marshals it once, then sends it through two paths:

```text
1. Direct driver registry delivery:
   for driverID, driverSocket := range h.drivers.Snapshot()
       driverSocket.Conn.WriteMessage(...)

2. Global websocket broadcast:
   h.ws.Broadcast(offerBytes)
```

Because every registered driver websocket is also added to the global websocket manager client set, a connected driver receives the same `ride_offer` twice:

```text
direct driver registry send + global broadcast send = duplicate
```

Runtime acceptance evidence:

```text
Driver websocket received ride_offer_count=2
```

## Goal

Guarantee exactly-once `ride_offer` delivery per eligible driver connection while preserving:

```text
ride creation behavior
ride_accepted behavior
ride_started behavior
ride_completed behavior
driver_location behavior
```

## Classification

```text
ride_offer duplicate delivery: NEEDS BACKEND CHANGE
```

## Design Decision

`ride_offer` should be a driver-targeted event, not a global broadcast.

Canonical delivery path:

```text
registered driver connections only
```

Rationale:

- `ride_offer` is actionable driver work.
- General websocket clients, riders, and unregistered clients should not receive driver offer inventory.
- Existing driver registry already maps authenticated driver identity to the latest active websocket connection.
- Exactly-once per eligible driver connection is easiest to enforce by using one delivery path.

## Recommended Implementation

### 1. Remove Global Broadcast For `ride_offer`

In:

```text
internal/rides/handler.go
```

Inside:

```go
func (h *Handler) Request(c *fiber.Ctx) error
```

Keep:

```go
for driverID, driverSocket := range h.drivers.Snapshot() {
    driverSocket.Conn.WriteMessage(1, offerBytes)
}
```

Remove only the second send path:

```go
h.ws.Broadcast(offerBytes)
```

Also remove or revise the surrounding `BROADCASTING RIDE OFFER` log block so logs do not imply a global broadcast still occurs.

### 2. Preserve Driver Registry Cleanup

Keep this behavior:

```go
if err := driverSocket.Conn.WriteMessage(1, offerBytes); err != nil {
    h.drivers.Delete(driverID)
    continue
}
```

This preserves cleanup for stale driver sockets.

### 3. Do Not Change Other Events

Do not change:

```text
ride_accepted
ride_started
ride_completed
driver_location
```

Especially preserve:

```text
driver_location with ride_id -> room fanout
driver_location without ride_id -> global broadcast
```

## Alternative Considered

### Broadcast With Exclusion Set

Add a websocket manager method such as:

```go
BroadcastExcept(payload []byte, excluded map[*socketio.Websocket]bool)
```

Then send directly to drivers and globally broadcast to everyone except those driver sockets.

Rejected for Go Core V1 because:

- It still sends driver work to non-driver clients.
- It expands the event audience unnecessarily.
- It makes the definition of “eligible driver connection” less clear.

This could be revisited only if product explicitly wants non-driver clients to observe ride marketplace events.

## Test Plan

### Unit Tests

Add or update ride handler tests to prove:

1. `ride_offer` is sent through driver registry delivery.
2. `ride_offer` does not call global websocket broadcast.
3. A stale driver websocket send failure removes that driver from the registry.
4. Ride creation still returns `201` and writes `public.rides`.

Practical test harness option:

- Introduce a small notifier interface for ride request offers, similar to the lifecycle notifier.
- In production, implement it with driver registry delivery.
- In tests, use a fake notifier and assert exactly one send per driver.

Suggested interface:

```go
type rideOfferNotifier interface {
    NotifyRideOffer(payload RideOfferBroadcast)
}
```

Production implementation:

```go
type websocketRideOfferNotifier struct {
    drivers *websocket.ConnectionRegistry
}
```

This avoids brittle tests against real websocket objects.

### Runtime Tests

Run an acceptance test with:

```text
1. open driver websocket with role=driver
2. open rider websocket with role=rider
3. create ride through POST /api/rides
4. assert driver websocket receives exactly one ride_offer
5. assert rider websocket receives zero ride_offer events
6. assert ride creation response remains 201
```

Expected:

```text
driver ride_offer count = 1
rider ride_offer count = 0
```

## Documentation Updates

Update:

```text
WEBSOCKET_EVENT_CONTRACT.md
GO_CORE_V1_ACCEPTANCE_REPORT.md
```

Change `ride_offer` delivery from:

```text
Directly to every registered driver connection.
Broadcast to every connected websocket client.
```

to:

```text
Directly to each registered driver connection exactly once.
```

## Risk Assessment

### Compatibility Risk

Medium.

Any non-driver frontend connection currently relying on global `ride_offer` broadcast will stop receiving it.

Mitigation:

- The product contract should treat `ride_offer` as driver-facing.
- Driver clients should connect with `role=driver`.
- Keep route response behavior unchanged.

### Operational Risk

Low.

This removes a redundant send path and reduces websocket fanout volume.

### Security Risk

Improves.

Ride offers are no longer broadcast to all connected websocket clients.

## Acceptance Criteria

```text
POST /api/rides still creates public.rides row.
Driver websocket receives exactly one ride_offer.
Rider websocket does not receive ride_offer unless also registered as driver.
No global h.ws.Broadcast call is used for ride_offer.
ride_accepted behavior unchanged.
ride_started behavior unchanged.
ride_completed behavior unchanged.
driver_location behavior unchanged.
go test ./... passes.
go build ./cmd/server passes.
Runtime acceptance ride_offer_count becomes 1.
```

## Recommended Final Contract

```text
ride_offer
Producer: internal/rides.Handler.Request
Audience: registered driver websocket connections
Delivery: exactly once per registered driver connection
```

Payload remains unchanged:

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
