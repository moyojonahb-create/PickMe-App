# Frontend Backend Communication Audit

Audit date: 2026-06-12

Scope: Lovable React + Capacitor frontend communication paths in `src/`.

Target architecture:

```text
Frontend (Lovable React + Capacitor)
  -> Go Backend (Fiber/API)
  -> Supabase PostgreSQL
```

Finding: the repository is **partially migrated**. Core ride and driver write paths now use the Go client, but the frontend still talks directly to Supabase for many ride reads, wallet flows, financial/admin workflows, dispatch-supporting data, settings, profiles, notifications, and operational tooling.

## SECTION A - Frontend -> Go API Calls

### Central Go Client

| File | Purpose |
| --- | --- |
| `src/lib/goBackendClient.ts` | Central HTTP client. Reads `VITE_GO_BACKEND_URL`, `VITE_API_BASE_URL`, or `VITE_BACKEND_URL`; attaches Supabase bearer token; supports `GET`, `POST`, `PATCH`, `DELETE`; maps typed errors. |
| `src/lib/goRideSocket.ts` | Go websocket client for `/ws?access_token={token}&room=ride_{rideId}`. |

### Go-Owned Calls Found

| Flow | Frontend Call | Files |
| --- | --- | --- |
| Ride creation | `POST /api/rides` | `src/lib/requestRide.ts`, `src/pages/negotiate/RiderRequestScreen.tsx` |
| Offer submission | `POST /api/rides/:rideId/offers` | `src/lib/offerHelpers.ts`, `src/pages/negotiate/DriverRequestsScreen.tsx` |
| Offer acceptance | `POST /api/rides/:rideId/offers/:offerId/accept` | `src/lib/offerHelpers.ts`, `src/pages/RideDetail.tsx`, `src/pages/negotiate/RiderOffersScreen.tsx` |
| Offer rejection | `POST /api/rides/:rideId/offers/:offerId/reject` | `src/lib/offerHelpers.ts`, `src/pages/RideDetail.tsx` |
| Ride status/lifecycle | `POST /api/rides/:rideId/status` | `src/pages/DriverDashboard.tsx`, `src/pages/RiderRideDetail.tsx`, `src/pages/RideDetail.tsx`, `src/components/driver/FullScreenNavigation.tsx`, `src/components/ride/RideView.tsx` |
| Ride completion | `POST /api/rides/:rideId/complete` | `src/lib/completeTrip.ts` |
| Ride settlement | `POST /api/rides/:rideId/settle` | `src/lib/completeTrip.ts` |
| Fare adjustment | `PATCH /api/rides/:rideId` | `src/pages/RiderRideDetail.tsx` |
| Driver presence | `POST /api/drivers/me/presence` | `src/pages/DriverDashboard.tsx` |
| Driver location | `POST /api/drivers/me/location` | `src/lib/driverLocation.ts` |
| Ride websocket | `/ws?access_token={token}&room=ride_{rideId}` | `src/lib/goRideSocket.ts`, `src/hooks/useRideRealtime.ts` |

### Other `fetch()` Calls

These do not use `goBackendClient`.

| Target | Files | Classification |
| --- | --- | --- |
| Supabase Edge Function `verify-student` | `src/pages/StudentVerificationPage.tsx` | Supabase direct; student verification deferred/out-of-scope |
| Supabase Edge Function `admin-api` | `src/hooks/useAdminAuth.tsx`, `src/pages/admin/AdminDashboard.tsx` | Architecture violation for admin operations |
| Supabase Edge Function `send-notification` | `src/hooks/useSendNotification.ts`, `src/components/ride/RideView.tsx` | Supabase direct notification path |
| Supabase Edge Function `wallet-pin` | `src/hooks/useWalletPin.ts` | Wallet/security direct path |
| OTP SMS HTTP endpoints | `src/pages/Signup.tsx` | Supabase/function-backed auth-adjacent flow |
| Map/geocode/proxy calls | `src/lib/geo.ts`, `src/lib/geo_osm.ts`, `src/lib/osrm.ts`, `src/lib/osrmSteps.ts`, `src/hooks/useGooglePlacesAutocomplete.ts` | External map services, not Go-owned business logic |
| Go client wrapper | `src/lib/goBackendClient.ts` | Intended central Go path |

No `axios` usage was found.

## SECTION B - Frontend -> Supabase Direct Calls

### Allowed / Expected Supabase Direct Usage

| Area | Examples | Notes |
| --- | --- | --- |
| Auth | `supabase.auth.signUp`, `signInWithPassword`, `signInWithOtp`, `verifyOtp`, `getSession`, `getUser`, `onAuthStateChange` | Compliant with stated architecture. |
| Storage | `driver-documents`, `driver-avatars`, `student-verification`, `deposit-proofs`, `rider-deposit-proofs` | Storage is explicitly allowed to remain Supabase-owned. |
| Chat/messages | `messages` reads/writes, `useRideRealtime` message channel | Chat Realtime is allowed. |
| Profiles/settings | `profiles`, `user_settings`, preference tables | Direct profile reads/writes remain outside Go. Acceptable only if profile management is intentionally Supabase-owned. |
| Notifications UI | `notifications` reads/writes | Allowed only as non-business notification UI until migrated. |

### Supabase Direct Reads

The frontend still reads many business tables directly, including:

| Domain | Tables / Files |
| --- | --- |
| Ride read models | `rides` in `RideDetail`, `RiderRideDetail`, `RideHistory`, `RideHistorySheet`, `RecentDestinations`, admin dashboards/reports/system health |
| Offer read models | `offers` in `RideDetail`, `AdminSystemHealth` |
| Negotiation read models | `ride_requests`, `ride_offers` in `pages/negotiate/*` |
| Driver read models | `drivers`, `driver_documents`, `driver_ratings`, `driver_feedback`, `driver_sessions` |
| Location/dispatch read models | `live_locations`, `ride_demand_zones`, `koloi_landmarks`, map/location hooks |
| Wallet/financial read models | `wallets`, `wallet_transactions`, `driver_wallets`, `deposit_requests`, `rider_deposit_requests`, `withdrawals`, `admin_earnings`, `platform_ledger` |
| Admin/ops read models | `fraud_flags`, `emergency_alerts`, `disputes`, `system_error_logs`, `promo_codes`, `town_pricing`, `student_profiles` |

### Supabase Direct Mutations

Direct mutations still exist in important product areas:

| Flow | Tables / RPCs | Files |
| --- | --- | --- |
| Wallet payments/transfers/withdrawals | `pay_ride_from_wallet`, `transfer_funds`, `request_withdrawal`, `admin_approve_withdrawal`, `admin_reject_withdrawal` RPCs | `src/lib/walletPayments.ts` |
| Wallet/deposit request creation | `deposit_requests`, `rider_deposit_requests` | `src/pages/DriverDepositPage.tsx`, `src/components/wallet/DepositModal.tsx` |
| Wallet/admin finance | `wallet_transactions`, `wallets`, `deposit_requests`, `withdrawals`, `admin_*` wallet RPCs | `src/pages/admin/AdminWalletDashboard.tsx`, `src/pages/admin/AdminDepositsPage.tsx`, `src/pages/admin/AdminRiderDepositsPage.tsx` |
| Legacy settlement | Supabase Edge Function `settle-trip` plus `platform_ledger` read | `src/pages/RideDetail.tsx` |
| Driver onboarding | `drivers`, `driver_documents` | `DriverApplicationForm`, `DriverReviewForm`, `DriverRegistrationWizard`, `DocumentUpload` |
| Driver settings/avatar | `drivers.update` | `DriverSettingsPanel`, `DriverAvatarUpload` |
| Dispatch/demand | `update_demand_zones` RPC, `ride_demand_zones` | `DemandHeatmap` |
| Admin remediation | `expire_old_rides`, stale driver/location cleanup, direct `rides.update`, `drivers.update`, `live_locations.delete` | `src/lib/ramzActions.ts`, `LoadPulsePanel` |
| Financial/user actions | `tips`, `disputes`, `cancellation_fees`, `fraud_flags`, `driver_sessions`, `driver_ratings` | ride components/hooks |
| Promo/pricing/admin config | `promo_codes`, `town_pricing`, `pricing_settings` | admin/settings/hooks |
| Notifications | `notifications.insert/update` | ride/driver notification UI |

### Supabase RPCs Found

| RPC | Classification |
| --- | --- |
| `pay_ride_from_wallet` | Wallet architecture violation |
| `transfer_funds` | Wallet architecture violation |
| `request_withdrawal` | Wallet architecture violation |
| `admin_approve_withdrawal` / `admin_reject_withdrawal` | Financial/admin violation |
| `admin_approve_deposit` / `admin_approve_rider_deposit` | Financial/admin violation |
| `admin_flag_user`, `admin_resolve_fraud_flag`, `admin_lock_wallet`, `admin_unlock_wallet`, `admin_reverse_transaction` | Financial/admin violation |
| `admin_set_fx_rate` | Financial/admin violation |
| `can_driver_operate`, `is_top_driver` | Driver/dispatch policy bypasses Go |
| `update_demand_zones` | Dispatch bypasses Go |
| `expire_old_rides` | Ride lifecycle/admin bypasses Go |
| `auto_resolve_noise_fraud_flags`, `cleanup_old_messages` | Admin/ops direct Supabase |
| `lookup_user_by_pickme_account` | Wallet/user lookup bypasses Go |

### Supabase Channels Found

| Channel | Files | Classification |
| --- | --- | --- |
| `ride-messages-*` | `src/hooks/useRideRealtime.ts` | Allowed chat realtime |
| `webrtc-signal-*` | `src/hooks/useWebRTCCall.ts` | Communication/signaling, not core business DB |
| `ride:*` broadcast helpers | `src/lib/koloiRealtime.ts`, `src/lib/rideSignals.ts` | Legacy ride signal path; should be reviewed against Go websocket ownership |
| Driver/dashboard wallet channels | Several pages/hooks subscribe via `.channel(...).on('postgres_changes')` | Direct Supabase read model dependency |

## SECTION C - Architecture Violations

The frontend is **not** strictly following `Frontend -> Go -> Supabase PostgreSQL`.

### Ride Architecture Violations

- Ride reads still come directly from Supabase `rides` and `offers`.
- `RideDetail` still calls Supabase Edge Function `settle-trip` and reads `platform_ledger`.
- Admin remediation can mutate `rides` directly through `ramzActions`.
- `expire_old_rides` RPC remains callable from frontend code.
- Rider cancellation is implemented as `POST /api/rides/:rideId/status` with `status: cancelled`, while the backend matrix says no dedicated cancel endpoint exists.

Core ride writes are mostly Go-owned, but ride read models and some settlement/admin lifecycle paths still bypass Go.

### Wallet Architecture Violations

- Wallet balance and transaction history read directly from `wallets`, `wallet_transactions`, `driver_wallets`, `deposit_requests`, `withdrawals`, and `admin_earnings`.
- Wallet payments, transfers, withdrawals, and admin withdrawal decisions still use Supabase RPCs.
- Rider/driver deposit creation still writes directly to Supabase deposit tables.
- Wallet PIN uses a Supabase Edge Function directly.

Wallet is **not Go-owned** in the frontend.

### Dispatch Architecture Violations

- Driver online/offline presence and location update writes now use Go.
- Open ride discovery, driver eligibility, top-driver checks, nearby driver reads, demand heatmap updates, and `live_locations` admin/monitoring reads still go directly to Supabase.
- `update_demand_zones` RPC is a direct dispatch-side mutation.

Dispatch is only partially Go-owned.

### Settlement / Financial Architecture Violations

- `settle-trip` Supabase Edge Function remains in `RideDetail`.
- `platform_ledger` is read directly by ride/admin reporting.
- Admin wallet dashboard uses financial RPCs and direct financial table reads.
- Tips, disputes, cancellation fees, fraud flags, deposit approvals, withdrawal approvals, FX rate changes, promo operations, and financial reversals bypass Go.

Financial architecture is still Supabase-first.

### Admin Architecture Violations

- Admin screens rely heavily on direct Supabase reads/mutations instead of Go admin endpoints.
- `admin-api` Supabase Edge Function is used for admin checks/actions.
- System health, reports, driver map, wallet admin, deposits, rider deposits, promos, students, disputes, and rate pages all access Supabase directly.

## SECTION D - Compliance Score

| Area | Score | Rationale |
| --- | ---: | --- |
| Ride Architecture | 65% | Core ride mutations moved to Go, but ride reads, legacy settlement, admin ride remediation, and cancellation semantics still bypass or mismatch Go. |
| Wallet Architecture | 20% | Wallet remains mostly Supabase RPC/table driven. Go wallet endpoints from the capability matrix are not used by the frontend. |
| Dispatch Architecture | 45% | Driver presence/location writes use Go, but eligibility, demand, open rides, locations/read models, and admin map data still use Supabase directly. |
| Financial Architecture | 15% | Ledger, deposits, withdrawals, approvals, reversals, tips, disputes, rates, and reports mostly bypass Go. |

Overall compliance score: **36%**

## SECTION E - Final Verdict

**PARTIALLY COMPLIANT**

The migrated frontend is moving in the correct direction for the core pilot ride/driver write path:

- Ride creation: Go-owned
- Offer submission/accept/reject: Go-owned
- Ride lifecycle writes: mostly Go-owned
- Driver presence/location writes: Go-owned
- Per-ride websocket: Go-owned for ride events

But the broader product architecture is still Supabase-direct for major business domains:

- Wallet
- Financial ledger/admin
- Deposits/withdrawals
- Settlement legacy path
- Dispatch/read models
- Admin operations
- Driver onboarding/settings
- Reports/system health

To become mostly or fully compliant, the next migration pass should prioritize:

1. Replace wallet RPCs and wallet table reads with `/api/wallets/*`.
2. Replace admin finance/deposit/withdrawal RPCs with Go admin endpoints.
3. Replace direct ride/offer read models with Go read endpoints or an explicit Go-backed read API.
4. Remove `settle-trip` Supabase Edge Function usage from ride detail.
5. Move dispatch eligibility, top-driver, demand zones, and open ride discovery behind Go.
6. Move admin remediation actions behind Go admin endpoints.
