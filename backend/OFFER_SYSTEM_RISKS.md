# Offer System Risks

## Current implementation risks

1. `offerId` is ignored
   - `POST /api/rides/:rideId/offers/:offerId/accept` does not validate the offer.
   - This makes the endpoint effectively identical to `POST /rides/:id/accept`.
   - Result: riders cannot safely choose among multiple offers.

2. No `active_driver_offers` persistence
   - No SQL references the production table.
   - Offers are not stored or audited, so driver-side state is ephemeral and unreliable.
   - Result: driver assignment cannot be reconciled against the offer market.

3. Direct ride assignment without offer binding
   - `public.rides` is updated directly on acceptance.
   - No check exists that the accepting driver was the intended candidate.
   - Result: a driver can accept a ride that was offered to others, breaking marketplace guarantees.

4. Missing expiration guard
   - There is no offer TTL or expiration state.
   - Expired or stale offers can still be accepted if the backend is not updated.
   - Result: potential assignments to unavailable drivers or outdated proposals.

5. Scalability gap
   - Current flow broadcasts all new ride requests to all connected drivers.
   - At 100,000+ rides/day, this becomes a broadcast storm.
   - Result: performance collapse without a targeted offer distribution strategy.

## Proposed Phase B1 risks and mitigations

### Risk: race conditions on accept

- If two drivers accept simultaneously, both may race for the same ride.
- Mitigation:
  - Use atomic SQL with strict predicates: `ride_status='requested'` and `offer.status='pending'`.
  - Reject the second accept attempt with `409`.
  - Expire other offers in the same transaction.

### Risk: duplicate ride assignments

- Ride assignment must be driven by the accepted offer, not by a generic ride update.
- Mitigation:
  - Add an offer-level constraint and require `offer_id` in acceptance.
  - Persist offer state transitions in `active_driver_offers`.

### Risk: accepting expired offers

- Without expiration checks, old offers remain valid.
- Mitigation:
  - Persist `expires_at` on offers.
  - Enforce `expires_at > NOW()` in accept/reject/update statements.
  - Add background expiry cleanup.

### Risk: rider choice not represented

- Rider cannot see or compare multiple offers if only driver-side “ride_offer” broadcasts exist.
- Mitigation:
  - Expose `GET /api/rides/:rideId/offers`.
  - Emit rider-facing offer state updates.

### Risk: frontend compatibility breakage

- Changing `/api/rides/:rideId/offers/:offerId/accept` semantics could break existing clients if not handled carefully.
- Mitigation:
  - Preserve the route and auth model.
  - Return the same response shape, plus `offer_id` when available.
  - Keep legacy `/rides/:id/accept` behavior intact for old clients.

### Risk: scaling with current websocket broadcast model

- Broadcasting every request to all drivers is unsustainable.
- Mitigation:
  - Phase B1 should preserve existing event names but move toward limited targeting by available drivers, zones, or driver state.
  - If necessary, implement a driver/topic subscription layer in websocket manager.

## Out-of-scope but related risks

- Wallet/payment integration is broken in the current backend and is not addressed here.
- Platform fee processing is incomplete and should be handled in Phase B1 only after offer assignment is stable.
- Admin topups and ledger reconciliation are separate concerns and should not be introduced in the offer management design.

## Executive risk verdict

The current backend is not production-ready for Phase B1 offer management because it lacks the `active_driver_offers` persistence layer and ignores `offerId` during acceptance. The safest production implementation is to add offer-level validation, state transitions, and expiry checks while preserving existing JWT route compatibility.
