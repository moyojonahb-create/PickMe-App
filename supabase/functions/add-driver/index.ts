import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
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

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (!legacyAllowed("LEGACY_ADD_DRIVER_ENABLED")) {
    return new Response(
      JSON.stringify({ error: "add-driver is retired; use Go /admin/business/drivers or /api/drivers/applications" }),
      { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    // Verify user and get claims
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getUser(token);
    
    if (claimsError || !claimsData?.user) {
      console.error("Auth error:", claimsError);
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userId = claimsData.user.id;

    // Check if user has admin role using service role client for security
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: roleData, error: roleError } = await serviceClient
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();

    if (roleError || !roleData) {
      console.error("Role check failed:", roleError);
      return new Response(
        JSON.stringify({ error: "Access denied. Admin role required." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse request body
    const body = req.method === "POST" ? await req.json() : {};
    const { email, vehicleType = "economy", platNumber = "", vehicleMake = "", vehicleModel = "", vehicleYear = null } = body;

    if (!email) {
      return new Response(
        JSON.stringify({ error: "Email is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Adding driver for email: ${email}`);

    // Find user by email
    const { data: users, error: usersError } = await serviceClient.auth.admin.listUsers();
    
    if (usersError) {
      console.error("Error listing users:", usersError);
      return new Response(
        JSON.stringify({ error: "Failed to find user" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const targetUser = users.users.find(u => u.email === email);
    
    if (!targetUser) {
      return new Response(
        JSON.stringify({ error: `User with email ${email} not found` }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if driver record already exists
    const { data: existingDriver } = await serviceClient
      .from("drivers")
      .select("id")
      .eq("user_id", targetUser.id)
      .maybeSingle();

    if (existingDriver) {
      return new Response(
        JSON.stringify({ error: "Driver record already exists for this user" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create driver record
    const { data: newDriver, error: driverError } = await serviceClient
      .from("drivers")
      .insert({
        user_id: targetUser.id,
        status: "approved", // Auto-approve for admin-added drivers
        vehicle_type: vehicleType,
        plate_number: platNumber,
        vehicle_make: vehicleMake,
        vehicle_model: vehicleModel,
        vehicle_year: vehicleYear,
        rating_avg: 0,
        total_trips: 0,
        is_online: false,
      })
      .select()
      .single();

    if (driverError) {
      console.error("Error creating driver:", driverError);
      return new Response(
        JSON.stringify({ error: "Failed to create driver record", details: driverError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Log system event
    await serviceClient.from("system_events").insert({
      actor_id: userId,
      event_type: "driver_created",
      entity_type: "driver",
      entity_id: newDriver.id,
      details: { email, vehicleType },
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: `Driver created successfully for ${email}`,
        driver: newDriver,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("[add-driver] Internal error:", error instanceof Error ? error.message : error);
    return new Response(
      JSON.stringify({ error: "An internal error occurred" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
