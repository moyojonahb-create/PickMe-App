# Canonical Offer Table Recommendation

## Executive Summary

Phase B1 implementation incorrectly assumed `public.active_driver_offers` is a writable table. Production verification confirmed it is a **PostgreSQL VIEW** with limited column exposure.

This audit identifies the canonical offer storage table and recommends refactoring to use existing production schema instead of creating a parallel table.

---

## Schema Verification Required

### Active Driver Offers (VIEW) - Confirmed Schema

**Table Type**: PostgreSQL VIEW (read-only)

**Exposed Columns**:
```
id                (UUID)
ride_request_id   (UUID)
driver_id         (TEXT)
amount            (DECIMAL)
currency          (VARCHAR)
created_at        (TIMESTAMP)
expires_at        (TIMESTAMP)
```

**Columns NOT Exposed** (required by Phase B1):
```
status            ❌ MISSING
updated_at        ❌ MISSING
ride_id           ⚠️ NAMED ride_request_id (different)
```

### Underlying Tables (Production)

Based on production structure, two candidate offer storage tables have been identified:

#### Candidate 1: `app.offers` (Likely)

**Schema Status**: Needs verification

**Hypothesis** (based on view exposure):
```sql
CREATE TABLE app.offers (
  id UUID PRIMARY KEY,
  ride_request_id UUID NOT NULL,  -- References rides (ride_request_id style)
  driver_id TEXT NOT NULL,
  amount DECIMAL(10,2),
  currency VARCHAR(3),
  status VARCHAR(20),              -- pending, accepted, rejected, expired
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  accepted_at TIMESTAMP,
  rejected_at TIMESTAMP,
  FOREIGN KEY (ride_request_id) REFERENCES rides(id)
)
```

**Likelihood**: HIGH — View column names match this structure

---

#### Candidate 2: `app.ride_offers` (Possible Alternative)

**Schema Status**: Needs verification

**Hypothesis** (alternative naming):
```sql
CREATE TABLE app.ride_offers (
  id UUID PRIMARY KEY,
  ride_id UUID NOT NULL,            -- Possibly different FK naming
  driver_id TEXT NOT NULL,
  offer_amount DECIMAL(10,2),
  offer_currency VARCHAR(3),
  offer_status VARCHAR(20),
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  ...
  FOREIGN KEY (ride_id) REFERENCES rides(id)
)
```

**Likelihood**: MEDIUM — Alternative schema structure

---

## View Definition Analysis

### Query: What `public.active_driver_offers` VIEW Selects

The view exposes only 7 columns, suggesting it's a projection of a larger table:

```sql
-- Likely definition (inferred):
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
WHERE status IN ('pending', 'accepted')  -- Only active offers
  AND expires_at > NOW()                  -- Not expired
ORDER BY created_at DESC;
```

**Observations**:
- ✅ View filters out rejected/expired/cancelled offers
- ✅ View exposes economical columns only (amount, currency)
- ✅ View hides state management columns (status, updated_at)
- ✅ `ride_request_id` column name suggests source table uses this naming

---

## Phase B1 Schema Mismatch

### Current Implementation Assumptions

**internal/rides/handler.go** writes/reads:

```go
// Assumed columns:
INSERT INTO public.active_driver_offers (
  id,
  ride_id,          // ❌ WRONG: actual column is ride_request_id
  driver_id,
  status,           // ❌ MISSING: not exposed by view
  expires_at,
  created_at,
  updated_at        // ❌ MISSING: not exposed by view
)

// Also reads:
SELECT id, ride_id, driver_id, status, expires_at FROM public.active_driver_offers
// But actual columns are: id, ride_request_id, driver_id, amount, currency, created_at, expires_at
```

### Runtime Failure Root Cause

| Operation | Expected Table | Expected Columns | Actual Reality | Result |
|---|---|---|---|---|
| INSERT | public.active_driver_offers (table) | ride_id, status, updated_at | public.active_driver_offers (VIEW) | ❌ **INSERT fails** — views are read-only |
| SELECT | public.active_driver_offers | status, updated_at | public.active_driver_offers (VIEW) | ❌ **Columns missing** — view doesn't expose these |
| UPDATE | public.active_driver_offers | status, updated_at | public.active_driver_offers (VIEW) | ❌ **UPDATE fails** — views are read-only |

---

## Production Schema Design Pattern

### Inferred Architecture

```
┌─────────────────────────────────────────┐
│  app.offers (or app.ride_offers)        │
│  ────────────────────────────────       │
│  Canonical offer storage table          │
│  - FULL state management                │
│  - Writable (INSERT, UPDATE, DELETE)    │
│  - All columns (status, updated_at)     │
│  - Lifecycle tracking (accepted_at)     │
└──────────────┬──────────────────────────┘
               │
               │ Projects subset
               ↓
┌─────────────────────────────────────────┐
│ public.active_driver_offers (VIEW)      │
│ ────────────────────────────────────    │
│ - READ-ONLY projection                  │
│ - Filters active offers only            │
│ - Exposes economics only                │
│ - No state columns                      │
│ - For external/client consumption       │
└─────────────────────────────────────────┘
```

**Design Pattern**: This follows **View-as-API** pattern:
- Table is canonical (authoritative)
- View is facade (read-only projection)
- Application writes to table, clients read from view

---

## Required Schema Information

To proceed, the following must be verified from production:

### Table: `app.offers` (or `app.ride_offers`)

```sql
-- 1. Verify table exists:
SELECT * FROM information_schema.tables 
WHERE table_schema = 'app' AND table_name IN ('offers', 'ride_offers');

-- 2. Get exact column definitions:
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns
WHERE table_schema = 'app' AND table_name = 'offers'
ORDER BY ordinal_position;

-- 3. Get constraints:
SELECT constraint_name, constraint_type
FROM information_schema.table_constraints
WHERE table_schema = 'app' AND table_name = 'offers';

-- 4. Get indexes:
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'app' AND tablename = 'offers';
```

### Expected Findings

**Critical Questions**:

1. **Which table is canonical?** `app.offers` or `app.ride_offers`?
2. **Column naming convention**: Does it use `ride_id` or `ride_request_id`?
3. **State management**: Does it have `status`, `updated_at`, `accepted_at`, `rejected_at`?
4. **Offer lifecycle**: Are all states supported? (pending, accepted, rejected, expired, cancelled)
5. **Indexes**: What indexes exist for performance?
6. **Foreign keys**: What's the constraint structure?
7. **Current usage**: Is this table actively used by other systems?

---

## Recommended Architecture (Contingent on Schema Verification)

### Option 1: Use `app.offers` Directly (PREFERRED)

**If `app.offers` contains all required columns:**

```
Go Backend (internal/rides)
  ↓ Writes to
app.offers (canonical)
  ↓ Projects as
public.active_driver_offers (VIEW for read-only clients)
```

**Advantages**:
- ✅ No schema migration needed
- ✅ Single source of truth
- ✅ Reuses existing indexes
- ✅ Backward compatible with existing views
- ✅ Aligns with production architecture

**Implementation**: Update 9 SQL statements in handler.go:
- Change table name: `public.active_driver_offers` → `app.offers`
- Update column references: `ride_request_id` ← `ride_id` mapping

---

### Option 2: Use `app.ride_offers` (FALLBACK)

**If `app.ride_offers` is the canonical table:**

```
Go Backend (internal/rides)
  ↓ Writes to
app.ride_offers (canonical)
  ↓ Projects through
public.active_driver_offers (VIEW) OR separate view
```

**Implementation**: Similar to Option 1, but different schema name and column mappings

---

### Option 3: Hybrid - Parallel System with Sync (WORST CASE)

**If neither `app.offers` nor `app.ride_offers` exist:**

- Create `app.driver_offers` (parallel table)
- Set up dual-writes during transition period
- Requires data sync/reconciliation logic
- ❌ NOT RECOMMENDED — avoid at all costs

---

## Column Mapping Requirements

### If Using `app.offers` (Option 1)

**Required column remapping in handler.go**:

| Phase B1 Code | `app.offers` Column | Mapping Required |
|---|---|---|
| `ride_id` | `ride_request_id` | Yes — rename in queries |
| `status` | `status` | No — direct match |
| `updated_at` | `updated_at` | No — direct match |
| `id` | `id` | No — direct match |
| `driver_id` | `driver_id` | No — direct match |
| `expires_at` | `expires_at` | No — direct match |
| `created_at` | `created_at` | No — direct match |
| `amount` | `amount` | No — direct match (already in code) |
| `currency` | `currency` | No — direct match (already in code) |

**Example mapping**:
```go
// Current (wrong):
INSERT INTO public.active_driver_offers (ride_id, ...) VALUES ($1, ...)

// Corrected:
INSERT INTO app.offers (ride_request_id, ...) VALUES ($1, ...)
```

---

## Verification Checklist

**Before proceeding, verify:**

- [ ] `app.offers` or `app.ride_offers` exists in production
- [ ] Table has columns: id, ride_request_id/ride_id, driver_id, status, updated_at, accepted_at, rejected_at
- [ ] `public.active_driver_offers` VIEW is a read-only projection
- [ ] Existing system uses the table (verify with SELECT COUNT(*))
- [ ] No other backend services will conflict with our writes
- [ ] Foreign key constraints are properly defined
- [ ] Indexes exist for ride_id, driver_id, status filtering

---

## Next Documents

Based on schema verification:

1. **OFFER_MIGRATION_STRATEGY.md** — Zero-loss refactor from Phase B1 assumptions to actual schema
2. **PHASE_B1_REFACTOR_PLAN.md** — Exact code changes for handler.go (depends on schema verification)

---

## Recommendation

**Proceed with schema verification immediately.**

Do NOT deploy Phase B1 as currently designed.

Refactor to use existing production offer table (likely `app.offers`) rather than creating parallel `public.driver_offers` table.

This requires:
- 9 SQL statement updates in handler.go
- Column name remapping (ride_request_id ← ride_id)
- No database migration
- No schema changes
- Zero downtime deployment
