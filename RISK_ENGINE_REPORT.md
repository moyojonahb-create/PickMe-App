# Risk Engine Report

Date: 2026-06-19

Scope: Implemented GO V2.5-A Fraud & Risk Engine for PickMe Zimbabwe.

## Result

Overall result: **PASS**

Implemented a centralized backend risk platform where the frontend submits risk signals, Go records evidence and calculates scores, PostgreSQL stores risk evidence/actions/scores, Redis stores short-term counters, and Asynq runs deeper fraud scan jobs.

## Architecture

Implemented:

- Frontend sends risk events only.
- Go calculates risk, trust, and fraud scores.
- PostgreSQL stores risk evidence in dedicated risk tables.
- Redis stores short-term counters.
- Asynq runs deeper risk scan jobs.
- Default decision is `allow`.
- Users are only blocked when an admin explicitly applies a `block` action or preserves an existing blocked score.

## Risk Areas

Supported areas:

- `rider_fraud`
- `driver_fraud`
- `wallet_abuse`
- `referral_abuse`
- `student_discount_abuse`
- `gps_spoofing`
- `fake_ride_creation`
- `multi_account_abuse`
- `payment_abuse`
- `emergency_sos_abuse`

## Database

Added migration:

- `supabase/migrations/20260619100000_risk_engine.sql`

Tables:

- `risk_events`
- `risk_scores`
- `risk_rules`
- `risk_actions`
- `risk_device_fingerprints`

## Scores

Each user has:

- `risk_score`
- `trust_score`
- `fraud_score`
- `risk_level`: `low`, `medium`, `high`, `blocked`

## Actions

Supported actions:

- `allow`
- `review`
- `rate_limit`
- `require_verification`
- `block`

## APIs

Added:

```text
POST /api/risk/events
GET /api/risk/me
GET /admin/risk/users
GET /admin/risk/users/:userId
POST /admin/risk/users/:userId/action
GET /admin/risk/stats
```

Admin routes require Supabase JWT plus `middleware.AdminOnly()`.

## Asynq Jobs

Added handlers for:

- `fraud.scan`
- `risk.recalculate_user`
- `risk.detect_multi_account`
- `risk.detect_wallet_abuse`
- `risk.detect_student_abuse`
- `risk.detect_gps_spoofing`

## Redis Counters

Implemented short-term counters:

- `ride_requests_per_user`
- `wallet_transfers_per_user`
- `failed_login_attempts`
- `device_accounts_count`
- `phone_accounts_count`
- `suspicious_location_jumps`

## Metrics

Added Prometheus metrics:

- `risk_events_total`
- `risk_high_users_total`
- `risk_actions_total`
- `fraud_scan_failures_total`

## Sentry

Risk scan failures, Redis counter errors, device fingerprint persistence errors, and score recalculation errors are captured through backend Sentry integration.

## Verification

Backend:

```text
cd backend
go test ./...
PASS
```

