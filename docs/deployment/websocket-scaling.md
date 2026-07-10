# WebSocket / Driver Registry Scaling Constraint

This backend currently supports **exactly one `backend` / `pickme-server` process**.
Do not run multiple replicas behind a load balancer (Docker Compose `--scale`,
multiple systemd hosts, a Kubernetes Deployment with `replicas > 1`, etc.)
without addressing the gap described below first.

## What is per-instance, in-memory state

- **`internal/websocket.ConnectionRegistry`** (`backend/internal/websocket/registry.go`) —
  maps a rider/driver user ID to their live WebSocket connection on this
  process only. There is no cross-node index of "which instance is this user
  connected to."
- **`driverRegistry` / `riderRegistry`** in `backend/cmd/server/main.go` — the
  two `ConnectionRegistry` instances created at startup and passed into
  `rides.Handler` (`backend/internal/rides/handler.go`) and the dispatch
  offer notifier.
- **The in-memory rate-limit fallback** (`fixedWindowLimiter` in
  `backend/internal/middleware/production.go`) — used whenever Redis is
  disabled or a Redis call errors transiently. It has no cross-instance view
  either.

## What already IS shared across instances (and would keep working)

- Room broadcasts sent through `websocket.Manager.BroadcastRoom` — these
  publish to Redis pub/sub (`WithPubSub`) and every subscribed instance
  rebroadcasts to its own locally-connected room members. Ride-room events
  reach a rider/driver regardless of which instance they're connected to.
- Redis-backed geo lookups, dispatch locks, dispatch queueing, and the
  Redis-backed rate limiter (when `REDIS_ENABLED=true` and Redis is healthy).

## What breaks with more than one replica

- **Direct-to-driver dispatch offers.** `dispatchService.WithOfferNotifier`
  in `main.go` looks up the target driver with `driverRegistry.Get(offer.DriverID)`
  and sends directly — it does not go through the Redis-backed room
  broadcast path. If the driver's WebSocket connection is on a different
  instance than the one that computed the dispatch decision, the offer is
  silently dropped. Sticky load-balancer sessions do **not** fix this: they
  only guarantee a given driver's *connection* stays on one instance, not
  that the instance which decides to offer them a ride is the same one.
- Several other direct-lookup sends in `internal/rides/handler.go` (ride
  status pushes, cancellation notices) have the same limitation.
- The in-memory rate-limit fallback becomes per-instance instead of
  authoritative, which weakens protection during a Redis outage rather than
  keeping it consistent.

## Startup guard

`backend/internal/config/config.go` reads an optional `BACKEND_INSTANCE_COUNT`
environment variable (default `1`). Setting it to a value greater than `1`
does **not** enable clustering or change any runtime behavior — it only makes
`backend/cmd/server/main.go` log a `DEPLOYMENT_SINGLE_INSTANCE_CONSTRAINT_VIOLATION`
warning at startup so a scale-out attempt is loud in logs/monitoring instead
of silently dropping driver offers in production. Leave it unset (or `1`) for
a normal single-instance deployment.

## Before scaling horizontally

Any of the following would need to land first:
1. Route dispatch offer delivery through the same Redis pub/sub path room
   broadcasts already use, instead of a direct in-process registry lookup.
2. Or move driver/rider presence into a shared store (e.g. Redis-backed
   connection index) that any instance can query.

Neither is in scope for the current hardening pass — this document exists so
the constraint is explicit and discoverable, not to prescribe the eventual
clustering design.
