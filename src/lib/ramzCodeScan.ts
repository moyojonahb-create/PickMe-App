/**
 * Ramz One — client-side code scanner.
 *
 * Uses Vite's `import.meta.glob(..., { query: '?raw', as: 'string' })` to
 * pull source files into the bundle as raw strings, batches them, and ships
 * them to the `ramz-code-scan` edge function which calls Lovable AI.
 *
 * We deliberately scope to the most bug-prone areas (hooks, lib, ride/wallet
 * flows, admin guards) to keep the payload small and the signal high.
 */
import { supabase } from '@/lib/supabaseClient';
import { heuristicScanFile } from './ramzHeuristicScan';

// Pull raw file contents at build time.
// Scans the entire src/ tree EXCEPT test files, generated Supabase types, and the
// scanner internals themselves (they trip their own rules with literal regex strings).
const RAW_MODULES = import.meta.glob(
  [
    '/src/**/*.{ts,tsx}',
    '!/src/test/**',
    '!/src/integrations/supabase/types.ts',
    '!/src/integrations/supabase/client.ts',
    '!/src/lib/ramzCodeScan.ts',
    '!/src/lib/ramzHeuristicScan.ts',
    '!/src/lib/ramzPatch.ts',
    '!/src/lib/ramzPrompt.ts',
    '!/src/lib/ramzAudit.ts',
    '!/src/components/admin/RamzCodeScanPanel.tsx',
    '!/src/vite-env.d.ts',
  ],
  { query: '?raw', import: 'default', eager: false },
) as Record<string, () => Promise<string>>;

export interface CodeFinding {
  file: string;
  line: number;
  severity: 'critical' | 'high' | 'medium' | 'low';
  category:
    | 'bug'
    | 'react'
    | 'supabase'
    | 'security'
    | 'performance'
    | 'accessibility'
    | 'type-safety'
    | 'scalability'
    | 'mobile'
    | 'realtime'
    | 'database'
    | 'ux'
    | 'reliability';
  title: string;
  description: string;
  suggestion: string;
  /** Optional deeper engineering context produced by the upgraded AI engine. */
  rootCause?: string;
  userImpact?: string;
  scalabilityImpact?: string;
  performanceImpact?: string;
  securityImpact?: string;
  implementationDetails?: string;
  expectedResult?: string;
}

export interface ScanProgress {
  scanned: number;
  total: number;
  currentBatch: string[];
}

export interface ScanResult {
  findings: CodeFinding[];
  scannedFiles: string[];
  batches: number;
}

const BATCH_SIZE = 6;

export async function listScannableFiles(): Promise<string[]> {
  return Object.keys(RAW_MODULES).sort();
}

export async function runCodeScan(
  options: {
    fileFilter?: (path: string) => boolean;
    onProgress?: (p: ScanProgress) => void;
    /** When true, skip the AI gateway entirely and only run local heuristics. */
    heuristicOnly?: boolean;
  } = {},
): Promise<ScanResult> {
  const allPaths = Object.keys(RAW_MODULES).filter(options.fileFilter ?? (() => true));
  const findings: CodeFinding[] = [];
  const scannedFiles: string[] = [];
  let aiDisabled = options.heuristicOnly === true;

  for (let i = 0; i < allPaths.length; i += BATCH_SIZE) {
    const batch = allPaths.slice(i, i + BATCH_SIZE);
    options.onProgress?.({ scanned: i, total: allPaths.length, currentBatch: batch });

    const files = await Promise.all(
      batch.map(async (path) => ({
        path: path.replace(/^\//, ''),
        content: await RAW_MODULES[path](),
      })),
    );

    // ALWAYS run the local heuristic scanner — it costs nothing and works offline.
    for (const f of files) {
      const local = heuristicScanFile(f.path, f.content);
      findings.push(...local);
      scannedFiles.push(f.path);
    }

    // Optionally augment with AI findings when credits/quota are available.
    if (aiDisabled) continue;

    const { data, error } = await supabase.functions.invoke('ramz-code-scan', {
      body: { files },
    });

    if (error) {
      console.warn('ramz-code-scan AI batch failed — continuing with heuristic results.', error);
      aiDisabled = true; // stop hammering the gateway for the rest of the run
      continue;
    }

    if (data?.fallback) {
      // 402 / 429 / gateway error — keep scanning with heuristics only.
      console.warn('ramz-code-scan AI fallback signaled:', data?.error);
      aiDisabled = true;
      continue;
    }

    if (Array.isArray(data?.findings)) {
      for (const f of data.findings as CodeFinding[]) {
        if (f && typeof f.file === 'string') findings.push(f);
      }
    }
  }

  options.onProgress?.({ scanned: allPaths.length, total: allPaths.length, currentBatch: [] });

  // De-duplicate (same file + line + title).
  const dedup = new Map<string, CodeFinding>();
  for (const f of findings) {
    const key = `${f.file}:${f.line}:${f.title}`;
    if (!dedup.has(key)) dedup.set(key, f);
  }
  const unique = Array.from(dedup.values());

  // Sort by severity (critical first) then by file.
  const sevRank = { critical: 0, high: 1, medium: 2, low: 3 } as const;
  unique.sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || a.file.localeCompare(b.file));

  return { findings: unique, scannedFiles: Array.from(new Set(scannedFiles)), batches: Math.ceil(allPaths.length / BATCH_SIZE) };
}

export function findingToLovablePrompt(f: CodeFinding): string {
  const sections: string[] = [
    `# ${f.title}`,
    `Location: ${f.file}:${f.line}`,
    `Severity: ${f.severity.toUpperCase()} · Category: ${f.category}`,
    '',
    '## PROBLEM',
    f.description,
  ];
  if (f.rootCause) sections.push('', '## ROOT CAUSE', f.rootCause);
  if (f.userImpact) sections.push('', '## USER IMPACT', f.userImpact);
  sections.push('', '## SEVERITY', f.severity);
  if (f.scalabilityImpact) sections.push('', '## SCALABILITY IMPACT', f.scalabilityImpact);
  if (f.performanceImpact) sections.push('', '## PERFORMANCE IMPACT', f.performanceImpact);
  if (f.securityImpact) sections.push('', '## SECURITY IMPACT', f.securityImpact);
  sections.push('', '## REQUIRED FIX', f.suggestion);
  if (f.implementationDetails) sections.push('', '## IMPLEMENTATION DETAILS', f.implementationDetails);
  else sections.push('', '## IMPLEMENTATION DETAILS', `- File: ${f.file}`, `- Line: ${f.line}`);
  if (f.expectedResult) sections.push('', '## EXPECTED RESULT', f.expectedResult);
  else sections.push('', '## EXPECTED RESULT', 'Re-running Ramz One reports no finding for this location and no regression in surrounding behavior.');
  return sections.join('\n');
}

/**
 * Combine every finding into ONE Lovable prompt that an admin can paste into
 * Lovable chat to fix the entire system in a single turn.
 */
export function findingsToCombinedLovablePrompt(findings: CodeFinding[]): string {
  if (findings.length === 0) {
    return 'Ramz One full system scan: no issues detected. Nothing to fix.';
  }
  const sevRank = { critical: 0, high: 1, medium: 2, low: 3 } as const;
  const sorted = [...findings].sort(
    (a, b) => sevRank[a.severity] - sevRank[b.severity] || a.file.localeCompare(b.file),
  );

  const byFile = new Map<string, CodeFinding[]>();
  for (const f of sorted) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file)!.push(f);
  }

  const counts = sorted.reduce(
    (acc, f) => ({ ...acc, [f.severity]: (acc[f.severity] ?? 0) + 1 }),
    {} as Record<string, number>,
  );

  const lines: string[] = [];
  lines.push('FULL SYSTEM FIX — Ramz One production engineering scan');
  lines.push('');
  lines.push(`Total findings: ${sorted.length} (critical: ${counts.critical ?? 0}, high: ${counts.high ?? 0}, medium: ${counts.medium ?? 0}, low: ${counts.low ?? 0})`);
  lines.push('');
  lines.push('GOAL:');
  lines.push('Apply every fix below in a single pass. Preserve surrounding behavior. After applying, the next Ramz One scan must report zero findings for these locations.');
  lines.push('');
  lines.push('FIXES BY FILE:');
  lines.push('');

  let idx = 1;
  for (const [file, items] of byFile) {
    lines.push(`### ${file}`);
    for (const f of items) {
      lines.push(`${idx}. [${f.severity.toUpperCase()} · ${f.category}] ${f.title} (line ${f.line})`);
      lines.push(`   - Problem: ${f.description}`);
      if (f.rootCause) lines.push(`   - Root cause: ${f.rootCause}`);
      if (f.userImpact) lines.push(`   - User impact: ${f.userImpact}`);
      if (f.scalabilityImpact) lines.push(`   - Scalability: ${f.scalabilityImpact}`);
      if (f.performanceImpact) lines.push(`   - Performance: ${f.performanceImpact}`);
      if (f.securityImpact) lines.push(`   - Security: ${f.securityImpact}`);
      lines.push(`   - Required fix: ${f.suggestion}`);
      if (f.expectedResult) lines.push(`   - Expected result: ${f.expectedResult}`);
      lines.push('');
      idx++;
    }
  }

  lines.push('ACCEPTANCE CRITERIA:');
  lines.push('- All listed issues resolved.');
  lines.push('- No new TypeScript or runtime errors.');
  lines.push('- Existing tests still pass.');
  lines.push('- Mobile, realtime, wallet, and GPS flows remain stable under production load.');
  return lines.join('\n');
}
