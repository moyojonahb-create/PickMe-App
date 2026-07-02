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

  if (!legacyAllowed("LEGACY_ADMIN_API_ENABLED")) {
    return new Response(
      JSON.stringify({ error: "admin-api is retired; use Go /admin endpoints" }),
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
    const url = new URL(req.url);
    const action = url.searchParams.get("action");
    const body = req.method === "POST" ? await req.json() : {};

    console.log(`Admin action: ${action} by user ${userId}`);

    let result;

    switch (action) {
      case "verify_admin": {
        // Simple verification - if we got here, user is admin (checked above)
        result = { 
          isAdmin: true, 
          userId,
          verifiedAt: new Date().toISOString()
        };
        break;
      }

      case "get_metrics": {
        // Get dashboard metrics
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const [driversResult, activeDriversResult, pendingDriversResult, ridesResult] = await Promise.all([
          serviceClient.from("drivers").select("*", { count: "exact", head: true }),
          serviceClient.from("drivers").select("*", { count: "exact", head: true }).eq("is_online", true).eq("status", "approved"),
          serviceClient.from("drivers").select("*", { count: "exact", head: true }).eq("status", "pending"),
          serviceClient.from("rides").select("status, fare").gte("created_at", today.toISOString()),
        ]);

        const rides = ridesResult.data || [];
        result = {
          totalDrivers: driversResult.count || 0,
          activeDrivers: activeDriversResult.count || 0,
          pendingDrivers: pendingDriversResult.count || 0,
          totalTripsToday: rides.length,
          ongoingTrips: rides.filter((r) => r.status === "requested" || r.status === "in_progress").length,
          completedTrips: rides.filter((r) => r.status === "completed").length,
          cancelledTrips: rides.filter((r) => r.status === "cancelled").length,
          totalRevenue: rides.filter((r) => r.status === "completed").reduce((sum, r) => sum + Number(r.fare), 0),
        };
        break;
      }

      case "approve_driver": {
        const { driverId } = body;
        if (!driverId) throw new Error("Driver ID required");

        const { error } = await serviceClient
          .from("drivers")
          .update({ status: "approved" })
          .eq("id", driverId);

        if (error) throw error;

        // Log system event
        await serviceClient.from("system_events").insert({
          actor_id: userId,
          event_type: "driver_approved",
          entity_type: "driver",
          entity_id: driverId,
        });

        result = { success: true, message: "Driver approved" };
        break;
      }

      case "suspend_driver": {
        const { driverId, reason } = body;
        if (!driverId) throw new Error("Driver ID required");

        const { error } = await serviceClient
          .from("drivers")
          .update({ status: "suspended", is_online: false })
          .eq("id", driverId);

        if (error) throw error;

        await serviceClient.from("system_events").insert({
          actor_id: userId,
          event_type: "driver_suspended",
          entity_type: "driver",
          entity_id: driverId,
          details: { reason },
        });

        result = { success: true, message: "Driver suspended" };
        break;
      }

      case "ban_driver": {
        const { driverId, reason } = body;
        if (!driverId) throw new Error("Driver ID required");

        const { error } = await serviceClient
          .from("drivers")
          .update({ status: "banned", is_online: false })
          .eq("id", driverId);

        if (error) throw error;

        await serviceClient.from("system_events").insert({
          actor_id: userId,
          event_type: "driver_banned",
          entity_type: "driver",
          entity_id: driverId,
          details: { reason },
        });

        result = { success: true, message: "Driver banned" };
        break;
      }

      case "force_driver_offline": {
        const { driverId } = body;
        if (!driverId) throw new Error("Driver ID required");

        const { error } = await serviceClient
          .from("drivers")
          .update({ is_online: false })
          .eq("id", driverId);

        if (error) throw error;

        // Also update live_locations
        const { data: driverData } = await serviceClient
          .from("drivers")
          .select("user_id")
          .eq("id", driverId)
          .single();

        if (driverData) {
          await serviceClient
            .from("live_locations")
            .update({ is_online: false })
            .eq("user_id", driverData.user_id);
        }

        result = { success: true, message: "Driver forced offline" };
        break;
      }

      case "approve_document": {
        const { documentId } = body;
        if (!documentId) throw new Error("Document ID required");

        const { error } = await serviceClient
          .from("driver_documents")
          .update({
            status: "approved",
            reviewed_by: userId,
            reviewed_at: new Date().toISOString(),
          })
          .eq("id", documentId);

        if (error) throw error;

        result = { success: true, message: "Document approved" };
        break;
      }

      case "reject_document": {
        const { documentId, reason } = body;
        if (!documentId) throw new Error("Document ID required");

        const { error } = await serviceClient
          .from("driver_documents")
          .update({
            status: "rejected",
            reviewed_by: userId,
            reviewed_at: new Date().toISOString(),
            rejection_reason: reason,
          })
          .eq("id", documentId);

        if (error) throw error;

        result = { success: true, message: "Document rejected" };
        break;
      }

      case "cancel_trip": {
        const { tripId, reason } = body;
        if (!tripId) throw new Error("Trip ID required");

        const { error } = await serviceClient
          .from("rides")
          .update({ status: "cancelled" })
          .eq("id", tripId);

        if (error) throw error;

        // Log trip event
        await serviceClient.from("trip_events").insert({
          ride_id: tripId,
          actor_id: userId,
          event_type: "admin_cancelled",
          payload: { reason },
        });

        await serviceClient.from("system_events").insert({
          actor_id: userId,
          event_type: "trip_cancelled",
          entity_type: "ride",
          entity_id: tripId,
          details: { reason },
        });

        result = { success: true, message: "Trip cancelled" };
        break;
      }

      case "send_notification": {
        const { targetUserId, title, body: notifBody, type } = body;
        if (!targetUserId || !title || !notifBody) {
          throw new Error("User ID, title, and body are required");
        }

        const { error } = await serviceClient.from("notifications").insert({
          user_id: targetUserId,
          title,
          body: notifBody,
          notification_type: type || "info",
        });

        if (error) throw error;

        result = { success: true, message: "Notification sent" };
        break;
      }

      case "broadcast_notification": {
        const { title, body: notifBody, type, targetRole } = body;
        if (!title || !notifBody) {
          throw new Error("Title and body are required");
        }

        // Get target users based on role
        let userIds: string[] = [];
        if (targetRole === "drivers") {
          const { data: drivers } = await serviceClient
            .from("drivers")
            .select("user_id")
            .eq("status", "approved");
          userIds = drivers?.map((d) => d.user_id) || [];
        } else {
          // All users - get from profiles
          const { data: profiles } = await serviceClient.from("profiles").select("user_id");
          userIds = profiles?.map((p) => p.user_id) || [];
        }

        if (userIds.length > 0) {
          const notifications = userIds.map((uid) => ({
            user_id: uid,
            title,
            body: notifBody,
            notification_type: type || "system",
          }));

          await serviceClient.from("notifications").insert(notifications);
        }

        result = { success: true, message: `Broadcast sent to ${userIds.length} users` };
        break;
      }

      case "create_landmark": {
        const { name, category, latitude, longitude, description, keywords } = body;
        if (!name || !latitude || !longitude) {
          throw new Error("Name, latitude, and longitude are required");
        }

        const { error } = await serviceClient.from("koloi_landmarks").insert({
          name,
          category: category || "Other",
          latitude,
          longitude,
          description,
          keywords,
        });

        if (error) throw error;

        result = { success: true, message: "Landmark created" };
        break;
      }

      case "update_landmark": {
        const { landmarkId, ...updateData } = body;
        if (!landmarkId) throw new Error("Landmark ID required");

        const { error } = await serviceClient
          .from("koloi_landmarks")
          .update(updateData)
          .eq("id", landmarkId);

        if (error) throw error;

        result = { success: true, message: "Landmark updated" };
        break;
      }

      case "delete_landmark": {
        const { landmarkId } = body;
        if (!landmarkId) throw new Error("Landmark ID required");

        const { error } = await serviceClient
          .from("koloi_landmarks")
          .delete()
          .eq("id", landmarkId);

        if (error) throw error;

        result = { success: true, message: "Landmark deleted" };
        break;
      }

      case "get_system_events": {
        const { limit = 50 } = body;

        const { data, error } = await serviceClient
          .from("system_events")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(limit);

        if (error) throw error;

        result = { events: data };
        break;
      }

      default:
        return new Response(
          JSON.stringify({ error: "Unknown action" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }

    return new Response(
      JSON.stringify(result),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("[admin-api] Internal error:", error instanceof Error ? error.message : error);
    return new Response(
      JSON.stringify({ error: "An internal error occurred" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
