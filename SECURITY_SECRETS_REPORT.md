# Security Secrets Report

Date: 2026-06-14

Scope: Repository scan for API keys, JWT secrets, Supabase secrets, database URLs, Google Maps keys, and service-role material. Business logic was not changed.

## Summary

Result: **Secrets hygiene improved, rotation still required.**

The scan found one committed frontend example containing a live-looking Google Maps API key and local ignored env files containing live-looking backend/frontend secrets. Committed examples and documentation were changed to placeholders. Ignore rules were hardened so local env files under the root and `backend/` stay out of git.

## Files Updated

- `.env.example`
- `backend/.env.example`
- `backend/DEPLOYMENT.md`
- `README.md`
- `.gitignore`
- `SECURITY_SECRETS_REPORT.md`

## Findings

| Finding | File | Status |
|---|---|---|
| Live-looking Google Maps key in frontend example env | `.env.example` | Replaced with empty env placeholder |
| Google Maps key-shaped placeholder in README | `README.md` | Replaced with neutral placeholder |
| Backend example used database URL-shaped placeholder | `backend/.env.example` | Replaced with empty env placeholder |
| Backend example used JWT-secret-shaped placeholder | `backend/.env.example` | Replaced with empty env placeholder |
| Backend deployment docs used secret-shaped placeholders | `backend/DEPLOYMENT.md` | Replaced with empty env placeholders |
| Local root env contains live-looking values | `.env` | Ignored by git; values not printed in this report |
| Local backend env contains live-looking database/JWT values | `backend/.env` | Ignored by git; values not printed in this report |

## Environment Variables

Frontend public variables:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_GO_BACKEND_URL`
- `VITE_API_BASE_URL`
- `VITE_BACKEND_URL`
- `VITE_GOOGLE_MAPS_API_KEY`
- `VITE_DD_RUM_ENABLED`
- `VITE_DD_RUM_APPLICATION_ID`
- `VITE_DD_RUM_CLIENT_TOKEN`
- `VITE_DD_RUM_SITE`
- `VITE_DD_RUM_SERVICE`
- `VITE_DD_RUM_ENV`
- `VITE_DD_RUM_VERSION`

Backend/server-only variables:

- `DATABASE_URL`
- `SUPABASE_URL`
- `SUPABASE_JWT_SECRET`
- `SUPABASE_JWT_AUDIENCE`
- `SUPABASE_JWT_ISSUER`
- `REDIS_URL`
- `ONEMONEY_WEBHOOK_SECRET`
- `ONEMONEY_STATUS_TOKEN`
- `ECOCASH_WEBHOOK_SECRET`
- `ECOCASH_STATUS_TOKEN`
- `INNBUCKS_WEBHOOK_SECRET`
- `INNBUCKS_STATUS_TOKEN`
- `PAYPAL_WEBHOOK_SECRET`
- `PAYPAL_STATUS_TOKEN`

Supabase Edge Function secrets already referenced through `Deno.env.get(...)`:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GOOGLE_MAPS_API_KEY`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER`
- `AGORA_APP_ID`
- `AGORA_APP_CERT`
- `LOVABLE_API_KEY`
- `VAPID_PUBLIC_KEY`

## Gitignore Coverage Added

- `.env.*`
- `!.env.example`
- `backend/.env`
- `backend/.env.*`
- `!backend/.env.example`

Existing coverage retained:

- `.env`
- `backend/.gocache/`
- `backend/tmp/`
- `backend/*.exe`
- `backend/bin/`
- `backend/coverage.out`

## Required Follow-Up

1. Rotate the Google Maps API key that appeared in `.env.example`.
2. Rotate any Supabase/database/JWT secrets that were ever committed, shared, or pasted into tooling.
3. Confirm `.env` and `backend/.env` remain untracked before every commit.
4. Keep `SUPABASE_SERVICE_ROLE_KEY` server-only. It must never appear in any `VITE_` variable or frontend bundle.
5. Use provider dashboards or deployment secret stores for production values, not repository files.
