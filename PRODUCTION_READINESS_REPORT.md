# PickMe Production Readiness Report

Date: 2026-05-31  
Audit mode: Uber/InDrive-style launch readiness review from local repository evidence.

## Executive Summary

PickMe is a serious prototype with many launch-grade concepts already present: RLS, Supabase Realtime, driver onboarding, document upload, wallet ledgers, commission functions, student verification, admin dashboards, and operational health scans. It is not yet ready for real-money, real-driver production launch.

Launch readiness score: 62/100.

Primary blockers:

1. TypeScript safety flow is broken: `useDriverNoShow.ts`.
2. Realtime publication does not match app subscriptions.
3. `maintenance` Edge Function is service-role privileged and lacks visible caller auth.
4. Missing `admin_topup_driver` and `driver_locations` compatibility object.
5. Ride creation still trusts client fare for cash rides.
6. Tests cannot run in this environment because Node is `24.14.0`; project requires Node 20 or 22.

## Ride-Hailing Flow Audit

### 1. Driver Registration

Flow: driver forms insert into `drivers`, upload to `driver-documents`, insert `driver_documents`.

Failure points:

- Multiple registration components appear to insert drivers directly.
- Driver identity verification relies on admin review but needs stronger uniqueness checks for ID/license/phone.
- Storage path scoping must be verified live.

Fixes:

- Server-side `submit_driver_application` RPC.
- Unique normalized license/national ID hash.
- Required document checklist enforced in DB.

### 2. Driver Approval

Flow: admin pages or `admin-api` update `drivers.status = approved`.

Failure points:

- Admin UI direct updates exist in several pages.
- Need audit event for every approval/rejection.

Fixes:

- Make approval/rejection RPC-only.
- Require `reviewed_by`, `reviewed_at`, reason, and document status.

### 3. Driver Goes Online

Flow: `DriverDashboard` calls `can_driver_operate`, then updates `drivers.is_online`.

Failure points:

- Code logs a bypass path around `can_driver_operate`.
- `can_driver_operate` expects driver user id as `p_driver_id`, but naming is ambiguous.
- Driver wallet row may be missing after approval.

Fixes:

- Remove bypass.
- Rename param to `p_driver_user_id`.
- Create driver wallet on approval.

### 4. Location Tracking

Flow: `updateDriverLocation` upserts `live_locations` and emits WebSocket message.

Failure points:

- No `driver_locations` object.
- Global Realtime fanout does not scale.
- Stale rows are handled by admin cleanup, not automatic lifecycle.

Fixes:

- Add `driver_locations` view.
- Partition locations by town/geohash.
- Add scheduled stale-offline process.

### 5. Nearby Driver Discovery

Flow: `useNearbyDrivers` reads latest 200 online drivers and filters client-side.

Failure points:

- Not geographically bounded at DB level.
- `.limit(200)` can silently miss nearest drivers in large cities.
- All driver locations can stream to riders.

Fixes:

- Add geohash/town query.
- Use dispatch service or PostGIS earthdistance when available.

### 6. Ride Request Creation

Flow: `requestRide` inserts `rides`; wallet rides use `request_wallet_ride`.

Failure points:

- Cash fare is client-provided.
- Offline queue can replay stale pricing.
- Push notification is best-effort.

Fixes:

- Use server-side `request_ride` RPC for all payment methods.
- Store fare quote id and expiry.
- Dispatch through server/Edge Function.

### 7. Ride Offer Delivery

Flow: legacy `offers` and negotiation `ride_offers` both exist.

Failure points:

- Two offer systems increase drift.
- Realtime publication for `rides` was dropped, while offers remain.
- Women-only/gender preference must be enforced server-side, not just stripped from UI.

Fixes:

- Pick one offer model or add a clear compatibility layer.
- Server-side eligibility checks in offer insert RPC.

### 8. Ride Acceptance

Flow: offers/ride rows are updated by rider/driver screens.

Failure points:

- Race condition if two drivers accept simultaneously unless DB uses conditional update.
- Passenger PII exposure must happen only after acceptance.

Fix:

```sql
update public.rides
set driver_id = p_driver_table_id, status = 'accepted', updated_at = now()
where id = p_ride_id and status = 'pending' and driver_id is null
returning *;
```

Wrap this in `accept_ride_offer` RPC.

### 9. Pickup Navigation

Flow: map components render route and driver navigation; external/in-app nav options exist.

Failure points:

- Google/Mapbox key and route API availability.
- `TripGoogleMap` currently violates hook rules.

Fixes:

- Fix hook order.
- Cache route failures and fallback to OSRM/Mapbox.

### 10. Trip Start

Flow: driver updates ride status to `in_progress`.

Failure points:

- Client can update status if RLS allows assigned driver updates.
- Need GPS proximity check to pickup.

Fix: `start_trip(p_ride_id)` RPC verifies assigned driver, status, and pickup proximity.

### 11. Trip Completion

Flow: `completeTrip` validates ride, calls `complete_trip_with_commission`, then `settle-trip`.

Failure points:

- Completion can be initiated by rider or driver in RPC.
- Settlement is non-blocking after completion; ledger may lag.
- Idempotency must be guaranteed by unique ledger constraints.

Fixes:

- Make completion RPC idempotent.
- Add unique `admin_earnings(ride_id)` and `platform_ledger(trip_id)` constraints if not already live.

### 12. Payment Settlement, Driver Earnings, Commission

Flow: wallet/cash completion updates `driver_wallets`, `admin_earnings`, `wallet_transactions`, `platform_ledger`.

Failure points:

- Cash rides require driver balance to cover commission; if insufficient, completion can fail.
- Driver top-up missing.
- Wallet and platform ledger use mixed currency naming (`balance_usd`, `currency: ZAR`, fare values).

Fixes:

- Normalize money columns: `amount_minor`, `currency`, `exchange_rate_id`.
- Add `admin_topup_driver`.
- Support negative commission receivable with limits, instead of blocking trip completion at roadside.

## Consistency Audit

| Check | Result |
|---|---|
| Core required tables | All exist except `driver_locations`. |
| Core required functions | All exist except `admin_topup_driver`. |
| Frontend table refs match schema | Mostly, except storage buckets mixed into `.from()` scans and `driver_locations` spec mismatch. |
| Edge Functions deployed in repo | 23 functions present; `here-geocode` missing. |
| Realtime publications match code | No; publication drops conflict with subscriptions. |
| Foreign keys | Many references exist; live validation required for all late `ALTER TABLE` changes. |
| Generated types | Include required core tables/functions, except `driver_locations`/`admin_topup_driver`. |

## Launch Blockers

1. Fix `useDriverNoShow.ts`.
2. Fix `TripGoogleMap.tsx` hook order.
3. Lock down `maintenance`.
4. Reconcile Realtime publication.
5. Add `admin_topup_driver` and driver top-up audit table.
6. Move cash ride creation/accept/start/complete to RPCs.
7. Add missing `here-geocode` or remove invocation.
8. Run tests under Node 20/22.
9. Run live Supabase Advisor and RLS impersonation tests.

## Recommended Migration Bundle

Combine the SQL from `DATABASE_AUDIT.md`, `SECURITY_REPORT.md`, and `PERFORMANCE_REPORT.md` into a new Supabase migration:

- `driver_locations` compatibility view.
- `driver_wallet_topups` table and `admin_topup_driver` RPC.
- Realtime publication restoration for subscribed tables.
- Composite performance indexes.
- Optional geohash/town columns for `live_locations`.

## Code Fixes

- Replace direct ride insert with `request_ride` RPC.
- Replace direct ride status updates with `accept_ride_offer`, `start_trip`, `arrive_pickup`, `complete_trip` RPCs.
- Add shared Edge Function auth middleware.
- Replace global driver Realtime with location partitions.
- Add route-level lazy loading for maps, calls, charts, and admin dashboards.
- Fix TypeScript/lint hard errors before release.

## Verification Commands

Use Node 20 or 22:

```bash
npm run lint -- --quiet
npx tsc -b --noEmit
npm test
npm run build
```

Live Supabase checks:

```sql
select schemaname, tablename, rowsecurity from pg_tables where schemaname = 'public';
select * from pg_publication_tables where pubname = 'supabase_realtime';
select n.nspname, p.proname, p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public';
```

## Final Readiness Score

Overall: 62/100.

Not ready for full public launch. Ready for a controlled internal pilot only after the launch blockers above are fixed and verified against a live Supabase project.

