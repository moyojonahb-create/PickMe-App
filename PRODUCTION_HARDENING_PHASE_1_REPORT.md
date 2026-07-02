# Production Hardening Phase 1 Report

Date: 2026-07-01

Scope: GO V2.5-D critical production hardening blockers only. No frontend contract changes, no new product features, and no ride/wallet business behavior changes.

## Result

Overall result: **PASS FOR PHASE 1 CODE-LEVEL HARDENING**

Updated production readiness score: **84/100**  
Previous audit score: **76/100**

## Files Changed

- `backend/cmd/server/main.go`
- `backend/internal/database/postgres.go`
- `backend/internal/middleware/auth.go`
- `backend/internal/middleware/production.go`
- `backend/internal/middleware/production_test.go`
- `backend/internal/business/handler.go`
- `backend/internal/business/handler_test.go`
- `src/lib/businessApi.ts`
- `src/lib/rideExpiry.ts`
- `src/lib/ramzActions.ts`
- `src/components/driver/DemandHeatmap.tsx`
- `src/pages/DriverDashboard.tsx`
- `src/pages/negotiate/DriverRequestsScreen.tsx`
- `supabase/config.toml`
- `supabase/functions/add-driver/index.ts`
- `supabase/functions/admin-api/index.ts`
- `supabase/functions/dispatch-scheduled/index.ts`
- `supabase/functions/settle-trip/index.ts`
- `PRODUCTION_HARDENING_PHASE_1_REPORT.md`

## Security Issues Fixed

### 1. `/test-db` Production Exposure

Fixed.

- Local/dev/test environments keep `/test-db` available without auth for local diagnostics.
- Non-local environments now require authenticated admin access.
- Production database connectivity failures no longer return raw database error strings.
- Production-safe readiness endpoints remain:
  - `/health/ready`
  - `/health/dependencies`

### 2. `/metrics` Production Exposure

Fixed.

- Local/dev/test environments keep `/metrics` available for local scraping.
- Non-local environments now require authenticated admin access.
- This prevents public exposure of operational metrics in production app code.

### 3. Generic Admin Mutation Constraints

Fixed for `/admin/business/:table`.

- Replaced generic writable-table-only protection with per-table mutation policies.
- Added action checks for insert/update/delete.
- Added per-table field allowlists.
- Sensitive fields such as ride ownership, driver assignment, and arbitrary IDs are blocked unless explicitly allowed.
- Added structured audit logs for successful mutations:
  - `SECURITY_ADMIN_MUTATION`
- Added structured denial logs:
  - `SECURITY_ADMIN_MUTATION_DENIED`
- Preserved existing route paths and frontend adapter contracts.

### 4. Unified Admin Authorization

Fixed.

- Centralized admin authorization in `backend/internal/middleware/auth.go`.
- Admin verification supports JWT admin/service role and database-backed `public.user_roles` admin membership.
- Business admin handlers now call the shared authorization service instead of duplicating the role query.

### 5. Legacy Edge Function Rollback Safety

Fixed.

- All current `LEGACY_*_ENABLED` functions now refuse to run in `APP_ENV=production` unless `LEGACY_EMERGENCY_OVERRIDE_ENABLED=true` is also set.
- Updated `supabase/config.toml` comments to document the emergency override rule.
- Guarded functions:
  - `LEGACY_ADMIN_API_ENABLED`
  - `LEGACY_ADD_DRIVER_ENABLED`
  - `LEGACY_DISPATCH_SCHEDULED_ENABLED`
  - `LEGACY_SETTLE_TRIP_ENABLED`

### 6. Frontend Operational RPC Removal

Fixed for `src/`.

Moved these browser-side `supabase.rpc(...)` calls behind Go endpoints:

- `expire_old_rides`
- `auto_resolve_noise_fraud_flags`
- `cleanup_old_messages`
- `update_demand_zones`
- `can_driver_operate`
- `is_top_driver`

Frontend adapters still return the same operational booleans/counts expected by callers.

### 7. Distributed Rate Limiting

Fixed.

- HTTP rate limiting now uses Redis when Redis is enabled.
- The existing in-process limiter remains as local/dev and Redis-failure fallback.
- The global limiter continues to cover public APIs, admin routes, wallet/risk APIs, health-adjacent public paths, and proxy-like routes through the existing app middleware chain.

## Remaining Risks

- Historical docs still mention `/test-db` as public or development-facing. The live route is protected in non-local environments, but documentation cleanup should follow.
- Generic admin mutation is now constrained, but table-specific admin endpoints still deserve a later field-policy pass.
- Redis rate limiting is fixed-window. A Lua-backed sliding window or token bucket would be stronger under very high traffic.
- Edge Function rollback safety depends on correct `APP_ENV=production` in Supabase secrets/config. The emergency override secret must be tightly controlled.
- Retired Edge Functions still contain legacy business logic for emergency rollback. They are guarded, but should eventually be deleted after rollback windows close.
- `scripts/` does not exist in the current repo, so no script audit was possible.

## Verification

Backend:

```text
cd backend
$env:GOCACHE=(Resolve-Path .).Path + '\.gocache'
go test ./...
PASS
```

Frontend:

```text
npx tsc --noEmit -p tsconfig.app.json
PASS
```

Frontend RPC scan:

```text
rg -n "supabase\.rpc\(" src
No matches
```

`/test-db` scan:

```text
rg -n '"/test-db"|test-db' backend src supabase docs
```

Live code result:

- `backend/cmd/server/main.go` registers `/test-db` unauthenticated only in explicit development mode.
- `backend/cmd/server/main.go` registers `/test-db` with `requireAuth` and `AdminOnlyWithDB` outside explicit development mode.

Other hits are historical documentation references.

Generic admin mutation scan:

```text
rg -n "adminMutationPolicies|Admin(Update|Insert|Delete)Row|adminWritableTables|/admin/business|updateByID\(|deleteByID\(" backend/internal/business src
```

Result:

- `/admin/business/:table` still exists for frontend compatibility.
- Generic mutations are now routed through `adminMutationPolicies`.
- No `adminWritableTables` map remains.

Legacy flag scan:

```text
rg -n "LEGACY_.*_ENABLED|LEGACY_EMERGENCY_OVERRIDE_ENABLED" supabase docs backend src
```

Result:

- All current `LEGACY_*_ENABLED` function gates include production emergency override protection.
