const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// DEPRECATED: Trip settlement is now handled entirely by the Go backend
// ("Go Core") via POST /api/rides/{id}/settle. This function is kept only
// as a placeholder that returns a clear deprecation response to any
// lingering callers. It performs no authentication, no database reads or
// writes, and no business logic.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  return new Response(
    JSON.stringify({ error: "settle-trip is deprecated. Settlement is handled by Go Core." }),
    { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
