# PickMe GO V2 — Architecture Blueprint

V2 is **additive**. All GO V1 ride lifecycle tables, routes, and websocket events are locked. V2 introduces new tables, new endpoints, new WS event channels, and new services that read from V1 state but never mutate `public.rides`, `public.ride_offers`, `public.driver_locations`, or `public.driver_sessions` outside the existing Go Core paths.

---

## 1. Architecture Blueprint

```text
                ┌───────────────────────────────┐
                │   Frontend F1 (React/Capacitor)│
                └──────────────┬────────────────┘
                               │ HTTPS + WSS
                ┌──────────────▼────────────────┐
                │      Go Core V1 (LOCKED)      │
                │  rides · offers · location    │
                │  ride_started · completed     │
                └──────────────┬────────────────┘
                               │ emits domain events (read-only consumers below)
        ┌──────────────────────┼─────────────────────────────┐
        │                      │                             │
┌───────▼────────┐   ┌─────────▼──────────┐        ┌─────────▼────────┐
│ V2 Match Svc   │   │ V2 Wallet Svc      │        │ V2 Notify Svc    │
│ (Go, new)      │   │ (Go, new)          │        │ (Go, new)        │
└───────┬────────┘   └─────────┬──────────┘        └─────────┬────────┘
        │                      │                             │
┌───────▼──────────────────────▼─────────────────────────────▼────────┐
│           Postgres (Supabase)  — V2 tables only                      │
│   driver_scores · match_candidates · wallet_ledger · student_*       │
│   booking_proxies · luggage_listings · ratings_* · push_tokens · …   │
└──────────────────────────────────────────────────────────────────────┘
        │
┌───────▼────────┐      ┌──────────────────────┐
│ Admin Ops UI   │      │ Analytics Warehouse  │
│ (React, V2)    │      │ (materialized views) │
└────────────────┘      └──────────────────────┘

         Future: Redis (geo + presence + pub/sub) sits in front of
         Postgres for matching, nearby discovery, and WS fanout.
```

**Boundary rule:** V2 services subscribe to V1 outbound events (`ride.requested`, `offer.created`, `ride.accepted`, `ride.started`, `ride.completed`) via a read-side event bus. V2 never writes the locked tables.

---

## 2. Systems Design (14)

### 1) Smart Matching Engine
- **Goal:** server-side candidate selection to replace broadcast-to-all-drivers.
- **Inputs:** ride request (from V1 event), driver presence, geo cell, vehicle type, score, gender pref, WAV, fatigue, wallet eligibility.
- **Algorithm:** H3 (res 8) candidate set → filter eligibility → rank by composite score (distance 40%, rating 25%, acceptance 20%, ETA 15%) → fan out targeted offer invites in waves of 5, 8s each.
- **Output:** writes `match_candidates` rows; calls existing V1 `POST /api/rides/:id/offers/invite` (new sibling that pushes WS notifications only — not a lifecycle mutation).

### 2) Driver Ranking System
- **Goal:** durable per-driver score driving matching priority.
- **Inputs:** completion rate, cancellation rate, rolling 30d rating avg, acceptance rate, fraud flags, tenure.
- **Storage:** `driver_scores` (recomputed nightly + incrementally on ride completion event).

### 3) Nearby Vehicle Discovery
- **Goal:** rider sees nearby drivers without leaking precise location of unassigned drivers.
- **Read path:** `GET /api/v2/discovery/nearby?lat&lng&vehicle_type` — returns jittered positions (±80m) for online drivers within radius from a Postgres GIST index (Redis later).
- **Privacy:** exact location only after `ride.accepted`.

### 4) Live Navigation Engine
- **Goal:** server-blessed routing, ETA, and turn-by-turn for driver app.
- **Service:** new edge function `v2-navigation` wraps Google Directions; caches polylines in `nav_routes`; emits `nav.eta.updated` WS events on `nav:<rideId>` channel (separate from locked `driver_location`).

### 5) Wallet Architecture
- **Goal:** append-only double-entry ledger; existing `wallets` / `driver_wallets` become **projections**.
- **New tables:** `wallet_accounts`, `wallet_ledger_entries` (debit/credit pairs, idempotency_key UNIQUE), `wallet_holds`.
- **Commands:** `POST /api/v2/wallet/hold|capture|release|transfer|topup` — all idempotent.
- **Reconciliation job:** daily; flags drift vs projection.

### 6) Student Discount System
- **New tables:** `student_verifications` (institution_id, doc_url, status, expires_at), `student_discount_rules` (institution_id, pct, cap_usd, valid_from/to).
- **Hook:** fare quote endpoint (V2) consults active verification and applies discount before V1 ride creation; discount amount is metadata, not a lifecycle mutation.

### 7) Book For Someone Else
- **New table:** `booking_proxies` (booker_user_id, passenger_name, passenger_phone, relationship, ride_id).
- **Flow:** rider creates proxy → V1 `POST /api/rides` called with `passenger_*` fields already supported → proxy row persists contact tier + OTP handoff for pickup.

### 8) Luggage Marketplace
- **Goal:** decouple luggage surcharge from base fare; let drivers opt-in.
- **New tables:** `luggage_listings` (extends existing `luggage_requests`), `luggage_bids` (driver_id, surcharge_usd, accepted).
- **Endpoints:** `POST /api/v2/luggage/:rideId/bids`, `POST .../accept`. Acceptance is recorded as `fare_adjustments` (already exists) — still no V1 lifecycle mutation.

### 9) Driver Rating System
- Keep existing `driver_ratings` table.
- Add `driver_rating_aggregates` (driver_id, count, avg, p25, last_30d_avg) refreshed by trigger.
- Feed into Driver Ranking (#2).

### 10) Rider Rating System
- **New tables:** `rider_ratings` (ride_id, driver_id, rider_id, stars, tags[], comment), `rider_rating_aggregates`.
- Drivers rate riders post-completion; aggregates surfaced to matching as soft filter (low-rated riders matched last).

### 11) Push Notification Infrastructure
- **New tables:** `push_tokens` (user_id, platform, token, last_seen), `notification_outbox` (user_id, channel, template, payload, status, retry_count, next_retry_at).
- **Service:** `v2-notify` edge function consumes outbox every 10s, sends via FCM/APNs/web-push, exponential backoff. Re-uses mirror_outbox pattern.
- **Channels:** ride_offer, ride_accepted, ride_arrived, ride_completed, payment, promo, admin.

### 12) Admin Operations Center
- **New UI module** under `/admin/ops`: live fleet, dispatch queue depth, match SLA, wallet drift, dispute SLA, SOS heatmap, manual driver assignment, force-cancel, refund console.
- **Backed by:** existing admin RPCs + new `v2_admin_*` views (read-only over V1 tables).

### 13) Analytics Layer
- **New schema:** `analytics.*` (Postgres) with materialized views: `mv_rides_daily`, `mv_driver_funnel`, `mv_fare_breakdown`, `mv_match_latency`, `mv_cancellation_reasons`.
- **Refresh:** pg_cron every 5 min for hot views, hourly for cohort views.
- **Export:** nightly dump to mirror DB (already exists) for BI.

### 14) Future Redis Realtime Layer
- **Phase 2 only.** Redis used for: (a) geo index of online drivers (`GEOADD drivers:online`), (b) presence TTL, (c) pub/sub fanout for `driver_location`, `nav.eta.updated`, `match.invite`.
- Postgres remains source of truth; Redis is a cache + fanout tier.
- WS gateway reads from Redis instead of polling Postgres.

---

## 3. Database Changes

### New tables
| Table | Purpose |
|---|---|
| `match_candidates` | per-ride ranked candidate drivers + wave state |
| `driver_scores` | composite ranking score, refreshed |
| `driver_rating_aggregates` | denormalized rating summary |
| `nav_routes` | cached polylines + ETA snapshots |
| `wallet_accounts` | one row per logical account |
| `wallet_ledger_entries` | append-only double-entry |
| `wallet_holds` | reserved funds for wallet rides |
| `student_verifications` | proof + status + expiry |
| `student_discount_rules` | per-institution discount config |
| `booking_proxies` | book-for-someone metadata |
| `luggage_listings` | normalized luggage offer |
| `luggage_bids` | driver bids on luggage surcharge |
| `rider_ratings` | drivers rating riders |
| `rider_rating_aggregates` | denormalized |
| `push_tokens` | device tokens |
| `notification_outbox` | retry-safe push queue |
| `analytics.mv_*` | materialized views (read-only) |

### Modified tables (additive columns only — no behavior change for V1)
| Table | Added columns |
|---|---|
| `profiles` | `student_verification_id`, `rider_rating_avg` |
| `drivers` | `score`, `score_updated_at`, `accepts_luggage` |
| `rides` | `proxy_id` nullable (read-only FK), `discount_applied_usd` (write at quote-time only) |
| `fare_adjustments` | `source` enum (`luggage_bid`, `discount`, `manual`) |

**Locked tables (`ride_offers`, `driver_locations`, `driver_sessions`)** — no schema change.

---

## 4. API Endpoints (all under `/api/v2/`, V1 routes untouched)

### Matching & Discovery
- `POST /api/v2/match/quote` — fare estimate + discount preview
- `GET  /api/v2/discovery/nearby`
- `POST /api/v2/match/feedback` (driver decline reason)

### Navigation
- `GET  /api/v2/nav/:rideId/route`
- `POST /api/v2/nav/:rideId/reroute`

### Wallet
- `POST /api/v2/wallet/topup`
- `POST /api/v2/wallet/hold`
- `POST /api/v2/wallet/capture`
- `POST /api/v2/wallet/release`
- `POST /api/v2/wallet/transfer`
- `GET  /api/v2/wallet/ledger?account_id`

### Student
- `POST /api/v2/student/verify`
- `GET  /api/v2/student/status`
- `POST /api/v2/admin/student/:id/approve|reject`

### Proxy booking
- `POST /api/v2/bookings/proxy`
- `GET  /api/v2/bookings/proxy/:id`

### Luggage marketplace
- `POST /api/v2/luggage/:rideId/listings`
- `POST /api/v2/luggage/:rideId/bids`
- `POST /api/v2/luggage/:rideId/bids/:bidId/accept`

### Ratings
- `POST /api/v2/ratings/rider`
- `GET  /api/v2/ratings/driver/:driverId/summary`
- `GET  /api/v2/ratings/rider/:riderId/summary`

### Notifications
- `POST /api/v2/push/register`
- `DELETE /api/v2/push/:tokenId`

### Admin Ops
- `GET  /api/v2/admin/ops/fleet`
- `GET  /api/v2/admin/ops/match-sla`
- `POST /api/v2/admin/ops/rides/:id/force-cancel`
- `POST /api/v2/admin/ops/wallet/reconcile`

### Analytics
- `GET  /api/v2/analytics/:metric?range=`

---

## 5. WebSocket Events (new channels only — V1 events unchanged)

| Channel | Event | Direction |
|---|---|---|
| `match:<rideId>` | `match.invite`, `match.wave`, `match.timeout` | server → driver |
| `nav:<rideId>` | `nav.eta.updated`, `nav.reroute` | server → both |
| `wallet:<userId>` | `wallet.balance.changed`, `wallet.hold.created` | server → user |
| `notify:<userId>` | `notify.push`, `notify.inapp` | server → user |
| `ops:admin` | `ops.sos`, `ops.dispute.new`, `ops.driver.flagged` | server → admin |
| `rating:<userId>` | `rating.requested` | server → user |

**Untouched:** `ride_offer`, `ride_accepted`, `driver_location`, `ride_started`, `ride_completed`.

---

## 6. Implementation Order

**Phase 0 — Foundations (week 1)**
1. Event bus tap on V1 (read-only consumer of lifecycle events)
2. `notification_outbox` + push tokens + `v2-notify` worker
3. Analytics schema + first 3 materialized views

**Phase 1 — Trust & Money (weeks 2–3)**
4. Wallet ledger + holds + reconciliation job (projection-compatible)
5. Driver ranking + aggregates
6. Rider rating system

**Phase 2 — Marketplace (weeks 4–5)**
7. Smart Matching Engine (shadow mode first — log only, don't fan out)
8. Nearby Vehicle Discovery
9. Luggage Marketplace
10. Student Discount

**Phase 3 — Experience (week 6)**
11. Live Navigation Engine
12. Book For Someone Else
13. Admin Operations Center

**Phase 4 — Scale (post-pilot)**
14. Redis realtime tier (geo + presence + WS fanout)

---

## 7. Migration Plan

1. **Cut-over policy:** every V2 feature ships behind a flag in `pricing_settings` extension or a new `feature_flags` table. Default OFF.
2. **Shadow mode:** Matching engine runs in parallel with V1 broadcast for 2 weeks; compare candidate quality + acceptance latency before switching dispatch source.
3. **Wallet migration:** backfill `wallet_ledger_entries` from historical `wallet_transactions` in a one-shot job; reconciliation must pass 7 consecutive days before projection writes are deprecated.
4. **Mirror sync:** all new tables added to the existing `mirror_outbox` trigger set; runbook updated.
5. **Rollback:** each phase is independently revertible by disabling its flag and pausing its workers; no V1 dependency means rollback never touches lifecycle code.
6. **Pilot gating:** Phases 0–2 required before public beta; Phase 3 before national launch; Phase 4 before >10k DAU.

---

## 8. Non-Goals (explicit)

- No changes to `public.rides`, `public.ride_offers`, `public.driver_locations`, `public.driver_sessions` schemas (beyond additive nullable cols on `rides` only).
- No changes to V1 websocket event names, payloads, or auth handshake.
- No replacement of Go Core routes with Supabase RPCs.
- No removal of `/negotiate/*` redirects.
- No code in this deliverable — architecture only.
