/**
 * analyze-code-scan
 *
 * Secure backend bridge between Ramz One Code Scan and OpenAI.
 *
 * - Receives findings + optional logs/context from the admin panel.
 * - Strips secrets (Supabase keys, JWTs, OpenAI keys, EcoCash numbers, etc.).
 * - Truncates oversized payloads to keep token cost bounded.
 * - Calls OpenAI Chat Completions with a senior-engineer system prompt.
 * - Returns a structured engineering report (markdown) the UI can render.
 *
 * Never exposes OPENAI_API_KEY to the client.
 */
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2.45.0';

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

// Models — keep aligned with the user-facing toggle.
const MODEL_DEEP = 'gpt-4o';
const MODEL_FAST = 'gpt-4o-mini';

// Hard caps to control token spend.
const MAX_FINDINGS = 80;
const MAX_LOGS = 40;
const MAX_LOG_CHARS = 600;
const MAX_TEXT_FIELD = 1200;

interface IncomingFinding {
  file?: string;
  line?: number;
  severity?: string;
  category?: string;
  title?: string;
  description?: string;
  suggestion?: string;
  rootCause?: string;
  userImpact?: string;
  scalabilityImpact?: string;
  performanceImpact?: string;
  securityImpact?: string;
  expectedResult?: string;
}

interface RequestBody {
  scanSummary?: { total?: number; critical?: number; high?: number; medium?: number; low?: number };
  findings?: IncomingFinding[];
  logs?: string[];
  stackTraces?: string[];
  affectedFiles?: string[];
  appStack?: string;
  mode?: 'deep' | 'fast';
}

// ---------- sanitization ----------

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  // OpenAI / generic bearer tokens
  [/sk-(?:proj-)?[A-Za-z0-9_-]{20,}/g, '[REDACTED_OPENAI_KEY]'],
  [/Bearer\s+[A-Za-z0-9._-]{20,}/gi, 'Bearer [REDACTED]'],
  // JWTs (three base64 segments)
  [/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED_JWT]'],
  // Supabase project URLs (keep as token, drop ref)
  [/https:\/\/[a-z0-9]{10,}\.supabase\.co/g, 'https://[REDACTED].supabase.co'],
  // Generic api key style env exposure
  [/(api[_-]?key|secret|token|password|pin)\s*[:=]\s*["']?[A-Za-z0-9_.\\-]{12,}["']?/gi, '$1=[REDACTED]'],
  // Emails
  [/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[REDACTED_EMAIL]'],
  // Zimbabwe phone numbers (+263 / 07xxxxxxxx)
  [/\+?263\d{9}/g, '[REDACTED_PHONE]'],
  [/\b0?7[1-8]\d{7}\b/g, '[REDACTED_PHONE]'],
  // Long hex (could be private keys / hashes that look sensitive)
  [/\b[A-Fa-f0-9]{40,}\b/g, '[REDACTED_HASH]'],
];

function sanitize(text: unknown): string {
  if (text == null) return '';
  let s = typeof text === 'string' ? text : JSON.stringify(text);
  for (const [re, replacement] of SECRET_PATTERNS) s = s.replace(re, replacement);
  return s;
}

function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + ` …[+${s.length - max} chars truncated]`;
}

function sanitizeFinding(f: IncomingFinding): IncomingFinding {
  const sf: IncomingFinding = {
    file: f.file ? sanitize(f.file) : undefined,
    line: typeof f.line === 'number' ? f.line : undefined,
    severity: f.severity,
    category: f.category,
    title: f.title ? clip(sanitize(f.title), 200) : undefined,
    description: f.description ? clip(sanitize(f.description), MAX_TEXT_FIELD) : undefined,
    suggestion: f.suggestion ? clip(sanitize(f.suggestion), MAX_TEXT_FIELD) : undefined,
    rootCause: f.rootCause ? clip(sanitize(f.rootCause), MAX_TEXT_FIELD) : undefined,
    userImpact: f.userImpact ? clip(sanitize(f.userImpact), MAX_TEXT_FIELD) : undefined,
    scalabilityImpact: f.scalabilityImpact ? clip(sanitize(f.scalabilityImpact), MAX_TEXT_FIELD) : undefined,
    performanceImpact: f.performanceImpact ? clip(sanitize(f.performanceImpact), MAX_TEXT_FIELD) : undefined,
    securityImpact: f.securityImpact ? clip(sanitize(f.securityImpact), MAX_TEXT_FIELD) : undefined,
    expectedResult: f.expectedResult ? clip(sanitize(f.expectedResult), MAX_TEXT_FIELD) : undefined,
  };
  return sf;
}

// ---------- prompt ----------

const SYSTEM_PROMPT = `You are the lead production engineer for PickMe, a mobile-first ride-hailing platform built on React + TypeScript + Capacitor + Supabase + Google Maps, deployed across Zimbabwe on weak cellular networks.

You combine the perspectives of: senior software engineer, security engineer, DevOps engineer, Supabase/Postgres architect, React/TypeScript expert, Capacitor mobile expert, and production reliability engineer.

Your priorities, in order:
1. GPS reliability  2. Wallet security  3. Realtime ride sync  4. Weak-network resilience
5. Battery optimization  6. Realtime stability  7. Crash prevention  8. Mobile responsiveness
9. Fraud prevention  10. Production scalability.

You will receive a sanitized scan summary, a list of findings (each with file/line/category/severity), and optionally log excerpts. Produce a deep engineering report.

OUTPUT FORMAT (markdown, in this exact order):

# Executive Summary
2–4 sentences: overall production-readiness verdict and the single biggest risk.

# Top Risks (ranked)
For each of the top 5–10 issues, render this exact block:

## <Short Title>
**File:** <path>:<line>  ·  **Severity:** Critical|High|Medium|Low  ·  **Category:** <category>

### Problem
Clear explanation of what is wrong.

### Root Cause
Deep technical explanation (mechanism, not symptom).

### User Impact
How real riders / drivers / admins are affected.

### Scalability Impact
What happens at 1k / 10k / 100k concurrent users.

### Performance Impact
Effect on speed, memory, battery, network.

### Security Impact
Concrete attacker scenarios, or "None" if not applicable.

### Required Fix
The exact change to make.

### Implementation Details
Files / hooks / components / Supabase tables / RPCs / RLS policies to touch.

### Expected Result
Measurable production improvement after fix.

# Cross-Cutting Patterns
Bullet list of recurring anti-patterns across the codebase (e.g. ".single() everywhere", "missing realtime cleanup", "GPS without battery guard").

# Recommended Next Sprint
Numbered list of 5–8 concrete tickets a senior engineer should ship first.

Rules:
- Be specific. Reference real PickMe concerns (wallet integrity, EcoCash flows, intercity negotiation, no-show protection, fatigue monitoring).
- Never invent code that doesn't exist; reason from the finding metadata.
- Never echo back sanitized placeholders like [REDACTED_*].
- If findings are sparse, still produce the structure but note "No issues observed in category X".`;

function buildUserPayload(body: RequestBody): string {
  const findings = (body.findings ?? []).slice(0, MAX_FINDINGS).map(sanitizeFinding);
  const logs = (body.logs ?? []).slice(0, MAX_LOGS).map((l) => clip(sanitize(l), MAX_LOG_CHARS));
  const stacks = (body.stackTraces ?? []).slice(0, 10).map((s) => clip(sanitize(s), MAX_LOG_CHARS));
  const files = (body.affectedFiles ?? []).slice(0, 100).map((f) => sanitize(f));

  // Severity buckets
  const buckets = { critical: 0, high: 0, medium: 0, low: 0 } as Record<string, number>;
  for (const f of findings) {
    const sev = (f.severity ?? 'low').toLowerCase();
    if (sev in buckets) buckets[sev]++;
  }

  return JSON.stringify(
    {
      app: body.appStack ?? 'PickMe — React + TS + Capacitor + Supabase + Google Maps',
      summary: body.scanSummary ?? buckets,
      severityCounts: buckets,
      findings,
      affectedFiles: files,
      logs,
      stackTraces: stacks,
    },
    null,
    2,
  );
}

// ---------- handler ----------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  if (!OPENAI_API_KEY) {
    return new Response(
      JSON.stringify({ error: 'OPENAI_API_KEY is not configured on the backend.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  // Require an authenticated admin session (panel is admin-only).
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Missing auth' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userRes, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userRes?.user) {
    return new Response(JSON.stringify({ error: 'Invalid session' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const { data: roleRow } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', userRes.user.id)
    .eq('role', 'admin')
    .maybeSingle();
  if (!roleRow) {
    return new Response(JSON.stringify({ error: 'Admin access required' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!body || (!body.findings?.length && !body.logs?.length)) {
    return new Response(
      JSON.stringify({ error: 'Provide at least findings[] or logs[] to analyze.' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  const model = body.mode === 'fast' ? MODEL_FAST : MODEL_DEEP;
  const userContent = buildUserPayload(body);

  let openaiRes: Response;
  try {
    openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
      }),
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: 'Network error calling OpenAI', detail: String(e) }),
      { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  if (!openaiRes.ok) {
    const text = await openaiRes.text();
    let userMsg = 'OpenAI request failed.';
    if (openaiRes.status === 401) userMsg = 'OpenAI API key is invalid.';
    else if (openaiRes.status === 429) userMsg = 'OpenAI rate limit hit — try again shortly.';
    else if (openaiRes.status === 402) userMsg = 'OpenAI account has insufficient quota.';
    else if (openaiRes.status === 400) userMsg = 'OpenAI rejected the payload (model name or size).';
    return new Response(
      JSON.stringify({ error: userMsg, status: openaiRes.status, detail: text.slice(0, 500) }),
      { status: openaiRes.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  const json = await openaiRes.json();
  const report: string = json?.choices?.[0]?.message?.content ?? '';
  const usage = json?.usage ?? null;

  return new Response(
    JSON.stringify({
      report,
      model,
      usage,
      findingsAnalyzed: Math.min(body.findings?.length ?? 0, MAX_FINDINGS),
      generatedAt: new Date().toISOString(),
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
