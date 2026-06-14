# Offer System API Specification

## Purpose

Define the Phase B1 API surface for driver offers while preserving the existing JWT security model and compatibility with current frontend routes.

## Authentication

- All offer management endpoints require the same `requireAuth` JWT middleware already used by `/api` compatibility routes.
- The authenticated user identity is derived from the JWT subject.
- Driver actions must operate only on the authenticated driver ID.
- Rider actions must operate only on the authenticated rider ID.

## Existing compatibility routes

### `POST /api/rides`

- Reuses current `Request` behavior.
- Creates a ride with `ride_status = 'requested'`.
- Returns `ride_id`, `ride_status`, `created_at`.
- Continues broadcasting `ride_offer` events to drivers.

### `POST /api/rides/:rideId/offers/:offerId/accept`

- Must be upgraded to validate the selected offer ID.
- Request body:
  - `driver_id` (optional, must match authenticated driver)
- Behavior:
  - confirm `offerId` belongs to `rideId`
  - confirm offer is `pending`
  - confirm offer has not expired
  - confirm ride is still `requested`
  - atomically set `offer.status = 'accepted'` and `ride.driver_id = driver_id`
  - expire or reject competing offers for `rideId`
- Response:
  - `message`
  - `ride_id`
  - `offer_id`
  - `driver_id`
  - `ride_status`
  - `room`

> This endpoint remains the primary rider-side choice point for Phase B1.

### `POST /api/rides/:rideId/status`

- Preserved for compatibility; maps to `start` semantics.
- Should continue to require ride assignment and update `ride_status = 'ongoing'`.

### `POST /api/rides/:rideId/complete`

- Preserved for compatibility; continues to complete the ride.

### `POST /api/rides/:rideId/settle`

- Preserved for compatibility; remains a terminal ride operation only.

## New offer lifecycle endpoints

### `GET /api/rides/:rideId/offers`

- Returns the current active offers for a ride.
- This enables rider-side choice among multiple offers.
- Response fields:
  - `offer_id`
  - `driver_id`
  - `status`
  - `expires_at`
  - `estimated_fare`
  - `eta` (optional)
  - `platform_fee` (optional)
  - `created_at`
  - `updated_at`

> This endpoint is required to support riders selecting among multiple driver proposals.

### `POST /api/rides/:rideId/offers/:offerId/reject`

- Driver rejects a specific offer.
- Validates `driver_id` and `offerId` ownership.
- Only `pending` offers can be rejected.
- Transitions offer to `rejected`.
- Response includes `offer_id` and `status`.

### `PATCH /api/rides/:rideId/offers/:offerId`

- Optional for driver-side updates before acceptance.
- Should allow update of mutable metadata such as ETA, price proposal, or fee details.
- Request body may include:
  - `estimated_fare`
  - `eta`
  - `platform_fee`
  - `metadata`
- Validates `pending` status and authenticated driver.
- Returns updated offer snapshot.

## WebSocket contract updates

### Current realtime messages

- `ride_offer` — broadcast to drivers from `internal/rides/handler.go`.
- `ride_accepted` — sent to rider on driver acceptance.

### Phase B1 required additions

- `ride_offer` payload must include `offer_id`.
- `ride_offers_updated` or `offer_state_change` should be emitted to the rider when offers change.
- `ride_accepted` payload should include `offer_id` and `driver_id`.

## Backward-compatibility guidance

- Keep `POST /api/rides/:rideId/offers/:offerId/accept` but change semantics from "accept by ride" to "accept by validated offer".
- Keep `POST /rides/:id/accept` for legacy clients, but treat it as a deprecated direct accept shortcut.
- Do not change the existing JWT enforcement or body validation behavior for current compatibility routes.
- Preserve the current `ride_offer` event name unless absolutely necessary; only extend payload with `offer_id`.

## Error model

- `400` — malformed request body or missing fields.
- `401` — unauthenticated request.
- `403` — driver/rider mismatch, unauthorized action.
- `404` — ride not found or offer not found.
- `409` — offer already accepted/rejected/expired, ride already assigned, or concurrent assignment conflict.
- `500` — unexpected backend error.
