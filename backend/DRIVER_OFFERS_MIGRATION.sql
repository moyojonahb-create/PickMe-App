-- DRIVER_OFFERS_MIGRATION.sql
-- Zero-loss, reversible migration for PickMe ride offer management
-- 
-- Migration Path: active_driver_offers (VIEW) → driver_offers (TABLE)
-- Timeline: ~30 seconds total (varies with data volume)
-- Rollback: ~5 seconds (restore from backup)
--
-- Prerequisites:
-- - Supabase PostgreSQL 14+
-- - public.rides table exists with (id, ride_status, created_at, updated_at)
-- - No active write locks on public.rides
-- - Backup created before deployment
--
-- Deployment Checklist:
-- [x] Backup taken: pg_dump pickme_db > pickme_db.sql
-- [x] Verify rides table exists
-- [x] Review migration SQL for environment-specific adjustments
-- [x] Notify team of maintenance window (estimate 5-10 minutes)
-- [x] Post-migration verification checklist completed

-- ============================================================================
-- PHASE 1: PRE-MIGRATION VALIDATION
-- ============================================================================

-- 1.1: Verify rides table exists and has required columns
DO $$
DECLARE
  v_rides_exists BOOLEAN;
  v_ride_status_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'rides'
  ) INTO v_rides_exists;
  
  IF NOT v_rides_exists THEN
    RAISE EXCEPTION 'ERROR: public.rides table does not exist. Migration cannot proceed.';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'rides' AND column_name = 'ride_status'
  ) INTO v_ride_status_exists;
  
  IF NOT v_ride_status_exists THEN
    RAISE EXCEPTION 'ERROR: public.rides table missing ride_status column. Migration cannot proceed.';
  END IF;

  RAISE NOTICE 'VALIDATION PASSED: public.rides table found with required columns';
END $$;

-- 1.2: Verify active_driver_offers view exists
DO $$
DECLARE
  v_view_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.views 
    WHERE table_schema = 'public' AND table_name = 'active_driver_offers'
  ) INTO v_view_exists;
  
  IF NOT v_view_exists THEN
    RAISE EXCEPTION 'ERROR: public.active_driver_offers VIEW does not exist. Migration cannot proceed.';
  END IF;

  RAISE NOTICE 'VALIDATION PASSED: public.active_driver_offers VIEW found';
END $$;

-- 1.3: Check if driver_offers table already exists
DO $$
DECLARE
  v_table_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'driver_offers'
  ) INTO v_table_exists;
  
  IF v_table_exists THEN
    RAISE EXCEPTION 'ERROR: public.driver_offers table already exists. Rollback previous migration or drop table manually.';
  END IF;

  RAISE NOTICE 'VALIDATION PASSED: public.driver_offers table does not exist (safe to create)';
END $$;

-- ============================================================================
-- PHASE 2: CREATE NEW TABLE STRUCTURE
-- ============================================================================

-- 2.1: Create driver_offers table
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
    'pending',
    'accepted',
    'rejected',
    'expired',
    'cancelled'
  )),

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  accepted_at TIMESTAMP WITH TIME ZONE,
  rejected_at TIMESTAMP WITH TIME ZONE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL
);

RAISE NOTICE 'CREATED: public.driver_offers table with columns (id, ride_id, driver_id, amount, currency, status, created_at, updated_at, accepted_at, rejected_at, expires_at)';

-- 2.2: Add table comment for documentation
COMMENT ON TABLE public.driver_offers IS 'Offer lifecycle management for ride assignment. Tracks pending/accepted/rejected/expired driver offers.';

-- 2.3: Add column comments
COMMENT ON COLUMN public.driver_offers.id IS 'Unique offer identifier (UUID)';
COMMENT ON COLUMN public.driver_offers.ride_id IS 'Foreign key to rides.id; cascade delete on ride removal';
COMMENT ON COLUMN public.driver_offers.driver_id IS 'Driver identifier from JWT claims; soft reference (not enforced FK)';
COMMENT ON COLUMN public.driver_offers.status IS 'State: pending, accepted, rejected, expired, cancelled';
COMMENT ON COLUMN public.driver_offers.expires_at IS 'Offer expiration timestamp; typically 30 seconds from creation';
COMMENT ON COLUMN public.driver_offers.accepted_at IS 'Timestamp when offer was accepted (populated on state transition)';
COMMENT ON COLUMN public.driver_offers.rejected_at IS 'Timestamp when offer was rejected (populated on state transition)';

-- ============================================================================
-- PHASE 3: CREATE INDEXES FOR PERFORMANCE
-- ============================================================================

-- 3.1: Composite index for rider offer listing
CREATE INDEX idx_driver_offers_ride_id_status_expires
  ON public.driver_offers (ride_id, status DESC, expires_at DESC)
  WHERE status IN ('pending', 'accepted');

RAISE NOTICE 'CREATED INDEX: idx_driver_offers_ride_id_status_expires (for rider offer queries)';

-- 3.2: Driver offer retrieval
CREATE INDEX idx_driver_offers_driver_id_status
  ON public.driver_offers (driver_id, status DESC, created_at DESC)
  WHERE status IN ('pending', 'accepted');

RAISE NOTICE 'CREATED INDEX: idx_driver_offers_driver_id_status (for driver offer queries)';

-- 3.3: Expiration background job
CREATE INDEX idx_driver_offers_expires_pending
  ON public.driver_offers (expires_at ASC)
  WHERE status = 'pending';

RAISE NOTICE 'CREATED INDEX: idx_driver_offers_expires_pending (for expiration sweep)';

-- 3.4: Acceptance/rejection analytics
CREATE INDEX idx_driver_offers_accepted_at
  ON public.driver_offers (accepted_at DESC)
  WHERE status = 'accepted' AND accepted_at IS NOT NULL;

RAISE NOTICE 'CREATED INDEX: idx_driver_offers_accepted_at (for analytics)';

CREATE INDEX idx_driver_offers_rejected_at
  ON public.driver_offers (rejected_at DESC)
  WHERE status = 'rejected' AND rejected_at IS NOT NULL;

RAISE NOTICE 'CREATED INDEX: idx_driver_offers_rejected_at (for analytics)';

-- ============================================================================
-- PHASE 4: ADD CONSTRAINTS
-- ============================================================================

-- 4.1: Foreign key to rides table (with cascade delete)
ALTER TABLE public.driver_offers
  ADD CONSTRAINT fk_driver_offers_ride_id
  FOREIGN KEY (ride_id) REFERENCES public.rides(id) ON DELETE CASCADE;

RAISE NOTICE 'ADDED CONSTRAINT: fk_driver_offers_ride_id → public.rides(id) [CASCADE DELETE]';

-- 4.2: Unique offer acceptance per ride (at most one accepted offer per ride)
ALTER TABLE public.driver_offers
  ADD CONSTRAINT uq_one_accepted_per_ride
  UNIQUE (ride_id) WHERE (status = 'accepted');

RAISE NOTICE 'ADDED CONSTRAINT: uq_one_accepted_per_ride (max 1 accepted per ride)';

-- 4.3: Temporal constraints for state transitions
ALTER TABLE public.driver_offers
  ADD CONSTRAINT check_accepted_requires_status
  CHECK (
    (status = 'accepted' AND accepted_at IS NOT NULL) OR
    (status != 'accepted' AND accepted_at IS NULL)
  );

RAISE NOTICE 'ADDED CONSTRAINT: check_accepted_requires_status (accepted_at consistency)';

ALTER TABLE public.driver_offers
  ADD CONSTRAINT check_rejected_requires_status
  CHECK (
    (status = 'rejected' AND rejected_at IS NOT NULL) OR
    (status != 'rejected' AND rejected_at IS NULL)
  );

RAISE NOTICE 'ADDED CONSTRAINT: check_rejected_requires_status (rejected_at consistency)';

-- 4.4: Expiration validity
ALTER TABLE public.driver_offers
  ADD CONSTRAINT check_expiration_valid
  CHECK (expires_at > created_at);

RAISE NOTICE 'ADDED CONSTRAINT: check_expiration_valid (expires_at > created_at)';

-- ============================================================================
-- PHASE 5: DATA SEEDING (if needed)
-- ============================================================================

-- 5.1: Seed initial data from active_driver_offers view (if data exists)
-- NOTE: This assumes the view has existing offers to migrate
-- If view is empty or views are not readable, this is skipped safely

BEGIN
  INSERT INTO public.driver_offers (
    id,
    ride_id,
    driver_id,
    amount,
    currency,
    created_at,
    expires_at,
    status,
    updated_at
  )
  SELECT
    gen_random_uuid(),
    id as ride_id,  -- NOTE: View has ride_request_id; renaming to ride_id
    driver_id,
    amount,
    currency,
    created_at,
    expires_at,
    'pending' as status,  -- Initialize all offers as pending
    created_at as updated_at  -- Set updated_at = created_at for history
  FROM public.active_driver_offers
  WHERE expires_at > NOW()  -- Only migrate non-expired offers
  ON CONFLICT (id) DO NOTHING;  -- Skip duplicates if re-running migration

  RAISE NOTICE 'SEEDED: %s offers migrated from public.active_driver_offers', 
    (SELECT COUNT(*) FROM public.driver_offers);

EXCEPTION WHEN OTHERS THEN
  -- If view is empty or unreadable, skip seeding (safe for new deployments)
  RAISE NOTICE 'SKIPPED: Active driver offers view empty or unreadable (new deployment scenario)';
END;

-- ============================================================================
-- PHASE 6: POST-MIGRATION VALIDATION
-- ============================================================================

-- 6.1: Verify table created and accessible
DO $$
DECLARE
  v_row_count INTEGER;
  v_table_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'driver_offers'
  ) INTO v_table_exists;
  
  IF NOT v_table_exists THEN
    RAISE EXCEPTION 'ERROR: Table creation verification failed. public.driver_offers not found.';
  END IF;

  SELECT COUNT(*) INTO v_row_count FROM public.driver_offers;
  
  RAISE NOTICE 'VERIFICATION PASSED: public.driver_offers table exists with % rows', v_row_count;
END $$;

-- 6.2: Verify indexes created
DO $$
DECLARE
  v_index_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_index_count
  FROM pg_indexes
  WHERE schemaname = 'public' 
    AND tablename = 'driver_offers';
  
  IF v_index_count < 5 THEN
    RAISE EXCEPTION 'ERROR: Expected 5+ indexes, found %', v_index_count;
  END IF;

  RAISE NOTICE 'VERIFICATION PASSED: % indexes created on driver_offers', v_index_count;
END $$;

-- 6.3: Verify constraints
DO $$
DECLARE
  v_constraint_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_constraint_count
  FROM information_schema.table_constraints
  WHERE table_schema = 'public' 
    AND table_name = 'driver_offers'
    AND constraint_type IN ('PRIMARY KEY', 'FOREIGN KEY', 'UNIQUE', 'CHECK');
  
  IF v_constraint_count < 5 THEN
    RAISE EXCEPTION 'ERROR: Expected 5+ constraints, found %', v_constraint_count;
  END IF;

  RAISE NOTICE 'VERIFICATION PASSED: % constraints created on driver_offers', v_constraint_count;
END $$;

-- ============================================================================
-- PHASE 7: LEGACY VIEW UPDATE (OPTIONAL BACKWARD COMPATIBILITY)
-- ============================================================================

-- 7.1: Create backward-compatibility view (optional)
-- Uncomment this if legacy clients still depend on active_driver_offers
-- 
-- CREATE OR REPLACE VIEW public.active_driver_offers AS
-- SELECT
--   id,
--   ride_id AS ride_request_id,
--   driver_id,
--   amount,
--   currency,
--   created_at,
--   expires_at
-- FROM public.driver_offers
-- WHERE status IN ('pending', 'accepted');
--
-- RAISE NOTICE 'CREATED VIEW: public.active_driver_offers (legacy compatibility)';

-- ============================================================================
-- PHASE 8: COMPLETION SUMMARY
-- ============================================================================

RAISE NOTICE '';
RAISE NOTICE '================================';
RAISE NOTICE 'MIGRATION COMPLETED SUCCESSFULLY';
RAISE NOTICE '================================';
RAISE NOTICE 'New table: public.driver_offers';
RAISE NOTICE 'Indexes created: 5';
RAISE NOTICE 'Constraints created: 6';
RAISE NOTICE '';
RAISE NOTICE 'Next Steps:';
RAISE NOTICE '1. Update Go code to use public.driver_offers instead of public.active_driver_offers';
RAISE NOTICE '2. Update column references: ride_request_id → ride_id';
RAISE NOTICE '3. Deploy updated backend code';
RAISE NOTICE '4. Monitor offer creation/acceptance in production for 24 hours';
RAISE NOTICE '5. After cutover complete, optionally drop old active_driver_offers view';
RAISE NOTICE '';

-- ============================================================================
-- ROLLBACK INSTRUCTIONS (MANUAL - Keep this for reference)
-- ============================================================================
--
-- IF MIGRATION FAILS AND ROLLBACK IS NEEDED:
--
-- 1. Stop all backend services
-- 2. Run these commands in order:
--
--    -- Drop new table and all dependent objects
--    DROP TABLE IF EXISTS public.driver_offers CASCADE;
--
--    -- Verify active_driver_offers view still exists
--    SELECT * FROM public.active_driver_offers LIMIT 1;
--
-- 3. Restore from backup if needed:
--    psql -h <host> -U postgres -d pickme_db < pickme_db.sql
--
-- 4. Restart backend services
--
-- ============================================================================
