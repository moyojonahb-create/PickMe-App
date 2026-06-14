# PickMe Offer System Architecture (Phase B1)

## Objective

Design a production-grade driver offer management subsystem for Phase B1 that preserves current frontend compatibility, maintains JWT security, and upgrades the backend from a direct ride acceptance model to a true offer lifecycle.

## Current state (confirmed in source)

- `POST /api/rides/:rideId/offers/:offerId/accept` exists in `internal/rides/handler.go` but ignores `offerId` and updates `public.rides` directly.
- `POST /rides/:id/accept` and `POST /api/rides/:rideId/offers/:offerId/accept` share the same backend accept logic.
- Ride creation in `internal/rides/handler.go` inserts only into `public.rides` and broadcasts a generic `ride_offer` websocket event to all connected drivers.
- No SQL in the repository references `active_driver_offers`.
- Authentication is enforced via `requireAuth` middleware on compatibility routes.

## Phase B1 offer architecture

### Core components

1. `Ride` entity (`public.rides`) remains the canonical request and assignment record.
2. `Offer` entity is the new first-class lifecycle object, stored in `public.active_driver_offers`.
3. Driver offer creation is separated from ride acceptance.
4. Rider selection is driven by explicit offer IDs, not by the raw ride ID.
5. WebSocket remains the realtime transport for offer events, but offer state is sourced from the database.

### High-level flow

1. Rider requests a ride.
2. Backend creates the ride row in `public.rides` with `ride_status = 'requested'`.
3. Backend creates one or more `active_driver_offers` rows for candidate drivers.
4. Drivers receive `ride_offer` websocket messages including the new `offer_id`.
5. Drivers can accept or reject the offer.
6. Rider can inspect multiple active offers via API or realtime updates.
7. Rider chooses one offer and invokes `POST /api/rides/:rideId/offers/:offerId/accept`.
8. Backend validates:
   - offer belongs to ride
   - offer is still active
   - ride is still `requested`
   - offer has not expired/rejected/assigned
9. Backend atomically transitions one offer to `accepted` and the ride to `accepted`.
10. All other active offers for the ride are transitioned to `expired`/`rejected`.

## Offer lifecycle states

- `created` / `pending` — offer emitted to driver candidates.
- `updated` — price, ETA, fee, or metadata changes before acceptance.
- `rejected` — driver explicitly rejects.
- `expired` — TTL reached or ride assigned elsewhere.
- `accepted` — rider chooses the offer and the ride assigns.
- `canceled` — ride canceled before acceptance.

## Safety boundaries

### Prevent duplicate assignment

- Force assignment through offer row validation, not direct ride updates.
- Use SQL `UPDATE ... WHERE ride_id=$1 AND id=$2 AND status='pending' AND expires_at > NOW()`.
- Update ride assignment and offer state in a single transaction.

### Prevent race conditions

- Enforce offer versioning / state conditions in the SQL update predicate.
- Keep `ride_status = 'requested'` and `offer.status = 'pending'` in the same statement.
- Reject conflicting concurrent accepts with `409` if rows affected = 0.
- Expire competing offers immediately after acceptance.

### Prevent accepting expired offers

- Model `expires_at` on `active_driver_offers`.
- Offer acceptance queries must include `expires_at > NOW()`.
- Background cleanup should expire old offers for production hygiene.

## Scaling to 100,000+ rides/day

### Database

- Index `active_driver_offers` by `(ride_id, status, expires_at)` and `(driver_id, status)`.
- Avoid full-table scans for offer lookup.
- Use a narrow `public.active_driver_offers` record structure.

### Realtime

- Stop broadcasting every new ride offer to all drivers in Phase B1.
- Move toward targeted driver offer publishing by geofence or availability shard.
- Preserve current websocket event names for compatibility while migrating payloads.

### Operational

- Keep a small offer TTL (15-30 seconds) for ephemeral availability.
- Use database-controlled expiry rather than client clock.
- Keep acceptance semantically idempotent for the same driver if repeated.

## Compatibility recommendations

- Preserve `/api/rides/:rideId/offers/:offerId/accept` as the new rider-side choice endpoint.
- Preserve `/rides/:id/accept` as a legacy direct-driver shortcut with current semantics, but mark it as deprecated for Phase B1.
- Preserve current JWT auth enforcement on all mutating routes.
- Keep existing websocket `ride_offer`/`ride_accepted` events, but include `offer_id` where applicable.

## Phase B1 architecture decision

Do not treat `public.rides.driver_id` as the offer identifier.
Instead, treat `public.active_driver_offers` as the offer source of truth and bind `driver_id` to the ride only after a validated offer acceptance.
