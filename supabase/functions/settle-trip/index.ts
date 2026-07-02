import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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
    return new Response(null, { headers: corsHeaders });
  }

  if (!legacyAllowed("LEGACY_SETTLE_TRIP_ENABLED")) {
    return new Response(JSON.stringify({ error: "settle-trip is retired; use Go /api/rides/:rideId/settle" }), {
      status: 410,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // Authenticate caller
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } = await anonClient.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = claimsData.claims.sub;

    const { tripId } = await req.json();
    if (!tripId) {
      return new Response(JSON.stringify({ error: "tripId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use service role for ledger insert (clients cannot insert directly)
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Read ride
    const { data: ride, error: rideErr } = await supabaseAdmin
      .from("rides")
      .select("*")
      .eq("id", tripId)
      .maybeSingle();

    if (rideErr || !ride) {
      return new Response(JSON.stringify({ error: "Trip not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify caller is either the driver or the rider
    const isRider = ride.user_id === userId;
    let isDriver = false;
    if (ride.driver_id) {
      const { data: driverRec } = await supabaseAdmin
        .from("drivers")
        .select("user_id")
        .eq("id", ride.driver_id)
        .maybeSingle();
      if (driverRec?.user_id === userId) isDriver = true;
    }

    if (!isRider && !isDriver) {
      return new Response(JSON.stringify({ error: "Not authorized" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Only settle completed rides
    if (ride.status !== "completed") {
      return new Response(JSON.stringify({ error: "Trip is not completed" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const amount = Number(ride.fare) || 0;
    if (amount <= 0) {
      return new Response(JSON.stringify({ error: "Trip amount invalid" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get driver's user_id for the ledger
    let driverUserId: string | null = null;
    if (ride.driver_id) {
      const { data: d } = await supabaseAdmin
        .from("drivers")
        .select("user_id")
        .eq("id", ride.driver_id)
        .maybeSingle();
      driverUserId = d?.user_id ?? null;
    }

    // Insert settlement (unique on trip_id)
    const { data, error } = await supabaseAdmin
      .from("platform_ledger")
      .insert({
        trip_id: tripId,
        driver_id: driverUserId,
        passenger_id: ride.user_id,
        amount,
        currency: "ZAR",
        to_account_id: "98855",
        status: "SETTLED",
      })
      .select()
      .single();

    if (error) {
      const msg = (error.message || "").toLowerCase();
      if (msg.includes("duplicate") || msg.includes("unique") || msg.includes("23505")) {
        return new Response(JSON.stringify({ ok: true, alreadySettled: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      console.error("[settle-trip] Database error:", error.message);
      return new Response(JSON.stringify({ error: "Settlement failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, settlement: data }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    console.error("[settle-trip] Unexpected error:", (e as Error)?.message);
    return new Response(JSON.stringify({ error: "An error occurred" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
