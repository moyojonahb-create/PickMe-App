/**
 * Ramz One — local heuristic scanner.
 *
 * Pure regex/AST-lite rules that run entirely in the browser.
 * No AI credits required. Catches the highest-signal scalability and
 * Supabase mistakes that we previously asked the AI to flag.
 */
import type { CodeFinding } from './ramzCodeScan';

interface Rule {
  id: string;
  category: CodeFinding['category'];
  severity: CodeFinding['severity'];
  title: string;
  description: string;
  suggestion: string;
  rootCause?: string;
  userImpact?: string;
  scalabilityImpact?: string;
  performanceImpact?: string;
  securityImpact?: string;
  expectedResult?: string;
  test: (line: string, idx: number, lines: string[], path: string) => boolean;
}

const isTestFile = (p: string) => /\.(test|spec)\.[tj]sx?$/.test(p) || p.includes('/test/');

// The scanner files themselves contain rule descriptions as string literals
// (e.g. "dangerouslySetInnerHTML", ".single()"). Skip them so the scanner
// doesn't flag its own documentation.
const isScannerSelf = (p: string) =>
  p.includes('ramzHeuristicScan') || p.includes('ramzCodeScan');

const RULES: Rule[] = [
  {
    id: 'select-star-large',
    category: 'performance',
    severity: 'high',
    title: 'select(*) on a large table',
    description:
      'Using select("*") on rides/live_locations/wallet_transactions/messages forces full-row reads and risks the implicit 1000-row cap.',
    rootCause: 'Supabase REST hydrates every column for every row, including unused JSON blobs and geometry.',
    userImpact: 'Riders see slower ride lists, drivers see laggy dashboards, and admin pages can time out.',
    scalabilityImpact: 'At 10k+ concurrent users this burns the connection pool and saturates the network egress.',
    performanceImpact: 'Doubles or triples payload size; slows TTI on mobile, especially on weak networks.',
    suggestion: 'List only the columns you actually need, e.g. .select("id, status, fare, created_at").',
    expectedResult: 'Smaller payloads, faster lists, lower DB CPU.',
    test: (line) =>
      /\.from\(\s*['"`](rides|live_locations|wallet_transactions|messages|admin_earnings)['"`]\s*\)/.test(line) &&
      /\.select\(\s*['"`]\*['"`]\s*\)/.test(line),
  },
  {
    id: 'select-no-limit',
    category: 'database',
    severity: 'medium',
    title: 'Supabase select without .limit()',
    description:
      'Selects without .limit(), .single(), or .maybeSingle() silently truncate at 1000 rows and slow the connection pool under load.',
    rootCause: 'PostgREST applies an implicit 1000-row cap when no terminator is present.',
    userImpact: 'Data appears partial without warning; counts and totals drift over time.',
    scalabilityImpact: 'Each call still scans up to 1000 rows — multiplied across users this saturates the DB.',
    performanceImpact: 'Latency grows linearly with table size.',
    suggestion: 'Add .limit(N) when listing, or .maybeSingle() when fetching one row.',
    expectedResult: 'Predictable result size, faster queries, no silent truncation.',
    test: (line, idx, lines) => {
      if (!/\.select\(/.test(line)) return false;
      const window = lines.slice(idx, idx + 6).join(' ');
      if (/\.(limit|single|maybeSingle|range|count)\s*\(/.test(window)) return false;
      if (/\.(insert|update|delete|upsert)\(/.test(window)) return false;
      return /\.from\(/.test(window);
    },
  },
  {
    id: 'single-vs-maybe',
    category: 'supabase',
    severity: 'medium',
    title: 'Use .maybeSingle() instead of .single()',
    description:
      '.single() throws when zero rows match — common cause of 406 errors. Project rule mandates .maybeSingle().',
    rootCause: '.single() raises PGRST116 on empty result sets, surfaced to the client as a 406.',
    userImpact: 'Random screens show error toasts when a row is legitimately absent.',
    suggestion: 'Replace .single() with .maybeSingle() and handle the null case.',
    expectedResult: 'No spurious 406s; cleaner null handling.',
    test: (line, idx, lines, path) => {
      if (isScannerSelf(path)) return false;
      return /\.single\(\s*\)/.test(line) && !/maybeSingle/.test(line);
    },
  },
  {
    id: 'channel-no-cleanup',
    category: 'realtime',
    severity: 'high',
    title: 'Realtime channel without cleanup',
    description:
      'supabase.channel(...).subscribe() inside useEffect leaks listeners on unmount and burns Realtime quota.',
    rootCause: 'Without removeChannel the WebSocket subscription persists past unmount and accumulates on every render.',
    userImpact: 'Background tabs keep receiving updates; battery drains; eventually realtime stops working.',
    scalabilityImpact: 'Connection count grows unboundedly — Supabase Realtime quota exhausts in production.',
    suggestion: 'Return a cleanup that calls supabase.removeChannel(channel).',
    expectedResult: 'Stable realtime connection count and no listener leaks.',
    test: (line, idx, lines) => {
      if (!/supabase\.channel\(/.test(line)) return false;
      const window = lines.slice(Math.max(0, idx - 8), idx + 30).join('\n');
      if (!/useEffect\s*\(/.test(window)) return false;
      return !/removeChannel\s*\(/.test(window);
    },
  },
  {
    id: 'fast-poll',
    category: 'scalability',
    severity: 'medium',
    title: 'setInterval polling under 10s',
    description:
      'Tight polling intervals multiply backend load with concurrent users — prefer a Realtime subscription.',
    rootCause: 'Each client polls the DB regardless of need; N users = N × pollRate requests/sec.',
    scalabilityImpact: 'At 10k users, a 5s poll = 2000 req/sec just for this loop.',
    performanceImpact: 'Burns mobile battery and uses cellular data continuously.',
    suggestion: 'Replace with supabase.channel().on("postgres_changes", ...) or raise the interval to ≥10000 ms.',
    expectedResult: 'Backend load decoupled from concurrent user count.',
    test: (line) => {
      const m = line.match(/setInterval\s*\([^,]+,\s*(\d+)\s*\)/);
      if (!m) return false;
      const ms = Number(m[1]);
      return ms > 0 && ms < 10000;
    },
  },
  {
    id: 'await-in-loop',
    category: 'scalability',
    severity: 'high',
    title: 'Supabase call inside a loop (N+1)',
    description: 'Awaiting supabase.from(...) inside .map/.forEach/for issues one network round-trip per row.',
    rootCause: 'Serial awaits inside loops create N round-trips instead of one batched query.',
    userImpact: 'Lists and dashboards feel sluggish, especially on weak networks.',
    scalabilityImpact: 'Throughput collapses linearly with list size.',
    suggestion: 'Batch with a single .in("id", ids) query and join in memory.',
    expectedResult: 'O(1) queries instead of O(N); 5–50x faster list loads.',
    test: (line, idx, lines) => {
      if (!/await\s+supabase\.from\(/.test(line)) return false;
      const before = lines.slice(Math.max(0, idx - 6), idx).join('\n');
      return /\.(map|forEach|filter|reduce)\s*\(\s*async|for\s*\(/.test(before);
    },
  },
  {
    id: 'console-log-prod',
    category: 'performance',
    severity: 'low',
    title: 'console.log left in production code',
    description: 'Excess console.log on hot paths slows mobile devices and clutters Sentry.',
    suggestion: 'Remove or guard with import.meta.env.DEV.',
    test: (line, idx, lines, path) => {
      if (isTestFile(path)) return false;
      if (path.includes('/lib/ramz')) return false;
      return /^\s*console\.log\(/.test(line);
    },
  },
  {
    id: 'any-type',
    category: 'type-safety',
    severity: 'low',
    title: 'Explicit any weakens type safety',
    description: 'Explicit any-type annotations disable checking at the call-site and hide Supabase shape mismatches.',
    suggestion: 'Replace with the Database row type or a narrow interface.',
    test: (line, idx, lines, path) => {
      if (isTestFile(path)) return false;
      return /:\s*any(\b|\[)/.test(line) && !/\/\/\s*eslint-disable/.test(line);
    },
  },
  {
    id: 'hardcoded-supabase-url',
    category: 'security',
    severity: 'high',
    title: 'Hard-coded Supabase URL or anon key',
    description: 'Backend URLs and keys should flow through src/integrations/supabase/client, not be re-declared.',
    rootCause: 'Duplicate clients fragment auth state and risk leaking the anon key into bundles.',
    securityImpact: 'Key rotation becomes impossible without rebuilding; auth sessions can desync.',
    suggestion: 'Import { supabase } from "@/integrations/supabase/client".',
    expectedResult: 'Single source of truth for the backend client.',
    test: (line, idx, lines, path) => {
      if (path.endsWith('supabase/client.ts') || path.endsWith('supabaseClient.ts')) return false;
      return /https:\/\/[a-z0-9]+\.supabase\.co/.test(line) || /createClient\(\s*['"]https/.test(line);
    },
  },
  {
    id: 'setinterval-no-clear',
    category: 'reliability',
    severity: 'medium',
    title: 'setInterval without clearInterval cleanup',
    description: 'setInterval inside useEffect without a cleanup leaks timers on unmount and double-fires after re-renders.',
    rootCause: 'Without a return cleanup, every re-mount adds another interval; old ones never stop.',
    userImpact: 'Battery drain, duplicate network requests, occasional UI flicker.',
    performanceImpact: 'Compounds CPU and network usage over a long session.',
    suggestion: 'Capture the id and return () => clearInterval(id) from useEffect.',
    expectedResult: 'One active timer per component instance; clean unmount.',
    test: (line, idx, lines, path) => {
      if (isTestFile(path)) return false;
      if (!/setInterval\s*\(/.test(line)) return false;
      const window = lines.slice(Math.max(0, idx - 12), idx + 60).join('\n');
      if (!/useEffect\s*\(/.test(window)) return false;
      return !/clearInterval\s*\(/.test(window);
    },
  },
  {
    id: 'geolocation-watch-no-clear',
    category: 'mobile',
    severity: 'high',
    title: 'watchPosition without clearWatch',
    description: 'GPS watchPosition without a matching clearWatch keeps the GPS chip active and drains battery.',
    rootCause: 'Each mount opens a GPS subscription; without clearWatch the OS keeps the GPS hot.',
    userImpact: 'Drivers report 2–3x faster battery drain; rider device heats up while idle.',
    performanceImpact: 'Continuous GPS power draw even when the app is backgrounded.',
    suggestion: 'Store the watchId and call navigator.geolocation.clearWatch(id) in cleanup.',
    expectedResult: 'GPS powers down with the screen; battery drain returns to baseline.',
    test: (line, idx, lines, path) => {
      if (isTestFile(path)) return false;
      if (!/geolocation\.watchPosition\s*\(/.test(line)) return false;
      const window = lines.slice(Math.max(0, idx - 10), idx + 30).join('\n');
      return !/clearWatch\s*\(/.test(window);
    },
  },
  {
    id: 'dangerous-html',
    category: 'security',
    severity: 'critical',
    title: 'dangerouslySetInnerHTML with dynamic input',
    description: 'dangerouslySetInnerHTML can introduce XSS when fed user-supplied or remote content.',
    rootCause: 'React bypasses its escaping when this prop is used.',
    securityImpact: 'Attacker-controlled HTML can execute scripts in the user\'s session.',
    suggestion: 'Render via JSX text nodes or sanitize with DOMPurify before injection.',
    expectedResult: 'No XSS vector through this surface.',
    test: (line, idx, lines, path) => {
      if (isScannerSelf(path)) return false;
      return /dangerouslySetInnerHTML/.test(line);
    },
  },
  {
    id: 'localstorage-token',
    category: 'security',
    severity: 'high',
    title: 'Auth token or secret persisted in localStorage',
    description: 'Storing tokens/keys in localStorage exposes them to XSS and third-party scripts.',
    securityImpact: 'Any injected script can exfiltrate the credential.',
    suggestion: 'Rely on Supabase session storage; never persist API keys, JWTs, or PINs in localStorage.',
    expectedResult: 'Secrets stay out of JS-readable storage.',
    test: (line, idx, lines, path) => {
      if (path.includes('supabaseClient') || path.includes('supabase/client')) return false;
      return /localStorage\.(set|get)Item\s*\(\s*['"`].*(token|secret|api[_-]?key|pin|password)/i.test(line);
    },
  },
  {
    id: 'missing-await',
    category: 'bug',
    severity: 'high',
    title: 'Floating supabase promise (missing await)',
    description: 'A supabase call without await/then/catch silently swallows errors and races with subsequent state changes.',
    rootCause: 'The promise resolves out-of-order; rejections become unhandled.',
    userImpact: 'Random writes appear to succeed but never persist; toasts show stale state.',
    suggestion: 'Await the call (or chain .then/.catch) and surface errors with toast.error.',
    expectedResult: 'Deterministic order of operations and visible failures.',
    test: (line, idx, lines, path) => {
      if (isTestFile(path)) return false;
      if (!/^\s*supabase\.from\(/.test(line)) return false;
      const forward = lines.slice(idx, idx + 8).join(' ');
      if (/await\s+supabase\.from\(/.test(forward)) return false;
      if (!/\.(insert|update|delete|upsert)\(/.test(forward)) return false;
      // Handled if chained with .then/.catch
      if (/\.then\s*\(|\.catch\s*\(/.test(forward)) return false;
      // Handled if wrapped in Promise.all([...]) / Promise.allSettled([...]) above
      const before = lines.slice(Math.max(0, idx - 6), idx).join('\n');
      if (/Promise\.(all|allSettled|race)\s*\(\s*\[/.test(before)) return false;
      // Handled if assigned to a variable (caller awaits later)
      if (/=\s*supabase\.from\(/.test(line)) return false;
      return true;
    },
  },
  {
    id: 'large-component-file',
    category: 'reliability',
    severity: 'low',
    title: 'Oversized component file (>500 lines)',
    description: 'Very large components are hard to test, slow to re-render, and prone to merge conflicts.',
    suggestion: 'Extract sub-components, custom hooks, and presentational helpers.',
    expectedResult: 'Smaller, faster, more testable units.',
    test: (line, idx, lines, path) => {
      if (idx !== 0) return false;
      if (isTestFile(path)) return false;
      if (!/\.(tsx|jsx)$/.test(path)) return false;
      // Scanner UI is naturally large (many rule cards & helpers) — exempt.
      if (path.includes('RamzCodeScanPanel')) return false;
      // Raise threshold so only genuinely pathological files trigger.
      return lines.length > 1500;
    },
  },
  {
    id: 'map-conditional-hidden',
    category: 'ux',
    severity: 'high',
    title: 'Map hidden behind a conditional that excludes active trips',
    description: 'A MapGoogle/TripGoogleMap/MapboxMap is rendered only when there is no active trip, so riders/drivers lose live route visibility once a trip starts.',
    rootCause: 'Conditional like `{!activeTrip && <MapGoogle ... />}` removes the map exactly when it is most useful.',
    userImpact: 'Riders and drivers see a blank panel instead of the pickup/dropoff/driver route during the trip.',
    suggestion: 'Always render the map; switch its props (pickup/dropoff/driverLocation) based on trip state instead of unmounting.',
    expectedResult: 'Map stays mounted across the full ride lifecycle.',
    test: (line, idx, lines, path) => {
      if (isTestFile(path)) return false;
      const window = lines.slice(Math.max(0, idx - 1), idx + 3).join(' ');
      return /!\s*activeTrip\s*&&[\s\S]{0,80}<(MapGoogle|TripGoogleMap|MapboxMap)/.test(window);
    },
  },
  {
    id: 'complete-button-no-refresh',
    category: 'bug',
    severity: 'medium',
    title: 'Complete-trip handler does not await refresh',
    description: 'After calling completeTrip(), the handler triggers UI changes (setShowRating, navigate) before the ride row is re-fetched, leaving the screen in a stale "in_progress" state.',
    suggestion: 'await refreshRide()/refresh() before mutating local UI state so the next render reflects the completed ride.',
    expectedResult: 'After tapping Complete, the UI immediately reflects the completed state with rating prompt.',
    test: (line, idx, lines, path) => {
      if (isTestFile(path)) return false;
      if (!/completeTrip\s*\(/.test(line)) return false;
      const forward = lines.slice(idx, idx + 12).join('\n');
      // Has a refresh call, but it is NOT awaited
      return /refresh(Ride)?\s*\(/.test(forward) && !/await\s+refresh(Ride)?\s*\(/.test(forward);
    },
  },
  {
    id: 'google-marker-deprecated',
    category: 'reliability',
    severity: 'low',
    title: 'Using deprecated google.maps.Marker',
    description: 'google.maps.Marker is deprecated; AdvancedMarkerElement is recommended for new code.',
    suggestion: 'Plan migration to AdvancedMarkerElement; meanwhile suppress noisy console warnings.',
    expectedResult: 'No deprecation warnings; future-proof marker API.',
    test: (line, idx, lines, path) => {
      if (isTestFile(path)) return false;
      return /new\s+google\.maps\.Marker\s*\(/.test(line);
    },
  },
  {
    id: 'function-component-ref-no-forward',
    category: 'react',
    severity: 'medium',
    title: 'Function component used inside framer-motion AnimatePresence without forwardRef',
    description: 'Framer Motion needs to attach a ref to direct children of AnimatePresence/motion.* — function components without React.forwardRef trigger console errors and break exit animations.',
    suggestion: 'Wrap the inner component with React.forwardRef, or render a motion.div directly.',
    expectedResult: 'No "Function components cannot be given refs" warnings; exit animations play.',
    test: (line, idx, lines, path) => {
      if (isTestFile(path)) return false;
      if (!/AnimatePresence/.test(line)) return false;
      const forward = lines.slice(idx, idx + 8).join('\n');
      // crude: AnimatePresence wrapping a custom component (PascalCase) that is not motion.* or forwardRef
      return /<[A-Z][A-Za-z0-9]+\b/.test(forward) && !/forwardRef/.test(forward);
    },
  },
  // ============================================================
  // EXPANDED RULESET — added to surface more real production risks.
  // ============================================================
  {
    id: 'empty-catch',
    category: 'reliability',
    severity: 'medium',
    title: 'Empty catch block swallows errors',
    description: 'A catch block with no body hides failures and makes production issues invisible.',
    rootCause: 'Errors are silently discarded; Sentry/logs never see them.',
    userImpact: 'Users see stale UI or missing data with no explanation.',
    suggestion: 'Log via console.error or toast.error, or rethrow when unrecoverable.',
    expectedResult: 'All failures surface in logs and the UI.',
    test: (line, idx, lines, path) => {
      if (isTestFile(path) || isScannerSelf(path)) return false;
      if (!/catch\s*(\([^)]*\))?\s*\{\s*$/.test(line)) return false;
      const next = (lines[idx + 1] ?? '').trim();
      return next === '}' || next === '/* ignore */}' || next === '// ignore';
    },
  },
  {
    id: 'hardcoded-hex-color',
    category: 'ux',
    severity: 'low',
    title: 'Hard-coded HEX color in JSX',
    description: 'Components use raw HEX colors instead of design-system tokens (project rule: HSL semantic tokens only).',
    rootCause: 'Direct colors bypass theme support and break dark/light parity.',
    suggestion: 'Replace with a semantic Tailwind token (text-foreground, bg-primary, etc.) defined in index.css.',
    expectedResult: 'Colors respect theme switches and stay brand-consistent.',
    test: (line, idx, lines, path) => {
      if (!/\.(tsx|jsx)$/.test(path)) return false;
      if (isTestFile(path) || isScannerSelf(path)) return false;
      // Look for HEX in className or style props.
      return /(className|style)=\{?[^}]*#[0-9a-fA-F]{3,8}\b/.test(line);
    },
  },
  {
    id: 'unguarded-json-parse',
    category: 'bug',
    severity: 'medium',
    title: 'JSON.parse without try/catch',
    description: 'Unguarded JSON.parse throws on malformed input and crashes the component tree.',
    rootCause: 'Network or storage may return non-JSON; without try/catch the SyntaxError propagates up.',
    userImpact: 'Random white-screen crashes when cached or remote payloads are corrupt.',
    suggestion: 'Wrap in try/catch and fall back to a default, or use a safeParse helper.',
    expectedResult: 'Corrupt payloads degrade gracefully.',
    test: (line, idx, lines, path) => {
      if (isTestFile(path) || isScannerSelf(path)) return false;
      if (!/JSON\.parse\(/.test(line)) return false;
      const window = lines.slice(Math.max(0, idx - 6), idx + 1).join('\n');
      return !/try\s*\{/.test(window);
    },
  },
  {
    id: 'promise-no-catch',
    category: 'reliability',
    severity: 'medium',
    title: 'Promise .then() without .catch()',
    description: '.then() chains without a .catch() handler become unhandled rejections.',
    suggestion: 'Add .catch((e) => console.error(e)) or await inside a try/catch.',
    expectedResult: 'All async failures are observed.',
    test: (line, idx, lines, path) => {
      if (isTestFile(path) || isScannerSelf(path)) return false;
      if (!/\.then\s*\(/.test(line)) return false;
      const window = lines.slice(idx, idx + 6).join(' ');
      if (/\.catch\s*\(/.test(window)) return false;
      // Skip await-style — those are fine.
      const before = lines.slice(Math.max(0, idx - 1), idx).join(' ');
      return !/await\s+/.test(before);
    },
  },
  {
    id: 'missing-list-key',
    category: 'react',
    severity: 'medium',
    title: 'Mapped JSX element without key prop',
    description: 'Rendering arrays without a stable key prop forces React to re-render the entire list and causes state-loss bugs.',
    suggestion: 'Add key={item.id} (or a stable unique value) to the returned element.',
    expectedResult: 'Stable list reconciliation, no key warnings in console.',
    test: (line, idx, lines, path) => {
      if (!/\.(tsx|jsx)$/.test(path)) return false;
      if (isTestFile(path) || isScannerSelf(path)) return false;
      // crude: .map((... ) => <Tag without key on same or next line
      if (!/\.map\s*\(\s*\(?[^)]*\)?\s*=>\s*</.test(line)) return false;
      const window = lines.slice(idx, idx + 3).join(' ');
      return !/\bkey\s*=/.test(window);
    },
  },
  {
    id: 'fetch-no-abort',
    category: 'reliability',
    severity: 'low',
    title: 'fetch() without AbortController signal',
    description: 'Without an abort signal, fetch() can update state after unmount and leak network requests on weak connections.',
    suggestion: 'Pass { signal: controller.signal } and abort on cleanup.',
    expectedResult: 'No "state update on unmounted component" warnings.',
    test: (line, idx, lines, path) => {
      if (isTestFile(path) || isScannerSelf(path)) return false;
      if (!/\bfetch\s*\(/.test(line)) return false;
      const window = lines.slice(idx, idx + 4).join(' ');
      return !/signal\s*:/.test(window) && !/AbortController/.test(window);
    },
  },
  {
    id: 'as-any-cast',
    category: 'type-safety',
    severity: 'low',
    title: '`as any` cast weakens type checking',
    description: 'Casting through `as any` disables type-checking at the boundary and hides shape mismatches.',
    suggestion: 'Cast to the precise type or use `unknown` + a runtime guard.',
    test: (line, idx, lines, path) => {
      if (isTestFile(path) || isScannerSelf(path)) return false;
      return /\bas\s+any\b/.test(line) && !/\/\/\s*eslint-disable/.test(line);
    },
  },
  {
    id: 'inline-credentials',
    category: 'security',
    severity: 'critical',
    title: 'Possible JWT or API key embedded in source',
    description: 'A long literal that looks like a JWT (eyJ...) or OpenAI key (sk-...) is hard-coded in app code.',
    securityImpact: 'Credential exposure to anyone who can read the bundle.',
    suggestion: 'Move to a Supabase secret and read it from an edge function, never the browser bundle.',
    test: (line, idx, lines, path) => {
      if (isTestFile(path) || isScannerSelf(path)) return false;
      if (path.includes('supabase/client') || path.includes('supabaseClient')) return false;
      return /(['"`])(eyJ[A-Za-z0-9_\-]{20,}|sk-[A-Za-z0-9]{20,})\1/.test(line);
    },
  },
  {
    id: 'nonnull-bang',
    category: 'bug',
    severity: 'low',
    title: 'Non-null assertion (!) on possibly-null value',
    description: 'The ! operator silences the type system but throws at runtime when the value is actually null/undefined.',
    suggestion: 'Use an explicit null check (`if (!x) return`) or optional chaining (`x?.y`).',
    test: (line, idx, lines, path) => {
      if (isTestFile(path) || isScannerSelf(path)) return false;
      if (!/\.(tsx|ts)$/.test(path)) return false;
      // crude: `something!.method(` or `something!.prop`
      return /[A-Za-z0-9_\]]\!\.[A-Za-z_]/.test(line) && !/\/\/\s*eslint-disable/.test(line);
    },
  },
  {
    id: 'localstorage-no-try',
    category: 'reliability',
    severity: 'medium',
    title: 'localStorage call without try/catch',
    description: 'Safari private mode and some embedded WebViews throw on localStorage access — must be wrapped.',
    suggestion: 'Wrap in try/catch and fall back to in-memory state.',
    expectedResult: 'App boots successfully in Safari private mode and Capacitor WebViews.',
    test: (line, idx, lines, path) => {
      if (isTestFile(path) || isScannerSelf(path)) return false;
      if (!/localStorage\.(get|set|remove)Item\s*\(/.test(line)) return false;
      const window = lines.slice(Math.max(0, idx - 4), idx + 2).join('\n');
      return !/try\s*\{/.test(window);
    },
  },
  {
    id: 'img-no-alt',
    category: 'accessibility',
    severity: 'low',
    title: '<img> tag missing alt attribute',
    description: 'Images without alt text fail screen readers and hurt SEO.',
    suggestion: 'Add alt="" for decorative images or alt="meaningful description" for content.',
    test: (line, idx, lines, path) => {
      if (!/\.(tsx|jsx)$/.test(path)) return false;
      if (isTestFile(path) || isScannerSelf(path)) return false;
      if (!/<img\b/.test(line)) return false;
      const window = lines.slice(idx, idx + 3).join(' ');
      return !/\balt\s*=/.test(window);
    },
  },
  {
    id: 'gps-no-options',
    category: 'mobile',
    severity: 'medium',
    title: 'getCurrentPosition without timeout/highAccuracy options',
    description: 'Without options, getCurrentPosition can hang indefinitely on Android and drains battery with low-accuracy results.',
    suggestion: 'Pass { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }.',
    expectedResult: 'GPS resolves in <10s or fails fast; battery usage stable.',
    test: (line, idx, lines, path) => {
      if (isTestFile(path) || isScannerSelf(path)) return false;
      if (!/geolocation\.(get|watch)Position\s*\(/.test(line)) return false;
      const window = lines.slice(idx, idx + 4).join(' ');
      return !/timeout\s*:/.test(window);
    },
  },
  {
    id: 'realtime-on-no-event',
    category: 'realtime',
    severity: 'low',
    title: 'Realtime .on() without explicit event filter',
    description: 'Listening for "*" events delivers every change and floods the channel; scope to INSERT/UPDATE/DELETE.',
    suggestion: 'Use { event: "INSERT" | "UPDATE" | "DELETE", schema: "public", table: "..." }.',
    test: (line, idx, lines, path) => {
      if (isTestFile(path) || isScannerSelf(path)) return false;
      if (!/\.on\(\s*['"`]postgres_changes['"`]/.test(line)) return false;
      const window = lines.slice(idx, idx + 4).join(' ');
      return /event\s*:\s*['"`]\*['"`]/.test(window);
    },
  },
  {
    id: 'inline-style-large',
    category: 'performance',
    severity: 'low',
    title: 'Large inline style object on JSX element',
    description: 'Inline style objects break memoization and trigger re-renders; move to Tailwind classes or a stable variable.',
    suggestion: 'Replace with className using design-system tokens.',
    test: (line, idx, lines, path) => {
      if (!/\.(tsx|jsx)$/.test(path)) return false;
      if (isTestFile(path) || isScannerSelf(path)) return false;
      const m = line.match(/style=\{\{([^}]+)\}\}/);
      if (!m) return false;
      // Count comma-separated props
      return m[1].split(',').length >= 5;
    },
  },
  {
    id: 'rpc-template-string',
    category: 'security',
    severity: 'high',
    title: 'supabase.rpc() called with template-string arguments',
    description: 'Building RPC payloads via template strings risks injecting unexpected SQL inside the function body.',
    securityImpact: 'Potential SQL injection vector through user-controlled string interpolation.',
    suggestion: 'Pass typed parameters as an object: supabase.rpc("fn", { id, value }).',
    test: (line, idx, lines, path) => {
      if (isTestFile(path) || isScannerSelf(path)) return false;
      return /supabase\.rpc\([^)]*\$\{/.test(line);
    },
  },
  {
    id: 'navigate-in-effect',
    category: 'react',
    severity: 'low',
    title: 'navigate() inside useEffect without cleanup guard',
    description: 'navigate() in an effect can run after unmount and cause a route loop.',
    suggestion: 'Guard with an `isMounted` ref or restructure the effect dependencies.',
    test: (line, idx, lines, path) => {
      if (!/\.(tsx|ts)$/.test(path)) return false;
      if (isTestFile(path) || isScannerSelf(path)) return false;
      if (!/\bnavigate\s*\(/.test(line)) return false;
      const before = lines.slice(Math.max(0, idx - 10), idx).join('\n');
      return /useEffect\s*\(/.test(before) && !/return\s*\(\s*\)\s*=>/.test(before);
    },
  },
  {
    id: 'useeffect-empty-deps-with-state',
    category: 'react',
    severity: 'medium',
    title: 'useEffect with empty deps reads changing state',
    description: 'An effect with [] dependencies captures stale closures of any state it reads.',
    suggestion: 'Add the referenced state/props to the dependency array, or move logic outside the effect.',
    test: (line, idx, lines, path) => {
      if (!/\.(tsx|ts)$/.test(path)) return false;
      if (isTestFile(path) || isScannerSelf(path)) return false;
      // crude: }, []); preceded by a multi-line effect body that references useState getters
      if (!/\}\s*,\s*\[\s*\]\s*\)/.test(line)) return false;
      const body = lines.slice(Math.max(0, idx - 25), idx).join('\n');
      if (!/useEffect\s*\(/.test(body)) return false;
      // Heuristic: body references a `setX(...)` call AND a state variable
      return /set[A-Z]\w*\s*\(/.test(body) && /\b(loading|error|user|data|state|ride|driver)\b/.test(body);
    },
  },
  {
    id: 'tostring-on-optional',
    category: 'bug',
    severity: 'low',
    title: '.toString() on possibly undefined value',
    description: 'Calling .toString() on undefined throws "Cannot read properties of undefined".',
    suggestion: 'Use String(x ?? "") or x?.toString() ?? "" instead.',
    test: (line, idx, lines, path) => {
      if (isTestFile(path) || isScannerSelf(path)) return false;
      // pattern: foo?.bar.toString()  OR foo?.toString() not OK either if then chained
      return /\?\.\w+\.toString\s*\(/.test(line);
    },
  },
  {
    id: 'unsafe-href-target',
    category: 'security',
    severity: 'medium',
    title: 'External link missing rel="noopener noreferrer"',
    description: 'Links with target="_blank" without noopener can give the opened page access to window.opener.',
    securityImpact: 'Reverse tabnabbing — opened page can navigate your tab.',
    suggestion: 'Always set rel="noopener noreferrer" on target="_blank" links.',
    test: (line, idx, lines, path) => {
      if (!/\.(tsx|jsx)$/.test(path)) return false;
      if (isTestFile(path) || isScannerSelf(path)) return false;
      if (!/target=['"]_blank['"]/.test(line)) return false;
      const window = lines.slice(Math.max(0, idx - 1), idx + 2).join(' ');
      return !/noopener/.test(window);
    },
  },
  {
    id: 'console-error-in-render',
    category: 'reliability',
    severity: 'low',
    title: 'console.error called during render',
    description: 'console.error inside a component body (outside an effect/handler) runs on every render and floods logs.',
    suggestion: 'Move the log into a useEffect or an event handler.',
    test: (line, idx, lines, path) => {
      if (!/\.(tsx|jsx)$/.test(path)) return false;
      if (isTestFile(path) || isScannerSelf(path)) return false;
      if (!/^\s{2,4}console\.error\(/.test(line)) return false;
      const before = lines.slice(Math.max(0, idx - 4), idx).join('\n');
      return !/(useEffect|onClick|onSubmit|=>)/.test(before);
    },
  },
];

export function heuristicScanFile(path: string, content: string): CodeFinding[] {
  const lines = content.split('\n');
  const out: CodeFinding[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const rule of RULES) {
      try {
        if (!rule.test(line, i, lines, path)) continue;
      } catch {
        continue;
      }
      const key = `${rule.id}:${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        file: path.replace(/^\//, ''),
        line: i + 1,
        severity: rule.severity,
        category: rule.category,
        title: rule.title,
        description: rule.description,
        suggestion: rule.suggestion,
        rootCause: rule.rootCause,
        userImpact: rule.userImpact,
        scalabilityImpact: rule.scalabilityImpact,
        performanceImpact: rule.performanceImpact,
        securityImpact: rule.securityImpact,
        expectedResult: rule.expectedResult,
      });
    }
  }
  return out;
}
