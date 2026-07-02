import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function legacyAllowed(flagName: string): boolean {
  if (Deno.env.get(flagName) !== "true") return false;
  const appEnv = (Deno.env.get("APP_ENV") ?? "").toLowerCase();
  if (appEnv === "production" && Deno.env.get("LEGACY_EMERGENCY_OVERRIDE_ENABLED") !== "true") {
    return false;
  }
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (!legacyAllowed("LEGACY_DISPATCH_SCHEDULED_ENABLED")) {
    return new Response(
      JSON.stringify({ error: "dispatch-scheduled is retired; scheduled dispatch must run in Go" }),
      { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Dispatch scheduled rides that are due
    const { data: dispatchCount, error: dispatchErr } = await supabase
      .rpc("dispatch_scheduled_rides");

    if (dispatchErr) {
      console.error("Dispatch error:", dispatchErr);
    }

    // Also expire old pending rides (reuse existing function)
    const { data: expiredCount, error: expireErr } = await supabase
      .rpc("expire_old_rides");

    if (expireErr) {
      console.error("Expire error:", expireErr);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        dispatched: dispatchCount ?? 0,
        expired: expiredCount ?? 0,
        timestamp: new Date().toISOString(),
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("Scheduled dispatch error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
