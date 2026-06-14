# V2 Roadmap

## Objective

V2 should move PickMe beyond a single-instance V1 realtime backend into a scalable, observable, marketplace-grade ride-hailing platform.

## Priority 1: Distributed Realtime

```text
Goal: make websocket delivery safe across multiple backend instances.
```

Work items:

- Add Redis Pub/Sub, NATS, Kafka, or a dedicated realtime gateway for cross-instance fanout.
- Add sticky-session guidance for interim deployments.
- Externalize rider/driver presence from process memory.
- Add websocket delivery metrics by event name and room.
- Add replay or recovery strategy for critical lifecycle events.

## Priority 2: Matching Engine

```text
Goal: replace broad driver registry ride_offer fanout with ranked eligible-driver dispatch.
```

Work items:

- Build candidate driver selection by distance, vehicle type, availability, and freshness.
- Add dispatch windows and offer batches.
- Add driver rejection/timeout lifecycle.
- Add marketplace fairness and anti-spam controls.
- Add simulation tests for dense and sparse markets.

## Priority 3: Offer System Hardening

```text
Goal: make offers durable, observable, and operationally tunable.
```

Work items:

- Add explicit background expiration job.
- Add offer status audit trail.
- Add accepted/expired/declined event stream.
- Add idempotency keys for driver offer submissions and rider accept actions.
- Add load tests for concurrent accept spikes.

## Priority 4: Payments and Wallet

```text
Goal: introduce settlement without weakening V1 ride lifecycle correctness.
```

Work items:

- Add wallet ledger with immutable entries.
- Add payment authorization/capture or cash reconciliation flow.
- Add settlement state separate from ride state.
- Add refund/reversal path.
- Add reconciliation reports.

## Priority 5: Operational Readiness

```text
Goal: make national launch supportable by operations teams.
```

Work items:

- Structured logs with request IDs and ride IDs.
- Metrics for HTTP status, DB latency, websocket sends, and event fanout.
- Sentry or equivalent production error tracking.
- Admin diagnostics for room membership and registry presence.
- Runbooks for stuck rides, missing offers, and websocket incident response.

## Priority 6: Security and Abuse Controls

```text
Goal: protect riders, drivers, and marketplace integrity.
```

Work items:

- Rate limit ride requests, offer submissions, and location updates.
- Add device/session risk checks.
- Add stronger role authorization if rider/driver roles diverge.
- Add audit logging for sensitive lifecycle mutations.
- Review Supabase RLS/Data API exposure for every public table.

## Priority 7: Mobile Client Protocol V2

```text
Goal: version the websocket/API contract before introducing breaking improvements.
```

Work items:

- Add protocol version negotiation.
- Add typed event envelopes with event_id and occurred_at.
- Add idempotent client acknowledgements where needed.
- Add frontend migration guide from V1 event payloads.
- Preserve V1 compatibility until F2 rollout is complete.
