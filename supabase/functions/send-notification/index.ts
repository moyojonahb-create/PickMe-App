import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
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

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !userData?.user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userId = userData.user.id;
    const body = await req.json();
    const { type, title, message, rideId, targetUserId, targetRole } = body;

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // --- Authorization helpers -------------------------------------------
    const isAdmin = async (): Promise<boolean> => {
      const { data } = await serviceClient.rpc("has_role", {
        _user_id: userId,
        _role: "admin",
      });
      return data === true;
    };

    const getRideParties = async (
      id: unknown,
    ): Promise<{ riderId: string; driverUserId: string | null } | null> => {
      if (typeof id !== "string" || !/^[0-9a-fA-F-]{36}$/.test(id)) return null;
      const { data: ride } = await serviceClient
        .from("rides")
        .select("user_id, driver_id")
        .eq("id", id)
        .maybeSingle();
      if (!ride) return null;
      let driverUserId: string | null = null;
      if (ride.driver_id) {
        const { data: drv } = await serviceClient
          .from("drivers")
          .select("user_id")
          .eq("id", ride.driver_id)
          .maybeSingle();
        driverUserId = drv?.user_id ?? null;
      }
      return { riderId: ride.user_id, driverUserId };
    };

    const forbidden = () =>
      new Response(
        JSON.stringify({ error: "Forbidden" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );

    // Caller must be a party to the ride, and the target must be the other party.
    const assertRideParticipants = async (): Promise<Response | null> => {
      if (!targetUserId || typeof targetUserId !== "string") {
        return new Response(
          JSON.stringify({ error: "targetUserId required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (await isAdmin()) return null;
      const parties = await getRideParties(rideId);
      if (!parties) return forbidden();
      const members = [parties.riderId, parties.driverUserId].filter(Boolean) as string[];
      if (!members.includes(userId) || !members.includes(targetUserId) || targetUserId === userId) {
        return forbidden();
      }
      return null;
    };

    // Store notification in DB
    const storeNotification = async (uid: string, notifTitle: string, notifBody: string, notifType: string) => {
      await serviceClient.from("notifications").insert({
        user_id: uid,
        title: notifTitle,
        body: notifBody,
        notification_type: notifType,
      });
    };

    switch (type) {
      case "ride_requested": {
        // Broadcast to drivers is only allowed for the rider who owns the ride
        // (or an admin) — never for arbitrary callers.
        if (!(await isAdmin())) {
          const parties = await getRideParties(rideId);
          if (!parties || parties.riderId !== userId) return forbidden();
        }

        // Notify all online drivers about new ride request
        const { data: onlineDrivers } = await serviceClient
          .from("drivers")
          .select("user_id")
          .eq("status", "approved")
          .eq("is_online", true);

        if (onlineDrivers) {
          const notifications = onlineDrivers.map(d => ({
            user_id: d.user_id,
            title: "🚗 New Ride Request",
            body: title || "A new ride is available near you!",
            notification_type: "ride_request",
          }));
          if (notifications.length > 0) {
            await serviceClient.from("notifications").insert(notifications);
          }
        }

        return new Response(
          JSON.stringify({ ok: true, notified: onlineDrivers?.length || 0 }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "ride_accepted": {
        // Notify rider that a driver accepted
        const denied = await assertRideParticipants();
        if (denied) return denied;
        await storeNotification(
          targetUserId,
          "✅ Ride Accepted!",
          message || "A driver has accepted your ride. They're on their way!",
          "ride_accepted"
        );
        return new Response(
          JSON.stringify({ ok: true }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "driver_arrived": {
        const denied = await assertRideParticipants();
        if (denied) return denied;
        await storeNotification(
          targetUserId,
          "📍 Driver Arrived",
          message || "Your driver has arrived at the pickup point!",
          "driver_arrived"
        );
        return new Response(
          JSON.stringify({ ok: true }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "ride_completed": {
        const denied = await assertRideParticipants();
        if (denied) return denied;
        await storeNotification(
          targetUserId,
          "🏁 Ride Complete",
          message || "Your ride has been completed. Please rate your experience!",
          "ride_completed"
        );
        return new Response(
          JSON.stringify({ ok: true }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "ride_cancelled": {
        const denied = await assertRideParticipants();
        if (denied) return denied;
        await storeNotification(
          targetUserId,
          "❌ Ride Cancelled",
          message || "Your ride has been cancelled.",
          "ride_cancelled"
        );
        return new Response(
          JSON.stringify({ ok: true }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "new_offer": {
        const denied = await assertRideParticipants();
        if (denied) return denied;
        await storeNotification(
          targetUserId,
          "💰 New Offer Received",
          message || "You've received a new offer for your ride!",
          "new_offer"
        );
        return new Response(
          JSON.stringify({ ok: true }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "deposit_approved": {
        if (!targetUserId) {
          return new Response(
            JSON.stringify({ error: "targetUserId required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        if (!(await isAdmin())) return forbidden();
        await storeNotification(
          targetUserId,
          "💵 Deposit Approved",
          message || "Your deposit has been approved and credited to your wallet!",
          "deposit_approved"
        );
        return new Response(
          JSON.stringify({ ok: true }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ error: "Unknown notification type" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
  } catch (error: unknown) {
    console.error("[send-notification] Error:", error instanceof Error ? error.message : error);
    return new Response(
      JSON.stringify({ error: "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
