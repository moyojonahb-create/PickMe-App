# PickMe Performance Report

Date: 2026-05-31  
Scope: Static performance audit of Supabase schema, indexes, Realtime usage, frontend query patterns, and Edge Function paths.

## Executive Summary

The database has a reasonable starter index set, but the current architecture will strain before 100,000 users unless location updates and Realtime subscriptions are redesigned. The highest-risk scaling path is `live_locations`: every driver location update writes to Postgres, goes through Realtime, and many clients subscribe broadly then filter on the client.

Performance readiness score: 61/100.

## Scale Assessment

| Scale | Expected behavior | Main bottleneck |
|---|---|---|
| 1,000 users | Usable if location frequency is moderate | Admin N+1 queries, broad Realtime channels. |
| 10,000 users | Noticeable lag during driver/rider peaks | `live_locations` write amplification, all-driver subscriptions, admin dashboard polling. |
| 100,000 users | Not production-safe without dispatch partitioning | Postgres Realtime fanout, geospatial filtering in client, large JS chunks, wallet/ride ledger contention. |

## Critical Performance Findings

### 1. Live Location Realtime Fanout Is Too Broad

Evidence: `src/hooks/useNearbyDrivers.ts` initially fetches `.limit(200)` from `live_locations`, then subscribes to all driver `live_locations` changes with `filter: user_type=eq.driver`. Admin dashboards subscribe to all `live_locations`.

Impact: At 10,000 online drivers, each rider can receive far more updates than needed. At 100,000 users this becomes a Realtime quota and browser CPU problem.

Fix:

```sql
alter table public.live_locations
  add column if not exists geohash5 text,
  add column if not exists town_id text;

create index if not exists idx_live_locations_town_online_updated
on public.live_locations (town_id, is_online, updated_at desc)
where user_type = 'driver';

create index if not exists idx_live_locations_geohash_online_updated
on public.live_locations (geohash5, is_online, updated_at desc)
where user_type = 'driver';
```

Code fix: subscribe by town/geohash channel, not global driver changes. For high scale, send driver locations through a WebSocket dispatch service and write Postgres snapshots every 10-30 seconds.

### 2. Admin Dashboard Polls And Subscribes Broadly

Evidence: `src/pages/admin/AdminDashboard.tsx` polls every 10 seconds, subscribes to all `live_locations`, `rides`, and `drivers`, then runs multiple queries and per-driver profile/location fetches.

Impact: Admin page becomes a production load generator.

Fix: create `admin_dashboard_snapshot()` RPC returning aggregate counts and top N map markers in one query; refresh every 30-60 seconds.

### 3. `update_demand_zones` Deletes And Rebuilds Whole Table

Evidence: function deletes all rows then rebuilds from last 24h rides.

Impact: Locking, Realtime churn, and expensive full-table work as rides grow.

Fix: incremental materialized strategy:

```sql
create index if not exists idx_rides_demand_window
on public.rides (created_at desc, status, town_id)
where pickup_lat is not null and pickup_lon is not null;
```

Run demand aggregation asynchronously per town/time bucket, not on interactive driver screens.

### 4. Missing Composite Indexes For Common Query Shapes

Recommended migrations:

```sql
create index if not exists idx_rides_driver_active_updated
on public.rides (driver_id, status, updated_at desc)
where status in ('accepted','arrived','in_progress','near_destination');

create index if not exists idx_rides_user_recent
on public.rides (user_id, created_at desc);

create index if not exists idx_rides_pending_town_created
on public.rides (town_id, created_at desc)
where status = 'pending';

create index if not exists idx_offers_driver_status_created
on public.offers (driver_id, status, created_at desc);

create index if not exists idx_ride_offers_driver_status_created
on public.ride_offers (driver_id, status, created_at desc);

create index if not exists idx_messages_ride_created_id
on public.messages (ride_id, created_at desc, id);

create index if not exists idx_notifications_user_created
on public.notifications (user_id, created_at desc);

create index if not exists idx_wallet_transactions_user_created
on public.wallet_transactions (user_id, created_at desc);

create index if not exists idx_platform_ledger_trip_unique
on public.platform_ledger (trip_id);
```

### 5. Large Frontend Chunks

Build warnings:

- `ActiveCallOverlay` about 1.37 MB minified.
- `mapsKillSwitch` chunk about 1.97 MB minified.
- main `index` about 730 KB minified.

Impact: slow first load in mobile networks, especially in Zimbabwe/SADC market conditions.

Fix: split maps, Agora/WebRTC, admin dashboards, and charting into lazy route-level imports; do not include map SDKs in the first rider screen.

## Query And N+1 Findings

| Area | Evidence | Fix |
|---|---|---|
| Admin drivers | `AdminDrivers.tsx` fetches profiles per driver | Admin RPC/view joining drivers + profiles. |
| Admin dashboard | per-driver profile and live location requests | Snapshot RPC. |
| Ride detail | multiple driver/profile lookups | Use joined RPC or batched `.in()` queries. |
| System health | many count/head queries | Materialized/system summary table. |
| Nearby drivers | `.limit(200)` and client distance filter | geospatial/town filtered query. |

## Realtime Bottlenecks

High-risk channels:

- `nearby-drivers-rt`: all driver location changes.
- `open-rides`: all ride and offer changes.
- `admin-dashboard`: all live locations, rides, drivers.
- call sessions: code subscribes, but publication is later dropped.
- ride-level channels are acceptable if publication is restored.

Fixes:

- Partition by town/geohash.
- Prefer broadcast channels for dispatch events over table-wide Postgres changes.
- Add server-side eligibility filtering for women-only rides and vehicle type.
- Avoid Realtime on financial tables unless essential; use explicit refetch after mutation.

## Location Update Frequency

Evidence: `src/pages/DriverDashboard.tsx` maintains `locationIntervalRef`; `src/lib/driverLocation.ts` deduplicates movements under about 5m and sends both Supabase upsert and WebSocket event.

Recommendation:

- Driver foreground navigation: WebSocket every 2-5 seconds, Postgres snapshot every 15-30 seconds.
- Driver idle/online: Postgres snapshot every 30-60 seconds.
- Rider tracking a matched driver: subscribe to a ride-specific broadcast/WebSocket stream.
- Admin map: aggregate snapshots every 15-30 seconds.

## Memory Leak / Subscription Notes

Most hooks clean up with `supabase.removeChannel`, which is good. Risks remain in broad re-subscriptions and timers:

- `useDriverNoShow.ts` is currently syntactically broken and references an undeclared interval.
- Some pages use `setInterval` for UI countdowns; ensure cleanup on unmount.
- Avoid `Date.now()` in channel names unless the effect cannot re-run often; it can hide duplicate channels during debugging.

## Performance Fix Plan

1. Restore required Realtime publications or remove subscriptions for non-published tables.
2. Partition driver location by geohash/town and reduce Postgres write frequency.
3. Add the recommended composite indexes.
4. Replace admin N+1 pages with snapshot RPCs.
5. Move maps/calls/charts into lazy bundles.
6. Run `EXPLAIN ANALYZE` against live data after seeding at 10k/100k scale.

