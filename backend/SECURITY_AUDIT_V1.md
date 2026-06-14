# PickMe Security Audit V1

## Executive Summary

PickMe has strong foundations in several financial areas: double-entry ledger posting, provider event idempotency, scoped payment idempotency, row locking in critical wallet paths, and a clear architecture rule:

```text
Supabase = Storage
Go = Everything Smart
```

The repository is not ready for public launch or broad public wallet/payment exposure. The highest-risk issue is that driver capability is not strongly bound to an approved driver identity in Go. Several operational and admin surfaces also rely on authentication without full authorization checks. Payment provider callbacks remain pilot-grade, and exact-money hardening is incomplete because `float64` is still present in live payment and wallet types.

Audit verdict:

```text
Internal controlled pilot: possible only after P0 remediation
Limited public wallet pilot: blocked until P0 and P1 financial/access findings are fixed
Public payments: not approved
Public driver activation: not approved
Production launch: not approved
```

## Scope

Reviewed security-sensitive areas:

```text
wallet security
authentication
authorization
websocket security
replay attack resistance
race conditions
privilege escalation
RLS bypass risks
financial integrity risks
provider callback security
pilot controls
admin reporting exposure
```

## Positive Controls Observed

```text
JWT signature, issuer, audience, exp, nbf, and subject validation exist
rider_id and driver_id request bodies are often bound to authenticated subject
wallet/provider deposit callback processing uses database transactions and row locks
provider_events has uniqueness constraints for provider event IDs and payload hashes
payment_intents has scoped idempotency and provider reference uniqueness in schema
wallet ledger paths use append-oriented double-entry primitives
many wallet and finance tables have RLS enabled with admin-only select policies
provider and public payment activation is still default-off
```

These controls are valuable, but several authorization and runtime enforcement gaps remain.

## Risk Ranking

```text
P0 Critical: 1
P1 High:    8
P2 Medium: 7
P3 Low:    4
```

## P0 Critical Findings

### P0-1: Any Authenticated User Can Act As A Driver

Affected areas:

```text
internal/websocket/auth.go:69
internal/websocket/auth.go:73
internal/websocket/handler.go:35
internal/rides/handler.go:154
internal/rides/handler.go:432
internal/rides/handler.go:468
internal/rides/handler.go:562
internal/drivers/handler.go:130
internal/drivers/handler.go:282
```

The websocket layer accepts a `role` query parameter and allows any authenticated user to register as a driver. Ride offer broadcasts are sent to registered driver sockets. Driver offer submission and direct ride acceptance only verify that the submitted `driver_id` equals the authenticated subject; they do not verify that the user is an approved driver, enrolled in the relevant pilot, active, in the authorized city, or not suspended.

Impact:

```text
unauthorized users can receive ride offers
unauthorized users can submit driver offers
unauthorized users can accept rides as drivers
driver impersonation and marketplace manipulation
passenger safety risk
pilot boundary breach
fraudulent earnings or settlement records
regulatory and board-review failure
```

Required remediation:

```text
1. Add a central Go authorization service for driver capability.
2. Require approved driver status before websocket driver registration.
3. Require approved driver status before driver online, location update, offer submission, and ride acceptance.
4. Bind driver eligibility to pilot or public launch authorization state.
5. Reject client-supplied websocket role escalation; derive role from server-side profile/driver records.
6. Add tests proving riders and unapproved users cannot register as drivers, receive offers, submit offers, or accept rides.
```

## P1 High Findings

### P1-1: Admin Reporting Routes Expose Sensitive Data To Any Authenticated User

Affected areas:

```text
internal/dispatch/reporting.go:29
internal/dispatch/reporting.go:30
internal/reputation/reporting.go:27
internal/reputation/reporting.go:28
internal/reputation/calibration_reporting.go:18
internal/reputation/calibration_reporting.go:19
```

Several `/admin/...` route groups are registered with `requireAuth` only and no admin authorization middleware. This permits any authenticated account to access dispatch shadow reports and driver reputation/calibration reporting.

Impact:

```text
leakage of operational marketplace data
exposure of driver scoring/reputation controls
privilege escalation from authenticated user to admin visibility
investor/regulator audit failure
```

Required remediation:

```text
1. Apply a shared admin/finance authorization middleware to every /admin route.
2. Add route registration tests proving non-admin users receive 403.
3. Maintain an allow-list inventory of all admin routes.
4. Add CI security tests that fail on /admin routes without admin middleware.
```

### P1-2: Driver Location Broadcast Can Leak Precise Location To All Websocket Clients

Affected areas:

```text
internal/drivers/handler.go:238
internal/websocket/manager.go:66
```

When no `ride_id` is supplied, driver location updates are broadcast to all connected websocket clients. Combined with the driver role escalation issue, this also allows unauthorized users to spam location updates.

Impact:

```text
driver privacy exposure
marketplace data leakage
stalking and safety risk
operational noise from spoofed locations
```

Required remediation:

```text
1. Remove global driver location broadcasts.
2. Publish driver location only to authorized ride rooms, dispatch operators, or vetted operational channels.
3. Require driver eligibility before accepting driver location updates.
4. Add rate limits and geofence sanity checks for location updates.
```

### P1-3: Payment Method Is Not Strictly Allow-Listed Before Ride Creation

Affected areas:

```text
internal/rides/types.go:10
internal/rides/handler.go:335
internal/rides/handler.go:343
internal/rides/handler.go:1009
```

Wallet authorization runs only when `payment_method == "wallet"`. Blank payment method defaults to cash, but unknown payment methods are not rejected. This creates ambiguity where a client can submit unsupported values and bypass wallet authorization/capture behavior.

Impact:

```text
rides can proceed with unsupported payment semantics
wallet capture may not happen for intended wallet rides
settlement records can diverge from client-visible payment method
fraud and reconciliation risk
```

Required remediation:

```text
1. Add a payment method enum in Go.
2. Accept only cash and wallet for the current pilot surface.
3. Normalize case and reject unknown values before ride creation.
4. Add tests for unknown, mixed-case, blank, wallet, and cash payment methods.
```

### P1-4: Provider Callback Verification Remains Pilot-Grade

Affected areas:

```text
internal/payments/provider.go:209
internal/payments/provider.go:249
internal/payments/service.go:232
internal/payments/http.go:61
internal/payments/http.go:63
internal/payments/http.go:65
internal/payments/http.go:67
```

Provider callbacks are intentionally unauthenticated HTTP endpoints protected by pilot HMAC adapters. The verification path does not enforce provider-certified webhook verification, timestamp replay windows, event type allow-lists, key rotation, or provider status confirmation. Provider `GetTransactionStatus` methods are stubs.

Impact:

```text
forged or replayed callbacks if pilot HMAC is mistaken for production
false wallet credits
provider settlement loss
chargeback and dispute exposure
audit failure before public deposits
```

Required remediation:

```text
1. Implement certified webhook verification per provider.
2. Validate provider timestamps and reject callbacks outside replay windows.
3. Maintain provider event type allow-lists.
4. Poll provider status before crediting for high-risk or delayed callbacks.
5. Add provider contract tests and negative security tests.
```

### P1-5: `float64` Remains In Financial Request And Ledger-Adjacent Types

Affected areas:

```text
internal/payments/http.go:90
internal/payments/provider.go:43
internal/payments/provider.go:328
internal/wallet/types.go:423
internal/wallet/types.go:436
internal/wallet/repository.go:2756
internal/wallet/repository.go:2949
internal/money/money.go:62
```

The repository includes an exact-money package and minor-unit schema additions, but live HTTP, provider, wallet, and repository code still uses `float64` in several financial paths.

Impact:

```text
rounding drift
ledger/projection mismatches
amount comparison edge cases
refund and fee split errors
financial audit objections
```

Required remediation:

```text
1. Replace financial API structs with minor-unit integer request types.
2. Remove float64 from wallet, payments, settlement, authorization, and reconciliation types.
3. Keep decimal display formatting at API boundaries only.
4. Add property tests for split math, refunds, reversals, and currency exponent handling.
```

### P1-6: Public-Schema Tables Have RLS Gaps

Affected areas:

```text
DISPATCH_SHADOW_SCHEMA.sql
PUBLIC_RIDE_OFFERS_MIGRATION.sql
DRIVER_REPUTATION_SCHEMA.sql
REPUTATION_CALIBRATION_SCHEMA.sql
WALLET_LEDGER_SCHEMA.sql:1568
```

Wallet and finance tables generally enable RLS, but some public-schema operational tables either do not enable RLS in their migration file or enable RLS without explicit read policies. `dispatch_shadow_*` and `ride_offers` are especially sensitive if exposed through Supabase APIs.

Impact:

```text
RLS bypass through direct Supabase access
exposure of ride offers, dispatch candidates, and operational scoring
inconsistent security posture across domains
```

Required remediation:

```text
1. Enable RLS on every public-schema application table.
2. Add explicit deny-by-default or role-scoped policies.
3. Add a schema test that fails if any public application table lacks RLS.
4. Keep write decisions in Go, not SQL policies or frontend code.
```

### P1-7: Public Wallet Pilot Controls Are Frameworked But Not Wired Into Live Wallet/Ride Paths

Affected areas:

```text
internal/wallet/public_wallet_pilot.go
cmd/server/main.go
internal/rides/handler.go
internal/payments/http.go
```

The V2.3-A wallet pilot service defines cohort, city, limit, fraud, reconciliation, and kill-switch controls. The service is not visibly instantiated or enforced in the live ride creation, wallet authorization, deposit, or payment endpoints.

Impact:

```text
Gwanda pilot limits may not protect runtime wallet actions
non-cohort users may reach wallet paths if older feature flags allow it
pilot transaction limits can become reporting-only rather than enforcement
board-approved pilot boundaries can be exceeded
```

Required remediation:

```text
1. Wire PublicWalletPilotService into wallet deposit and wallet ride payment entry points.
2. Enforce city, cohort, status, duration, balance, daily, and monthly limits before mutation.
3. Enforce pilot wallet kill switches before mutation.
4. Add integration tests proving non-cohort and non-Gwanda users are blocked.
```

### P1-8: Admin Authorization Relies On JWT Role Claims Instead Of A Server-Side Permission Model

Affected areas:

```text
internal/auth/supabase_jwt.go:22
internal/middleware/auth.go:40
internal/wallet/admin_http.go:1150
internal/payments/http.go:374
```

Admin authorization checks the JWT `role` placed into request locals. Wallet RLS policies use `auth.jwt()->app_metadata->>role = 'admin'`, but Go admin middleware allows top-level roles `admin` and `service_role`. This creates inconsistent authorization semantics between Go and Supabase policies.

Impact:

```text
admin access can depend on stale or overly broad token claims
service_role bearer usage becomes a full admin bypass if exposed
Go and Supabase authorization can disagree
privilege review is harder during audits
```

Required remediation:

```text
1. Implement a central Go permission service backed by server-side admin/finance role records.
2. Prefer immutable app_metadata roles only as a coarse hint, not final authorization.
3. Never accept service_role tokens from user-facing clients.
4. Require tiered finance permissions for financial admin actions.
5. Add tests for stale token, service_role, admin, finance viewer, and non-admin cases.
```

## P2 Medium Findings

### P2-1: Raw Database Errors Are Returned To Clients

Affected areas:

```text
internal/database/postgres.go:38
internal/rides/handler.go
internal/drivers/handler.go
internal/dispatch/reporting.go
internal/reputation/reporting.go
internal/wallet/reporting.go
cmd/server/main.go:129
```

Multiple handlers return `err.Error()` directly. The `/test-db` route also returns raw database connectivity errors.

Recommended remediation:

```text
1. Replace raw errors with stable public error codes.
2. Log detailed errors server-side with request IDs.
3. Remove or protect /test-db in non-local environments.
```

### P2-2: Websocket Tokens In Query Strings Increase Leakage Risk

Affected areas:

```text
internal/websocket/auth.go:93
internal/websocket/auth.go:97
WEBSOCKET_PROTOCOL.md
```

The websocket layer accepts access tokens in query parameters. Query strings can leak through logs, proxies, browser history, and diagnostics.

Recommended remediation:

```text
1. Prefer Authorization headers or short-lived one-time websocket tickets.
2. Reduce websocket token TTL.
3. Redact tokens in all websocket logs and documentation examples.
```

### P2-3: Websocket Handler Logs And Echoes Raw Client Messages

Affected areas:

```text
internal/websocket/handler.go:63
internal/websocket/handler.go:64
internal/websocket/handler.go:68
```

The websocket handler prints raw client messages and echoes them back. This can leak data into logs and create noisy broadcast/echo behavior.

Recommended remediation:

```text
1. Remove raw message logging in production.
2. Parse and allow-list websocket message types.
3. Add per-connection rate limits and message size limits.
```

### P2-4: No Global Rate Limiting, Body Limits, Or Panic Recovery Middleware Observed

Affected area:

```text
cmd/server/main.go:119
```

The Fiber app is initialized without visible global rate limiting, request body limits, or panic recovery middleware.

Recommended remediation:

```text
1. Add recovery middleware.
2. Add route-specific request body limits.
3. Add rate limits for auth, websocket upgrade, ride creation, driver location, provider callbacks, and admin endpoints.
4. Add abuse metrics and alerts.
```

### P2-5: Websocket Broadcast Holds A Mutex During Network Writes

Affected area:

```text
internal/websocket/manager.go:66
```

The websocket manager holds its lock while writing to every client. A slow or stuck client can block broadcast progress and connection registry updates.

Recommended remediation:

```text
1. Snapshot clients under lock, then release the lock before network writes.
2. Add per-client outbound queues with backpressure.
3. Drop or disconnect slow clients after threshold.
```

### P2-6: Websocket Registry Can Delete Newer Connections From Stale Disconnects

Affected area:

```text
internal/websocket/registry.go:33
```

The registry deletes a user connection by user ID only. If a user reconnects, an older connection cleanup can remove the newer connection from the registry.

Recommended remediation:

```text
1. Store connection IDs or pointers with registry entries.
2. Delete only if the closing connection matches the registered connection.
3. Add tests for reconnect races.
```

### P2-7: Reputation RLS Configuration Is Ambiguous

Affected areas:

```text
DRIVER_REPUTATION_SCHEMA.sql
REPUTATION_CALIBRATION_SCHEMA.sql
```

These schemas enable RLS but do not clearly define access policies in the same migration. This may be safe-deny through Supabase Data API, but it is operationally ambiguous and can cause either accidental exposure in future migrations or broken direct-admin access assumptions.

Recommended remediation:

```text
1. Add explicit admin-only select policies or explicit deny policies.
2. Document that writes are Go-owned only.
3. Add schema tests for expected policy names.
```

## P3 Low Findings

### P3-1: Local `.env` Exists In Workspace

The `.env` file appears ignored by git, which is good. It still increases local secret exposure risk.

Recommended remediation:

```text
1. Keep .env out of git.
2. Rotate any secrets that were ever shared in screenshots or logs.
3. Prefer a secrets manager for shared environments.
```

### P3-2: Manual HS256 JWT Verification Should Be Reviewed Before Production

Affected area:

```text
internal/auth/supabase_jwt.go:45
```

Manual HS256 verification is acceptable only if Supabase JWT configuration remains symmetric and the secret is tightly protected. If the project moves to asymmetric JWT signing, verification must use JWKS/key rotation.

Recommended remediation:

```text
1. Document the expected Supabase JWT signing mode.
2. Add key rotation runbooks.
3. Add tests for invalid alg, wrong audience, wrong issuer, expired, and not-before tokens.
```

### P3-3: SQL Triggers Should Remain Non-Business-Logic Only

Affected area:

```text
PUBLIC_RIDE_OFFERS_MIGRATION.sql
```

The observed trigger appears to maintain `updated_at`, which is acceptable. Future migrations should avoid moving financial, dispatch, pilot, or governance decisions into SQL triggers.

Recommended remediation:

```text
1. Keep triggers limited to timestamps or invariant enforcement.
2. Review future migrations for business logic drift.
```

### P3-4: Production Logs Need Redaction Standards

Affected areas:

```text
internal/websocket/handler.go
internal/rides/handler.go
internal/drivers/handler.go
```

Some logs include operational identifiers and raw message content. This is manageable for development but should be standardized before production.

Recommended remediation:

```text
1. Add structured logging with request IDs.
2. Redact tokens, raw websocket payloads, phone numbers, and precise locations.
3. Add log retention and access controls.
```

## Race Condition And Replay Review

Good controls:

```text
provider callback processing uses transactions and row locks
provider_events uniqueness reduces duplicate callback posting
wallet ledger posting uses idempotency keys
payment_intents has scoped idempotency and provider reference uniqueness in schema
```

Remaining risks:

```text
provider callbacks lack timestamp replay windows
websocket registry can race on reconnect/disconnect
websocket broadcasts can be blocked by slow clients
driver capability checks are not atomic with driver marketplace actions
pilot wallet framework is not yet enforced at runtime entry points
```

## RLS Review

Good controls:

```text
wallet and finance hardening tables generally enable RLS
admin-only select policies commonly use app_metadata role checks
write decisions remain mostly Go-owned
```

Required hardening:

```text
1. Every public-schema application table must have RLS enabled.
2. Every sensitive table must have explicit deny-by-default or role-scoped policies.
3. Go admin authorization must match the server-side role model used by RLS.
4. Add automated schema tests for missing RLS and missing policies.
```

## Financial Integrity Review

Strong areas:

```text
double-entry ledger direction is sound
provider callback processing posts through wallet repository primitives
provider events are audited
idempotency and provider-reference uniqueness exist in schema
pilot flags and governance reports are default conservative
```

Launch blockers:

```text
float64 remains in live financial code
payment method allow-list is incomplete
provider verification is not production-certified
public wallet pilot controls are not wired into live mutation paths
admin finance authorization is too coarse
```

## Remediation Roadmap

### Immediate: Before Any Wider Internal Pilot

```text
1. Fix driver identity and eligibility enforcement across websocket, driver, and ride-offer paths.
2. Add admin authorization middleware to all /admin routes.
3. Remove global driver location broadcasts.
4. Add payment method allow-listing.
5. Protect or remove /test-db.
```

### Short Term: Before Limited Public Wallet Pilot Execution

```text
1. Wire wallet pilot access and limit checks into live deposit and ride wallet paths.
2. Complete exact-money minor-unit migration in Go request and domain types.
3. Enable and test RLS on every public application table.
4. Add rate limits and request body limits.
5. Remove raw error leakage.
```

### Medium Term: Before Public Provider Deposits

```text
1. Replace pilot HMAC provider adapters with certified provider verification.
2. Add callback timestamp replay windows and provider event allow-lists.
3. Add provider status polling for high-risk callbacks.
4. Add dead-letter handling for suspicious provider events.
5. Run provider statement reconciliation daily with signoff.
```

### Production Gate

```text
1. No P0 findings open.
2. No P1 findings open without board-approved exception and mitigation.
3. RLS coverage verified by automated tests.
4. Driver eligibility enforced server-side.
5. Wallet pilot controls enforced at runtime.
6. Provider callback verification certified.
7. Daily reconciliation green.
8. Finance, CTO, risk, and operations signoff recorded.
```

## Final Security Decision

```text
Repository security posture: NOT PUBLIC-LAUNCH READY
Wallet security posture: PILOT-READY ONLY AFTER P0/P1 FIXES
Driver marketplace security posture: BLOCKED BY P0 DRIVER AUTHORIZATION GAP
Provider payment security posture: PILOT-ONLY
RLS posture: NEEDS COVERAGE HARDENING
Financial integrity posture: NEEDS EXACT-MONEY COMPLETION
```

Security recommendation:

```text
Do not proceed to public driver activation, public wallet execution, provider public activation, or production launch until P0 and P1 findings are remediated and verified by tests.
```
