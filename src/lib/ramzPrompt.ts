/**
 * Ramz One — turns a HealthCheck finding into a structured, copy-paste-ready
 * Lovable.dev prompt that another agent (or a developer) can drop straight
 * into the chat to fix the underlying issue.
 *
 * Output format (per the user's spec):
 *   PROBLEM:      …
 *   ROOT CAUSE:   …
 *   FIX TYPE:     UI / Performance / Backend / Security / Database
 *   LOVABLE PROMPT:
 *     Refactor / Fix [feature]
 *     GOAL: …
 *     1. PROBLEM DESCRIPTION
 *     2. REQUIRED FIX
 *     3. IMPLEMENTATION DETAILS
 *     4. UX IMPROVEMENTS
 *     5. FINAL RESULT
 */

export interface RamzFinding {
  id: string;
  category: string;
  severity: string;
  title: string;
  description: string;
  suggestion: string;
  context?: string;
  affectedUsers?: number;
}

const FIX_TYPE_BY_CATEGORY: Record<string, string> = {
  ui: "UI",
  map: "UI / Performance",
  driver: "Backend / UX",
  performance: "Performance",
  security: "Security",
  database: "Backend / Database",
  suggestion: "UX / Operations",
  error: "Backend",
};

function rootCauseFor(f: RamzFinding): string {
  switch (f.id) {
    case "stale-rides":
      return "expire_old_rides() trigger isn't firing on schedule, so rides past their TTL stay in 'pending' forever.";
    case "low-balance-drivers":
      return "Driver wallet balance fell below the $0.50 acceptance threshold and no automated top-up reminder was sent.";
    case "unresolved-sos":
      return "SOS alerts are written to emergency_alerts but the admin notification channel / on-call paging is not acknowledging them.";
    case "old-disputes":
      return "Disputes have no auto-escalation policy; the admin queue grows unbounded when manual review is slow.";
    case "fraud-flags":
      return "Heuristic fraud_flags rows are being created but never reviewed — auto-clear/auto-suspend rules are missing.";
    case "pending-drivers":
      return "Driver onboarding has no batch-approve UI, so admins approve one at a time and the queue accumulates.";
    case "high-cancel-rate":
      return "Either ETAs are over-promised, fares feel too high, or matching dispatches drivers too far away — riders/drivers cancel before pickup.";
    case "no-driver-response":
      return "Online driver supply in this area is below demand, OR the offer broadcast radius/duration is too small for current density.";
    case "message-cleanup":
      return "cleanup_old_messages() isn't running on a cron schedule, so the messages table grows indefinitely and slows realtime queries.";
    case "stale-driver-locations":
      return "Driver app stopped emitting GPS pings (background-fetch killed, weak signal, or app crash) but is_online was never reset.";
    case "map-route-failures":
      return "Mapbox route display failed (token / network / domain restriction) and the OSRM fallback either errored or wasn't invoked.";
    case "call-failures":
      return "Agora token issuance failed or the WebRTC handshake never completed (likely AGORA_APP_ID/CERT misconfig or NAT traversal).";
    case "stuck-accepted-rides":
      return "Driver accepted ride but never transitioned status to in_progress — likely app navigation broken, or driver went offline mid-pickup.";
    case "scan-error":
      return "Ramz One could not query the Supabase project (RLS blocked admin role, or transient network failure).";
    default: {
      // Generic inference from the category
      if (f.category === "performance") return "A user-facing flow is exceeding its expected SLO — most likely a missing index, an N+1 query, or a chatty client effect.";
      if (f.category === "security") return "A security-critical event was detected but the response workflow has no human owner assigned.";
      if (f.category === "database") return "A maintenance task that should be scheduled is being deferred indefinitely.";
      if (f.category === "ui") return "A user-facing component is failing silently and is not visible in standard error monitoring.";
      return "The underlying subsystem is reporting an anomaly outside its expected operating range.";
    }
  }
}

function featureNameFor(f: RamzFinding): string {
  switch (f.category) {
    case "ui": return "Ride / Driver UI";
    case "map": return "Map & Route Rendering";
    case "driver": return "Driver Lifecycle";
    case "performance": return "Matching & Dispatch Performance";
    case "security": return "Safety & Security Response";
    case "database": return "Database Maintenance";
    case "suggestion": return "Operations Workflow";
    default: return "Affected Subsystem";
  }
}

export function generateLovablePrompt(f: RamzFinding): string {
  const fixType = FIX_TYPE_BY_CATEGORY[f.category] ?? "Backend";
  const feature = featureNameFor(f);
  const rootCause = rootCauseFor(f);
  const affected = f.affectedUsers ? `Affects ~${f.affectedUsers} user${f.affectedUsers > 1 ? "s" : ""}.` : "";
  const flow = f.context ? `User flow: ${f.context}` : "";

  return [
    `PROBLEM:`,
    `${f.title} — ${f.description} ${affected}`.trim(),
    ``,
    `ROOT CAUSE:`,
    rootCause,
    ``,
    `FIX TYPE:`,
    fixType,
    ``,
    `LOVABLE PROMPT:`,
    `Refactor / Fix ${feature} — ${f.title}`,
    ``,
    `GOAL:`,
    `Eliminate the "${f.title.replace(/^[^a-zA-Z0-9]+/, "")}" anomaly so the affected flow recovers within one product cycle and never recurs.`,
    ``,
    `1. PROBLEM DESCRIPTION`,
    `${f.description}`,
    flow ? `${flow}` : ``,
    ``,
    `2. REQUIRED FIX`,
    `- UI changes: surface the failure state inline (toast + inline fallback) instead of letting it silently degrade.`,
    `- Logic changes: ${f.suggestion}`,
    `- Performance improvements: cache the inputs to this flow and short-circuit on stale data.`,
    ``,
    `3. IMPLEMENTATION DETAILS`,
    `- Components to update: identify the screen(s) tied to the "${f.category}" subsystem (e.g. Ride screen, Wallet screen, Driver dashboard, Admin panel).`,
    `- Loading behavior: render a skeleton that mirrors the final layout — never a blank screen or full-page spinner.`,
    `- State handling: manage with React Query (or an equivalent async hook) so retries, caching, and invalidation are consistent.`,
    `- Backend: add/repair the relevant Supabase trigger, scheduled function, or RPC needed to keep this state self-healing.`,
    ``,
    `4. UX IMPROVEMENTS`,
    `- Add a 200ms fade-in when real data replaces the skeleton.`,
    `- Provide an explicit "Retry" action when an automated recovery attempt fails twice.`,
    `- Show a compact status pill (color-coded) so users understand whether the system is healthy, degraded, or recovering.`,
    ``,
    `5. FINAL RESULT`,
    `The affected flow feels instant on slow networks, never blocks the UI, and Ramz One's next scan reports zero findings for "${f.id}".`,
  ].filter(Boolean).join("\n");
}
