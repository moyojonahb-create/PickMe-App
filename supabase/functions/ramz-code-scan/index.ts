// Ramz One — AI-powered code scanner.
// Accepts a batch of { path, content } source files and returns structured
// bug/anti-pattern findings + suggested fixes via the Lovable AI Gateway.
//
// Auth: requires a logged-in admin (checked against public.user_roles).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MAX_FILES_PER_BATCH = 12;
const MAX_BYTES_PER_FILE = 18_000;

interface FileInput {
  path: string;
  content: string;
}

const SYSTEM_PROMPT = `You are Ramz One, an expert React/TypeScript/Supabase code reviewer for the PickMe ride-hailing app.
You scan source files for real, actionable issues only. Ignore stylistic nitpicks.

Focus on:
- Bugs and crashes (null/undefined access, missing await, race conditions)
- React mistakes (missing deps, stale closures, key issues, ref misuse)
- Supabase misuse (missing error handling, .single() vs .maybeSingle(), RLS-bypassing patterns, leaking PII to client)
- Security issues (secrets in client, missing auth checks, XSS, unsafe eval)
- Performance traps (unnecessary re-renders, missing memoization on hot paths)
- Accessibility regressions on critical flows

SCALABILITY RULES (PickMe must support 100+ concurrent users on a small Cloud instance):
- Flag N+1 Supabase queries inside .map() / for-loops — should be a single .in() or .or() query.
- Flag any supabase.from(...).select(...) without .limit() OR .single()/.maybeSingle() — the implicit 1000-row cap silently truncates.
- Flag select('*') on large tables (rides, live_locations, wallet_transactions, messages) — list explicit columns.
- Flag setInterval polling shorter than 10s when a Realtime subscription would do — increases connection load.
- Flag useEffect that calls supabase.channel(...).subscribe() without a cleanup that calls supabase.removeChannel(...).
- Flag geospatial filters (lat/lng) without a bounding box — full table scans kill driver-nearby lookups.
- Flag .eq()/.in() filters on columns that are likely missing an index (any column ending in _id, status, created_at filtered with .lt/.gt).

For each issue produce ONE finding. Be precise: cite the exact file path and a line number.
Skip files with no real problems. Better to return zero findings than fluff.`;

const TOOL_SCHEMA = {
  type: "function",
  function: {
    name: "report_findings",
    description: "Report bug/anti-pattern findings discovered while reviewing the source files.",
    parameters: {
      type: "object",
      properties: {
        findings: {
          type: "array",
          items: {
            type: "object",
            properties: {
              file: { type: "string", description: "Exact file path as supplied." },
              line: { type: "number", description: "1-based line number where the issue starts." },
              severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
              category: {
                type: "string",
                enum: ["bug", "react", "supabase", "security", "performance", "accessibility", "type-safety"],
              },
              title: { type: "string", description: "Short imperative summary, <80 chars." },
              description: { type: "string", description: "What is wrong and why it matters." },
              suggestion: { type: "string", description: "Concrete fix the developer can apply." },
            },
            required: ["file", "line", "severity", "category", "title", "description", "suggestion"],
            additionalProperties: false,
          },
        },
      },
      required: ["findings"],
      additionalProperties: false,
    },
  },
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) return json({ error: "Unauthorized" }, 401);

    const { data: roleRow } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!roleRow) return json({ error: "Admin only" }, 403);

    const body = await req.json().catch(() => ({}));
    const files: FileInput[] = Array.isArray(body?.files) ? body.files : [];
    if (!files.length) return json({ error: "No files supplied" }, 400);

    const trimmed = files
      .slice(0, MAX_FILES_PER_BATCH)
      .map((f) => ({
        path: String(f.path || "").slice(0, 200),
        content: String(f.content || "").slice(0, MAX_BYTES_PER_FILE),
      }))
      .filter((f) => f.path && f.content);

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) return json({ error: "AI gateway not configured" }, 500);

    // Build a single review prompt with all files annotated by line numbers.
    const reviewPayload = trimmed
      .map((f) => {
        const numbered = f.content
          .split("\n")
          .map((line, i) => `${String(i + 1).padStart(4, " ")} | ${line}`)
          .join("\n");
        return `===== FILE: ${f.path} =====\n${numbered}`;
      })
      .join("\n\n");

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content:
              `Review the following source files and call report_findings with every real issue you find. ` +
              `Cite the file path exactly and the line number from the leading "NNNN |" gutter.\n\n` +
              reviewPayload,
          },
        ],
        tools: [TOOL_SCHEMA],
        tool_choice: { type: "function", function: { name: "report_findings" } },
      }),
    });

    if (aiResp.status === 429) {
      return json({ error: "AI rate limit — try again shortly.", fallback: true, findings: [], scannedFiles: [] }, 200);
    }
    if (aiResp.status === 402) {
      return json({ error: "AI credits exhausted — top up your workspace.", fallback: true, findings: [], scannedFiles: [] }, 200);
    }
    if (!aiResp.ok) {
      const text = await aiResp.text();
      console.error("AI gateway error:", aiResp.status, text);
      return json({ error: "AI gateway error", fallback: true, findings: [], scannedFiles: [] }, 200);
    }

    const aiData = await aiResp.json();
    const toolCall = aiData?.choices?.[0]?.message?.tool_calls?.[0];
    let findings: unknown = [];
    if (toolCall?.function?.arguments) {
      try {
        const parsed = JSON.parse(toolCall.function.arguments);
        findings = parsed?.findings ?? [];
      } catch (e) {
        console.error("Could not parse tool arguments", e);
      }
    }

    return json({
      scannedFiles: trimmed.map((f) => f.path),
      findings,
    }, 200);
  } catch (e) {
    console.error("ramz-code-scan error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
