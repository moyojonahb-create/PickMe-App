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
  test: (line: string, idx: number, lines: string[], path: string) => boolean;
}

const isTestFile = (p: string) => /\.(test|spec)\.[tj]sx?$/.test(p) || p.includes('/test/');

const RULES: Rule[] = [
  {
    id: 'select-star-large',
    category: 'performance',
    severity: 'high',
    title: 'select(*) on a large table',
    description:
      'Using select("*") on rides/live_locations/wallet_transactions/messages forces full-row reads and risks the implicit 1000-row cap.',
    suggestion: 'List only the columns you actually need, e.g. .select("id, status, fare, created_at").',
    test: (line) =>
      /\.from\(\s*['"`](rides|live_locations|wallet_transactions|messages|admin_earnings)['"`]\s*\)/.test(line) &&
      /\.select\(\s*['"`]\*['"`]\s*\)/.test(line),
  },
  {
    id: 'select-no-limit',
    category: 'performance',
    severity: 'medium',
    title: 'Supabase select without .limit()',
    description:
      'Selects without .limit(), .single(), or .maybeSingle() silently truncate at 1000 rows and slow the connection pool under load.',
    suggestion: 'Add .limit(N) when listing, or .maybeSingle() when fetching one row.',
    test: (line, idx, lines) => {
      if (!/\.select\(/.test(line)) return false;
      // Look 6 lines ahead for chained terminators.
      const window = lines.slice(idx, idx + 6).join(' ');
      if (/\.(limit|single|maybeSingle|range|count)\s*\(/.test(window)) return false;
      // Skip obvious .insert/.update/.delete chains.
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
    suggestion: 'Replace .single() with .maybeSingle() and handle the null case.',
    test: (line) => /\.single\(\s*\)/.test(line) && !/maybeSingle/.test(line),
  },
  {
    id: 'channel-no-cleanup',
    category: 'react',
    severity: 'high',
    title: 'Realtime channel without cleanup',
    description:
      'supabase.channel(...).subscribe() inside useEffect leaks listeners on unmount and burns Realtime quota.',
    suggestion: 'Return a cleanup that calls supabase.removeChannel(channel).',
    test: (line, idx, lines, path) => {
      if (!/supabase\.channel\(/.test(line)) return false;
      const window = lines.slice(Math.max(0, idx - 8), idx + 30).join('\n');
      if (!/useEffect\s*\(/.test(window)) return false;
      return !/removeChannel\s*\(/.test(window);
    },
  },
  {
    id: 'fast-poll',
    category: 'performance',
    severity: 'medium',
    title: 'setInterval polling under 10s',
    description:
      'Tight polling intervals multiply backend load with concurrent users — prefer a Realtime subscription.',
    suggestion: 'Replace with supabase.channel().on("postgres_changes", ...) or raise the interval to ≥10000 ms.',
    test: (line) => {
      const m = line.match(/setInterval\s*\([^,]+,\s*(\d+)\s*\)/);
      if (!m) return false;
      const ms = Number(m[1]);
      return ms > 0 && ms < 10000;
    },
  },
  {
    id: 'await-in-loop',
    category: 'performance',
    severity: 'high',
    title: 'Supabase call inside a loop (N+1)',
    description: 'Awaiting supabase.from(...) inside .map/.forEach/for issues one network round-trip per row.',
    suggestion: 'Batch with a single .in("id", ids) query and join in memory.',
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
    description: 'Explicit `: any` disables checking at the call-site and hides Supabase shape mismatches.',
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
    suggestion: 'Import { supabase } from "@/integrations/supabase/client".',
    test: (line, idx, lines, path) => {
      if (path.endsWith('supabase/client.ts') || path.endsWith('supabaseClient.ts')) return false;
      return /https:\/\/[a-z0-9]+\.supabase\.co/.test(line) || /createClient\(\s*['"]https/.test(line);
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
      });
    }
  }
  return out;
}
