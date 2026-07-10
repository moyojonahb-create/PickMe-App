# Deployment Security

## HTTP Security Headers

NGINX config includes:

- `Strict-Transport-Security`
- `X-Content-Type-Options`
- `X-Frame-Options`
- `Referrer-Policy`
- `Permissions-Policy`

Review CSP separately before enforcing because the app uses maps, Supabase, Sentry, and optional RUM providers.

## TLS

- Use TLS 1.2+.
- Prefer Cloudflare Full Strict mode.
- Renew certificates automatically with Certbot or Cloudflare origin certificates.
- `DATABASE_URL` must include `sslmode=require`, `sslmode=verify-full`, or
  `sslmode=verify-ca` whenever `APP_ENV` is not `development`/`dev`/`local`;
  the backend enforces this at startup and fails to start otherwise. Prefer
  `verify-full` when your Postgres provider issues a certificate you can
  validate against a known CA.

## CORS

Set `CORS_ALLOW_ORIGINS` to exact production frontend origins. Do not use `*` in production.

The backend enforces this at startup: `CORS_ALLOW_ORIGINS` is required whenever
`APP_ENV` is not `development`, `dev`, or `local`, and there is no built-in
fallback origin list for that case — a missing value fails the process to
start rather than silently defaulting to any origin.

## JWT

- Backend validates Supabase JWTs with `SUPABASE_JWT_SECRET`.
- Keep access-token TTL short for admin accounts.
- Rotate admin tokens used by Prometheus scraping.

## WebSocket

Each `/ws` connection enforces a per-connection inbound message rate limit
(`backend/internal/websocket/ratelimit.go`): up to 30 client messages
(ping/join_room/leave_room/other) per rolling 10-second window. Exceeding it
closes the connection with WebSocket close code `1008` (policy violation)
and reason `rate limit exceeded`. This is independent of the HTTP-layer rate
limiter and does not affect driver location updates, which are sent over
HTTP (`POST /drivers/location`) and only ever broadcast outbound.

## Cookies

The Go API uses bearer tokens and does not require browser cookies for API auth. If future cookie auth is added, require `Secure`, `HttpOnly`, and `SameSite=Lax` or stricter.

## Secrets

- Store `.env` only on hosts or secret managers.
- Never commit `backend/.env`.
- Never put service-role keys in frontend env.
- Use GitHub Actions environments for staging and production secrets.

## Environment Validation

Before starting production:

```bash
test -n "$DATABASE_URL"
echo "$DATABASE_URL" | grep -Eq 'sslmode=(require|verify-full|verify-ca)'
test -n "$SUPABASE_URL"
test -n "$SUPABASE_JWT_SECRET"
test -n "$CORS_ALLOW_ORIGINS"
test "$APP_ENV" = "production"
test "$REDIS_ENABLED" = "true"
test "$ASYNQ_ENABLED" = "true"
```

## Scaling

Do not run more than one `backend`/`pickme-server` replica without reading
[websocket-scaling.md](websocket-scaling.md) — the WebSocket driver/rider
registries and the in-memory rate-limit fallback are per-process only.
Leave `BACKEND_INSTANCE_COUNT` unset (or `1`) for a normal deployment.

## Legacy Edge Functions

In production, retired legacy functions require both:

- their `LEGACY_*_ENABLED=true` flag
- `LEGACY_EMERGENCY_OVERRIDE_ENABLED=true`

Keep emergency override unset unless an incident commander explicitly approves rollback.
