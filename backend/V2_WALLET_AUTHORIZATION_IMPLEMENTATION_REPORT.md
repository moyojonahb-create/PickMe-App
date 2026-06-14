# PickMe GO V2.1-E2 Wallet Ride Authorization Implementation Report

## Summary

GO V2.1-E2 wallet ride authorization and balance reservation is implemented behind a feature flag.

This phase handles wallet rides only. It does not implement EcoCash, Innbucks, Visa/Mastercard, PayPal, provider callbacks, provider clearing, public rollout, or frontend wallet UI.

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
internal/wallet/authorization.go
internal/wallet/authorization_test.go
internal/wallet/repository.go
internal/wallet/schema_test.go
internal/wallet/types.go
internal/wallet/validation.go
WALLET_LEDGER_SCHEMA.sql
V2_WALLET_AUTHORIZATION_IMPLEMENTATION_REPORT.md
```

## Feature Flags

Added:

```text
WALLET_RIDE_AUTHORIZATION_ENABLED=false
WALLET_RIDE_AUTHORIZATION_TTL_MINUTES=30
```

Default is disabled. With the flag off, wallet ride authorization does not run and existing behavior remains dark.

## Authorization Model

Supported states:

```text
authorized
captured
released
expired
failed
```

Authorization is a reservation, not settlement.

Reservation accounting uses wallet cached projections:

```text
authorize: available -= amount, pending += amount
release:   available += remaining, pending -= remaining
capture:   pending -= captured_amount
```

Final settlement ledger entries are posted only during capture.

## Database Additions

Added additive wallet tables:

```text
public.wallet_authorizations
public.wallet_authorization_events
```

These store:

```text
ride_id
rider_id
wallet_account_id
amount
currency
status
idempotency_key
expires_at
captured_amount
released_amount
failure_reason
event audit trail
```

No ride lifecycle tables were modified.

## Ride Request Flow

When:

```text
payment_method = wallet
WALLET_RIDE_AUTHORIZATION_ENABLED=true
```

Go now:

```text
1. Generates the ride_id before insert.
2. Locks rider_wallet in a DB transaction.
3. Checks available balance.
4. Creates wallet_authorizations row.
5. Moves funds from available to pending.
6. Writes authorization event.
7. Inserts public.rides row.
8. Broadcasts ride_offer only after authorization succeeds.
```

If authorization fails due to insufficient funds:

```text
HTTP 402
No ride row inserted
No authorization created
No ride_offer broadcast
```

If ride insert fails after authorization:

```text
Go attempts best-effort authorization release
No driver offer broadcast occurs
warning is logged if release cleanup fails
```

## Capture Flow

On wallet ride completion:

```text
ride_completed websocket event remains delivered
ride completion response remains successful
wallet capture runs as a settlement side effect
```

Capture posts active wallet settlement:

```text
Debit:  rider_wallet      full captured fare
Credit: driver_wallet     85%
Credit: platform_wallet   15%
```

Settlement fields:

```text
transaction_type = wallet_settlement
payment_method = wallet
settlement_mode = active
settlement status = settled
idempotency key = wallet-settlement:{ride_id}
```

Unused authorized amount is released during capture.

## API Surface Decision

Implemented:

```text
POST /api/wallets/authorize-ride
POST /api/wallets/capture-ride
POST /api/wallets/release-ride
```

Security decision:

```text
authorize-ride: authenticated rider endpoint
capture-ride: admin/service-role gated
release-ride: admin/service-role gated
```

Normal ride creation and completion call the service internally. Capture and release are gated because they mutate financial state and should not be public rider/driver operations.

## Idempotency and Locking

Implemented controls:

```text
unique wallet_authorizations.ride_id
unique wallet_authorizations.idempotency_key
unique wallet_authorization_events.idempotency_key
row lock on wallet_authorizations during capture/release/expire
row lock on wallet_accounts during balance mutation
request rider_id must match locked authorization rider_id
duplicate authorization returns existing authorization
duplicate capture returns existing settlement
duplicate release returns released/expired authorization
```

## Tests Added

Added coverage for:

```text
successful authorization
insufficient balance
duplicate authorization
authorization expiration
release after cancellation
capture after completion
double capture prevention
double release prevention
wallet settlement ledger correctness
wallet ride request authorizes before broadcast
insufficient wallet funds do not broadcast ride_offer
wallet ride completion triggers capture without changing response
authorization HTTP route behavior
admin-only capture/release route protection
schema support for authorization tables and states
```

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

Before enabling outside local/internal testing:

```text
1. Apply additive wallet_authorizations and wallet_authorization_events schema.
2. Keep WALLET_RIDE_AUTHORIZATION_ENABLED=false.
3. Confirm existing cash and wallet request behavior is unchanged.
4. Enable WALLET_RIDE_AUTHORIZATION_ENABLED=true for internal riders only.
5. Seed rider_wallet available balance.
6. Request wallet ride with fare less than available balance.
7. Verify available decreases and pending increases.
8. Verify ride_offer is broadcast only after authorization succeeds.
9. Request wallet ride with insufficient balance.
10. Verify HTTP 402, no ride row, no ride_offer.
11. Complete authorized wallet ride.
12. Verify pending decreases, driver/platform wallets are credited, settlement is settled.
13. Retry capture and confirm no duplicate ledger posting.
14. Release an authorized ride and confirm funds return to available.
15. Expire stale authorization and confirm expiration audit event.
16. Reconcile wallet cached balances against ledger plus open authorizations.
```

## Operational Risks

```text
production DB constraints must be migrated before enabling wallet authorization
authorization expiry requires an operational job or admin action to call expiration
cached balances must be reconciled against ledger plus open holds
capture currently runs after ride_completed as a side effect, so failed captures must be monitored
actual fare adjustment policy is not yet defined beyond releasing unused authorized funds
public wallet payment rollout is still blocked until full reconciliation and support workflows exist
```

## Readiness Assessment

```text
GO V2.1-E2 Wallet Ride Authorization: IMPLEMENTED
Feature flag: DEFAULT OFF
Wallet balance reservation: IMPLEMENTED
Insufficient-funds block before broadcast: IMPLEMENTED
Authorization capture settlement: IMPLEMENTED
Release and expiration service methods: IMPLEMENTED
Provider integrations: NOT IMPLEMENTED
Frontend contracts: UNCHANGED
Websocket contracts: UNCHANGED
Public rollout: NOT ENABLED
```

Readiness for provider integrations:

```text
NOT READY FOR PROVIDER INTEGRATIONS
READY FOR INTERNAL WALLET-RIDE AUTHORIZATION TESTING
READY TO ADD EXPIRATION JOB AND RECONCILIATION DASHBOARD NEXT
READY TO DESIGN PROVIDER AUTH/CAPTURE ONLY AFTER WALLET HOLDS ARE PROVEN
```
