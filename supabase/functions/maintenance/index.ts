import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_ACTIONS = new Set([
  'update_demand_zones',
  'cleanup_old_messages',
  'auto_resolve_noise_fraud_flags',
  'expire_old_rides',
]);

const jsonResponse = (body: Record<string, unknown>, status: number) =>
  new Response(
    JSON.stringify(body),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get('action');
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const requestedAction = (action || body.action || '').toString();

    if (!requestedAction || !ALLOWED_ACTIONS.has(requestedAction)) {
      return new Response(
        JSON.stringify({ error: 'Unknown or disallowed maintenance action.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const userClient = createClient(
      supabaseUrl,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace('Bearer ', '');
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    const userId = userData?.user?.id;
    if (userError || !userId) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const supabase = createClient(
      supabaseUrl,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: roleData, error: roleError } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .eq('role', 'admin')
      .maybeSingle();

    if (roleError || !roleData) {
      return jsonResponse({ error: 'Admin role required' }, 403);
    }

    let rpcResult;

    switch (requestedAction) {
      case 'update_demand_zones':
      case 'cleanup_old_messages':
      case 'auto_resolve_noise_fraud_flags':
      case 'expire_old_rides': {
        const { data, error } = await supabase.rpc(requestedAction);
        if (error) throw error;
        rpcResult = data;
        break;
      }
      default:
        throw new Error('Unsupported maintenance action');
    }

    return new Response(
      JSON.stringify({ success: true, action: requestedAction, data: rpcResult }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[maintenance] error:', error);
    return new Response(
      JSON.stringify({ error: typeof error === 'string' ? error : (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
