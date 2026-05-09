// Ramz One — AI patch generator.
// Given a single source file + a Code-Scan finding, returns a fully patched
// version of the file plus a short summary of what changed. Admin-only.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MAX_BYTES = 24_000;

const SYSTEM_PROMPT = `You are Ramz One, an expert React/TypeScript/Supabase code-fix engine.
You receive ONE source file plus ONE finding (bug, anti-pattern, security gap).
Return a minimally-invasive patched version of the file that fixes the finding without changing unrelated behavior, formatting, or imports.

Rules:
- Output the COMPLETE updated file via the apply_patch tool. Do NOT return diffs or markdown.
- Preserve all unrelated code, exports, comments, and formatting verbatim.
- Do not introduce new dependencies. Do not invent APIs.
- If the finding is invalid or the fix is too risky to apply automatically, return changed=false with a short reason and the original content unchanged.`;

const TOOL_SCHEMA = {
  type: "function",
  function: {
    name: "apply_patch",
    description: "Return the patched file contents.",
    parameters: {
      type: "object",
      properties: {
        changed: { type: "boolean", description: "True if a fix was applied." },
        summary: { type: "string", description: "One-sentence summary of the change (or reason for skipping)." },
        patched_content: { type: "string", description: "Full updated file contents." },
      },
      required: ["changed", "summary", "patched_content"],
      additionalProperties: false,
    },
  },
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
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
    const file = body?.file as { path?: string; content?: string } | undefined;
    const finding = body?.finding;
    if (!file?.path || !file?.content || !finding) {
      return json({ error: "file{path,content} and finding are required" }, 400);
    }

    const path = String(file.path).slice(0, 200);
    const original = String(file.content).slice(0, MAX_BYTES);

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) return json({ error: "AI gateway not configured" }, 500);

    const numbered = original
      .split("\n")
      .map((line, i) => `${String(i + 1).padStart(4, " ")} | ${line}`)
      .join("\n");

    const userPrompt = [
      `FILE: ${path}`,
      `FINDING: ${finding.title}`,
      `LINE: ${finding.line}`,
      `SEVERITY: ${finding.severity}`,
      `CATEGORY: ${finding.category}`,
      `DESCRIPTION: ${finding.description}`,
      `SUGGESTION: ${finding.suggestion}`,
      "",
      "===== CURRENT FILE (line-numbered, do NOT include the gutter in your output) =====",
      numbered,
    ].join("\n");

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        tools: [TOOL_SCHEMA],
        tool_choice: { type: "function", function: { name: "apply_patch" } },
      }),
    });

    if (aiResp.status === 429) return json({ error: "AI rate limit — try again shortly." }, 429);
    if (aiResp.status === 402) return json({ error: "AI credits exhausted — top up your workspace." }, 402);
    if (!aiResp.ok) {
      console.error("AI gateway error:", aiResp.status, await aiResp.text());
      return json({ error: "AI gateway error" }, 502);
    }

    const aiData = await aiResp.json();
    const toolCall = aiData?.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) return json({ error: "AI returned no patch" }, 502);

    let parsed: { changed?: boolean; summary?: string; patched_content?: string };
    try {
      parsed = JSON.parse(toolCall.function.arguments);
    } catch (e) {
      console.error("parse error", e);
      return json({ error: "Could not parse AI response" }, 502);
    }

    return json({
      path,
      changed: parsed.changed === true,
      summary: parsed.summary ?? "",
      patchedContent: parsed.patched_content ?? original,
      originalContent: original,
    });
  } catch (e) {
    console.error("ramz-generate-patch error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
