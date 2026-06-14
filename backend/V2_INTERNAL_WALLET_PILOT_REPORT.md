# PickMe GO V2.1-E4 Internal Wallet Pilot Report

## Summary

GO V2.1-E4 internal wallet pilot framework is implemented behind default-off controls.

This phase allows PickMe to test wallet operations with a controlled internal cohort. It does not implement public wallet rollout, provider integrations, OneMoney, EcoCash, Innbucks, cards, PayPal, frontend changes, or websocket contract changes.

Architecture remains:

```text
Supabase = Storage
Go = Everything Smart
```

## Files Changed

```text
cmd/server/main.go
internal/config/config.go
internal/rides/handler.go
internal/rides/handler_test.go
internal/wallet/admin_http.go
internal/wallet/admin_http_test.go
internal/wallet/pilot.go
internal/wallet/pilot_test.go
internal/wallet/reporting.go
internal/wallet/repository.go
internal/wallet/schema_test.go
internal/wallet/types.go
internal/wallet/validation.go
WALLET_LEDGER_SCHEMA.sql
V2_INTERNAL_WALLET_PILOT_REPORT.md
```

## Pilot Architecture

Added pilot roles:

```text
pilot_rider
pilot_driver
pilot_admin
```

Added pilot user states:

```text
enabled
disabled
suspended
removed
```

Added additive Supabase storage tables:

```text
public.pilot_wallet_groups
public.pilot_wallet_users
public.pilot_wallet_user_events
```

Go owns all eligibility, gating, mutation, audit, and reporting logic.

## Feature Flags

Added:

```text
WALLET_INTERNAL_PILOT_ENABLED=false
WALLET_INTERNAL_PILOT_PERCENTAGE=0
```

When the pilot is disabled:

```text
existing ride behavior remains unchanged
existing wallet code paths remain dark unless their own flags are enabled
non-pilot users are not blocked by the pilot framework
```

When enabled, wallet operations require pilot eligibility.

## Feature Gating

Pilot gating now protects:

```text
wallet ride authorization
wallet ride request before ride insert and before ride_offer broadcast
wallet ride driver offer submission
wallet ride driver offer acceptance
wallet ride capture side effect
wallet deposits
wallet withdrawals
```

Non-pilot wallet ride requests are rejected before:

```text
authorization
ride row creation
driver offer broadcast
```

Non-pilot drivers are rejected before they can enter the wallet ride settlement path through offer submission or offer acceptance. Wallet capture also requires both the rider and driver to remain pilot-eligible.

Ride lifecycle and websocket contracts are unchanged.

## Safety Controls

Admin controls were added:

```text
POST /admin/wallets/pilot/users/:userId/enable
POST /admin/wallets/pilot/users/:userId/disable
POST /admin/wallets/pilot/users/:userId/suspend
POST /admin/wallets/pilot/users/:userId/remove
```

Each pilot mutation records:

```text
target user
admin user
role
status
group
reason
timestamp
```

Rollback is global:

```text
WALLET_INTERNAL_PILOT_ENABLED=false
```

This disables pilot gating without affecting ride completion, websocket delivery, or non-pilot users.

## Reporting

Added admin JSON endpoints:

```text
GET /admin/wallets/pilot/summary
GET /admin/wallets/pilot/users
GET /admin/wallets/pilot/failures
GET /admin/wallets/pilot/reconciliation
```

Pilot metrics include:

```text
total wallet rides
successful settlements
failed settlements
authorization failures
reconciliation failures
liability events
deposit approvals
withdrawal approvals
pilot rider count
pilot driver count
pilot admin count
```

## Tests Added

Added coverage for:

```text
pilot eligibility disabled allows normal behavior
explicit pilot rider eligibility
suspended pilot users are blocked
pilot admin role eligibility
percentage fallback behavior
pilot user mutation defaults and audit intent
pilot-gated wallet operations return 403 before service mutation
pilot admin reporting endpoints
pilot enable/disable/suspend/remove controls
wallet ride request blocks non-pilot users before authorization and broadcast
wallet ride offer submission blocks non-pilot drivers
wallet ride capture skips non-pilot drivers without failing ride completion
schema includes pilot tables, statuses, indexes, and RLS policies
```

Existing wallet authorization, active settlement, expiration, reconciliation, ride completion, and websocket delivery tests remain passing.

## Build Results

Initial sandboxed verification hit Windows Go build-cache access denial under:

```text
C:\Users\ntepemanamafm\AppData\Local\go-build
```

Rerun with normal Go build-cache access succeeded:

```text
go test ./...          PASS
go build ./cmd/server  PASS
```

## Runtime Verification Plan

Before enabling in any shared environment:

```text
1. Apply additive pilot_wallet_groups, pilot_wallet_users, and pilot_wallet_user_events schema.
2. Keep WALLET_INTERNAL_PILOT_ENABLED=false and WALLET_INTERNAL_PILOT_PERCENTAGE=0.
3. Confirm cash rides, normal ride requests, ride completion, and websocket delivery are unchanged.
4. Enable WALLET_INTERNAL_PILOT_ENABLED=true in an internal environment only.
5. Add one pilot rider, one pilot driver, and one pilot admin.
6. Verify pilot rider can create wallet authorization and wallet ride request.
7. Verify non-pilot wallet ride request returns 403 and creates no ride row.
8. Verify no ride_offer is broadcast for non-pilot wallet ride requests.
9. Verify pilot driver can access withdrawal creation and non-pilot driver cannot.
10. Verify non-pilot drivers cannot submit or accept wallet ride offers.
11. Verify wallet capture requires both pilot rider and pilot driver.
12. Verify pilot admin controls enable, disable, suspend, and remove pilot users.
13. Verify /admin/wallets/pilot/summary, /users, /failures, and /reconciliation return expected JSON.
14. Disable WALLET_INTERNAL_PILOT_ENABLED and verify normal non-wallet ride behavior remains unchanged.
15. Run reconciliation after pilot wallet rides and investigate any mismatch before wider exposure.
```

## Operational Risks

```text
pilot schema must be applied before admin pilot endpoints are used
percentage rollout is deterministic but should remain 0 until operations approves cohort testing
suspended and removed users are explicitly blocked even if percentage rollout is later increased
pilot metrics depend on existing settlement, authorization, admin action, and reconciliation tables
provider-backed deposits and withdrawals remain out of scope
public wallet rollout remains blocked until pilot reconciliation is clean
```

## Readiness Assessment

```text
GO V2.1-E4 Internal Wallet Pilot Framework: IMPLEMENTED
Pilot feature flag: DEFAULT OFF
Pilot percentage: DEFAULT 0
Pilot users and audit events: IMPLEMENTED
Pilot-gated wallet operations: IMPLEMENTED
Pilot reporting APIs: IMPLEMENTED
Pilot rollback control: IMPLEMENTED
Ride lifecycle contracts: UNCHANGED
Websocket contracts: UNCHANGED
Frontend contracts: UNCHANGED
Provider integrations: NOT STARTED
Public wallet rollout: NOT ENABLED
```

Readiness for provider integrations:

```text
NOT READY FOR PROVIDER INTEGRATION
READY FOR INTERNAL WALLET PILOT TESTING
READY TO VALIDATE PILOT RECONCILIATION AND SUPPORT RUNBOOKS
READY TO DESIGN PROVIDER PILOT ONLY AFTER INTERNAL WALLET DRIFT IS ZERO
```
