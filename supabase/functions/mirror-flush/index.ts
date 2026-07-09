// Drains public.mirror_outbox -> writes to the MIRROR Supabase project via PostgREST.
// Triggered by pg_cron every 30s. Idempotent, retry-safe, exponential backoff.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MIRROR_URL = Deno.env.get("MIRROR_SUPABASE_URL");
const MIRROR_KEY = Deno.env.get("MIRROR_SUPABASE_SERVICE_ROLE_KEY");

const BATCH_SIZE = 100;
const MAX_RETRIES = 8; // ~roughly 8h with backoff below before going 'dead'
const BACKOFF_SECONDS = [30, 120, 300, 900, 1800, 3600, 7200, 14400];

const db = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

type OutboxRow = {
  id: number;
  table_name: string;
  op: "INSERT" | "UPDATE" | "DELETE";
  row_pk: string;
  payload: Record<string, unknown>;
  retry_count: number;
};

async function applyOne(row: OutboxRow): Promise<{ ok: true } | { ok: false; error: string }> {
  const base = `${MIRROR_URL}/rest/v1/${encodeURIComponent(row.table_name)}`;
  const headers: Record<string, string> = {
    apikey: MIRROR_KEY!,
    Authorization: `Bearer ${MIRROR_KEY}`,
    "Content-Type": "application/json",
  };

  try {
    if (row.op === "DELETE") {
      const url = `${base}?id=eq.${encodeURIComponent(row.row_pk)}`;
      const r = await fetch(url, { method: "DELETE", headers });
      if (!r.ok && r.status !== 404) {
        return { ok: false, error: `DELETE ${r.status}: ${await r.text()}` };
      }
      return { ok: true };
    }

    // INSERT or UPDATE -> upsert with on_conflict on primary key 'id'
    const r = await fetch(`${base}?on_conflict=id`, {
      method: "POST",
      headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(row.payload),
    });
    if (!r.ok) {
      return { ok: false, error: `UPSERT ${r.status}: ${await r.text()}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `network: ${(e as Error).message}` };
  }
}

async function flush() {
  if (!MIRROR_URL || !MIRROR_KEY) {
    return { processed: 0, error: "MIRROR_SUPABASE_URL/KEY not configured" };
  }

  // Claim a batch of due rows.
  const { data: rows, error: claimErr } = await db
    .from("mirror_outbox")
    .select("id, table_name, op, row_pk, payload, retry_count")
    .eq("status", "pending")
    .lte("next_retry_at", new Date().toISOString())
    .order("id", { ascending: true })
    .limit(BATCH_SIZE);

  if (claimErr) {
    console.error("[mirror-flush] claim failed:", claimErr.message);
    return { processed: 0, error: claimErr.message };
  }
  if (!rows || rows.length === 0) return { processed: 0 };

  let ok = 0;
  let failed = 0;

  for (const row of rows as OutboxRow[]) {
    const res = await applyOne(row);
    if (res.ok) {
      await db
        .from("mirror_outbox")
        .update({ status: "done", updated_at: new Date().toISOString(), last_error: null })
        .eq("id", row.id);
      ok++;
    } else {
      const nextRetry = row.retry_count + 1;
      const dead = nextRetry >= MAX_RETRIES;
      const backoff = BACKOFF_SECONDS[Math.min(row.retry_count, BACKOFF_SECONDS.length - 1)];
      await db
        .from("mirror_outbox")
        .update({
          status: dead ? "dead" : "pending",
          retry_count: nextRetry,
          next_retry_at: new Date(Date.now() + backoff * 1000).toISOString(),
          last_error: res.error.slice(0, 2000),
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      console.error(
        `[mirror-flush] ${row.table_name}#${row.row_pk} ${row.op} attempt=${nextRetry} ${
          dead ? "DEAD" : `retry in ${backoff}s`
        } :: ${res.error}`,
      );
      failed++;
    }
  }

  console.log(`[mirror-flush] processed=${rows.length} ok=${ok} failed=${failed}`);
  return { processed: rows.length, ok, failed };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const result = await flush();
  return new Response(JSON.stringify(result), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status: 200,
  });
});
