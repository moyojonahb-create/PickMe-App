# Driver Offers Schema Design

## Table Definition: `public.driver_offers`

This is the production schema for the offer lifecycle management system.

### Core Table

```sql
CREATE TABLE public.driver_offers (
  -- Primary Key
  id UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Foreign Keys
  ride_id UUID NOT NULL,
  driver_id TEXT NOT NULL,

  -- Offer Economics
  amount DECIMAL(10, 2) NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',

  -- State Management
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',       -- Offer created, awaiting rider decision
    'accepted',      -- Rider accepted this offer, driver assigned
    'rejected',      -- Driver withdrew offer
    'expired',       -- Offer TTL expired without rider action
    'cancelled'      -- Offer cancelled by system (e.g., ride completed)
  )),

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  accepted_at TIMESTAMP WITH TIME ZONE,
  rejected_at TIMESTAMP WITH TIME ZONE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,

  -- Constraint: Ensure only one offer is accepted per ride
  UNIQUE (ride_id) WHERE status = 'accepted'
);
```

---

## Indexes

### Primary Indexes for Write Operations

```sql
-- Index 1: Offer submission + rider listing
-- Pattern: Rider queries: SELECT * FROM driver_offers WHERE ride_id = ? AND status = 'pending'
CREATE INDEX idx_driver_offers_ride_id_status_expires
  ON public.driver_offers (ride_id, status DESC, expires_at DESC)
  WHERE status IN ('pending', 'accepted')
  INCLUDE (driver_id, amount, currency);

-- Index 2: Driver offer retrieval
-- Pattern: Driver checks their active offers
CREATE INDEX idx_driver_offers_driver_id_status
  ON public.driver_offers (driver_id, status DESC, created_at DESC)
  WHERE status IN ('pending', 'accepted');

-- Index 3: Expiration background job
-- Pattern: SELECT * FROM driver_offers WHERE status = 'pending' AND expires_at < NOW()
CREATE INDEX idx_driver_offers_expires_pending
  ON public.driver_offers (expires_at ASC)
  WHERE status = 'pending'
  INCLUDE (id, ride_id, driver_id);

-- Index 4: Offer lookup by ID (acceptance workflow)
-- Pattern: SELECT * FROM driver_offers WHERE id = ? FOR UPDATE
CREATE UNIQUE INDEX idx_driver_offers_id
  ON public.driver_offers (id);
```

### Secondary Indexes for Analytics

```sql
-- Index 5: Acceptance tracking
-- Pattern: Analytics: acceptance_rate = COUNT(*) WHERE status = 'accepted'
CREATE INDEX idx_driver_offers_accepted_at
  ON public.driver_offers (accepted_at)
  WHERE status = 'accepted' AND accepted_at IS NOT NULL;

-- Index 6: Rejection analysis
CREATE INDEX idx_driver_offers_rejected_at
  ON public.driver_offers (rejected_at)
  WHERE status = 'rejected' AND rejected_at IS NOT NULL;
```

---

## Foreign Key Constraints

```sql
-- Constraint: Offer must reference existing ride
ALTER TABLE public.driver_offers
  ADD CONSTRAINT fk_driver_offers_ride_id
  FOREIGN KEY (ride_id) REFERENCES public.rides(id) ON DELETE CASCADE;
```

**Note**: `driver_id` is intentionally not a foreign key to allow offers from drivers not yet in the `drivers` table (soft registration support).

---

## Column Specifications

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| id | UUID | NO | gen_random_uuid() | Unique offer identifier |
| ride_id | UUID | NO | — | References rides.id; cascade delete |
| driver_id | TEXT | NO | — | Driver identifier (from JWT); soft FK |
| amount | DECIMAL(10,2) | NO | — | Offered amount in specified currency; 2 decimal places |
| currency | VARCHAR(3) | NO | 'USD' | ISO 4217 currency code |
| status | VARCHAR(20) | NO | 'pending' | Lifecycle state; enforced by CHECK constraint |
| created_at | TIMESTAMP TZ | NO | NOW() | Offer creation time |
| updated_at | TIMESTAMP TZ | NO | NOW() | Last status transition time |
| accepted_at | TIMESTAMP TZ | YES | NULL | When offer was accepted (populated on accept) |
| rejected_at | TIMESTAMP TZ | YES | NULL | When offer was rejected (populated on reject) |
| expires_at | TIMESTAMP TZ | NO | — | Offer expiration deadline; typically +30s from creation |

---

## Constraints

### CHECK Constraints

```sql
-- Offer state validity
ALTER TABLE public.driver_offers
  ADD CONSTRAINT check_status_valid
  CHECK (status IN ('pending', 'accepted', 'rejected', 'expired', 'cancelled'));

-- Temporal logic: accepted_at is only set when accepted
ALTER TABLE public.driver_offers
  ADD CONSTRAINT check_accepted_requires_status
  CHECK (
    (status = 'accepted' AND accepted_at IS NOT NULL) OR
    (status != 'accepted' AND accepted_at IS NULL)
  );

-- Temporal logic: rejected_at is only set when rejected
ALTER TABLE public.driver_offers
  ADD CONSTRAINT check_rejected_requires_status
  CHECK (
    (status = 'rejected' AND rejected_at IS NOT NULL) OR
    (status != 'rejected' AND rejected_at IS NULL)
  );

-- Offer must be valid (expires_at > created_at)
ALTER TABLE public.driver_offers
  ADD CONSTRAINT check_expiration_valid
  CHECK (expires_at > created_at);

-- Only one offer can be accepted per ride
ALTER TABLE public.driver_offers
  ADD CONSTRAINT uq_one_accepted_per_ride
  UNIQUE (ride_id) WHERE (status = 'accepted');
```

---

## Concurrency & Race Condition Safety

### Acceptance Transaction Pattern

The backend will use this transaction pattern to prevent race conditions:

```sql
BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;

  -- 1. Lock offer for read + write
  SELECT id, status, expires_at FROM public.driver_offers
  WHERE id = $1 FOR UPDATE;

  -- 2. Validate offer state
  -- Application: check status = 'pending' AND expires_at > NOW()

  -- 3. Claim ride (atomic state transition)
  UPDATE public.rides
  SET driver_id = $2, ride_status = 'accepted'
  WHERE id = $3 AND ride_status = 'requested';

  -- 4. Mark offer as accepted
  UPDATE public.driver_offers
  SET status = 'accepted', accepted_at = NOW(), updated_at = NOW()
  WHERE id = $1 AND status = 'pending';

  -- 5. Expire other pending offers
  UPDATE public.driver_offers
  SET status = 'expired', updated_at = NOW()
  WHERE ride_id = $3 AND status = 'pending' AND id != $1;

COMMIT;
```

**Serialization Level**: `SERIALIZABLE` ensures that concurrent acceptance attempts on the same ride will serialize, preventing both from succeeding.

---

## State Transitions

### Valid State Machine

```
pending → accepted     (rider accepts)
pending → rejected     (driver rejects)
pending → expired      (TTL exceeded)
pending → cancelled    (ride completed/cancelled before decision)

accepted → (terminal)
rejected → (terminal)
expired → (terminal)
cancelled → (terminal)
```

### Terminal States

Once an offer reaches `accepted`, `rejected`, `expired`, or `cancelled`, no further transitions are allowed.

---

## Performance Characteristics

### Write Patterns

| Operation | Table | Index | Expected Performance |
|-----------|-------|-------|----------------------|
| Create offer | INSERT | btree(id) | O(1) — append |
| Accept offer | UPDATE + UPDATE | btree(id) + idx_ride_id_status | O(log n) — indexed lookup + filter |
| Reject offer | UPDATE | btree(driver_id, status) | O(log n) — indexed lookup |
| Expire offers | UPDATE | idx_expires_pending | O(k) — k = offers to expire |

### Read Patterns

| Operation | Table | Index | Expected Performance |
|-----------|-------|-------|----------------------|
| Rider views pending offers | SELECT | idx_ride_id_status_expires | O(log n + m) — n = total offers, m = pending for ride |
| Driver checks offers | SELECT | idx_driver_id_status | O(log n + m) — n = total offers, m = driver's offers |
| Find expired offers | SELECT | idx_expires_pending | O(log n + k) — k = expired count |

---

## Scalability Considerations

### Horizontal Partitioning

Once offer volume exceeds 10M/month, partition by `ride_id`:

```sql
CREATE TABLE public.driver_offers_partition_0 PARTITION OF public.driver_offers
  FOR VALUES WITH (MODULUS 16, REMAINDER 0);

CREATE TABLE public.driver_offers_partition_1 PARTITION OF public.driver_offers
  FOR VALUES WITH (MODULUS 16, REMAINDER 1);

-- ... 14 more partitions
```

This enables:
- Parallel scans across partitions
- Independent index management
- Separate replication for each partition shard

### Time-based Partitioning (Archival)

After 30 days, archive old offers:

```sql
-- Annual partition
CREATE TABLE public.driver_offers_2026_q2 PARTITION OF public.driver_offers
  FOR VALUES FROM ('2026-04-01') TO ('2026-07-01');
```

Move to cold storage after 12 months (AWS Glacier/Archive).

---

## Backward Compatibility

### Column Mapping: Old View → New Table

| Old View (active_driver_offers) | New Table (driver_offers) | Mapping Strategy |
|---|---|---|
| id | id | Direct |
| ride_request_id | ride_id | Rename (code must handle) |
| driver_id | driver_id | Direct |
| amount | amount | Direct |
| currency | currency | Direct |
| created_at | created_at | Direct |
| expires_at | expires_at | Direct |
| — | status | New column (default 'pending' for hydration) |
| — | updated_at | New column (default created_at for hydration) |

### View Compatibility Layer (Optional)

After migration, optionally create a view for legacy consumers:

```sql
CREATE OR REPLACE VIEW public.active_driver_offers AS
SELECT
  id,
  ride_id AS ride_request_id,
  driver_id,
  amount,
  currency,
  created_at,
  expires_at
FROM public.driver_offers
WHERE status IN ('pending', 'accepted');
```

This allows gradual API migration without breaking existing clients.

---

## Next Steps

See `DRIVER_OFFERS_MIGRATION.sql` for the complete migration strategy.
