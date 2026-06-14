# Go Core V1 Acceptance Report

## Summary

Final Go Core V1 acceptance testing was executed against:

```text
Frontend-like client -> Go Backend -> Supabase -> WebSockets
```

No frontend code was modified. No wallet code was modified.

The test used a simulated frontend client that exercised the production API contract over HTTP and raw websocket connections. Final database state was verified directly against Supabase.

## Runtime Context

Backend:

```text
GET /health -> 200
Process: server.exe
Path: C:\Users\ntepemanamafm\Desktop\pickme-go-backend\server.exe
```

Test identity:

```text
auth_subject: bf25d517-425f-4cf0-9cae-ef644e4729fd
```

Fixture note:

```text
The connected Supabase project currently exposes one auth.users row, so the same authenticated subject was used as rider and driver.
```

Acceptance ride:

```text
ride_id:  6a6ef0b7-bfdb-40ab-bd2b-6ab843c1c96f
offer_id: 09e3b4a4-040f-4c66-9b05-0e627e3ca080
```

## Acceptance Results

| Step | Classification | Evidence |
|---|---|---|
| 1. Rider creates ride | **PASS** | `POST /api/rides -> 201`, ride `6a6ef0b7-bfdb-40ab-bd2b-6ab843c1c96f` created. |
| 2. Driver receives `ride_offer` | **PASS** | Driver websocket received exactly one `ride_offer` for the ride after deduplication. |
| 3. Driver submits offer | **PASS** | `POST /api/rides/:rideId/offers -> 201`, offer `09e3b4a4-040f-4c66-9b05-0e627e3ca080` created. |
| 4. Rider views offers | **PASS** | `GET /api/rides/:rideId/offers -> 200`, pending offer was returned. |
| 5. Rider accepts offer | **PASS** | `POST /api/rides/:rideId/offers/:offerId/accept -> 200`; rider websocket received exactly one `ride_accepted`. |
| 6. Driver starts ride | **PASS** | `POST /api/rides/:rideId/status -> 200`; `ride_started` reached room members plus rider/driver registry sockets exactly once. |
| 7. `driver_location` fanout works | **PASS** | `POST /api/drivers/me/location -> 200`; both room members received `driver_location`. |
| 8. Driver completes ride | **PASS** | `POST /api/rides/:rideId/complete -> 200`; `ride_completed` reached room members plus rider/driver registry sockets exactly once. |
| 9. Duplicate protections work | **PASS** | Duplicate accept, start, and complete all returned `409`; lifecycle event counts remained exactly one per connection. |
| 10. Database state is correct | **PASS** | `public.rides.ride_status = completed`, `public.rides.driver_id` set, `public.ride_offers.status = accepted`, `accepted_at` populated, driver location row present. |

## Websocket Evidence

### `ride_offer`

Driver registry websocket received:

```json
{
  "event": "ride_offer",
  "ride_id": "6a6ef0b7-bfdb-40ab-bd2b-6ab843c1c96f",
  "rider_id": "bf25d517-425f-4cf0-9cae-ef644e4729fd",
  "pickup_location": "go-core-v1-acceptance-pickup-2",
  "dropoff_location": "go-core-v1-acceptance-dropoff-2",
  "estimated_fare": 10.5,
  "payment_method": "cash"
}
```

### `ride_accepted`

Rider registry websocket received exactly one:

```json
{
  "driver_id": "bf25d517-425f-4cf0-9cae-ef644e4729fd",
  "event": "ride_accepted",
  "offer_id": "09e3b4a4-040f-4c66-9b05-0e627e3ca080",
  "ride_id": "6a6ef0b7-bfdb-40ab-bd2b-6ab843c1c96f",
  "ride_status": "accepted",
  "room": "ride_6a6ef0b7-bfdb-40ab-bd2b-6ab843c1c96f"
}
```

### `ride_started`

Each tested connection received exactly one `ride_started`:

```text
rider-room-member:  1
driver-room-member: 1
rider-registry:     1
driver-registry:    1
```

Payload:

```json
{
  "event": "ride_started",
  "ride_id": "6a6ef0b7-bfdb-40ab-bd2b-6ab843c1c96f",
  "driver_id": "bf25d517-425f-4cf0-9cae-ef644e4729fd",
  "ride_status": "ongoing",
  "room": "ride_6a6ef0b7-bfdb-40ab-bd2b-6ab843c1c96f"
}
```

### `driver_location`

Both ride room members received:

```json
{
  "event": "driver_location",
  "room": "ride_6a6ef0b7-bfdb-40ab-bd2b-6ab843c1c96f",
  "ride_id": "6a6ef0b7-bfdb-40ab-bd2b-6ab843c1c96f",
  "driver_id": "bf25d517-425f-4cf0-9cae-ef644e4729fd",
  "latitude": -20.151,
  "longitude": 28.581,
  "speed": 33.3,
  "heading": 91
}
```

### `ride_completed`

Each tested connection received exactly one `ride_completed`:

```text
rider-room-member:  1
driver-room-member: 1
rider-registry:     1
driver-registry:    1
```

Payload:

```json
{
  "event": "ride_completed",
  "ride_id": "6a6ef0b7-bfdb-40ab-bd2b-6ab843c1c96f",
  "driver_id": "bf25d517-425f-4cf0-9cae-ef644e4729fd",
  "ride_status": "completed",
  "room": "ride_6a6ef0b7-bfdb-40ab-bd2b-6ab843c1c96f"
}
```

## Duplicate Protection

| Duplicate action | Classification | Evidence |
|---|---|---|
| Accept already accepted offer | **PASS** | `409 {"error":"Offer is not pending"}` |
| Start already ongoing ride | **PASS** | `409`; all `ride_started` counts remained `1`. |
| Complete already completed ride | **PASS** | `409`; all `ride_completed` counts remained `1`. |

## Database State

Direct Supabase verification:

```json
{
  "ride_id": "6a6ef0b7-bfdb-40ab-bd2b-6ab843c1c96f",
  "offer_id": "09e3b4a4-040f-4c66-9b05-0e627e3ca080",
  "ride_status": "completed",
  "ride_driver_id": "bf25d517-425f-4cf0-9cae-ef644e4729fd",
  "offer_status": "accepted",
  "offer_driver_id": "bf25d517-425f-4cf0-9cae-ef644e4729fd",
  "accepted_at": "2026-05-31T22:59:50.346639Z",
  "driver_location_count": 1,
  "driver_session_online": true
}
```

## Notes

- `ride_offer` is now driver-targeted only and is no longer globally broadcast to every websocket client.
- Driver websocket delivery target is exactly once per registered driver connection.
- Rider/non-driver websocket clients should not rely on receiving `ride_offer`.

## Final Status

```text
GO CORE V1 STATUS:
COMPLETE
```
