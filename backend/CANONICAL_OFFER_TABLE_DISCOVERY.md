# Canonical Offer Table Discovery

Status: PREPARATION — SQL queries below must be executed against production Supabase database. Do NOT run these queries in development unless pointed at production replicas.

Objective: Determine which table is the authoritative canonical offer storage used by production among:

- `app.offers`
- `app.driver_offers`
- `app.ride_offers`

Deliverables:
- SQL queries to retrieve columns, types, constraints, indexes, foreign keys, and row counts for each table.
- SQL queries to inspect `public.active_driver_offers` view definition, triggers, and any `INSTEAD OF` triggers.
- A comparison matrix template to be filled with results from production.
- Final recommendation will be made after the queries are executed and results provided.

---

IMPORTANT: These queries are read-only except where noted (test INSERT is a harmless BEGIN/ROLLBACK block to verify write access). Use your app service account to run them.

Pre-flight checklist before running queries:
- Connect to Supabase with a user that has `SELECT` privileges on `information_schema` and `pg_catalog`, and `USAGE` on schemas `public` and `app`.
- If you have an admin session, prefer it for completeness.
- Run the queries in the order given to gather context.

---

## 1) Inspect the view: `public.active_driver_offers`

-- 1A: Get view definition (pg_catalog)
```sql
SELECT
  nspname AS view_schema,
  relname AS view_name,
  pg_get_viewdef(c.oid, true) AS view_definition
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'v'
  AND nspname = 'public'
  AND relname = 'active_driver_offers';
```

-- 1B: Get dependent objects (what tables the view selects from)
```sql
SELECT DISTINCT
  source_ns.nspname AS source_schema,
  source_rel.relname AS source_table
FROM pg_rewrite r
JOIN pg_depend d ON d.objid = r.oid
JOIN pg_class c_view ON c_view.oid = r.ev_class
JOIN pg_attribute a ON a.attrelid = COALESCE(r.ev_class, r.ev_class)
LEFT JOIN pg_class source_rel ON source_rel.oid = r.ev_class
LEFT JOIN pg_namespace source_ns ON source_rel.relnamespace = source_ns.oid
WHERE c_view.relname = 'active_driver_offers'
  AND source_ns.nspname IS NOT NULL;
```

-- 1C: Inspect view dependencies via `pg_catalog.pg_depend` and `pg_rewrite`
```sql
SELECT
  refobjid::regclass AS referenced_object,
  dep.refclassid::regclass AS ref_rel
FROM pg_rewrite rw
JOIN pg_depend dep ON dep.objid = rw.oid
JOIN pg_class c ON c.oid = rw.ev_class
WHERE c.relname = 'active_driver_offers' AND c.relnamespace = 'public'::regnamespace;
```

-- 1D: Check for INSTEAD OF triggers on the view
```sql
SELECT tg.tgname AS trigger_name,
       pg_get_triggerdef(tg.oid) AS trigger_def
FROM pg_trigger tg
JOIN pg_class c ON tg.tgrelid = c.oid
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE c.relname = 'active_driver_offers'
  AND n.nspname = 'public'
  AND tg.tgisinternal = false;
```

-- 1E: If application is misconfigured to create rules (older style), list rules
```sql
SELECT *
FROM pg_rules
WHERE schemaname = 'public'
  AND tablename = 'active_driver_offers';
```

---

## 2) Inspect candidate tables: `app.offers`, `app.driver_offers`, `app.ride_offers`

For each table run the following set of queries. Replace `<table_schema>` and `<table_name>` accordingly.

-- 2A: Does table exist?
```sql
SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_schema = 'app' AND table_name IN ('offers','driver_offers','ride_offers');
```

-- 2B: Column list and types
```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'app' AND table_name = '<table_name>'
ORDER BY ordinal_position;
```

-- 2C: Constraints (primary key, unique, check, foreign key references)
```sql
SELECT con.conname AS constraint_name,
       con.contype AS constraint_type,
       pg_get_constraintdef(con.oid) AS constraint_definition
FROM pg_constraint con
JOIN pg_namespace n ON n.oid = con.connamespace
WHERE con.conrelid = 'app.<table_name>'::regclass;
```

-- 2D: Indexes (including partial and expressions)
```sql
SELECT
  idx.indrelid::regclass AS table_name,
  i.relname AS index_name,
  pg_get_indexdef(idx.indexrelid) AS index_def
FROM pg_index idx
JOIN pg_class i ON i.oid = idx.indexrelid
WHERE idx.indrelid = 'app.<table_name>'::regclass;
```

-- 2E: Foreign key details (referenced table/columns)
```sql
SELECT
  tc.constraint_name,
  kcu.column_name,
  ccu.table_schema AS foreign_table_schema,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'app'
  AND tc.table_name = '<table_name>';
```

-- 2F: Row count (fast approximate and exact)
```sql
-- Exact count (can be slow on huge tables):
SELECT COUNT(*) FROM app.<table_name>;

-- Approximate using pg_class reltuples:
SELECT reltuples AS approximate_row_count
FROM pg_class
WHERE oid = 'app.<table_name>'::regclass;
```

-- 2G: Sample data (top 10 rows) to inspect columns like `status`, `accepted_at`, `rejected_at`, `ride_request_id`
```sql
SELECT * FROM app.<table_name> ORDER BY created_at DESC LIMIT 10;
```

---

## 3) Cross-check: Does view `public.active_driver_offers` reference one of these tables?

If 1A returns a view definition, visually inspect the SQL and look for references to `app.offers`, `app.driver_offers`, or `app.ride_offers`.

Also run:

```sql
-- Find dependency objects for the view's definition
SELECT DISTINCT referenced_table FROM (
  SELECT regexp_split_to_table(pg_get_viewdef(c.oid, true), E'\n') AS line
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relname = 'active_driver_offers' AND n.nspname = 'public'
) s WHERE line ~ 'app\.';
```

---

## 4) Check for INSTEAD OF triggers and rules (again, precise)

```sql
-- Triggers on view
SELECT tg.tgname, pg_get_triggerdef(tg.oid)
FROM pg_trigger tg
JOIN pg_class c ON tg.tgrelid = c.oid
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE c.relname = 'active_driver_offers'
  AND n.nspname = 'public';

-- Rules for view (legacy)
SELECT * FROM pg_rules WHERE schemaname = 'public' AND tablename = 'active_driver_offers';
```

If INSTEAD OF triggers exist, extract their function names and body:
```sql
SELECT
  tg.tgname,
  p.proname AS function_name,
  pg_get_functiondef(p.oid) AS function_def
FROM pg_trigger tg
JOIN pg_proc p ON p.oid = tg.tgfoid
JOIN pg_class c ON tg.tgrelid = c.oid
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE c.relname = 'active_driver_offers' AND n.nspname = 'public';
```

---

## 5) Build Comparison Matrix (fill after running queries)

| Table | Writable | Status Column | Ride FK Column | Accepted Timestamp | Rejected Timestamp | Row Count | Recommendation |
|---|---:|---|---|---|---|---:|---|
| app.offers | | | | | | | |
| app.driver_offers | | | | | | | |
| app.ride_offers | | | | | | | |


Notes on filling:
- Writable: `YES` if an INSERT test (BEGIN; INSERT ...; ROLLBACK;) succeeds without permission errors.
- Status Column: name of column storing offer state (e.g., `status`); include comments if it's encoded differently (integer, text, enum)
- Ride FK Column: name of column referencing rides table (e.g., `ride_request_id`)
- Accepted/Rejected Timestamps: column names for acceptance/rejection times
- Row Count: use exact count if small; approximate if table is large

---

## 6) Decide Canonical Table

After executing queries, determine which table meets these criteria:

1. Writable by backend service account
2. Contains `status` column representing offer lifecycle (pending, accepted, rejected, expired)
3. Has `ride_request_id` or equivalent FK to `rides` table
4. Has `accepted_at`/`rejected_at` timestamps or equivalent
5. Is referenced by `public.active_driver_offers` view (view may be a projection)
6. Has production row counts consistent with active view (view count <= table count)

Choose the single best table and record justification with evidence (query outputs). Put the final selection in `Recommendation` column.

---

## 7) Example Queries to run now (copy/paste ready)

-- Inspect view definition
```sql
SELECT pg_get_viewdef('public.active_driver_offers'::regclass, true);
```

-- Check dependencies
```sql
SELECT text FROM pg_views WHERE schemaname = 'public' AND viewname = 'active_driver_offers';
```

-- Quick check rows in view
```sql
SELECT COUNT(*) FROM public.active_driver_offers;
SELECT * FROM public.active_driver_offers LIMIT 5;
```

-- Quick checks for each candidate table
```sql
SELECT COUNT(*) FROM app.offers;
SELECT COUNT(*) FROM app.driver_offers;
SELECT COUNT(*) FROM app.ride_offers;
```

---

## 8) Security and Permissions

- Avoid running any destructive statements in production. All queries provided are read-only except the write-test which is wrapped in a transaction and rolled back.
- Log outputs and audit trail should be preserved.

---

## 9) Next Steps After You Run Queries

1. Paste outputs or grant me read access to query the database (if you want me to run them).
2. I will populate the comparison matrix with evidence and make a single canonical table recommendation.

---

Prepared by: Principal Database Architect (assistant)
