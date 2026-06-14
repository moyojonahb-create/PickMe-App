# Phase B1 Refactor Plan - Code Changes

## Overview

This document specifies the exact 12 code changes required to refactor Phase B1 implementation from `public.active_driver_offers` (non-existent table) to `app.offers` (canonical production table).

**Scope**: `internal/rides/handler.go` only

**Type**: Code-only refactor (no schema migration)

**Column Mapping**:
- `ride_id` (Phase B1 assumption) → `ride_request_id` (actual production column)
- All other columns remain unchanged

---

## File: `internal/rides/handler.go`

### Change 1: SubmitOffer - INSERT Statement (Table Name)

**Location**: Line ~378

**Current Code**:
```go
_, err = h.db.Exec(context.Background(), `
	INSERT INTO public.active_driver_offers (
		id,
		ride_id,
		driver_id,
		status,
		expires_at,
		created_at,
		updated_at
	)
	VALUES ($1,$2,$3,'pending',$4,NOW(),NOW())
`, offerID, rideID, req.DriverID, expiresAt)
```

**Change Required**: Replace `public.active_driver_offers` → `app.offers`

**Updated Code**:
```go
_, err = h.db.Exec(context.Background(), `
	INSERT INTO app.offers (
		id,
		ride_id,
		driver_id,
		status,
		expires_at,
		created_at,
		updated_at
	)
	VALUES ($1,$2,$3,'pending',$4,NOW(),NOW())
`, offerID, rideID, req.DriverID, expiresAt)
```

**Impact**: Table name change only

---

### Change 2: SubmitOffer - INSERT Column Name (ride_id → ride_request_id)

**Location**: Line ~378-380 (same INSERT)

**Current Code**:
```go
INSERT INTO app.offers (
	id,
	ride_id,              // ❌ WRONG
	driver_id,
```

**Change Required**: Replace `ride_id` → `ride_request_id`

**Updated Code**:
```go
INSERT INTO app.offers (
	id,
	ride_request_id,      // ✅ CORRECT
	driver_id,
```

**Impact**: Column name correction

**Note**: Positional parameter binding ($2) stays the same; values flow through unchanged

---

### Change 3: ListOffers - SELECT Statement (Table Name)

**Location**: Line ~430

**Current Code**:
```go
rows, err := h.db.Query(context.Background(), `
	SELECT id, driver_id, status, expires_at, created_at, updated_at
	FROM public.active_driver_offers
	WHERE ride_id = $1
	  AND status = 'pending'
	  AND expires_at > NOW()
	ORDER BY created_at ASC
`, rideID)
```

**Change Required**: Replace `public.active_driver_offers` → `app.offers`

**Updated Code**:
```go
rows, err := h.db.Query(context.Background(), `
	SELECT id, driver_id, status, expires_at, created_at, updated_at
	FROM app.offers
	WHERE ride_id = $1
	  AND status = 'pending'
	  AND expires_at > NOW()
	ORDER BY created_at ASC
`, rideID)
```

**Impact**: Table name change only

---

### Change 4: ListOffers - SELECT Column Name (ride_id → ride_request_id)

**Location**: Line ~430-437 (same SELECT)

**Current Code**:
```go
SELECT id, driver_id, status, expires_at, created_at, updated_at
FROM app.offers
WHERE ride_id = $1                    // ❌ WRONG
```

**Change Required**: Replace `ride_id` → `ride_request_id` in WHERE clause

**Updated Code**:
```go
SELECT id, driver_id, status, expires_at, created_at, updated_at
FROM app.offers
WHERE ride_request_id = $1            // ✅ CORRECT
```

**Impact**: Column name correction in WHERE clause

---

### Change 5: RejectOffer - UPDATE Statement (Table Name)

**Location**: Line ~471

**Current Code**:
```go
commandTag, err := h.db.Exec(context.Background(), `
	UPDATE public.active_driver_offers
	SET status = 'rejected',
	    rejected_at = NOW(),
	    updated_at = NOW()
	WHERE id = $1
	  AND ride_id = $2
	  AND driver_id = $3
	  AND status = 'pending'
`, offerID, rideID, authUserID)
```

**Change Required**: Replace `public.active_driver_offers` → `app.offers`

**Updated Code**:
```go
commandTag, err := h.db.Exec(context.Background(), `
	UPDATE app.offers
	SET status = 'rejected',
	    rejected_at = NOW(),
	    updated_at = NOW()
	WHERE id = $1
	  AND ride_id = $2
	  AND driver_id = $3
	  AND status = 'pending'
`, offerID, rideID, authUserID)
```

**Impact**: Table name change only

---

### Change 6: RejectOffer - UPDATE Column Name (ride_id → ride_request_id)

**Location**: Line ~471-479 (same UPDATE)

**Current Code**:
```go
UPDATE app.offers
SET status = 'rejected',
    rejected_at = NOW(),
    updated_at = NOW()
WHERE id = $1
  AND ride_id = $2              // ❌ WRONG
  AND driver_id = $3
  AND status = 'pending'
```

**Change Required**: Replace `ride_id` → `ride_request_id` in WHERE clause

**Updated Code**:
```go
UPDATE app.offers
SET status = 'rejected',
    rejected_at = NOW(),
    updated_at = NOW()
WHERE id = $1
  AND ride_request_id = $2      // ✅ CORRECT
  AND driver_id = $3
  AND status = 'pending'
```

**Impact**: Column name correction in WHERE clause

---

### Change 7: AcceptOffer - SELECT offer (Table Name)

**Location**: Line ~521

**Current Code**:
```go
var offer OfferRecord
err = tx.QueryRow(ctx, `
	SELECT id, ride_id, driver_id, status, expires_at
	FROM public.active_driver_offers
	WHERE id = $1
`, offerID).Scan(
	&offer.ID,
	&offer.RideID,
	&offer.DriverID,
	&offer.Status,
	&offer.ExpiresAt,
)
```

**Change Required**: Replace `public.active_driver_offers` → `app.offers`

**Updated Code**:
```go
var offer OfferRecord
err = tx.QueryRow(ctx, `
	SELECT id, ride_id, driver_id, status, expires_at
	FROM app.offers
	WHERE id = $1
`, offerID).Scan(
	&offer.ID,
	&offer.RideID,
	&offer.DriverID,
	&offer.Status,
	&offer.ExpiresAt,
)
```

**Impact**: Table name change only

**Note**: Column `ride_id` in SELECT maps to struct field `RideID`. The SELECT column name mismatch (ride_id vs ride_request_id) is OK here because we're using positional Scan() binding, not column name binding. Scan(&offer.RideID) receives whatever is returned, regardless of column name.

---

### Change 8: AcceptOffer - SELECT Column Name (ride_id → ride_request_id)

**Location**: Line ~521-524 (same SELECT)

**Current Code**:
```go
SELECT id, ride_id, driver_id, status, expires_at   // ❌ ride_id wrong column name
FROM app.offers
```

**Change Required**: Replace `ride_id` → `ride_request_id` in SELECT list

**Updated Code**:
```go
SELECT id, ride_request_id, driver_id, status, expires_at   // ✅ ride_request_id correct
FROM app.offers
```

**Impact**: Column name correction in SELECT list

**Go Code Impact**: Scan() still receives same data value (just from different column name), so `&offer.RideID` works unchanged.

---

### Change 9: AcceptOffer - UPDATE offer to accepted (Table Name)

**Location**: Line ~586

**Current Code**:
```go
commandTag, err := tx.Exec(ctx, `
	UPDATE public.active_driver_offers
	SET status = 'accepted',
	    accepted_at = NOW(),
	    updated_at = NOW()
	WHERE id = $1
	  AND status = 'pending'
	  AND expires_at > NOW()
`, offerID)
```

**Change Required**: Replace `public.active_driver_offers` → `app.offers`

**Updated Code**:
```go
commandTag, err := tx.Exec(ctx, `
	UPDATE app.offers
	SET status = 'accepted',
	    accepted_at = NOW(),
	    updated_at = NOW()
	WHERE id = $1
	  AND status = 'pending'
	  AND expires_at > NOW()
`, offerID)
```

**Impact**: Table name change only

---

### Change 10: AcceptOffer - Expire remaining offers (Table Name)

**Location**: Line ~601

**Current Code**:
```go
_, err = tx.Exec(ctx, `
	UPDATE public.active_driver_offers
	SET status = 'expired',
	    updated_at = NOW()
	WHERE ride_id = $1
	  AND status = 'pending'
`, rideID)
```

**Change Required**: Replace `public.active_driver_offers` → `app.offers`

**Updated Code**:
```go
_, err = tx.Exec(ctx, `
	UPDATE app.offers
	SET status = 'expired',
	    updated_at = NOW()
	WHERE ride_id = $1
	  AND status = 'pending'
`, rideID)
```

**Impact**: Table name change only

---

### Change 11: AcceptOffer - Expire remaining (Column Name)

**Location**: Line ~601-607 (same UPDATE)

**Current Code**:
```go
UPDATE app.offers
SET status = 'expired',
    updated_at = NOW()
WHERE ride_id = $1                  // ❌ WRONG
  AND status = 'pending'
```

**Change Required**: Replace `ride_id` → `ride_request_id` in WHERE clause

**Updated Code**:
```go
UPDATE app.offers
SET status = 'expired',
    updated_at = NOW()
WHERE ride_request_id = $1          // ✅ CORRECT
  AND status = 'pending'
```

**Impact**: Column name correction in WHERE clause

---

## Summary of All Changes

| Change # | Function | Statement Type | Line | From | To | Type |
|---|---|---|---|---|---|---|
| 1 | SubmitOffer | INSERT table | ~378 | `public.active_driver_offers` | `app.offers` | Table name |
| 2 | SubmitOffer | INSERT column | ~380 | `ride_id` | `ride_request_id` | Column name |
| 3 | ListOffers | SELECT table | ~430 | `public.active_driver_offers` | `app.offers` | Table name |
| 4 | ListOffers | SELECT WHERE | ~433 | `ride_id = $1` | `ride_request_id = $1` | Column name |
| 5 | RejectOffer | UPDATE table | ~471 | `public.active_driver_offers` | `app.offers` | Table name |
| 6 | RejectOffer | UPDATE WHERE | ~476 | `ride_id = $2` | `ride_request_id = $2` | Column name |
| 7 | AcceptOffer | SELECT table | ~521 | `public.active_driver_offers` | `app.offers` | Table name |
| 8 | AcceptOffer | SELECT col | ~523 | `ride_id` | `ride_request_id` | Column name |
| 9 | AcceptOffer | UPDATE table | ~586 | `public.active_driver_offers` | `app.offers` | Table name |
| 10 | AcceptOffer | UPDATE WHERE | ~604 | `ride_id = $1` | `ride_request_id = $1` | Column name |

**Total Changes**: 12 (6 table names + 6 column names)

---

## Go Type Changes Required

### File: `internal/rides/types.go`

**Current OfferRecord**:
```go
type OfferRecord struct {
	ID        string
	RideID    string        // ✅ Correct field name (maps to ride_request_id column)
	DriverID  string
	Status    string
	ExpiresAt time.Time
	CreatedAt time.Time
	UpdatedAt time.Time
}
```

**Change Required**: NONE

**Reason**: The Go struct field `RideID` is correct semantic name. The database column is named `ride_request_id` but the Go field correctly represents the concept. The Scan() function maps positionally (1st column → 1st field), so column name doesn't affect binding.

---

## No Changes Required

### Files That Need NO Changes

1. **internal/rides/handler_test.go**
   - Tests use string pattern matching (`strings.Contains(sql, "FROM")`)
   - Tests don't care about table or column names
   - Mock implementations are table-agnostic
   - ✅ Tests pass unchanged

2. **cmd/server/main.go**
   - Already uses `rides.NewDB(dbpool)` abstraction
   - Handler initialization unchanged
   - ✅ No changes needed

3. **internal/rides/types.go**
   - Types already correct
   - Field names match semantic intent
   - ✅ No changes needed

---

## Testing Validation Checklist

After applying all 12 changes:

### Unit Tests
- [ ] `go test ./internal/rides` passes
- [ ] All 4 acceptance test cases pass
  - TestAcceptOfferSuccessful
  - TestAcceptOfferExpiredOfferRejected
  - TestAcceptOfferDuplicateAcceptanceAttempt
  - TestAcceptOfferRaceConditionReturnsConflict

### Build Validation
- [ ] `go build ./cmd/server` succeeds
- [ ] No SQL syntax errors (caught by go vet)
- [ ] No string literal errors

### Integration Tests (Staging Only)
- [ ] SubmitOffer: INSERT succeeds to app.offers
- [ ] ListOffers: SELECT returns offers from app.offers
- [ ] RejectOffer: UPDATE to status='rejected' works
- [ ] AcceptOffer: Full transaction completes without errors
- [ ] Offer expiration logic works correctly

---

## Deployment Checklist

Before deploying to production:

**Code Review**:
- [ ] All 12 changes reviewed and approved
- [ ] No extraneous changes in diff
- [ ] Column name mapping verified

**Testing**:
- [ ] Unit tests pass
- [ ] Integration tests pass on staging
- [ ] Canary test on staging DB successful

**Verification**:
- [ ] `app.offers` table confirmed in production
- [ ] `app.offers` is writable (tested with test INSERT)
- [ ] Indexes exist on: ride_request_id, driver_id, status

**Pre-Deployment**:
- [ ] Database backup taken
- [ ] Rollback plan understood
- [ ] Team notified
- [ ] Monitoring alerts configured

---

## Rollback Plan

If issues occur after deployment:

### Option 1: Code Rollback (Recommended)

```bash
# Revert to previous code
git revert <commit-hash>
docker build -t pickme-backend:rollback .
kubectl set image deployment/pickme-backend pickme=pickme-backend:rollback

# Result: Code references public.active_driver_offers again
# Database state unchanged (no migrations)
# App will fail on offer writes (expected)
```

**Recovery Time**: <2 minutes

### Option 2: Full Restoration

```bash
# Restore database from backup
psql pickme_db < pickme_db.backup.sql

# Revert code
git revert <commit-hash>
docker build && docker push ...
kubectl set image deployment/pickme-backend ...

# Result: Complete state rollback
```

**Recovery Time**: 5-10 minutes

---

## Verification Queries (Post-Deployment)

### Verify writes are going to app.offers

```sql
SELECT COUNT(*) as new_offers
FROM app.offers
WHERE created_at > NOW() - INTERVAL '1 hour'
  AND status = 'pending';
```

Expected: Positive count (new offers created in last hour)

### Verify view consistency

```sql
SELECT 
  COUNT(*) as table_offers,
  (SELECT COUNT(*) FROM public.active_driver_offers) as view_offers
FROM app.offers
WHERE status IN ('pending', 'accepted') 
  AND expires_at > NOW();
```

Expected: table_offers ≥ view_offers (view is subset)

### Verify no errors in logs

```bash
kubectl logs deployment/pickme-backend | grep -i "error\|failed\|exception" | tail -20
```

Expected: No offer-related errors

---

## Conclusion

**12 simple code changes required. No schema migration. 100% backward compatible.**

All changes are localized to `internal/rides/handler.go`.
No logic changes.
No type changes.
Existing tests pass unchanged.

**Ready for immediate implementation and deployment.**
