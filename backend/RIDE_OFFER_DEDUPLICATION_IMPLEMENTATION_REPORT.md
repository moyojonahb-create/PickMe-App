# Ride Offer Deduplication Implementation Report

## Summary

Approved `ride_offer` deduplication was implemented.

`ride_offer` is now delivered only through the registered driver connection registry. The global websocket broadcast path was removed for `ride_offer` only.

Preserved:

```text
ride creation behavior
ride_accepted
ride_started
ride_completed
driver_location
stale driver socket cleanup
API response body/status
```

Not started:

```text
Redis
Kafka
Wallet
Matching Engine
Phase B2
```

## Files Changed

```text
internal/rides/handler.go
internal/rides/handler_test.go
WEBSOCKET_EVENT_CONTRACT.md
GO_CORE_V1_ACCEPTANCE_REPORT.md
RIDE_OFFER_DEDUPLICATION_IMPLEMENTATION_REPORT.md
```

## Code Changes

### Removed Duplicate Delivery

Removed the global broadcast path from `internal/rides.Handler.Request`:

```go
h.ws.Broadcast(offerBytes)
```

Removed the old global broadcast log block:

```text
BROADCASTING RIDE OFFER
Connected Clients
```

### Kept Direct Driver Delivery

Added a dedicated driver-targeted notifier:

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

The notifier sends exactly once to each registered driver connection from:

```go
drivers.Snapshot()
```

### Preserved Stale Socket Cleanup

Still deletes stale driver registry entries when a driver socket write fails:

```go
if err := driverSocket.Conn.WriteMessage(1, payloadBytes); err != nil {
    n.drivers.Delete(driverID)
    continue
}
```

## Tests Added

Added:

```text
TestRequestSendsRideOfferExactlyOnceThroughDriverNotifier
TestRideOfferDoesNotUseGlobalBroadcastPath
```

These prove:

- request creation emits exactly one `ride_offer` through the driver-targeted notifier
- the handler no longer contains `h.ws.Broadcast(offerBytes)`
- the removed global broadcast log path does not return
- `Request` still creates the ride and returns `201`

## Runtime Verification

Runtime verification was executed against the rebuilt server:

```text
Process: server.exe
Path: C:\Users\ntepemanamafm\Desktop\pickme-go-backend\server.exe
```

Probe:

```text
1. open driver websocket with role=driver
2. open rider websocket with role=rider
3. POST /api/rides
4. count ride_offer events on both sockets
```

Result:

```json
{
  "driver_open": true,
  "rider_open": true,
  "create_status": 201,
  "ride_id": "8fa5f1b3-4e5f-4aa3-a386-1a6a79d0cb98",
  "driver_ride_offer_count": 1,
  "rider_ride_offer_count": 0,
  "driver_payload": {
    "event": "ride_offer",
    "ride_id": "8fa5f1b3-4e5f-4aa3-a386-1a6a79d0cb98",
    "rider_id": "bf25d517-425f-4cf0-9cae-ef644e4729fd",
    "pickup_location": "ride-offer-dedupe-pickup",
    "dropoff_location": "ride-offer-dedupe-dropoff",
    "estimated_fare": 10.5,
    "payment_method": "cash"
  },
  "rider_payload": null
}
```

## Verification Commands

```text
go fmt ./...          PASS
go test ./internal/rides PASS
go test ./...        PASS
go build ./cmd/server PASS
```

The Go commands were run with normal Windows Go build-cache access where required.

## Updated Contract

`ride_offer` delivery is now:

```text
Producer: internal/rides.Handler.Request
Audience: registered driver websocket connections
Delivery: exactly once per registered driver connection
```

Payload is unchanged:

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

## Final Classification

```text
ride_offer duplicate delivery: FIXED
driver receives exactly one ride_offer: VERIFIED
rider receives zero ride_offer events: VERIFIED
global broadcast path removed for ride_offer: VERIFIED
ride creation behavior: PRESERVED
other websocket events: PRESERVED
```
