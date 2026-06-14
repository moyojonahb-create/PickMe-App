# Backend Capability Matrix

Audit date: 2026-06-12

Scope: Go backend capability inventory across API endpoints, websocket events, rider features, driver features, wallet features, admin features, payment features, and reporting features.

Status legend:

- Active: Current supported backend capability.
- Admin-only: Requires Supabase JWT plus Go admin authorization.
- Provider-only: Intended for external payment provider callbacks, not frontend users.
- Compatibility: Supported adapter or legacy route retained for existing clients.
- Deprecated: Should not be used for new client work.
- Experimental/Internal: Operational, certification, launch-readiness, or pilot-control capability not intended as normal rider/driver product UX.

## System Features

| Capability | Endpoint / Module | Status | Notes |
| --- | --- | --- | --- |
| Health check | `GET /health` | Active | Database health |
| Redis health check | `GET /health/redis` | Active | Redis enabled/connected/latency status |
| Database test endpoint | `GET /test-db` | Compatibility | Diagnostic endpoint; should not be public in hardened production |
| Root service banner | `GET /` | Active | Basic backend running response |
| Global request IDs | `internal/middleware.RequestID` | Active | Adds `X-Request-ID` |
| Panic recovery | `internal/middleware.Recover` | Active | Converts panic to structured 500 |
| Request timeouts | `internal/middleware.RequestTimeout` | Active | Deadline-aware context propagation |
| Global rate limiting | `internal/middleware.GlobalRateLimit` | Active | Process-local fixed window |
| Structured request logging | `internal/middleware.Observability` | Active | Logs request id, method, path, status, duration, user |
| CORS | `internal/middleware.CORS` | Active | Configured origins/methods/headers |
| Supabase JWT auth | `internal/middleware.SupabaseJWT` | Active | Validates Supabase JWT in Go |
| Admin authorization | `internal/middleware.AdminOnly` | Active | Allows `admin` and `service_role` |

## Rider Features

| Feature | Endpoint / Event | Status | Notes |
| --- | --- | --- | --- |
| List own rides | `GET /rides` | Active | Riders see only own rides; drivers assigned rides; admins all rides |
| Request ride | `POST /rides/request` | Active | Auth required |
| Request ride via API adapter | `POST /api/rides` | Active | Compatibility route for frontend-style API |
| Submit ride offer | `POST /api/rides/:rideId/offers` | Active | Driver-oriented offer submission endpoint |
| List ride offers | `GET /api/rides/:rideId/offers` | Active | Auth required |
| Accept driver offer | `POST /api/rides/:rideId/offers/:offerId/accept` | Active | Rider accepts an offer |
| Reject driver offer | `POST /api/rides/:rideId/offers/:offerId/reject` | Active | Rider rejects an offer |
| Track ride lifecycle | `ride_accepted`, `ride_started`, `ride_completed`, `driver_location` | Active | Websocket events |
| Start ride status transition | `POST /api/rides/:rideId/status` | Active | Maps to accepted -> ongoing |
| Complete ride | `POST /api/rides/:rideId/complete` | Active | Maps ongoing -> completed |
| Settle ride compatibility | `POST /api/rides/:rideId/settle` | Compatibility | Maps to completion/settlement behavior |
| Join ride room helper | `POST /rides/join-room` | Deprecated | Unauthenticated helper returning localhost websocket URL; use authenticated `/ws` instead |
| Cancel ride | None found | Missing | No dedicated rider cancellation endpoint found |
| Ride history | `GET /rides` | Active | Filtered by auth role |

## Driver Features

| Feature | Endpoint / Event | Status | Notes |
| --- | --- | --- | --- |
| Go online | `POST /drivers/online` | Active | Auth and driver authorization |
| Heartbeat | `POST /drivers/heartbeat` | Active | Driver presence freshness |
| Go offline | `POST /drivers/offline` | Active | Driver presence update |
| Presence adapter | `POST /api/drivers/me/presence` | Active | Accepts `status`, `state`, `action`, `is_online`, `online` |
| Update location | `POST /drivers/location` | Active | Auth, driver authorization, validation, Redis hot-state optional |
| Update location adapter | `POST /api/drivers/me/location` | Active | Frontend-style compatibility route |
| Receive ride offers | `ride_offer` websocket event | Active | Targeted to registered driver sockets |
| Accept ride directly | `POST /rides/:id/accept` | Compatibility | Legacy direct accept path |
| Submit offer | `POST /api/rides/:rideId/offers` | Active | Stores offer with TTL |
| Reject/cancel own offer | `POST /api/rides/:rideId/offers/:offerId/reject` | Active | Offer rejection path |
| Start accepted ride | `POST /rides/:id/start` or `POST /api/rides/:rideId/status` | Active | Assigned driver only |
| Complete ongoing ride | `POST /rides/:id/complete` or `POST /api/rides/:rideId/complete` | Active | Assigned driver only |
| Nearby driver lookup | `GET /drivers/nearby` | Admin-only | Not public rider discovery |
| Driver reputation tracking | `internal/reputation` | Active/Internal | Offer sent/submitted/accepted, completion, cancellation, location freshness |

## Wallet Features

| Feature | Endpoint / Module | Status | Notes |
| --- | --- | --- | --- |
| Wallet state | `GET /api/wallets/me` | Active | Auth required |
| Wallet transaction history | `GET /api/wallets/me/transactions` | Active | Auth required |
| Manual/admin-flow deposit creation | `POST /api/wallets/deposits` | Active/Pilot gated | Rider pilot eligibility required |
| Deposit detail | `GET /api/wallets/deposits/:id` | Active | Auth required |
| Withdrawal creation | `POST /api/wallets/withdrawals` | Active/Pilot gated | Driver pilot eligibility required |
| Withdrawal detail | `GET /api/wallets/withdrawals/:id` | Active | Auth required |
| Ride wallet authorization | `POST /api/wallets/authorize-ride` | Active/Pilot gated | Reserves rider funds |
| Ride capture | `POST /api/wallets/capture-ride` | Admin-only | Captures authorized funds |
| Ride release | `POST /api/wallets/release-ride` | Admin-only | Releases held funds |
| Exact money minor units | `internal/wallet/money.go`, `internal/money` | Active | Internal money as `int64` minor units |
| Wallet ledger | `internal/wallet/repository.go` | Active | Balanced ledger entries and cached balances |
| Authorization expiration worker | `internal/wallet/authorization.go` | Active/Config gated | Expires stale holds |
| Active cash settlement | `internal/wallet/active_settlement.go` | Active/Config gated | Cash liability/platform fee recording |
| Shadow settlement | `internal/wallet/settlement.go` | Active/Internal | Non-blocking settlement recording |
| Wallet reconciliation | `internal/wallet/reconciliation.go` | Active | Detects drift and open/expired auths |
| Public wallet pilot enforcement | `internal/wallet/public_wallet_pilot_enforcement.go` | Active | Cohort, city, balance, daily/monthly limits |
| Public wallet pilot program | `internal/wallet/public_wallet_pilot.go` | Active/Internal | Program, participants, transactions, reconciliation, fraud, kill switches |
| Internal wallet pilot | `internal/wallet/pilot.go` | Active/Internal | Pilot cohort controls |
| Refund intents | `POST /admin/finance/refunds` | Admin-only | Financial recovery |
| Chargebacks | `POST /admin/finance/chargebacks` | Admin-only | Financial recovery |
| Disputes | `POST /admin/finance/disputes` | Admin-only | Financial recovery |
| Provider statement reconciliation | `POST /admin/finance/provider-statements/import`, `POST /admin/finance/provider-statements/:id/reconcile` | Admin-only | Reconciliation workflow |

## Payment Features

| Feature | Endpoint / Module | Status | Notes |
| --- | --- | --- | --- |
| OneMoney deposit intent | `POST /api/payments/onemoney/deposits` | Active/Config gated | Auth required, pilot gating optional |
| EcoCash deposit intent | `POST /api/payments/ecocash/deposits` | Active/Config gated | Auth required, pilot gating optional |
| Innbucks deposit intent | `POST /api/payments/innbucks/deposits` | Active/Config gated | Auth required, pilot gating optional |
| PayPal deposit intent | `POST /api/payments/paypal/deposits` | Active/Config gated | Auth required, pilot gating optional |
| Card deposit | `POST /api/payments/cards/deposits` | Development-only unless real processor | Mock card processor rejected in production |
| OneMoney callback | `POST /api/payments/onemoney/callback` | Provider-only | Signed callback, replay protected |
| EcoCash callback | `POST /api/payments/ecocash/callback` | Provider-only | Signed callback, replay protected |
| Innbucks callback | `POST /api/payments/innbucks/callback` | Provider-only | Signed callback, replay protected |
| PayPal callback | `POST /api/payments/paypal/callback` | Provider-only | Signed callback, replay protected |
| Provider signature verification | `internal/payments/provider.go` | Active | Provider-specific canonical signing |
| Provider status verification | `HTTPStatusVerifier` | Active/Config required | Enabled providers require status URL outside dev |
| Duplicate event protection | `provider_events` repository path | Active | Event/reference/payload idempotency |
| Callback dead-lettering | `RecordProviderCallbackDeadLetter` | Active | Suspicious callback investigation |
| Card authorization/capture/void/refund abstraction | `internal/payments/card.go` | Internal/Config gated | Mock only allowed in dev |
| Payment failure metrics/jobs | `recordCallbackFailure` | Active/Internal | Financial jobs and metrics |
| Provider withdrawals | `CreateWithdrawal` provider methods | Disabled | Current provider implementations fail closed |

## Admin Features

| Feature | Endpoint | Status | Notes |
| --- | --- | --- | --- |
| Pending deposits | `GET /admin/wallets/deposits/pending` | Admin-only | Review queue |
| Approve deposit | `POST /admin/wallets/deposits/:id/approve` | Admin-only | Manual/admin deposit flow |
| Reject deposit | `POST /admin/wallets/deposits/:id/reject` | Admin-only | Manual/admin deposit flow |
| Pending withdrawals | `GET /admin/wallets/withdrawals/pending` | Admin-only | Review queue |
| Approve withdrawal | `POST /admin/wallets/withdrawals/:id/approve` | Admin-only | Driver payout control |
| Reject withdrawal | `POST /admin/wallets/withdrawals/:id/reject` | Admin-only | Driver payout control |
| Admin action audit | `GET /admin/wallets/admin-actions` | Admin-only | Audit trail |
| Run wallet reconciliation | `POST /admin/wallets/reconciliation/run` | Admin-only | Financial integrity |
| Open authorizations | `GET /admin/wallets/authorizations/open` | Admin-only | Wallet holds |
| Expired authorizations | `GET /admin/wallets/authorizations/expired` | Admin-only | Stale hold review |
| Pilot user enable | `POST /admin/wallets/pilot/users/:userId/enable` | Admin-only | Pilot cohort control |
| Pilot user disable | `POST /admin/wallets/pilot/users/:userId/disable` | Admin-only | Pilot cohort control |
| Pilot user suspend | `POST /admin/wallets/pilot/users/:userId/suspend` | Admin-only | Pilot risk control |
| Pilot user remove | `POST /admin/wallets/pilot/users/:userId/remove` | Admin-only | Pilot cohort control |
| Create refund intent | `POST /admin/finance/refunds` | Admin-only | Recovery flow |
| Create chargeback | `POST /admin/finance/chargebacks` | Admin-only | Recovery flow |
| Open dispute | `POST /admin/finance/disputes` | Admin-only | Recovery flow |
| Update dispute status | `POST /admin/finance/disputes/:id/status` | Admin-only | Recovery flow |
| Create financial incident | `POST /admin/finance/incidents` | Admin-only | Incident tracking |
| Import provider statement | `POST /admin/finance/provider-statements/import` | Admin-only | Provider reconciliation |
| Reconcile provider statement | `POST /admin/finance/provider-statements/:id/reconcile` | Admin-only | Provider reconciliation |
| Start provider certification | `POST /admin/finance/certifications/:provider/start` | Admin-only | Certification workflow |
| Run recovery drill | `POST /admin/finance/recovery-drills` | Admin-only | Recovery readiness |
| Record recovery scorecard | `POST /admin/finance/recovery-scorecards` | Admin-only | Certification/recovery scoring |
| Create finance approval | `POST /admin/finance/approvals` | Admin-only | Governance |
| Record finance approval decision | `POST /admin/finance/approvals/:id/decision` | Admin-only | Governance |
| Create launch gate | `POST /admin/finance/launch-gates` | Admin-only | Launch governance |
| Evaluate launch gate | `POST /admin/finance/launch-gates/:id/evaluate` | Admin-only | Launch governance |
| Create finance close run | `POST /admin/finance/close-runs` | Admin-only | Daily close |
| Create finance signoff | `POST /admin/finance/signoffs` | Admin-only | Finance approval |
| Create launch readiness scorecard | `POST /admin/finance/launch-readiness-scorecards` | Admin-only | Launch readiness |

## Reporting Features

| Reporting Area | Endpoints | Status |
| --- | --- | --- |
| Wallet reconciliation | `GET /admin/wallets/reconciliation/summary`, `GET /admin/wallets/reconciliation/drift` | Admin-only |
| Wallet pilot | `GET /admin/wallets/pilot/summary`, `/users`, `/failures`, `/reconciliation` | Admin-only |
| Public wallet pilot | `GET /admin/finance/public-wallet-pilot`, `/public-wallet-pilot-participants`, `/public-wallet-pilot-transactions`, `/public-wallet-pilot-reconciliation`, `/public-wallet-pilot-fraud`, `/public-wallet-pilot-evidence` | Admin-only |
| Pilot aliases | `GET /admin/pilot/cohort`, `/transactions`, `/monitoring`, `/daily-report` | Admin-only |
| Shadow settlements | `GET /admin/wallets/shadow-settlements/summary`, `/recent`, `/failed` | Admin-only |
| Active settlements | `GET /admin/wallets/active-settlements/summary`, `/active-settlements/failed`, `/driver-liabilities` | Admin-only |
| Payment provider summaries | `GET /admin/payments/{provider}/summary` for onemoney, ecocash, innbucks, paypal, cards | Admin-only |
| Payment provider transactions | `GET /admin/payments/{provider}/transactions` | Admin-only |
| Payment provider reconciliation | `GET /admin/payments/{provider}/reconciliation` | Admin-only |
| Payment provider failures | `GET /admin/payments/{provider}/failures` | Admin-only |
| Dispatch shadow | `GET /admin/dispatch/shadow/summary`, `/daily`, `/recent`, `/runs/:id/candidates`, `/outcomes`, `/failures`, `/health` | Admin-only |
| Driver reputation | `GET /admin/reputation/drivers`, `/drivers/:driverID`, `/drivers/:driverID/events`, `/top-drivers`, `/low-score-drivers` | Admin-only |
| Reputation calibration | `GET /admin/reputation/health`, `/distribution`, `/cohorts`, `/calibration`, `/dispatch-analysis` | Admin-only |
| Financial hardening/recovery | `GET /admin/finance/hardening/summary`, `/recovery/summary` | Admin-only |
| Refunds/chargebacks/disputes/incidents | `GET /admin/finance/refunds`, `/chargebacks`, `/disputes`, `/incidents` | Admin-only |
| Provider statements | `GET /admin/finance/provider-statements`, `/provider-statements/lines` | Admin-only |
| Runbooks/reliability | `GET /admin/finance/runbooks`, `/reliability/summary`, `/reliability-scorecards` | Admin-only |
| Certifications/recovery drills | `GET /admin/finance/certifications`, `/certifications/checks`, `/recovery-drills`, `/recovery-drills/events`, `/recovery-scorecards` | Admin-only |
| Governance | `GET /admin/finance/governance/summary`, `/approvals`, `/launch-gates`, `/close-runs`, `/signoffs`, `/launch-readiness-scorecards` | Admin-only |
| Release readiness | `GET /admin/finance/release-readiness`, `/release-evidence`, `/release-scorecards`, `/executive-signoff`, `/launch-blockers`, `/internal-launch-status` | Admin-only |
| Drill and exception review | `GET /admin/finance/drill-evidence`, `/exceptions` | Admin-only |
| Control room / daily close | `GET /admin/finance/control-room`, `/daily-close`, `/pilot-monitoring`, `/day1-close`, `/pilot-status`, `/go-no-go` | Admin-only |
| Internal pilot board/authorization | `GET /admin/finance/pilot-authorization`, `/pilot-readiness`, `/internal-pilot-board`, `/internal-pilot-authorization`, `/internal-pilot-health`, `/internal-pilot-incidents`, `/internal-pilot-participants`, `/internal-pilot-kill-switches`, `/internal-pilot-readiness`, `/internal-pilot-evidence`, `/internal-pilot-objectives`, `/internal-pilot-summary`, `/internal-pilot-compliance`, `/internal-pilot-board-review`, `/internal-pilot-findings`, `/internal-pilot-readiness-assessment`, `/internal-pilot-board-recommendation`, `/internal-pilot-review-summary` | Admin-only |

## WebSocket Events

| Event | Producer | Status | Payload Notes |
| --- | --- | --- | --- |
| `ride_offer` | Ride request | Active | Sent to registered driver sockets; includes `estimated_fare_minor` |
| `ride_accepted` | Direct ride accept or offer accept | Active | Sent to rider socket; offer path includes `offer_id` |
| `driver_location` | Driver location update | Active | Sent to ride room when `ride_id` exists |
| `ride_started` | Ride start transition | Active | Sent to room plus rider/driver fallback sockets |
| `ride_completed` | Ride complete transition | Active | Sent to room plus rider/driver fallback sockets |
| `SERVER RECEIVED: ...` | Websocket read loop | Deprecated/Legacy | Plain-text echo retained for compatibility; not a structured product event |
| `driver.location.update` | None | Missing/Broken | Not emitted by backend |

Websocket connection:

- `/ws`
- Auth through `Authorization: Bearer`, `access_token`, or `token`
- Ride rooms use `room=ride_{ride_id}`
- Room membership authorized server-side
- Driver registration decided server-side

## Deprecated / Compatibility Endpoints

| Endpoint / Feature | Classification | Reason |
| --- | --- | --- |
| `POST /rides/join-room` | Deprecated | Unauthenticated helper returning `ws://localhost:3000`; use authenticated `/ws` |
| `POST /rides/:id/accept` | Compatibility | Legacy direct driver accept; offer-based flow exists under `/api/rides/:rideId/offers` |
| `POST /rides/request` | Compatibility/Active | Legacy route retained alongside `POST /api/rides` |
| `POST /rides/:id/start` | Compatibility/Active | Legacy route retained alongside `/api/rides/:rideId/status` |
| `POST /rides/:id/complete` | Compatibility/Active | Legacy route retained alongside `/api/rides/:rideId/complete` |
| `POST /drivers/location` | Compatibility/Active | Legacy route retained alongside `/api/drivers/me/location` |
| `POST /drivers/online`, `/heartbeat`, `/offline` | Compatibility/Active | Legacy routes retained alongside `/api/drivers/me/presence` |
| `SERVER RECEIVED: ...` websocket echo | Deprecated | Non-JSON legacy echo |
| `GET /test-db` | Diagnostic/Compatibility | Useful for development diagnostics; should be restricted or removed from public production exposure |

## Experimental / Internal Endpoints

| Area | Endpoints / Modules | Reason |
| --- | --- | --- |
| Dispatch shadow reporting | `/admin/dispatch/shadow/*` | Shadow-mode analytics/control, not core rider/driver UX |
| Reputation calibration | `/admin/reputation/health`, `/distribution`, `/cohorts`, `/calibration`, `/dispatch-analysis` | Calibration/reporting surface |
| Provider certification | `/admin/finance/certifications*` | Readiness/certification workflow |
| Recovery drills | `/admin/finance/recovery-drills*`, `/recovery-scorecards` | Operational drill workflow |
| Launch governance | `/admin/finance/launch-gates*`, `/launch-readiness-scorecards` | Governance and release-readiness |
| Internal pilot board review | `/admin/finance/internal-pilot-*` | Internal pilot governance/reporting |
| Public wallet pilot reports | `/admin/finance/public-wallet-pilot*`, `/admin/pilot/*` | Pilot operations reporting |
| Shadow settlements | `/admin/wallets/shadow-settlements/*` | Non-blocking settlement observation |

## Missing Capabilities

| Capability | Status | Notes |
| --- | --- | --- |
| Rider cancellation endpoint | Missing | No dedicated public cancel endpoint found |
| Driver cancellation after accept | Missing | Reputation has cancellation tracking, but no explicit route found |
| Rider support ticket API | Missing | No public support endpoint found |
| Referral/growth API | Missing | Not part of backend product surface |
| User profile management | Missing | Auth/profile appears external to Go/Supabase Auth |
| Real production card processor | Missing/Config gated | Mock is development-only |
| Provider withdrawals | Disabled | Provider withdrawal methods fail closed |

## Unused Endpoints

Actual frontend usage cannot be determined from this backend repository alone because the Lovable frontend source is absent.

High-risk surfaces to validate against frontend usage:

- `/api/wallets/*`
- `/api/payments/*/deposits`
- `/api/rides/:rideId/offers`
- `/api/drivers/me/presence`
- `/admin/finance/*`
- `/admin/wallets/*`
- `/admin/pilot/*`
- `/ws`

## Module Summary

| Module | Primary Capabilities |
| --- | --- |
| `cmd/server` | App wiring, middleware, Redis, wallet, payment, ride, driver, admin/report routes |
| `internal/auth` | Supabase JWT validation |
| `internal/middleware` | Auth, admin authorization, CORS, request ID, recovery, timeout, rate limit, observability |
| `internal/rides` | Ride request/list, offers, accept/reject, lifecycle, settlement hooks, websocket events |
| `internal/drivers` | Online/offline/heartbeat, location updates, Redis hot-state, location privacy/authorization |
| `internal/websocket` | Authenticated websocket transport, room authorization, registries, backpressure-safe sends |
| `internal/wallet` | Ledger, exact money, authorizations, settlement, pilot enforcement, refunds, chargebacks, disputes, reconciliation, governance/reporting |
| `internal/payments` | Provider deposit intents, callbacks, signature/status verification, card abstraction, provider reporting |
| `internal/dispatch` | Shadow dispatch analytics/reporting |
| `internal/reputation` | Driver reputation scoring, calibration, admin reporting |
| `internal/redis` | Redis client, pooling, health, driver location hot-state support |
| `internal/geo` | Driver location/presence geo abstractions |

