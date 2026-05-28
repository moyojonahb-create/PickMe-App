-- Required extensions for scheduling + HTTP from the DB
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- =========================================================
-- mirror_outbox: write-behind queue for cross-project sync
-- =========================================================
CREATE TABLE IF NOT EXISTS public.mirror_outbox (
  id           bigserial PRIMARY KEY,
  table_name   text        NOT NULL,
  op           text        NOT NULL CHECK (op IN ('INSERT','UPDATE','DELETE')),
  row_pk       text        NOT NULL,
  payload      jsonb       NOT NULL,
  status       text        NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','done','failed','dead')),
  retry_count  int         NOT NULL DEFAULT 0,
  next_retry_at timestamptz NOT NULL DEFAULT now(),
  last_error   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mirror_outbox_pending
  ON public.mirror_outbox (status, next_retry_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_mirror_outbox_table
  ON public.mirror_outbox (table_name, created_at DESC);

-- Internal-only: never expose to anon/authenticated.
REVOKE ALL ON public.mirror_outbox FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.mirror_outbox TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.mirror_outbox_id_seq TO service_role;

ALTER TABLE public.mirror_outbox ENABLE ROW LEVEL SECURITY;
-- No policies = deny-by-default for everyone except service_role (which bypasses RLS).

-- =========================================================
-- Generic enqueue trigger function
-- Non-blocking: just inserts a row. If the insert ever fails
-- we still let the original write succeed (EXCEPTION swallow).
-- =========================================================
CREATE OR REPLACE FUNCTION public.enqueue_mirror()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pk      text;
  v_payload jsonb;
BEGIN
  BEGIN
    IF TG_OP = 'DELETE' THEN
      v_pk      := COALESCE((to_jsonb(OLD)->>'id'), '');
      v_payload := to_jsonb(OLD);
    ELSE
      v_pk      := COALESCE((to_jsonb(NEW)->>'id'), '');
      v_payload := to_jsonb(NEW);
    END IF;

    INSERT INTO public.mirror_outbox (table_name, op, row_pk, payload)
    VALUES (TG_TABLE_NAME, TG_OP, v_pk, v_payload);
  EXCEPTION WHEN OTHERS THEN
    -- Never block the originating write because mirroring failed.
    RAISE WARNING 'enqueue_mirror failed for %.%: %', TG_TABLE_SCHEMA, TG_TABLE_NAME, SQLERRM;
  END;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_mirror() FROM PUBLIC, anon, authenticated;

-- =========================================================
-- Attach triggers to the starter table set
-- =========================================================
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'rides','profiles','drivers','wallets',
    'driver_wallets','wallet_transactions','admin_earnings','driver_ratings'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    -- Skip if table doesn't exist in this DB
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema='public' AND table_name=t
    ) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_mirror_%1$s ON public.%1$I;', t);
      EXECUTE format(
        'CREATE TRIGGER trg_mirror_%1$s
           AFTER INSERT OR UPDATE OR DELETE ON public.%1$I
           FOR EACH ROW EXECUTE FUNCTION public.enqueue_mirror();',
        t
      );
    END IF;
  END LOOP;
END $$;
