# Supabase Edge Function Governance Report

Date: 2026-06-16

Scope: Audited targeted Supabase Edge Functions against the PickMe Zimbabwe architecture rule:

```text
Frontend -> Go API -> PostgreSQL
```

Supabase remains allowed for Auth, Storage, database hosting, and temporary read/realtime subscriptions. Edge Functions must not own core business logic.

## Executive Summary

Result: **CONFIG HARDENED, HIGH-RISK LEGACY BUSINESS FUNCTIONS DEFAULT-DISABLED**

Frontend admin business mutations were migrated from `admin-api` to Go. Legacy Edge Functions that duplicate core Go responsibilities now default to `410 Gone` unless an explicit rollback secret enables them.

Implemented in this pass:

- Added Go admin verification endpoint: `GET /admin/auth/verify`.
- Migrated admin auth check from `admin-api?action=verify_admin` to Go.
- Migrated admin dashboard driver approve/suspend/force-offline mutations from `admin-api` to Go `adminUpdateRow`.
- Marked `admin-api`, `settle-trip`, `add-driver`, and `dispatch-scheduled` as legacy-disabled by default via `LEGACY_*_ENABLED` gates.
- Rewrote `supabase/config.toml` as an explicit per-function JWT policy matrix.
- Left Google Maps public proxy flows public because no Go replacement exists yet and the current frontend depends on them.

## Function Classification

| Function | Classification | JWT Config | Disposition |
|---|---|---:|---|
| `admin-api` | Duplicates Go admin/business logic | `true` | Legacy-disabled by default; frontend callers migrated to Go |
| `settle-trip` | Duplicates Go ride settlement | `true` | Legacy-disabled by default; Go `/api/rides/:rideId/settle` is canonical |
| `wallet-pin` | Authenticated sensitive utility; should migrate to Go wallet domain | `true` | Retained temporarily; service-role access server-only |
| `add-driver` | Duplicates Go driver/admin writes | `true` | Legacy-disabled by default |
| `dispatch-scheduled` | Scheduled business workflow | `true` | Legacy-disabled by default; should run from Go worker/cron |
| `send-notification` | Authenticated notification utility with DB writes | `true` | Retained temporarily; migrate notification fanout to Go |
| `verify-student` | Storage/Auth utility plus AI verification business workflow | `true` | Retained temporarily; should migrate verification decisioning to Go |
| `twilio-otp` | Public external-service proxy for signup phone OTP | `false` | Retained public; requires abuse controls |
| `sms-invite` | Public Twilio invite proxy | `false` | Retained public; requires abuse controls or JWT |
| `delete-account` | Auth utility requiring service role and Auth Admin API | `true` | Retained; consider Go migration before production |
| `import-osm-places` | Dev/admin-only import utility | `true` | Retained admin-only; service-role server-only |
| `ramz-code-scan` | Dev/admin-only AI tool | `true` | Retained admin-only |
| `ramz-generate-patch` | Dev/admin-only AI tool | `true` | Retained admin-only |
| `google-routes` | Public external-service proxy | `false` | Retained public to avoid breaking Maps flow |
| `google-places-search` | Public external-service proxy | `false` | Retained public to avoid breaking autocomplete/search |
| `google-maps-key` | Authenticated key utility | `true` | Retained temporarily; prefer Go or platform key restrictions |
| `nominatim-search` | Public external-service proxy | `false` | Retained public; requires abuse controls |
| `agora-token` | Authenticated external token minting utility | `true` | Retained temporarily; validates user and call session |
| `push-config` | Public config utility returning VAPID public key only | `false` | Retained public |

## Functions Migrated

- `admin-api?action=verify_admin` -> `GET /admin/auth/verify`
- `admin-api?action=approve_driver` -> `PATCH /admin/business/drivers/:id`
- `admin-api?action=suspend_driver` -> `PATCH /admin/business/drivers/:id`
- `admin-api?action=force_driver_offline` -> `PATCH /admin/business/drivers/:id`
- `settle-trip` was already replaced in frontend runtime by Go `POST /api/rides/:rideId/settle`; stale test expectations were updated.

## Functions Disabled

These are still deployable for emergency rollback but return `410 Gone` by default:

| Function | Enable Secret |
|---|---|
| `admin-api` | `LEGACY_ADMIN_API_ENABLED=true` |
| `settle-trip` | `LEGACY_SETTLE_TRIP_ENABLED=true` |
| `add-driver` | `LEGACY_ADD_DRIVER_ENABLED=true` |
| `dispatch-scheduled` | `LEGACY_DISPATCH_SCHEDULED_ENABLED=true` |

## Functions Retained

Retained as temporary authenticated utilities:

- `wallet-pin`
- `send-notification`
- `verify-student`
- `delete-account`
- `import-osm-places`
- `ramz-code-scan`
- `ramz-generate-patch`
- `google-maps-key`
- `agora-token`

Retained as public external-service proxies:

- `twilio-otp`
- `sms-invite`
- `google-routes`
- `google-places-search`
- `nominatim-search`
- `push-config`

## Config Changes

`supabase/config.toml` now explicitly declares all targeted functions.

JWT required:

- `admin-api`
- `settle-trip`
- `add-driver`
- `dispatch-scheduled`
- `wallet-pin`
- `send-notification`
- `verify-student`
- `delete-account`
- `import-osm-places`
- `ramz-code-scan`
- `ramz-generate-patch`
- `google-maps-key`
- `agora-token`

JWT intentionally public:

- `twilio-otp`
- `sms-invite`
- `google-routes`
- `google-places-search`
- `nominatim-search`
- `push-config`

## Required Secrets

| Function | Secrets |
|---|---|
| `admin-api` | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, optional `LEGACY_ADMIN_API_ENABLED` |
| `settle-trip` | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, optional `LEGACY_SETTLE_TRIP_ENABLED` |
| `wallet-pin` | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| `add-driver` | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, optional `LEGACY_ADD_DRIVER_ENABLED` |
| `dispatch-scheduled` | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, optional `LEGACY_DISPATCH_SCHEDULED_ENABLED` |
| `send-notification` | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| `verify-student` | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `LOVABLE_API_KEY` |
| `twilio-otp` | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` |
| `sms-invite` | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` |
| `delete-account` | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| `import-osm-places` | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| `ramz-code-scan` | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `LOVABLE_API_KEY` |
| `ramz-generate-patch` | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `LOVABLE_API_KEY` |
| `google-routes` | `GOOGLE_MAPS_API_KEY` |
| `google-places-search` | `GOOGLE_MAPS_API_KEY` |
| `google-maps-key` | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `GOOGLE_MAPS_API_KEY` |
| `nominatim-search` | none required |
| `agora-token` | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `AGORA_APP_ID`, `AGORA_APP_CERT` |
| `push-config` | `VAPID_PUBLIC_KEY` |

## Rate Limiting Strategy

Required production strategy:

- Put public proxy functions behind gateway/WAF limits by IP, user agent, and route.
- Move durable rate counters to Go/Redis for OTP, SMS invite, Google search/routes, and Nominatim.
- Add phone-number keyed limits for `twilio-otp`: per phone, per IP, and per device fingerprint.
- Add per-origin and per-IP quotas for `google-routes`, `google-places-search`, and `nominatim-search`.
- Add per-ride/per-user limits for `sms-invite`.
- Keep `push-config` cacheable and deny non-`GET` methods.
- Avoid relying on Edge Function in-memory maps except as defense-in-depth; they reset on cold start and do not coordinate across isolates.

Current code gaps:

- `twilio-otp` has database-backed OTP state but no robust IP/device throttle.
- `sms-invite`, `google-routes`, `google-places-search`, and `nominatim-search` are public and need gateway or Go-backed rate limiting.
- `wallet-pin` has an in-memory brute-force limiter, which is not sufficient for production because it is isolate-local.

## Service-Role Review

Service-role usage is server-only in Edge Function code and not exposed to the frontend. Remaining service-role functions should be treated as privileged server components:

- `wallet-pin`
- `send-notification`
- `verify-student`
- `delete-account`
- `import-osm-places`
- Legacy-disabled functions when rollback-enabled

Risk note: service-role clients bypass RLS, so each retained function must validate the caller and ownership before touching rows or storage. `delete-account` and `verify-student` deserve the next focused review because they combine Auth/Admin, Storage, and multi-table writes/deletes.

## Remaining Risks

- `wallet-pin` should be migrated into Go wallet endpoints with Redis-backed attempt counters and structured audit events.
- `send-notification` still owns notification fanout rules in an Edge Function; Go should become canonical.
- `verify-student` owns verification decisioning and writes `student_profiles`; Go should own decisioning, while Supabase Storage remains acceptable for uploads.
- `delete-account` performs broad service-role deletes and Auth Admin deletion; this should move to a Go account-deletion workflow with soft-delete, audit, and recovery window controls.
- Public Maps/Nominatim proxies are intentionally left public until Go replacements exist. They need rate limiting before production.
- `google-maps-key` returns a browser-usable key to authenticated users; restrict the key at Google Cloud by HTTP referrer/package/signature and consider moving map bootstrap to Go.
- `push-subscribe` is referenced by frontend but was outside the requested target list and should be audited separately.
