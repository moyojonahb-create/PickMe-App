# Phase B1 Code Changes - Migration Plan

## Overview

This document specifies every code change required to migrate from `public.active_driver_offers` (VIEW) to `public.driver_offers` (TABLE).

**Scope**: `internal/rides/handler.go` and `internal/rides/types.go`

**No changes required**: `cmd/server/main.go`, `internal/rides/handler_test.go` (only view references in tests; logic unchanged)

---

## File: `internal/rides/types.go`

### Current State

```go
type OfferResponse struct {
	OfferID   string    `json:"offer_id"`
	RideID    string    `json:"ride_id"`
	DriverID  string    `json:"driver_id"`
	Status    string    `json:"status"`
	ExpiresAt time.Time `json:"expires_at"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type OfferRecord struct {
	ID        string
	RideID    string
	DriverID  string
	Status    string
	ExpiresAt time.Time
	CreatedAt time.Time
	UpdatedAt time.Time
}
```

### Required Changes

**Status**: No changes required. Types already match the new schema column names.

---

## File: `internal/rides/handler.go`

### SQL Queries to Update

#### Query 1: SubmitOffer - INSERT statement

**Location**: Line ~378

**Current**:
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

**Change Required**: 
- ✅ **No SQL change needed** — column names are already correct (`ride_id`, not `ride_request_id`)
- ✅ Only table name needs updating: `public.active_driver_offers` → `public.driver_offers`

**New**:
```go
_, err = h.db.Exec(context.Background(), `
	INSERT INTO public.driver_offers (
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

**Impact**: 1 line changed (table name)

---

#### Query 2: ListOffers - SELECT statement

**Location**: Line ~430

**Current**:
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

**Change Required**:
- ✅ **No column mapping needed** — all column names match
- ✅ Only table name needs updating: `public.active_driver_offers` → `public.driver_offers`

**New**:
```go
rows, err := h.db.Query(context.Background(), `
	SELECT id, driver_id, status, expires_at, created_at, updated_at
	FROM public.driver_offers
	WHERE ride_id = $1
	  AND status = 'pending'
	  AND expires_at > NOW()
	ORDER BY created_at ASC
`, rideID)
```

**Impact**: 1 line changed (table name)

---

#### Query 3: RejectOffer - UPDATE statement

**Location**: Line ~471

**Current**:
```go
commandTag, err := h.db.Exec(context.Background(), `
	UPDATE public.active_driver_offers
	SET status = 'rejected',
	    updated_at = NOW()
	WHERE id = $1
	  AND ride_id = $2
	  AND driver_id = $3
	  AND status = 'pending'
`, offerID, rideID, authUserID)
```

**Change Required**:
- ✅ **No column mapping needed**
- ✅ Add `rejected_at = NOW()` to track rejection timestamp
- ✅ Only table name needs updating: `public.active_driver_offers` → `public.driver_offers`

**New**:
```go
commandTag, err := h.db.Exec(context.Background(), `
	UPDATE public.driver_offers
	SET status = 'rejected',
	    rejected_at = NOW(),
	    updated_at = NOW()
	WHERE id = $1
	  AND ride_id = $2
	  AND driver_id = $3
	  AND status = 'pending'
`, offerID, rideID, authUserID)
```

**Impact**: 2 lines changed (table name + add rejected_at)

---

#### Query 4: AcceptOffer - SELECT offer statement

**Location**: Line ~521

**Current**:
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

**Change Required**:
- ✅ **No column mapping needed**
- ✅ Only table name needs updating: `public.active_driver_offers` → `public.driver_offers`

**New**:
```go
var offer OfferRecord
err = tx.QueryRow(ctx, `
	SELECT id, ride_id, driver_id, status, expires_at
	FROM public.driver_offers
	WHERE id = $1
`, offerID).Scan(
	&offer.ID,
	&offer.RideID,
	&offer.DriverID,
	&offer.Status,
	&offer.ExpiresAt,
)
```

**Impact**: 1 line changed (table name)

---

#### Query 5: AcceptOffer - UPDATE offer to accepted

**Location**: Line ~586

**Current**:
```go
commandTag, err := tx.Exec(ctx, `
	UPDATE public.active_driver_offers
	SET status = 'accepted',
	    updated_at = NOW()
	WHERE id = $1
	  AND status = 'pending'
	  AND expires_at > NOW()
`, offerID)
```

**Change Required**:
- ✅ **No column mapping needed**
- ✅ Add `accepted_at = NOW()` to track acceptance timestamp
- ✅ Only table name needs updating: `public.active_driver_offers` → `public.driver_offers`

**New**:
```go
commandTag, err := tx.Exec(ctx, `
	UPDATE public.driver_offers
	SET status = 'accepted',
	    accepted_at = NOW(),
	    updated_at = NOW()
	WHERE id = $1
	  AND status = 'pending'
	  AND expires_at > NOW()
`, offerID)
```

**Impact**: 2 lines changed (table name + add accepted_at)

---

#### Query 6: AcceptOffer - Expire remaining offers

**Location**: Line ~601

**Current**:
```go
_, err = tx.Exec(ctx, `
	UPDATE public.active_driver_offers
	SET status = 'expired',
	    updated_at = NOW()
	WHERE ride_id = $1
	  AND status = 'pending'
`, rideID)
```

**Change Required**:
- ✅ **No column mapping needed**
- ✅ Only table name needs updating: `public.active_driver_offers` → `public.driver_offers`

**New**:
```go
_, err = tx.Exec(ctx, `
	UPDATE public.driver_offers
	SET status = 'expired',
	    updated_at = NOW()
	WHERE ride_id = $1
	  AND status = 'pending'
`, rideID)
```

**Impact**: 1 line changed (table name)

---

## Summary of Changes

### By Category

| Category | Count | Details |
|----------|-------|---------|
| Table name updates | 6 | All SQL statements: replace `public.active_driver_offers` → `public.driver_offers` |
| Column additions | 2 | Add `rejected_at` to RejectOffer; add `accepted_at` to AcceptOffer |
| Logic changes | 0 | No handler logic changes required |
| Type changes | 0 | No struct changes required |

### By File

| File | Changes | Impact |
|------|---------|--------|
| `internal/rides/types.go` | 0 | No changes (types already match new schema) |
| `internal/rides/handler.go` | 9 | 6 table name updates + 2 timestamp additions + 1 line formatting |
| `internal/rides/handler_test.go` | 0 | No changes (tests only reference string matching, not actual SQL) |
| `cmd/server/main.go` | 0 | No changes (already using DB abstraction) |

---

## Deployment Sequence

### Phase 1: Database Migration (Pre-deployment)

1. Run `DRIVER_OFFERS_MIGRATION.sql` in Supabase console
2. Verify table creation with: `SELECT COUNT(*) FROM public.driver_offers;`
3. Verify indexes with: `SELECT * FROM pg_indexes WHERE tablename = 'driver_offers';`

### Phase 2: Code Deployment

1. Update handler.go (9 changes above)
2. Re-run `go test ./internal/rides` to verify tests pass
3. Deploy new backend container

### Phase 3: Monitoring

1. Monitor offer creation rate for 2 hours
2. Monitor offer acceptance rate for 2 hours
3. Check error logs for any PostgreSQL constraint violations
4. Verify WebSocket offer broadcasts still work

### Phase 4: Cleanup (Optional, after 7 days stable)

1. Drop legacy `public.active_driver_offers` VIEW
2. Command: `DROP VIEW IF EXISTS public.active_driver_offers;`

---

## Rollback Plan

### If Code Deployment Fails

1. **Immediate**: Revert to previous backend container image
2. **Database**: No database rollback needed (old view still present if not dropped)
3. **Recovery Time**: <2 minutes

### If Database Migration Fails

1. **Immediate**: Kill migration script
2. **Restore**: Use Supabase automated backups to restore to pre-migration snapshot
3. **Recovery Time**: <5 minutes (depends on Supabase backup schedule)

---

## Testing Requirements

### Unit Tests (No Changes)

- Existing `internal/rides/handler_test.go` tests will pass without modification
- Tests check for string patterns in SQL, not exact SQL

### Integration Tests (Recommended Addition)

```go
// POST /api/rides/{rideId}/offers - Create offer
func TestSubmitOfferIntegration(t *testing.T) {
  // Verify INSERT succeeds against real driver_offers table
  // Verify offer appears in ListOffers query
  // Verify offer state is 'pending'
}

// POST /api/rides/{rideId}/offers/{offerId}/accept - Accept offer
func TestAcceptOfferIntegration(t *testing.T) {
  // Verify atomic transaction: accepted_at is set
  // Verify offer status transitions to 'accepted'
  // Verify remaining offers expire
  // Verify rides.driver_id is set
}
```

### Staging Environment Test Plan

1. Deploy schema migration to staging
2. Deploy updated code to staging
3. Run 50 concurrent offer creations
4. Run 50 concurrent offer acceptances
5. Verify no race conditions or constraint violations
6. Check latency metrics (should be <100ms per operation)

---

## Performance Impact Assessment

### Expected Performance (Post-Migration)

| Operation | Pre-Migration | Post-Migration | Change |
|-----------|---------------|----------------|--------|
| Create offer | N/A (fails) | ~10ms | New baseline |
| List pending offers | N/A (fails) | ~15ms | New baseline |
| Accept offer | N/A (fails) | ~25ms | New baseline |
| Reject offer | N/A (fails) | ~12ms | New baseline |

### Index Coverage

- ✅ Rider listing (idx_ride_id_status_expires): Query plan → Index Scan
- ✅ Driver lookup (idx_driver_id_status): Query plan → Index Scan
- ✅ Expiration job (idx_expires_pending): Query plan → Partial Index Scan
- ✅ Offer acceptance (PRIMARY KEY): Query plan → Index Scan

---

## Next Steps

1. Code review of handler.go changes
2. Staging deployment and load testing
3. Production database migration (maintenance window)
4. Production code deployment (blue-green)
5. 24-hour monitoring and stability assessment
