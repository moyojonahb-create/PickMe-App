# PickMe Security Report

Date: 2026-05-31  
Scope: Supabase database, RLS, Edge Functions, frontend RPC/table calls, wallet/payment flows, identity verification, and launch controls. This replaces the earlier narrow report with a full production-readiness security audit.

## Executive Summary

PickMe has many of the right primitives: RLS is broadly enabled, wallet mutations are mostly concentrated in `SECURITY DEFINER` RPCs with row locks, OTP/PIN tables are later revoked from direct client access, and admin operations check `user_roles`. The biggest security risks are operational exposure and consistency drift:

- Some service-role Edge Functions are callable with `verify_jwt=false`; they must all authenticate and authorize internally.
- The `maintenance` Edge Function can run service-role maintenance RPCs and currently shows no caller authentication in code.
- Realtime publication drift can break security assumptions: app code subscribes to tables that later migrations removed from publication.
- Student verification and driver documents carry national-ID-level data; access controls were patched, but live column grant verification is required.
- Wallet and fare flows still have client-side direct inserts/updates in some paths, creating tampering risk if RLS/RPC gates are incomplete.

Security readiness score: 66/100.

## Critical Findings

### Critical: Public `maintenance` Edge Function Runs Service-Role RPCs

Evidence: `supabase/functions/maintenance/index.ts` creates a service-role client and allows `update_demand_zones`, `cleanup_old_messages`, `auto_resolve_noise_fraud_flags`, and `expire_old_rides`. I did not find JWT validation or admin/service authorization in the function body.

Impact: If deployed publicly, anyone who can call the function can trigger destructive/privileged maintenance. `update_demand_zones` deletes and rebuilds demand zones; cleanup functions mutate production data.

Affected files: `supabase/functions/maintenance/index.ts`, `src/components/driver/DemandHeatmap.tsx`, `src/lib/rideExpiry.ts`, `src/lib/ramzActions.ts`.

Fix:

```ts
// In maintenance/index.ts before executing RPC:
const authHeader = req.headers.get("Authorization");
if (!authHeader?.startsWith("Bearer ")) return json401();
const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
const { data: userData } = await userClient.auth.getUser();
const userId = userData.user?.id;
if (!userId) return json401();
const { data: role } = await serviceClient.from("user_roles")
  .select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
if (!role) return json403();
```

### Critical: `useDriverNoShow.ts` Has Broken Syntax In A Safety Flow

Evidence: `npx tsc -b --noEmit` fails at `src/hooks/useDriverNoShow.ts`; callback uses `await` inside non-async `setTimeout` and references undeclared `interval`.

Impact: Type checking is blocked and the driver no-show safety feature cannot be trusted.

Affected file: `src/hooks/useDriverNoShow.ts`.

Fix: wrap the interval callback in `setInterval(async () => ...)`, store the interval id, and clean up both timeout and interval.

### Critical: Realtime Publication Drift Can Break Ride Status And Wallet Updates

Evidence: migrations add then later drop `rides`, `driver_wallets`, `call_sessions`, `town_pricing`, and `disputes` from `supabase_realtime`. Frontend still subscribes to `rides`, `driver_wallets`, `call_sessions`, and disputes/emergency admin flows.

Impact: riders/drivers may miss ride acceptance, completion, wallet balance changes, or call session updates.

Affected files: `src/hooks/useRideRealtime.ts`, `src/pages/DriverWalletPage.tsx`, `src/hooks/useAgoraCall.ts`, `src/hooks/useWebRTCCall.ts`, `src/pages/admin/AdminDashboard.tsx`, `src/pages/admin/AdminDisputes.tsx`.

Fix migration:

```sql
do $$
begin
  begin alter publication supabase_realtime add table public.rides; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.driver_wallets; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.call_sessions; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.disputes; exception when duplicate_object then null; end;
end $$;
```

## High Findings

### High: Missing `admin_topup_driver` Audited RPC

Impact: driver wallet support operations lack a single audited, idempotent, admin-gated path. Manual table updates are dangerous in production.

Fix: add the SQL in `DATABASE_AUDIT.md`.

### High: `verify_jwt=false` Edge Functions Need Uniform Auth Middleware

Functions configured with `verify_jwt=false`: `admin-api`, `google-routes`, `twilio-otp`, `import-osm-places`, `settle-trip`, `agora-token`, `google-maps-key`, `nominatim-search`, `google-places-search`, `ramz-code-scan`, `ramz-generate-patch`.

Impact: Manual auth is easy to miss. Functions that proxy paid APIs can be abused for billing. Functions using service role can bypass RLS.

Fix: centralize auth helper per function class:

- Public geocoder/token proxy: require bearer user or signed app token, rate-limit by IP/user/device.
- Admin function: require bearer user plus `user_roles.admin`.
- Ride function: require bearer user plus ride-party membership.
- OTP function: rate-limit unauthenticated access by phone/IP/device.

### High: Client-Side Ride Creation Accepts Client Fare For Cash Rides

Evidence: `src/lib/requestRide.ts` inserts `fare`, `distance_km`, and route fields directly into `rides` for non-wallet rides.

Impact: modified clients can understate fares or manipulate distance. Wallet path uses `request_wallet_ride`, but cash path still trusts the browser.

Fix: create `request_cash_ride(p_payload jsonb)` or general `request_ride` RPC that recomputes or verifies fare server-side using town pricing and route distance.

### High: `here-geocode` Edge Function Missing

Evidence: `src/components/FavoritesSheet.tsx` invokes `here-geocode`; no local `supabase/functions/here-geocode` exists.

Impact: favorite location geocoding fails in production unless deployed outside the repo. If it exists remotely but not in source, reproducible deploys are broken.

Fix: add the function or change the client to `google-places-search`, `nominatim-search`, or `mapbox-search`.

### High: Student Verification Abuse Needs Persistent Rate Limits

Evidence: `verify-student` uses service role and writes attempts; table exists. Need live confirmation of hard limits by user/device/document/IP.

Impact: fake students can brute-force document combinations, farm discounts, or upload excessive files.

Fix: enforce limits in the Edge Function using `student_verification_attempts`, `device_id`, `national_id_number` hash, and storage quotas.

## Medium Findings

### Medium: `driver_locations` Spec Mismatch

Impact: integration and analytics code expecting `driver_locations` will fail. Create compatibility view over `live_locations`.

### Medium: Wallet PIN Rate Limit Is In-Memory

Evidence: `wallet-pin` has endpoint-level attempt logic, but in-memory limits reset on cold start/multi-instance.

Impact: distributed brute force risk.

Fix: persist attempts in `wallet_pin_attempts` keyed by user, device, and IP.

### Medium: Admin Dashboards Use N+1 Profile Fetching

Evidence: `src/pages/admin/AdminDrivers.tsx` fetches profile per driver. `src/pages/admin/AdminDashboard.tsx` fetches profile and live location per driver.

Impact: admin pages degrade quickly at scale and may expose partial data on failures.

Fix: add admin RPCs/views for joined projections with security definer/admin checks.

### Medium: Realtime Filters Are Broad For Drivers

Evidence: `useOpenRidesRealtime` subscribes to all `rides` and `offers`; `useNearbyDrivers` subscribes to all driver location changes and filters client-side.

Impact: location and ride event volume can become a privacy and quota issue.

Fix: server-side dispatch channels by town/geohash, or broadcast only eligible rides through Edge/Realtime channels.

## Low Findings

- Existing `SECURITY_REPORT.md` noted Google Maps browser key restriction; still required.
- Build warns Sentry auth token is missing, so source maps/releases are not uploaded.
- `ramz` admin code-generation tools should be disabled or heavily gated in production.
- Storage buckets need live private/public confirmation; migrations imply private bucket policy intent.

## Browser RPC Calls

Client RPCs found: `can_driver_operate`, `complete_trip_with_commission`, `pay_ride_from_wallet`, `transfer_funds`, `request_withdrawal`, `lookup_user_by_pickme_account`, `request_wallet_ride`. These must remain explicitly granted only to `authenticated`, with internal authorization.

Maintenance RPCs found behind Edge Functions: `dispatch_scheduled_rides`, `expire_old_rides`, `update_demand_zones`, `cleanup_old_messages`, `auto_resolve_noise_fraud_flags`. These should be service/admin only.

## Wallet Security

Good:

- Wallet mutations use `FOR UPDATE` in key RPCs.
- Direct update/delete policies were added for `wallets` and `driver_wallets`.
- `wallet_pins` access was revoked from public/anon/authenticated.

Risks:

- No `admin_topup_driver` RPC.
- Need persistent PIN attempt logging.
- Need idempotency keys for deposits, wallet payments, withdrawals, and top-ups.
- Need ledger immutability: avoid update/delete on financial history except compensating entries.

## Production Security Fix List

1. Lock `maintenance` behind admin/service auth.
2. Reconcile Realtime publication with frontend subscriptions.
3. Add `admin_topup_driver`.
4. Move all ride creation through server-side RPC validation.
5. Add persistent PIN/OTP/student verification rate limits.
6. Add the missing `here-geocode` function or remove the call.
7. Run live Supabase Advisor and RLS impersonation tests before launch.

