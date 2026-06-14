# Offer System Architecture Review

## Executive Summary

The current implementation attempts to write to `public.active_driver_offers`, which is a PostgreSQL VIEW in production. This creates a critical architectural mismatch that blocks production deployment.

This review evaluates three storage architecture options and recommends the optimal path for scale, maintainability, and future horizontal scaling.

---

## Current State Analysis

### View Definition (Production)

```
public.active_driver_offers (VIEW)
  - id
  - ride_request_id
  - driver_id
  - amount
  - currency
  - created_at
  - expires_at
```

### Code Expectations

```
public.active_driver_offers (assumed writable table)
  - id
  - ride_id
  - driver_id
  - status
  - expires_at
  - created_at
  - updated_at
```

### Operations Against View

1. `SubmitOffer` → `INSERT INTO public.active_driver_offers`
2. `ListOffers` → `SELECT FROM public.active_driver_offers`
3. `RejectOffer` → `UPDATE public.active_driver_offers SET status = 'rejected'`
4. `AcceptOffer` → `SELECT + UPDATE public.active_driver_offers` (state transitions)
5. Expiration logic → `UPDATE public.active_driver_offers SET status = 'expired'`

**Current Result**: All write operations fail at runtime.

---

## Storage Architecture Options

### Option A: Replace View with Real Table

#### Approach
- Drop `public.active_driver_offers` VIEW.
- Create `public.active_driver_offers` as a real table with all required columns.
- Migrate existing data from underlying source tables into the new table.
- Update application code to reference new columns (e.g., `ride_id` instead of `ride_request_id`).

#### Advantages
- ✅ Minimal code changes (only column name mappings).
- ✅ Fastest immediate path to production.
- ✅ Backward compatible with existing API contracts.
- ✅ Single source of truth for offer state.

#### Disadvantages
- ❌ Loses original view semantics (if view was performing complex joins/transforms).
- ❌ Data duplication if original offers were stored elsewhere.
- ❌ Requires understanding what the view was aggregating.
- ❌ May violate existing data warehouse contracts if other systems depend on the view.

#### Risk Profile
- **High Risk if the view was a join/aggregation** (e.g., deriving `active_driver_offers` from `drivers + offers + rides` tables).
- **Low Risk if the view was a simple projection** (e.g., renaming columns or filtering).

#### Scalability
- Single table with direct INSERT/UPDATE/SELECT.
- Can be indexed for high-throughput offer creation and acceptance.
- Suitable for 1,000-10,000 concurrent ride requests.
- Requires careful index strategy for acceptance race-conditions.

---

### Option B: Create Dedicated Table + Leave View Untouched

#### Approach
- Create new `public.driver_offers` table (production schema) with full lifecycle support.
- Update application code to write to `public.driver_offers`.
- Leave existing `public.active_driver_offers` VIEW untouched (for backward compatibility).
- Optionally: Update the view to read from `public.driver_offers` if semantically appropriate.

#### Advantages
- ✅ **Preserves backward compatibility** with any existing view consumers.
- ✅ **Reduces migration risk** - no dropping of production views.
- ✅ **Clear separation of concerns** - ride offers in their own table.
- ✅ **Future-proof** - can evolve schema without impacting view consumers.
- ✅ **Allows gradual migration** - old system and new system can coexist during transition.
- ✅ **Best for horizontal scaling** - dedicated offer table can be replicated, partitioned, or moved to separate service.

#### Disadvantages
- ⚠️ Requires code changes to reference `public.driver_offers` instead of `public.active_driver_offers`.
- ⚠️ Potential duplication if view is also maintained from another source.
- ⚠️ Must reconcile two offer sources if both are active during migration window.

#### Risk Profile
- **Low Risk** - does not modify existing production views.
- **Medium Risk** - requires dual-write strategy during transition (if needed).

#### Scalability
- Dedicated table enables:
  - Horizontal partitioning by `ride_id` or `driver_id`.
  - Separate replication strategy from core `rides` table.
  - Redis caching layer for pending offers.
  - Message queue integration (NATS/Kafka) for offer state changes.
- Suitable for 10,000-100,000+ concurrent ride requests.
- Supports multi-region active-active deployments.

#### **Recommendation**: **Option B is preferred for production.**

---

### Option C: Writable Views + INSTEAD OF Triggers

#### Approach
- Create `public.driver_offers` table (real table, same as Option B).
- Create INSTEAD OF triggers on `public.active_driver_offers` VIEW.
- Triggers route INSERT/UPDATE/DELETE to underlying `public.driver_offers` table.
- Application code writes to `public.active_driver_offers` (the view) unchanged.

#### Advantages
- ✅ **No application code changes** - writes continue to `public.active_driver_offers`.
- ✅ **Backward compatible** - view interface unchanged.
- ✅ **Preserves existing API contracts**.
- ✅ **Encapsulates storage changes** - hiding implementation details.

#### Disadvantages
- ❌ **Complexity overhead** - triggers add operational burden.
- ❌ **Debugging difficulty** - INSERT/UPDATE surface shows as going to VIEW, but really target table.
- ❌ **Performance penalty** - trigger invocation on every write.
- ❌ **Error handling complexity** - debugging trigger failures requires PostgreSQL log inspection.
- ❌ **Not idiomatic** - rarely used in modern cloud applications.
- ❌ **Testing complexity** - mock triggers in tests adds overhead.

#### Risk Profile
- **High Risk** - PostgreSQL triggers are footguns in production.
- Suitable only if code changes are completely blocked (not applicable here).

#### Scalability
- Same as Option B, but with trigger overhead on every write.
- Not recommended for >10,000 concurrent requests.

---

## Architecture Recommendation

### **Option B: Dedicated `public.driver_offers` Table**

**Rationale:**

1. **Production Safety**: Preserves existing `active_driver_offers` view; does not drop production objects.
2. **Scalability**: Enables independent scaling, caching, and replication of offer state.
3. **Future Integration**: Supports async offer processing (NATS), Redis caching, and multi-region deployments.
4. **Code Clarity**: Explicit table name (`driver_offers`) matches semantic intent.
5. **Team Velocity**: Minimal operational complexity; straightforward Go code changes.
6. **Uber/InDrive Precedent**: Both platforms use dedicated offer tables, not views, for offer lifecycle management.

### Implementation Path

1. **Phase 1 (Immediate)**: Create `public.driver_offers` table with full schema.
2. **Phase 2 (Week 1)**: Implement migration SQL to hydrate initial data.
3. **Phase 3 (Week 1)**: Update Go code to write/read from `public.driver_offers`.
4. **Phase 4 (Week 2)**: Run canary deployment; shadow old view.
5. **Phase 5 (Week 3+)**: Retire old `active_driver_offers` view (optional, after full cutover).

---

## Next Steps

See:
- `DRIVER_OFFERS_SCHEMA.md` for final table design
- `DRIVER_OFFERS_MIGRATION.sql` for zero-loss migration
- `PHASE_B1_CODE_CHANGES.md` for backend refactor scope
- `SCALABILITY_REVIEW.md` for multi-region deployment readiness
