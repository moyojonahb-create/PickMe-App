-- 4A driver profile: the Documents row needs to know whether any document
-- is nearing expiry to decide its red/neutral styling. No expiry concept
-- existed anywhere before this — column starts NULL for every existing row
-- (no fabricated dates) and is populated as real expiry dates are captured
-- going forward.
ALTER TABLE public.driver_documents
  ADD COLUMN IF NOT EXISTS expiry_date date;
