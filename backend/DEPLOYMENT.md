# PickMe Go Backend Deployment

## Runtime Requirements

- Go toolchain compatible with `go.mod`.
- PostgreSQL database reachable through `DATABASE_URL`.
- Existing tables in `public.rides`, `public.driver_sessions`, and `public.driver_locations`.

## Environment Variables

Required:

```text
DATABASE_URL=
SUPABASE_JWT_SECRET=
```

Optional:

```text
PORT=3000
CORS_ALLOW_ORIGINS=https://www.voyex.site,https://pickme-co-zw.lovable.app
SUPABASE_URL=https://{project-ref}.supabase.co
SUPABASE_JWT_AUDIENCE=authenticated
SUPABASE_JWT_ISSUER=https://{project-ref}.supabase.co/auth/v1
```

`SUPABASE_JWT_SECRET` is required at startup because pilot mutation routes are protected by Supabase JWT middleware.

## Build

```bash
go build ./cmd/server
```

For a named Linux binary:

```bash
GOOS=linux GOARCH=amd64 go build -o pickme-backend ./cmd/server
```

## Run Locally

```bash
go run ./cmd/server
```

Health checks:

```bash
curl http://localhost:3000/health
curl http://localhost:3000/test-db
```

## HTTP Surface

Existing routes preserved by this refactor:

```text
GET  /
GET  /health
GET  /test-db
GET  /rides
POST /rides/request
POST /rides/:id/accept
POST /rides/:id/start
POST /rides/:id/complete
POST /rides/join-room
POST /drivers/location
POST /drivers/online
POST /drivers/heartbeat
POST /drivers/offline
GET  /drivers/nearby
GET  /ws
```

Protected routes require:

```text
Authorization: Bearer {supabase_access_token}
```

Protected routes:

```text
POST /rides/request
POST /rides/:id/accept
POST /rides/:id/start
POST /rides/:id/complete
POST /drivers/location
POST /drivers/online
POST /drivers/heartbeat
POST /drivers/offline
GET  /ws
```

Unauthenticated routes:

```text
GET  /
GET  /health
GET  /test-db
GET  /rides
POST /rides/join-room
GET  /drivers/nearby
```

On protected routes, `rider_id` and `driver_id` request fields are compatibility fields only. The backend uses the JWT subject as the effective rider or driver ID and returns `403` if a supplied ID attempts to target another user.

For websocket clients, connect with:

```text
wss://{api-host}/ws?access_token={supabase_access_token}&role=rider
wss://{api-host}/ws?access_token={supabase_access_token}&role=driver
wss://{api-host}/ws?access_token={supabase_access_token}&role=driver&room=ride_{ride_id}
```

Only the assigned rider or assigned driver can join a ride room.

## Production Checklist

- Store `.env` values in the deployment platform secret manager.
- Do not commit database credentials, Supabase secrets, or built binaries.
- Configure the load balancer to support websocket upgrades.
- Run exactly one backend instance. Sticky load-balancer sessions alone do
  not make horizontal scaling safe: the in-memory driver/rider WebSocket
  registries and rate-limit fallback are per-process, and dispatch offer
  delivery looks drivers up directly rather than broadcasting through Redis
  pub/sub. See `docs/deployment/websocket-scaling.md` before adding a second
  replica.
- Add database migrations before schema changes are introduced.
- Add request logging, panic recovery, and rate limiting once client compatibility is confirmed.
- Keep client mutation calls sending Supabase bearer tokens.
- Keep websocket clients sending Supabase access tokens during handshake.
- Move driver cleanup to a single scheduled worker if duplicate cleanup work becomes noisy at scale.

## Operational Notes

The service currently starts an in-process driver cleanup worker that marks stale online drivers offline after two minutes. This matches existing behavior. In a horizontally scaled deployment, every instance will run that worker unless it is moved into a separate job.
