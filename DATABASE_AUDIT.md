# PickMe Database Audit

Date: 2026-05-31  
Scope: Static audit of local Supabase migrations, generated Supabase types, Edge Functions, and frontend/backend database references. No live Supabase project connection was available in this session, so deployment state, actual grants, row counts, and Supabase Advisor findings still need live verification before launch.

## Executive Summary

PickMe has a broad ride-hailing schema with core entities for riders, drivers, wallets, negotiations, live tracking, messaging, deposits, student verification, disputes, and admin operations. The main launch blockers are not absence of the core schema, but consistency and control-plane gaps:

- `driver_locations` is requested as a platform object but does not exist; the app uses `live_locations`.
- `admin_topup_driver` does not exist, so admin top-ups are not a first-class audited RPC.
- Frontend invokes `here-geocode`, but no local Edge Function exists.
- Realtime publication history removes `rides`, `driver_wallets`, `call_sessions`, `town_pricing`, and `disputes`, while the frontend still subscribes to some of those tables.
- Several `verify_jwt = false` Edge Functions use service role and rely on manual JWT checks; acceptable only where each function verifies Authorization itself.
- `useDriverNoShow.ts` has a TypeScript parser error that blocks `tsc`; database correctness cannot compensate for that runtime path.

Production database readiness score: 64/100.

## Schemas

| Schema | Purpose | Dependencies | Security implications |
|---|---|---|---|
| `public` | Application data, RLS policies, RPCs, Realtime tables | Supabase Auth, PostgREST, Edge Functions | Exposed API schema; every table needs RLS and least-privilege policies. |
| `auth` | Supabase managed users and auth triggers | `handle_new_user`, `handle_new_user_wallet` triggers | Do not query directly from clients; triggers must be locked down. |
| `storage` | Supabase Storage metadata and bucket policies | `storage.objects`, private buckets | Bucket policies must scope by user folder and role. |
| `realtime` | Supabase Realtime authorization | `realtime.messages` policies | Broadcast/channel policies must prevent cross-ride subscription. |

No private application schema was found. For a production ride-hailing platform, privileged maintenance and wallet functions should eventually move out of exposed `public`.

## Tables

| Table | Purpose | Key dependencies | Security implications |
|---|---|---|---|
| `profiles` | Rider/user profile, phone, preferences, PickMe account | `auth.users`, `rides`, `referrals`, `wallets` | PII table; strict owner/admin RLS required. |
| `favorite_locations` | Saved rider locations | `profiles` | Owner-only access. |
| `rides` | Main trip lifecycle | `profiles`, `drivers`, `offers`, `messages`, `wallet_transactions`, `admin_earnings` | Critical table; fare/status/driver assignment must be server-controlled. |
| `koloi_landmarks` | Local places/landmarks | Admin UI, search hooks | Read can be broad; writes admin-only. |
| `user_roles` | Admin/driver/rider roles | `has_role`, Edge Functions | Privilege source of truth; write must be service/admin-only. |
| `drivers` | Driver application, status, vehicle, online flags | `profiles`, `driver_documents`, `live_locations`, `driver_wallets` | Driver approval and online state are safety-critical. |
| `driver_documents` | License and identity document metadata | Storage bucket `driver-documents` | Sensitive docs; owner/admin only. |
| `live_locations` | Current driver/rider GPS | Realtime, driver tracking, admin maps | High-volume and privacy sensitive; stale purge and RLS are essential. |
| `trip_events` | Audit trail for ride lifecycle | `rides`, admin-api | Append-only preferred; clients should not edit. |
| `notifications` | User notifications | Realtime, send-notification | User scoped; broadcast via service role only. |
| `system_events` | Admin/system audit events | admin-api, add-driver | Admin-only read/write. |
| `saved_items` | Generic saved user items | `profiles` | Owner-only. |
| `pricing_settings` | Global pricing controls | pricing hooks | Admin writes only; read can be authenticated. |
| `offers` | Legacy driver offers on rides | `rides`, drivers | Realtime table; must avoid exposing all pending passenger PII. |
| `messages` | Ride chat messages | `rides`, Realtime | Sender/ride-party scoped. |
| `wallets` | Rider wallet balances | wallet RPCs, wallet-pin | Direct client updates/deletes must be denied. |
| `wallet_transactions` | Rider wallet ledger | `wallets`, `rides` | Immutable ledger preferred; owner/admin read. |
| `admin_earnings` | Commission records | `rides`, `driver_wallets` | Financial ledger; admin/driver scoped. |
| `driver_wallets` | Driver balance for commission and earnings | `drivers`, wallet RPCs | Direct mutation should only happen via RPC/admin. |
| `fx_rates` | ZAR/USD conversion | `can_driver_operate`, admin RPC | Authenticated read; admin-only write. |
| `deposit_requests` | Driver deposits | driver wallet top-ups | Service/admin settlement only. |
| `places_cache` | Geocoding/search cache | map search | Avoid unbounded client inserts. |
| `platform_ledger` | Settlement ledger | `settle-trip` | Financial system of record; should be immutable. |
| `driver_feedback` | Driver feedback/complaints | drivers | Driver scoped; admin visibility. |
| `ride_requests` | Negotiated ride request model | `ride_offers` | Parallel to `rides`; consistency risk. |
| `ride_offers` | Negotiated offers | `ride_requests`, drivers | Realtime offer delivery. |
| `driver_ratings` | Rider ratings of drivers | `drivers`, `rides` | One rating per ride enforced by unique index. |
| `cancellation_fees` | Cancellation charges | `rides` | Payment-related; server calculated. |
| `promo_codes` | Promotions | admin | Must avoid client tampering. |
| `promo_usage` | Promo redemption history | `promo_codes`, `profiles` | Prevent duplicate abuse. |
| `referrals` | Referral records | `profiles` | Fraud-sensitive. |
| `user_settings` | User preference settings | `profiles` | Owner-only. |
| `call_sessions` | Voice/WebRTC/Agora call state | Realtime, `agora-token` | Ride-party scoped; publication currently dropped. |
| `town_pricing` | Per-town fare controls | admin pricing UI | Admin writes only; publication currently dropped. |
| `rider_deposit_requests` | Rider wallet top-up proof requests | storage `rider-deposit-proofs` | Admin approval must be audited. |
| `ride_stops` | Multi-stop rides | `rides` | Rider/assigned driver scoped. |
| `driver_queue` | Dispatch queue | `rides`, drivers | Service-generated preferred. |
| `fraud_flags` | Fraud/safety flags | fraudDetection, admin health | Users may view own flags; writes should be constrained. |
| `ride_demand_zones` | Heatmap demand grid | `update_demand_zones` | Rebuilt by maintenance; client write should be denied. |
| `emergency_alerts` | SOS alerts | admin emergency dashboard | High sensitivity; realtime/admin visibility. |
| `ride_preferences` | Accessibility/gender/preferences per ride | `rides` | Do not expose sensitive preferences to drivers unless needed. |
| `tips` | Ride tips | `rides`, wallets/cash | Payment-related; server-side validation needed. |
| `eco_stats` | Eco/rider stats | profiles | Owner-only. |
| `driver_sessions` | Driver online/fatigue sessions | fatigue monitor | Enforce duration and forced breaks server-side. |
| `disputes` | Ride disputes | admin disputes | Ride-party/admin scoped; publication currently dropped. |
| `request_throttle` | DB rate limit records | `check_rate_limit` | Service/RPC controlled. |
| `system_error_logs` | Operational errors | admin health | Admin-only. |
| `phone_verifications` | OTP verification records | `twilio-otp` | Correctly revoked from anon/authenticated in later migrations. |
| `gender_change_log` | Gender preference/profile audit | `can_change_gender` | Sensitive; owner/admin only. |
| `institutions` | Approved schools | student verification | Public/auth read ok; admin writes. |
| `student_profiles` | Student verification and PII | `verify-student`, admin RPC | National ID fields must stay column-revoked from clients. |
| `student_discount_usage` | Student discount usage | rides | Prevent self-awarded discounts. |
| `student_verification_attempts` | Attempt audit | `verify-student` | Abuse/fraud evidence; owner/admin. |
| `withdrawals` | Driver withdrawal requests | wallet RPCs | Must be immutable except admin state transitions. |
| `wallet_transfers` | Wallet-to-wallet transfer history | `transfer_funds` | Duplicate/daily limit enforced in RPC. |
| `wallet_pins` | PIN hash/salt | wallet-pin Edge Function | Service-role only; no client grants. |
| `ramz_patch_audit` | Code patch/audit tool log | admin tools | Admin-only. |
| `luggage_requests` | Luggage/courier metadata | rides, storage | Do not expose pending ride cargo to every driver. |
| `fare_adjustments` | Driver requested fare adjustments | rides | Rider approval required. |

Missing requested table: `driver_locations`. The system uses `live_locations`; add a compatibility view or rename the request/spec.

## Views

| View | Purpose | Dependencies | Security implications |
|---|---|---|---|
| `wallets_safe` | Safer projection of wallet data | `wallets` | Verify `security_invoker = true` live; views can bypass RLS if created by privileged owner. |

## Functions

Detected application RPCs/functions:

`update_updated_at_column`, `handle_new_user`, `has_role`, `is_ride_driver`, `is_user_driver`, `is_online_driver`, `get_driver_id`, `admin_set_fx_rate`, `admin_approve_deposit`, `complete_trip_and_charge_flat_r4`, `set_ride_expiry`, `expire_old_rides`, `can_driver_operate`, `update_ride_negotiation_updated_at`, `update_driver_rating_avg`, `is_top_driver`, `generate_referral_code`, `admin_approve_rider_deposit`, `complete_trip_with_commission`, `dispatch_scheduled_rides`, `update_demand_zones`, `cleanup_old_messages`, `cleanup_throttle`, `check_rate_limit`, `can_change_gender`, `can_use_student_discount`, `transfer_funds`, `pay_ride_from_wallet`, `request_withdrawal`, `admin_approve_withdrawal`, `admin_reject_withdrawal`, `handle_new_user_wallet`, `admin_flag_user`, `admin_resolve_fraud_flag`, `request_wallet_ride`, `admin_lock_wallet`, `admin_unlock_wallet`, `admin_reverse_transaction`, `generate_pickme_account`, `set_pickme_account`, `lookup_user_by_pickme_account`, `auto_resolve_noise_fraud_flag`, `auto_resolve_noise_fraud_flags`, `admin_list_student_profiles`.

Requested function verification:

| Function | Exists | Configuration notes |
|---|---:|---|
| `can_driver_operate` | Yes | `SECURITY DEFINER`; checks approved status, trial, `driver_wallets`, `fx_rates`. |
| `expire_old_rides` | Yes | Maintenance/cron function; later grants restrict to service role. |
| `update_demand_zones` | Yes | Rebuilds heatmap from last 24h; currently deletes/reinserts whole table. |
| `complete_trip_with_commission` | Yes | Atomic-ish ride completion and wallet/commission mutation; inspect idempotency live. |
| `pay_ride_from_wallet` | Yes | Locks ride and wallet rows with `FOR UPDATE`; good core pattern. |
| `transfer_funds` | Yes | Includes duplicate and daily limits. |
| `request_withdrawal` | Yes | Exists; driver payout path. |
| `admin_topup_driver` | No | Missing launch-critical admin operation. |

Security implications: many functions are `SECURITY DEFINER` in exposed `public`. Later migrations revoke broad execution for some functions, but live verification is required. Production posture should move privileged functions to a private schema or keep public RPCs with explicit grants, internal `auth.uid()` checks, and full tests.

## Triggers

Detected triggers: `update_profiles_updated_at`, `update_favorite_locations_updated_at`, `update_rides_updated_at`, `on_auth_user_created`, `update_koloi_landmarks_updated_at`, `update_drivers_updated_at`, `update_driver_documents_updated_at`, `update_live_locations_updated_at`, `update_pricing_settings_updated_at`, `update_wallets_updated_at`, `set_ride_expiry_trigger`, `update_driver_feedback_updated_at`, `update_ride_requests_updated_at`, `update_ride_offers_updated_at`, `trg_update_driver_rating_avg`, `set_referral_code`, `update_user_settings_updated_at`, `tr_set_ride_expiry`, `tr_updated_at_rides`, `tr_updated_at_drivers`, `tr_updated_at_town_pricing`, `tr_update_driver_rating`, `tr_generate_referral_code`, `tr_ride_requests_updated`, `tr_ride_offers_updated`, `update_student_profiles_updated_at`, `on_auth_user_created_wallet`, `trg_set_pickme_account`, `update_wallet_pins_updated_at`, `trg_auto_resolve_noise_fraud_flag`, `update_luggage_requests_updated_at`, `update_fare_adjustments_updated_at`.

Purpose: updated-at maintenance, auth profile/wallet provisioning, ride expiry, driver ratings, referral/PickMe account generation, fraud auto-resolution. Security implication: trigger functions must not be executable directly by clients; later migrations revoke many of these.

## Indexes

Detected important indexes:

`idx_koloi_landmarks_name`, `idx_koloi_landmarks_category`, `idx_koloi_landmarks_location`, `idx_koloi_landmarks_keywords`, `idx_rides_vehicle_type`, `idx_places_cache_coords`, `idx_places_cache_display_name`, `idx_places_cache_osm_unique`, `idx_driver_ratings_ride_unique`, `idx_driver_ratings_driver_id`, `idx_ride_stops_ride_id`, `idx_driver_queue_ride`, `idx_driver_queue_driver`, `profiles_phone_unique`, `idx_profiles_user_id_unique`, `idx_wallets_user_id_unique`, `idx_driver_wallets_driver_id_unique`, `idx_drivers_user_id_unique`, `idx_live_locations_user_id_unique`, `idx_eco_stats_user_id_unique`, `idx_deposit_requests_status`, `idx_rider_deposit_requests_status`, `idx_driver_queue_ride_id`, `idx_driver_queue_driver_id`, `idx_koloi_landmarks_active`, `idx_ride_requests_rider_id`, `idx_ride_requests_status`, `idx_ride_offers_request_id`, `idx_wallet_transactions_user_id`, `idx_user_roles_user_id`, `idx_favorite_locations_user_id`, `idx_rides_status_created`, `idx_rides_user_status`, `idx_rides_driver_status`, `idx_rides_pending_expires`, `idx_live_locations_driver_online`, `idx_live_locations_user_id`, `idx_offers_ride_status`, `idx_offers_driver`, `idx_drivers_user_status`, `idx_messages_ride_created`, `idx_notifications_user_unread`, `idx_call_sessions_participants`, `idx_wallet_txns_user`, `idx_disputes_ride`, `idx_disputes_reporter`, `idx_disputes_status`, `idx_messages_ride`, `idx_live_locations_user`, `idx_live_locations_online`, `idx_call_sessions_callee`, `idx_notifications_user`, `idx_driver_ratings_driver`, `idx_wallets_user`, `idx_driver_wallets_driver`, `idx_throttle_user_action`, `idx_system_error_logs_period`, `idx_system_error_logs_severity`, `idx_system_error_logs_created`, `idx_system_error_logs_resolved`, `idx_phone_verifications_phone`, `idx_phone_verifications_expires`, `idx_rides_status`, `idx_rides_user_id`, `idx_rides_driver_id`, `idx_rides_created_at`, `idx_rides_status_expires`, `idx_offers_ride_id`, `idx_offers_driver_id`, `idx_offers_status`, `idx_live_locations_online_drivers`, `idx_messages_ride_id`, `idx_drivers_user_id`, `idx_drivers_status`, `idx_admin_earnings_driver_id`, `idx_request_throttle_user_action`, `idx_fraud_flags_user_id`, `idx_deposit_requests_driver_status`, `idx_rider_deposit_requests_user_status`, `idx_gender_change_log_user`, `idx_institutions_active`, `idx_institutions_city`, `idx_institutions_type`, `idx_student_profiles_user`, `idx_student_profiles_status`, `idx_student_profiles_device`, `idx_student_discount_user_day`, `idx_sva_user`, `idx_sva_profile`, `idx_withdrawals_status`, `idx_withdrawals_driver`, `idx_wallet_transfers_sender`, `idx_wallet_transfers_receiver`, `idx_rider_deposit_requests_reference_unique`, `profiles_pickme_account_key`, `idx_ramz_patch_audit_created`, `idx_ramz_patch_audit_file`, `idx_luggage_requests_ride_id`, `idx_luggage_requests_rider_id`, `idx_fare_adjustments_ride_id`.

Performance implication: good baseline coverage exists, but live `EXPLAIN ANALYZE` is needed. Missing likely production indexes are listed in `PERFORMANCE_REPORT.md`.

## Edge Functions

| Function | Purpose | Dependencies | Security implications |
|---|---|---|---|
| `add-driver` | Admin-created driver | `drivers`, `user_roles`, service role | `verify_jwt` default; verifies admin in code. |
| `admin-api` | Admin operations | Many tables, service role | `verify_jwt=false`; manually verifies JWT and admin role. High risk if any route misses checks. |
| `agora-token` | Voice token generation | `call_sessions` | `verify_jwt=false`; must verify caller is ride participant. |
| `analyze-code-scan` | Admin code analysis | `user_roles` | AI/code tool; admin-only. |
| `delete-account` | Account deletion | service role, auth | Must verify caller equals target user; appears present. |
| `dispatch-scheduled` | Cron/maintenance dispatch | `dispatch_scheduled_rides`, `expire_old_rides` | Service role; should not be public. |
| `google-maps-key` | Key broker | env, auth | `verify_jwt=false`; should restrict by auth/origin and key restrictions. |
| `google-places-search` | Places proxy | Google API | `verify_jwt=false`; rate-limit needed. |
| `google-routes` | Routes proxy | Google API | `verify_jwt=false`; rate-limit needed. |
| `import-osm-places` | Admin import | `koloi_landmarks`, service role | Admin-only. |
| `maintenance` | Runs maintenance RPCs | service role | `verify_jwt` default; current code does not authenticate caller. Critical if deployed public. |
| `mapbox-search` | Mapbox search proxy | Mapbox | Rate-limit needed. |
| `mapbox-token` | Mapbox token broker | auth | Verify caller and restrict token. |
| `nominatim-search` | OSM geocoder | external API | Rate-limit and cache. |
| `push-config` | Push config | env | Avoid exposing secrets. |
| `ramz-code-scan` | Admin code scan | `user_roles` | Admin-only. |
| `ramz-generate-patch` | Admin patch generator | `user_roles` | High risk; admin-only and audit every call. |
| `send-notification` | Notification insert/broadcast | `notifications`, `drivers`, service role | Must verify sender and allowed notification type. |
| `settle-trip` | Platform ledger settlement | `rides`, `drivers`, `platform_ledger` | `verify_jwt=false`; verifies bearer and ride party in code. |
| `sms-invite` | SMS invite | SMS provider | Rate-limit and abuse controls needed. |
| `twilio-otp` | OTP send/verify | `phone_verifications`, service role | `verify_jwt=false`; must rate-limit by phone/IP/device. |
| `verify-student` | Student document verification | `student_profiles`, storage, service role | PII-heavy; must rate-limit and audit. |
| `wallet-pin` | Wallet PIN set/verify | `wallet_pins`, `wallets`, service role | Good use of service-only table; rate-limit persistence recommended. |

Missing invoked function: `here-geocode`, referenced by `src/components/FavoritesSheet.tsx`.

## Publications

Detected `supabase_realtime` history:

- Added: `live_locations`, `notifications`, `offers`, `messages`, `rides`, `ride_requests`, `ride_offers`, `call_sessions`, `town_pricing`, `driver_queue`, `emergency_alerts`, `disputes`, `driver_wallets`, `admin_earnings`, `luggage_requests`, `fare_adjustments`.
- Dropped later: `admin_earnings`, `driver_wallets`, `call_sessions`, `town_pricing`, `disputes`, `rides`.

Critical mismatch: frontend still subscribes to `rides`, `driver_wallets`, `call_sessions`, and `disputes` paths. If the last migrations are applied, those subscriptions will not receive Postgres changes.

## RLS Policies

RLS is enabled on nearly all application tables. Policy families found:

- Owner policies: profiles, favorites, rides, wallets, wallet transactions, settings, notifications, student profiles, discount usage, disputes.
- Driver policies: driver self records, documents, live location upserts, assigned ride reads, driver sessions, driver feedback, tips/ratings visibility.
- Admin policies: user roles, drivers/documents, system events, pricing, deposits, fraud flags, emergency alerts, institutions, student profiles, patch audit.
- Realtime policies: `realtime.messages` channel subscription/write authorization.
- Storage policies: `driver-documents`, `deposit-proofs`, `rider-deposit-proofs`, `driver-avatars`, `student-verification`, `luggage-photos`.
- Deny/direct-mutation policies: wallet and driver wallet direct update/delete blocked except admin/RPC.

Security implication: policy drift has been actively patched in late migrations, especially student PII, luggage visibility, and wallet PIN/OTP access. Live verification with Supabase RLS tests is mandatory.

## Critical Object Verification

| Object | Exists? | Correctness notes |
|---|---:|---|
| `drivers` | Yes | Core driver table; approval and online state used heavily. |
| `profiles` | Yes | PII and account identity; column restrictions needed for sensitive fields. |
| `driver_wallets` | Yes | Driver balances keyed by user id in app code; naming can confuse with driver table id. |
| `wallets` | Yes | Rider wallet; direct mutation blocked later. |
| `wallet_transactions` | Yes | Rider transaction ledger. |
| `rides` | Yes | Main trip table. |
| `ride_requests` | Yes | Negotiation model. |
| `ride_offers` | Yes | Negotiation offers. |
| `driver_locations` | No | App uses `live_locations`; requested object missing. |
| `live_locations` | Yes | Realtime GPS source. |
| `notifications` | Yes | User notifications. |
| `messages` | Yes | Ride chat. |
| `call_sessions` | Yes | Call signaling/state, but Realtime publication dropped later. |
| `user_roles` | Yes | Admin gate. |
| `fx_rates` | Yes | Used by driver wallet/trial operation. |

## Missing Object Impact And Migration

### Missing `driver_locations`

Impact: Any external admin tool, analytics job, or mobile release expecting `driver_locations` will fail. Current code uses `live_locations`, so this is a specification/schema mismatch rather than a frontend break.

Affected files: `src/lib/driverLocation.ts`, `src/hooks/useNearbyDrivers.ts`, `src/hooks/useDriverTracking.ts`, `src/pages/LiveTrackingPage.tsx`, `src/pages/admin/AdminDriversMap.tsx`, `src/pages/admin/AdminDashboard.tsx`.

Migration:

```sql
create or replace view public.driver_locations
with (security_invoker = true)
as
select
  user_id as driver_user_id,
  latitude,
  longitude,
  is_online,
  updated_at
from public.live_locations
where user_type = 'driver';

grant select on public.driver_locations to authenticated;
```

### Missing `admin_topup_driver`

Impact: Driver wallet top-ups are not standardized through an audited RPC. Admins may approve deposits through older functions, but there is no simple idempotent admin top-up function for support operations.

Affected files: `src/pages/DriverDepositPage.tsx`, `src/pages/DriverWalletPage.tsx`, `src/pages/admin/AdminDepositsPage.tsx`, `src/pages/admin/AdminWalletDashboard.tsx`, `src/lib/walletPayments.ts`.

Migration:

```sql
create table if not exists public.driver_wallet_topups (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references auth.users(id) on delete cascade,
  amount_usd numeric not null check (amount_usd > 0),
  reference text,
  note text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(reference)
);

alter table public.driver_wallet_topups enable row level security;

create policy "Admins can manage driver wallet topups"
on public.driver_wallet_topups
for all
to authenticated
using (public.has_role(auth.uid(), 'admin'::public.app_role))
with check (public.has_role(auth.uid(), 'admin'::public.app_role));

create or replace function public.admin_topup_driver(
  p_driver_id uuid,
  p_amount_usd numeric,
  p_reference text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    return jsonb_build_object('ok', false, 'reason', 'Not admin');
  end if;
  if p_amount_usd is null or p_amount_usd <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'Invalid amount');
  end if;

  insert into public.driver_wallet_topups(driver_id, amount_usd, reference, note, created_by)
  values (p_driver_id, p_amount_usd, nullif(p_reference, ''), p_note, auth.uid());

  insert into public.driver_wallets(driver_id, balance_usd)
  values (p_driver_id, p_amount_usd)
  on conflict (driver_id) do update
    set balance_usd = public.driver_wallets.balance_usd + excluded.balance_usd,
        updated_at = now();

  return jsonb_build_object('ok', true, 'driver_id', p_driver_id, 'amount_usd', p_amount_usd);
end;
$$;

revoke all on function public.admin_topup_driver(uuid, numeric, text, text) from public, anon;
grant execute on function public.admin_topup_driver(uuid, numeric, text, text) to authenticated;
```

