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

## CORS

Set `CORS_ALLOW_ORIGINS` to exact production frontend origins. Do not use `*` in production.

## JWT

- Backend validates Supabase JWTs with `SUPABASE_JWT_SECRET`.
- Keep access-token TTL short for admin accounts.
- Rotate admin tokens used by Prometheus scraping.

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
test -n "$SUPABASE_URL"
test -n "$SUPABASE_JWT_SECRET"
test "$APP_ENV" = "production"
test "$REDIS_ENABLED" = "true"
test "$ASYNQ_ENABLED" = "true"
```

## Legacy Edge Functions

In production, retired legacy functions require both:

- their `LEGACY_*_ENABLED=true` flag
- `LEGACY_EMERGENCY_OVERRIDE_ENABLED=true`

Keep emergency override unset unless an incident commander explicitly approves rollback.
