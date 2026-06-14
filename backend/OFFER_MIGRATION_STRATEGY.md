# Offer Migration Strategy - Refactor to Production Schema

## Executive Summary

This document outlines the zero-disruption strategy to refactor Phase B1 from writing to a non-existent table (`public.active_driver_offers` VIEW) to writing to the canonical production offer table (`app.offers` or `app.ride_offers`).

**Key Principle**: No schema changes. No database migrations. Code-only refactor.

---

## Current Broken State

### Phase B1 Implementation

**What was built**: Handler writes to `public.active_driver_offers` (assumed as table)

**What exists**: `public.active_driver_offers` is a VIEW (read-only)

**Result**: Runtime failures on all offer write operations

```
SubmitOffer()    → INSERT INTO public.active_driver_offers    ❌ FAILS
RejectOffer()    → UPDATE public.active_driver_offers         ❌ FAILS
AcceptOffer()    → UPDATE public.active_driver_offers         ❌ FAILS
ListOffers()     → SELECT FROM public.active_driver_offers    ⚠️ WORKS (view is readable)
```

---

## Production Reality

### Canonical Offer Table

**Location**: `app.offers` (or `app.ride_offers`)

**Type**: PostgreSQL TABLE (writable)

**Purpose**: Authoritative offer storage with full lifecycle support

**Existing Schema** (to be verified):

```sql
CREATE TABLE app.offers (
  id UUID PRIMARY KEY,
  ride_request_id UUID NOT NULL,      -- Foreign key to rides
  driver_id TEXT NOT NULL,
  amount DECIMAL(10,2),
  currency VARCHAR(3),
  status VARCHAR(20),                 -- pending, accepted, rejected, expired, cancelled
  created_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE,
  accepted_at TIMESTAMP WITH TIME ZONE,
  rejected_at TIMESTAMP WITH TIME ZONE,
  FOREIGN KEY (ride_request_id) REFERENCES rides(id)
);
```

**Existing View**:

```sql
CREATE VIEW public.active_driver_offers AS
SELECT
  id,
  ride_request_id,
  driver_id,
  amount,
  currency,
  created_at,
  expires_at
FROM app.offers
WHERE status IN ('pending', 'accepted')
  AND expires_at > NOW();
```

---

## Migration Phases

### Phase 0: Verification (Immediate)

**Action**: Query production schema

```sql
-- 1. Confirm table exists
SELECT * FROM information_schema.tables 
WHERE table_schema = 'app' AND table_name IN ('offers', 'ride_offers');

-- 2. Get column definitions
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns
WHERE table_schema = 'app' AND table_name = 'offers'
ORDER BY ordinal_position;

-- 3. Test write access
BEGIN;
INSERT INTO app.offers (id, ride_request_id, driver_id, amount, currency, status, created_at, updated_at, expires_at)
VALUES (gen_random_uuid(), gen_random_uuid(), 'test-driver', 100.00, 'USD', 'pending', NOW(), NOW(), NOW() + INTERVAL '30 seconds');
ROLLBACK;
```

**Expected Result**: ✅ INSERT succeeds (table is writable)

**Contingency**: If table doesn't exist or is read-only, fall back to Option 3 (create `app.driver_offers`)

---

### Phase 1: Code Refactor (Week 1)

**Scope**: Update Go backend to write to `app.offers` instead of `public.active_driver_offers`

**Files Changed**: 
- `internal/rides/handler.go` (9 SQL statements)
- No other files require changes

**Changes Required**:

#### 1.1: SubmitOffer - INSERT statement

```go
// BEFORE (incorrect):
INSERT INTO public.active_driver_offers (
  id, ride_id, driver_id, status, expires_at, created_at, updated_at
)

// AFTER (correct):
INSERT INTO app.offers (
  id, ride_request_id, driver_id, status, expires_at, created_at, updated_at
)
```

**Change Count**: 2 (table name + column name)

#### 1.2: ListOffers - SELECT statement

```go
// BEFORE:
SELECT id, driver_id, status, expires_at, created_at, updated_at
FROM public.active_driver_offers
WHERE ride_id = $1

// AFTER:
SELECT id, driver_id, status, expires_at, created_at, updated_at
FROM app.offers
WHERE ride_request_id = $1
```

**Change Count**: 2 (table name + column name)

#### 1.3: RejectOffer - UPDATE statement

```go
// BEFORE:
UPDATE public.active_driver_offers
SET status = 'rejected', rejected_at = NOW(), updated_at = NOW()
WHERE id = $1 AND ride_id = $2

// AFTER:
UPDATE app.offers
SET status = 'rejected', rejected_at = NOW(), updated_at = NOW()
WHERE id = $1 AND ride_request_id = $2
```

**Change Count**: 3 (table name + 2 column names)

#### 1.4: AcceptOffer - SELECT offer statement

```go
// BEFORE:
SELECT id, ride_id, driver_id, status, expires_at
FROM public.active_driver_offers
WHERE id = $1

// AFTER:
SELECT id, ride_request_id, driver_id, status, expires_at
FROM app.offers
WHERE id = $1
```

**Change Count**: 2 (table name + column name in SELECT)

**Note**: Go code maps `ride_request_id` to `OfferRecord.RideID` struct field (already done)

#### 1.5: AcceptOffer - UPDATE offer to accepted

```go
// BEFORE:
UPDATE public.active_driver_offers
SET status = 'accepted', accepted_at = NOW(), updated_at = NOW()
WHERE id = $1 AND status = 'pending' AND expires_at > NOW()

// AFTER:
UPDATE app.offers
SET status = 'accepted', accepted_at = NOW(), updated_at = NOW()
WHERE id = $1 AND status = 'pending' AND expires_at > NOW()
```

**Change Count**: 1 (table name only)

#### 1.6: AcceptOffer - Expire remaining offers

```go
// BEFORE:
UPDATE public.active_driver_offers
SET status = 'expired', updated_at = NOW()
WHERE ride_id = $1 AND status = 'pending'

// AFTER:
UPDATE app.offers
SET status = 'expired', updated_at = NOW()
WHERE ride_request_id = $1 AND status = 'pending'
```

**Change Count**: 2 (table name + column name)

**Total SQL Changes**: 12 changes across 6 SQL statements

---

### Phase 2: Testing (Week 1)

#### 2.1: Unit Tests

**No test changes required** — existing tests use string pattern matching and mocking

```go
// Existing test mocks return same structure regardless of table name
if strings.Contains(sql, "FROM") && strings.Contains(sql, "WHERE ride") {
  // Mock returns offer data — doesn't care about table name
  return mockOffer
}
```

#### 2.2: Integration Tests (Recommended)

```go
// NEW: Test actual app.offers table
func TestSubmitOfferToAppOffers(t *testing.T) {
  // 1. Create test ride
  // 2. Call SubmitOffer() with valid request
  // 3. Query app.offers directly (verify INSERT succeeded)
  // 4. Verify columns: ride_request_id, status = 'pending'
}

func TestAcceptOfferUpdateAppOffers(t *testing.T) {
  // 1. Create test offer in app.offers
  // 2. Call AcceptOffer() with valid request
  // 3. Query app.offers (verify UPDATE succeeded)
  // 4. Verify: status = 'accepted', accepted_at is set
}
```

#### 2.3: Canary Testing (Pre-Deployment)

```bash
# 1. Deploy to staging environment
# 2. Run offer creation flow
go run ./cmd/server

# 3. Verify in staging database
SELECT COUNT(*) FROM app.offers WHERE status = 'pending';
SELECT * FROM public.active_driver_offers LIMIT 5;

# 4. Verify both table and view return consistent data
SELECT id, driver_id, amount FROM app.offers WHERE status IN ('pending', 'accepted');
SELECT id, driver_id, amount FROM public.active_driver_offers;
```

---

### Phase 3: Deployment (Week 1-2)

#### 3.1: Pre-Deployment Checklist

- [ ] Verify `app.offers` table exists in production
- [ ] Verify table is writable (test INSERT)
- [ ] Verify indexes exist for: ride_request_id, driver_id, status
- [ ] Backup production database
- [ ] Notify team of deployment window (5-10 minutes)
- [ ] Code review completed
- [ ] Unit tests pass
- [ ] Staging tests pass

#### 3.2: Deployment Strategy (Zero Downtime)

**Option A: Blue-Green Deployment** (Recommended)

```
Time 0:
  - Blue (old code): Reads from public.active_driver_offers (view)
  - Green (new code): Writes to app.offers (table)
  - Production traffic: All to Blue

Time 1 (deploy):
  - Deploy new code to Green instance
  - Health checks pass
  - Gradually shift traffic: Blue → Green (5% → 25% → 100%)

Time 2 (monitor):
  - Green handles all traffic
  - Monitor error rates, latency
  - Keep Blue running as rollback

Time 3 (complete):
  - After 24 hours stable
  - Decommission Blue
  - Green is new production
```

**Expected Downtime**: 0 seconds (rolling update)

**Rollback Window**: 24 hours (keep old code available)

**Option B: Gradual Rollout** (If load balancer supports)

```
Minute 0-2:
  - Deploy new code to 1 instance (10% traffic)
  - Monitor offer creation success rate
  - Check error logs for SQL exceptions

Minute 2-5:
  - If stable, increase to 50% traffic (2 instances)
  - Continue monitoring

Minute 5-10:
  - If still stable, 100% traffic (all instances)
  - Final monitoring

Minute 10+:
  - Assess metrics over 1 hour
  - If all green, mark complete
  - If issues, rollback to old code
```

#### 3.3: Deployment Execution

```bash
# 1. Pull latest code with refactored handler.go
git pull origin main

# 2. Run tests one final time
go test ./internal/rides -v

# 3. Build new container
docker build -t pickme-backend:latest .

# 4. Push to registry
docker push pickme-backend:latest

# 5. Deploy to Kubernetes (or Docker Compose)
# Blue: keep running (rollback)
# Green: new instance with latest code
kubectl set image deployment/pickme-backend pickme=pickme-backend:latest

# 6. Monitor for 10 minutes
kubectl logs -f deployment/pickme-backend | grep -E "ERROR|WARN|offer"

# 7. Check metrics dashboard
# - Offer creation rate (should match pre-deployment)
# - Offer acceptance rate (should match pre-deployment)
# - Error rates (should be 0)
# - Latency p95 (should be <100ms)
```

---

### Phase 4: Post-Deployment Validation (Week 2)

#### 4.1: Monitoring (24 hours)

```sql
-- 1. Verify writes are going to app.offers
SELECT COUNT(*) as offer_count, 
       COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_count,
       COUNT(CASE WHEN status = 'accepted' THEN 1 END) as accepted_count
FROM app.offers
WHERE created_at > NOW() - INTERVAL '24 hours';

-- 2. Verify view consistency
SELECT COUNT(*) FROM app.offers WHERE status IN ('pending', 'accepted') AND expires_at > NOW();
SELECT COUNT(*) FROM public.active_driver_offers;
-- Should be same or close

-- 3. Check for errors
SELECT COUNT(*), error_message
FROM application_logs
WHERE timestamp > NOW() - INTERVAL '24 hours'
  AND message LIKE '%offer%'
GROUP BY error_message;
```

#### 4.2: Metrics to Validate

| Metric | Pre-Deployment | Post-Deployment | Target |
|---|---|---|---|
| Offer creation rate | X offers/min | Should match X | ✅ No change |
| Offer acceptance rate | Y offers/min | Should match Y | ✅ No change |
| Offer rejection rate | Z offers/min | Should match Z | ✅ No change |
| Query latency p95 | <100ms | Should be <100ms | ✅ No degradation |
| Error rate | <0.1% | Should be <0.1% | ✅ No increase |
| Database CPU | Normal | Should be normal | ✅ No spike |

#### 4.3: Rollback Trigger

**Automatic rollback if:**
- Error rate > 1% for 5 minutes
- Latency p95 > 500ms for 5 minutes
- Offer creation fails > 10% of requests
- Database CPU > 80%

**Manual rollback:**
```bash
kubectl rollout undo deployment/pickme-backend
# Instant rollback to old code + old table reference (public.active_driver_offers)
```

---

## Data Consistency Strategy

### During Transition

**Assumption**: Previous Phase B1 code may have written to `public.active_driver_offers` (but failed)

**Action**: Check if any data was persisted

```sql
-- 1. Check public.active_driver_offers for new data
SELECT COUNT(*) FROM public.active_driver_offers 
WHERE created_at > NOW() - INTERVAL '7 days';

-- 2. Check app.offers for data
SELECT COUNT(*) FROM app.offers
WHERE created_at > NOW() - INTERVAL '7 days';

-- 3. If public.active_driver_offers has data:
-- This shouldn't be possible (it's a view)
-- But if underlying table has stray data, reconcile or clean
```

### Post-Deployment Verification

```sql
-- Verify all offers are in app.offers
SELECT id, ride_request_id, status, created_at FROM app.offers
WHERE created_at > NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC
LIMIT 20;

-- Verify view exposes offers correctly
SELECT id, ride_request_id FROM public.active_driver_offers
WHERE created_at > NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC
LIMIT 20;

-- Both queries should show similar data (view is subset of table)
```

---

## Fallback: If `app.offers` Doesn't Exist

### Contingency Plan

**If production schema verification fails:**

1. **Verify table name**: Is it `app.ride_offers` instead?
2. **Verify schema**: Is it under `public` schema, not `app`?
3. **Verify write access**: Can service account write to it?

**If all checks fail:**

1. Create `app.driver_offers` table (as designed in Phase B1)
2. Hydrate with existing data (if any)
3. Deploy migrations to production
4. Deploy code with app.driver_offers references
5. Monitor for errors
6. Archive old active_driver_offers view after stable

---

## Rollback Instructions

### Complete Rollback (Return to Previous State)

```bash
# 1. Revert code to previous commit
git revert <commit-hash>

# 2. Rebuild container
docker build -t pickme-backend:previous .

# 3. Redeploy
kubectl set image deployment/pickme-backend pickme=pickme-backend:previous

# 4. Verify old code is running
kubectl logs -f deployment/pickme-backend | grep "active_driver_offers"

# 5. Monitor for 10 minutes
# App will fail on offer creation (expected — app.offers doesn't have view reference)
# But rides will still work
```

### Partial Rollback (Keep Database, Revert Code)

```bash
# 1. Database state is preserved (no schema changes)
# 2. Just revert code deployment (above)
# 3. Old code references public.active_driver_offers view
# 4. View still projects from app.offers correctly
```

---

## Timeline Summary

| Phase | Duration | Actions | Risk |
|---|---|---|---|
| 0: Verify | 1-2 hours | Query production schema | Low |
| 1: Refactor | 4-8 hours | Update 12 SQL statements | Low |
| 2: Test | 4-8 hours | Unit + integration tests | Medium |
| 3: Deploy | 0.5-2 hours | Blue-green deployment | Medium |
| 4: Validate | 24 hours | Monitor metrics | Low |
| **Total** | **~2-3 days** | **End-to-end** | **Low** |

---

## Risk Assessment

### Low-Risk Factors

✅ Code-only change (no schema migration)
✅ Public API contract unchanged (still writes offers)
✅ View still provides backward-compatible access
✅ Existing indexes still apply
✅ Zero data loss possible

### Medium-Risk Factors

⚠️ Column name mapping (ride_request_id ← ride_id)
⚠️ Existing offer data may need reconciliation
⚠️ Concurrent requests during transition

### Mitigation Strategies

✅ Pre-deployment staging tests
✅ Blue-green deployment strategy
✅ 24-hour rollback window
✅ Automated error detection and rollback

---

## Conclusion

**Migration from Phase B1 to production schema is low-risk and achievable in 2-3 days.**

No database schema changes required.
Code-only refactor (12 SQL statement changes).
Zero-downtime blue-green deployment.
Full rollback capability.

**Proceed with schema verification immediately.**
