# PickMe Internal Pilot Readiness Report

Internal Pilot Readiness Phase. This report uses current architecture evidence only and does not re-audit completed launch blockers.

## Readiness Scores

| Stage | Score | Decision |
| --- | ---: | --- |
| Internal Pilot | 67/100 | Conditional go |
| Public Beta | 44/100 | Not ready |
| National Launch | 23/100 | Not ready |

## Pilot Decision

PickMe is conditionally ready for an internal pilot if the pilot is intentionally narrow:

- One town or small operating zone.
- Limited invited riders and drivers.
- Live engineering and operations coverage.
- Manual monitoring of rides, wallets, GPS, messages, and calls.
- Clear rollback plan.

PickMe is not ready for public beta because dispatch, matching, and some communication state transitions remain too client-driven, and the Go WebSocket backend is not present in this repo for engineering review.

## Current Architecture Summary

### Backend

Supabase/Postgres is the main backend. Edge Functions handle scheduled dispatch, settlement, token generation, wallet PINs, notifications, and administrative operations. PostgreSQL RPCs handle several high-integrity wallet and ride creation paths.

Go backend presence is external only. The client references a WebSocket endpoint, but no Go service code or deployment definition exists in this workspace.

### WebSockets and Realtime

Supabase Realtime is the primary realtime layer. The Go WebSocket path appears secondary and best-effort for location and ride events.

### Driver Dispatch

Drivers see pending rides via Realtime and fetch recent open rides. Scheduled rides and ride expiration are handled server-side. Active dispatch candidate selection is not yet a central backend service.

### Ride Matching

The app supports inDrive-style offers. Drivers submit offers; riders accept. The acceptance path is still client-orchestrated and should become an atomic server command before public beta.

### Realtime Driver Tracking

Drivers upsert into `live_locations`; riders and admins subscribe through Supabase Realtime. Nearby driver filtering is client-side over a capped set of online drivers.

### Wallet Integrity

Wallet flows are better than the rest of the architecture because critical operations use RPCs and row locks. Remaining maturity gaps are idempotency, holds, reconciliation, and currency normalization.

### Rider-Driver Communication

Chat uses `messages` plus Supabase Realtime. Voice uses call sessions and Agora token issuance, with WebRTC fallback code also present. Phone number exposure remains a product and safety risk for public beta.

## Pilot Bottlenecks

- Database Realtime load from `live_locations`.
- Broad ride and offer subscriptions.
- Client-side offer acceptance race risk.
- External/unreviewed Go WebSocket backend.
- Chat reloads full message history on updates.
- Wallet settlement edge cases require manual reconciliation.

## Pilot Security Risks

- WebSocket identity and authorization are not visible in repo.
- GPS spoofing remains possible from client-originated location updates.
- Offer acceptance should be server-authoritative.
- Phone number exposure can move rider-driver communication off-platform.
- SECURITY DEFINER RPCs need grant drift monitoring.

## Pilot Operating Guardrails

Required before the first pilot session:

- Confirm new migrations are applied in the pilot Supabase project.
- Confirm Realtime publications and RLS match the pilot tables.
- Disable or configure production builds without hard-coded external WebSocket fallback.
- Define pilot city/town boundaries.
- Cap number of active drivers.
- Assign one engineer to observe logs and database state.
- Assign one operations person to resolve stuck rides and wallet issues.

During pilot:

- Track GPS age for active rides.
- Track ride request to first offer.
- Track offer acceptance failures.
- Track stuck rides by status.
- Track wallet payment failures.
- Track call setup failures.
- Record every manual admin intervention.

Stop pilot if:

- More than one duplicate assignment occurs.
- Wallet settlement produces unreconciled balances.
- GPS age exceeds 60 seconds for active trips repeatedly.
- Realtime subscriptions disconnect broadly.
- Drivers cannot receive new ride requests within 30 seconds.

## Recommended Uber/InDrive Architecture

### Internal Pilot Target

Keep Supabase as source of truth. Add only operational controls and measurement. Do not expand geography.

### Public Beta Target

Add backend-owned ride orchestration:

- Atomic offer acceptance.
- Targeted driver offer fanout.
- Authenticated WebSocket gateway.
- Server-side location ingest and candidate lookup.
- Wallet idempotency and reconciliation.
- Message send RPC and call lifecycle commands.

### National Launch Target

Split core services:

- Ride Orchestrator.
- Dispatch and Matching Service.
- Location Service.
- WebSocket Gateway.
- Wallet Ledger Service.
- Communication Service.
- Admin Ops and Risk Service.

Use event bus, regional sharding, observability, incident response, and fraud/risk automation.

## Migration Plan

### Phase 0: Pilot Hardening

1. Document Go WebSocket contract and deployment owner.
2. Add pilot dashboards for GPS, Realtime, wallet, dispatch, and call status.
3. Add atomic accept-offer RPC.
4. Review production env for `VITE_WS_URL`.
5. Run a 20-driver dry run before real riders.

### Phase 1: Public Beta Hardening

1. Move dispatch candidate selection server-side.
2. Move location ingest to backend.
3. Add idempotency keys to wallet commands.
4. Add message send RPC and pagination.
5. Add load tests for ride bursts and reconnect storms.

### Phase 2: National Launch Foundation

1. Introduce event bus.
2. Add regional WebSocket clusters.
3. Add geospatial driver index.
4. Build append-only ledger service.
5. Add automated risk, fraud, and support tooling.

## Final Recommendation

Internal pilot can proceed conditionally. Public beta should wait until server-side matching/acceptance and authenticated WebSocket architecture are in place. National launch requires a backend service architecture beyond direct client-to-Supabase orchestration.
