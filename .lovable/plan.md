# Major upgrade: Ramz One Code Scan + Admin System Health

## Problem

**Ramz Code Scan returns ~0 findings** because:
1. The scan glob only covers `src/hooks/**`, `src/lib/**`, `src/components/{ride,wallet,admin}/**`, and 4 pages — roughly 15% of the codebase. The biggest risk surfaces (driver components, map components, all pages, integrations, edge functions) are invisible to the scanner.
2. Heuristic ruleset is solid but only ~20 rules; many high-signal patterns (missing `useEffect` deps, hard-coded HEX colors, empty `catch`, unguarded `JSON.parse`, `.then` without `.catch`, missing `key` on lists, fetch without timeout, `as any` casts, etc.) are not checked.
3. AI batches run **serially** at 6 files per batch — slow, and on a 200-file codebase the first AI failure disables AI for the remainder.
4. AI model is `gpt-4o-mini` and the prompt asks for many optional fields, so the tool call often returns an empty `findings` array.

**System Health lacks operational signal** — it shows static heuristic counts but doesn't expose the live state of the platform (stuck rides, locked wallets, payment failures, stale GPS, edge function errors, realtime backlog, driver fleet posture).

## Scope of this pass

Frontend-only. No DB migrations, no edge function rewrites. We touch the scanner library, the scan edge function prompt, and the System Health page composition.

---

## Part 1 — Ramz Code Scan: 5x more findings, 3x faster

### `src/lib/ramzCodeScan.ts`
- Widen the `import.meta.glob` pattern to cover **all** `src/**/*.{ts,tsx}` (except `src/test/**`, `src/integrations/supabase/types.ts`, and the scanner files themselves).
- Add an explicit exclude list for `src/test/**` and generated types.
- Run AI batches with `Promise.allSettled` in groups of 3 concurrent batches (3× throughput). Keep BATCH_SIZE=6.
- Stop disabling AI on the first failure — only disable after 2 consecutive failures.
- Sort by severity then by category so users see security/critical first.

### `src/lib/ramzHeuristicScan.ts` — add ~20 new rules
- `useeffect-missing-deps` — `useEffect(() => { ... someVar ... }, [])` where `someVar` is a closure var.
- `hardcoded-hex-color` — `#[0-9a-f]{3,8}` in `.tsx` (violates the design-system token rule).
- `empty-catch` — `catch (e) {}` or `catch {}`.
- `unguarded-json-parse` — `JSON.parse(...)` without `try`.
- `promise-no-catch` — `.then(...)` chain without `.catch(...)` and not awaited.
- `missing-list-key` — `.map((x) => <Component ...>)` without `key=`.
- `fetch-no-abort` — `fetch(` without an `AbortController` signal.
- `as-any-cast` — `as any` casts (separate from declared `: any`).
- `inline-credentials` — long string literals matching `eyJ` (JWT) or `sk-` (API key) outside test files.
- `unbounded-array-state` — `useState<...[]>([])` pushed to without a cap on hot paths.
- `nonNull-bang` — `!` non-null assertion on Supabase results.
- `t-key-missing` — `useTranslation` import without any `t(...)` calls (dead i18n).
- `direct-window-localStorage` — `localStorage.setItem` without `try/catch` (Safari private-mode crash).
- `img-no-alt` — `<img ` without `alt=` (a11y + scanner gives accessibility category).
- `navigate-in-effect-no-cleanup` — `navigate(` inside `useEffect` without a guard against unmount.
- `gps-no-options` — `getCurrentPosition(` / `watchPosition(` without `{ enableHighAccuracy, timeout, maximumAge }`.
- `realtime-on-without-binding` — `.channel(...).on(...)` without a `event:` filter.
- `tostring-undefined-risk` — `.toString()` on a possibly-undefined value (string + `?.toString()` would be safer).
- `inline-style-large` — `style={{ ... }}` with > 4 props (move to className).
- `dangerous-rpc-userinput` — `supabase.rpc(` argument constructed via template string with `${`.

Each rule includes `rootCause`, `userImpact`, `suggestion`, `expectedResult` to populate the existing finding renderer.

### `supabase/functions/ramz-code-scan/index.ts`
- Bump `MAX_FILES_PER_BATCH` 12 → 16, `MAX_BYTES_PER_FILE` 18k → 28k.
- Switch default OpenAI model `gpt-4o-mini` → `gpt-5.4-mini` (better tool-calling, more findings).
- Tighten the system prompt to: "Emit at least one finding per file unless the file is genuinely flawless. Prefer false positives over silence — the human will triage."
- Make `rootCause`, `userImpact`, `scalabilityImpact`, etc. **optional** in the tool schema so the model doesn't drop findings when it can't fill them.

---

## Part 2 — Admin System Health: live operational dashboard

Add a new top section to `src/pages/admin/AdminSystemHealth.tsx` (kept above the existing tabs, doesn't remove anything):

### New `SystemSignals` component (`src/components/admin/SystemSignals.tsx`)
A 6-card live grid that polls every 30s:

1. **Ride Pipeline** — pending rides, accepted-but-stale (>15 min), in_progress without GPS in 5 min, completed in last 1h.
2. **Wallet Integrity** — locked wallets, `payment_failed` rides last 24h, negative-balance drivers, deposits awaiting approval.
3. **Driver Fleet** — online drivers, on-trip, idle >30 min while online, fatigued (12h+).
4. **Realtime / GPS** — `live_locations` rows updated in last 60s, drivers with no GPS ping in 5 min while on-trip, average ping age.
5. **Auth & Security** — unresolved `fraud_flags`, SOS alerts last 24h, failed OTPs last hour, admin-flagged users.
6. **Performance** — slowest edge functions last 1h (top 3 from analytics), recent 5xx count, recent rate-limit hits.

Each card shows:
- One headline number with delta vs 24h ago
- 2–3 sub-rows with mini-counts
- A severity dot (green / amber / red) computed from thresholds
- A "View details" button that drops the row into a drawer with the actual offending rows

### `src/lib/systemSignals.ts` — query helpers
Pure data layer that returns each card's snapshot. Reuses `supabase` client with `.maybeSingle()` and explicit column lists per project rules.

### Health Score
Top of the page: a single big "Platform Health Score" 0–100 = 100 − weighted sum of severity dots. Green ≥90, amber 70–89, red <70.

---

## Out of scope (call out, do not build)
- DB indexes / migrations (Ramz One will surface missing indexes as findings instead).
- Reworking the existing tabs (LoadPulse, UserIncidents, RamzCodeScan) — they stay.
- Streaming AI responses — not needed for a batch scanner.

---

## Acceptance criteria
- A fresh scan produces **≥ 50 heuristic findings** on the current codebase (up from ~5–10 today).
- AI batches run with up to 3 in flight; one failed batch no longer disables the rest.
- `/admin/system-health` shows the new 6-card live grid with real data within 5 s of load.
- No new TS errors, no regressions in the existing tabs.
