# Mirror Sync Runbook

Live write-behind mirror of selected Lovable Cloud tables → secondary Supabase project (`foksbnjtzubsjpeoorvo`).

## Architecture

```
Lovable Cloud write
   → AFTER INSERT/UPDATE/DELETE trigger (enqueue_mirror)
   → row appended to public.mirror_outbox  (non-blocking)

pg_cron every 30s
   → invokes edge function `mirror-flush`
   → claims batch of due rows (status='pending', next_retry_at <= now())
   → UPSERTs / DELETEs against mirror PostgREST using service-role key
   → marks row 'done' OR re-queues with exponential backoff
   → after 8 failed attempts → status='dead' (needs human review)
```

Exponential backoff schedule (seconds): `30, 120, 300, 900, 1800, 3600, 7200, 14400`.

## Tables currently mirrored

`rides`, `profiles`, `drivers`, `wallets`, `driver_wallets`, `wallet_transactions`, `admin_earnings`, `driver_ratings`.

Add another table later:

```sql
CREATE TRIGGER trg_mirror_<table>
  AFTER INSERT OR UPDATE OR DELETE ON public.<table>
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_mirror();
```

## What is NOT mirrored

- `auth.users` — Supabase Auth state lives per-project. The mirror DB will contain `user_id` UUIDs that do not match any real auth user on its side.
- Storage objects (driver docs, deposit proofs, avatars, luggage photos) — files stay only on Lovable Cloud.
- RLS policies, triggers, cron jobs, secrets, edge functions on the mirror side — those are project-local.

---

## ONE-TIME BOOTSTRAP (do this before enabling the cron schedule)

The mirror project must already have **identical table schemas**, or every flush attempt will 404.

### Step 1 — create schema on the mirror

In the Supabase SQL editor of `foksbnjtzubsjpeoorvo`, run, in order, every file in this repo's `supabase/migrations/` directory **up to but excluding** the mirror migration itself. Easiest way:

```bash
ls supabase/migrations/*.sql | sort | grep -v mirror
```

Paste each file's contents into the SQL editor. (Or use `supabase db push` against the mirror with its own connection string.)

> The mirror does NOT need RLS — only the service-role key writes to it. You may still copy the policies for parity, but they will not be exercised.

### Step 2 — backfill existing rows (one-time)

For each mirrored table, copy the current rows. Easiest path: in the **Lovable Cloud** SQL editor, export each table to CSV; in the **mirror** SQL editor, import the CSV. Or use the `pg_dump`/`pg_restore` pair if you have direct DB URLs:

```bash
pg_dump "$LOVABLE_CLOUD_DB_URL" \
  --data-only --no-owner --no-acl \
  -t public.rides -t public.profiles -t public.drivers \
  -t public.wallets -t public.driver_wallets -t public.wallet_transactions \
  -t public.admin_earnings -t public.driver_ratings \
  | psql "$MIRROR_DB_URL"
```

### Step 3 — schedule the cron job

Run this **in the Lovable Cloud SQL editor** (not via migration tool — it contains environment-specific values):

```sql
SELECT cron.schedule(
  'mirror-flush-every-30s',
  '30 seconds',
  $$
  SELECT net.http_post(
    url     := 'https://jidfganntquilvsytslp.supabase.co/functions/v1/mirror-flush',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImppZGZnYW5udHF1aWx2c3l0c2xwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkzNDM5MDIsImV4cCI6MjA4NDkxOTkwMn0.clwzOYffNy78E9kN2UnXVSHlWfTm3cMbZu3WtwCT3UM'
    ),
    body    := '{}'::jsonb
  );
  $$
);
```

To unschedule:

```sql
SELECT cron.unschedule('mirror-flush-every-30s');
```

---

## Operations

### Check queue health

```sql
SELECT status, COUNT(*) FROM public.mirror_outbox GROUP BY status;
```

### Recent failures

```sql
SELECT id, table_name, op, row_pk, retry_count, last_error, next_retry_at
FROM public.mirror_outbox
WHERE status IN ('failed','dead') OR retry_count > 0
ORDER BY updated_at DESC
LIMIT 50;
```

### Manually re-queue a dead row

```sql
UPDATE public.mirror_outbox
SET status='pending', retry_count=0, next_retry_at=now(), last_error=NULL
WHERE id = <ID>;
```

### Force a flush right now (without waiting for cron)

```bash
curl -X POST https://jidfganntquilvsytslp.supabase.co/functions/v1/mirror-flush \
  -H "Authorization: Bearer <ANON_KEY>"
```

### Edge function logs

In Lovable Cloud → Functions → `mirror-flush` → Logs. Lines start with `[mirror-flush]`.

### Pause sync (keep capturing, stop shipping)

```sql
SELECT cron.unschedule('mirror-flush-every-30s');
```

The outbox keeps accumulating; resume by re-running the `cron.schedule(...)` block above.

### Stop sync entirely (drop triggers)

```sql
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['rides','profiles','drivers','wallets',
                           'driver_wallets','wallet_transactions',
                           'admin_earnings','driver_ratings']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_mirror_%1$s ON public.%1$I;', t);
  END LOOP;
END $$;
```

---

## Known limitations

1. **Schema drift will silently break sync.** Every column added on Lovable Cloud must be added on the mirror first, or upserts will fail with `PGRST204`.
2. **No ordering guarantee across tables.** A `wallet_transactions` row referencing a not-yet-mirrored `wallet` will fail FK and retry until the wallet row catches up. Tune by adding FK targets to the mirrored set.
3. **`auth.uid()` is meaningless on the mirror.** Don't run business logic there — read-only / BI only.
4. **Outbox grows.** Add a janitor:
   ```sql
   DELETE FROM public.mirror_outbox
   WHERE status='done' AND updated_at < now() - interval '7 days';
   ```
5. **Service-role key in this project has god-mode access to the mirror DB.** Treat `MIRROR_SUPABASE_SERVICE_ROLE_KEY` like a crown-jewel secret; rotate immediately if this app's backend is ever compromised.
