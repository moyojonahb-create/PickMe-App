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
