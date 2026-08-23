import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// E.164, 8-15 digits.
const PHONE_RE = /^\+[1-9]\d{7,14}$/;

function sanitize(input: unknown, max: number): string {
  if (typeof input !== "string") return "";
  return input.replace(/[\r\n]+/g, " ").trim().slice(0, max);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // --- Authentication: only signed-in users may trigger an SMS ---
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: authError } = await anonClient.auth.getUser(token);
    if (authError || !userData?.user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const phoneRaw = typeof body.phone === "string" ? body.phone.replace(/[\s-()]/g, "") : "";

    if (!PHONE_RE.test(phoneRaw)) {
      return new Response(
        JSON.stringify({ error: "A valid international phone number is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // --- Server-side quota: max 5 invites per user per hour ---
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: allowed, error: rlError } = await serviceClient.rpc("check_rate_limit", {
      p_user_id: userId,
      p_action: "sms_invite",
      p_max_requests: 5,
      p_window_seconds: 3600,
    });
    if (rlError) {
      console.error("[sms-invite] rate limit check failed:", rlError.message);
    } else if (allowed === false) {
      return new Response(
        JSON.stringify({ error: "Invite limit reached. Please try again later." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
    const fromNumber = Deno.env.get("TWILIO_PHONE_NUMBER");

    if (!accountSid || !authToken || !fromNumber) {
      console.error("[sms-invite] Twilio not configured");
      return new Response(
        JSON.stringify({ error: "SMS service unavailable" }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const messageType = sanitize(body.messageType, 20) || "ride_invite";
    const name = sanitize(body.bookerName, 40) || "Someone";
    const pickupText = sanitize(body.pickup, 80) || "a nearby location";
    const dropoffText = sanitize(body.dropoff, 80) || "your destination";

    let message: string;
    if (messageType === "parcel_booked") {
      message = `📦 ${name} is sending you a parcel via PickMe!\n\nFrom: ${pickupText}\nTo: ${dropoffText}\n\nWe'll text you again once a driver is on the way.`;
    } else if (messageType === "parcel_matched") {
      const driverName = sanitize(body.driverName, 40) || "Your driver";
      const plate = sanitize(body.plate, 20);
      const etaMinutes = sanitize(body.etaMinutes, 6);
      message = `📦 Your PickMe parcel from ${name} is on the way!\n\nDriver: ${driverName}${plate ? ` · ${plate}` : ""}${etaMinutes ? `\nETA: ${etaMinutes} min` : ""}`;
    } else if (messageType === "third_party_matched") {
      const driverName = sanitize(body.driverName, 40) || "Your driver";
      const plate = sanitize(body.plate, 20);
      const etaMinutes = sanitize(body.etaMinutes, 6);
      message = `🚗 Your PickMe ride booked by ${name} is on the way!\n\nDriver: ${driverName}${plate ? ` · ${plate}` : ""}${etaMinutes ? `\nETA: ${etaMinutes} min` : ""}`;
    } else {
      message = `🚗 ${name} has booked a PickMe ride for you!\n\nFrom: ${pickupText}\nTo: ${dropoffText}`;
    }

    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          "Authorization": "Basic " + btoa(`${accountSid}:${authToken}`),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          To: phoneRaw,
          From: fromNumber,
          Body: message,
        }),
      },
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Twilio SMS error:", data);
      return new Response(
        JSON.stringify({ error: "Failed to send SMS" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ ok: true, sid: data.sid }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("SMS invite error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
