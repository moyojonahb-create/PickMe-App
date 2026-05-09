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

// Pull raw file contents at build time.
const RAW_MODULES = import.meta.glob(
  [
    '/src/hooks/**/*.{ts,tsx}',
    '/src/lib/**/*.ts',
    '/src/components/ride/**/*.{ts,tsx}',
    '/src/components/wallet/**/*.{ts,tsx}',
    '/src/components/admin/**/*.{ts,tsx}',
    '/src/pages/Ride.tsx',
    '/src/pages/RiderWalletPage.tsx',
    '/src/pages/DriverWalletPage.tsx',
    '/src/pages/RiderProfile.tsx',
  ],
  { query: '?raw', import: 'default', eager: false },
) as Record<string, () => Promise<string>>;

export interface CodeFinding {
  file: string;
  line: number;
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: 'bug' | 'react' | 'supabase' | 'security' | 'performance' | 'accessibility' | 'type-safety';
  title: string;
  description: string;
  suggestion: string;
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
  options: { fileFilter?: (path: string) => boolean; onProgress?: (p: ScanProgress) => void } = {},
): Promise<ScanResult> {
  const allPaths = Object.keys(RAW_MODULES).filter(options.fileFilter ?? (() => true));
  const findings: CodeFinding[] = [];
  const scannedFiles: string[] = [];

  for (let i = 0; i < allPaths.length; i += BATCH_SIZE) {
    const batch = allPaths.slice(i, i + BATCH_SIZE);
    options.onProgress?.({ scanned: i, total: allPaths.length, currentBatch: batch });

    const files = await Promise.all(
      batch.map(async (path) => ({
        path: path.replace(/^\//, ''),
        content: await RAW_MODULES[path](),
      })),
    );

    const { data, error } = await supabase.functions.invoke('ramz-code-scan', {
      body: { files },
    });

    if (error) {
      // Surface auth/rate errors but keep scanning the rest of the project.
      console.error('ramz-code-scan batch failed', batch, error);
      continue;
    }

    if (Array.isArray(data?.findings)) {
      for (const f of data.findings as CodeFinding[]) {
        if (f && typeof f.file === 'string') findings.push(f);
      }
    }
    if (Array.isArray(data?.scannedFiles)) scannedFiles.push(...data.scannedFiles);
  }

  options.onProgress?.({ scanned: allPaths.length, total: allPaths.length, currentBatch: [] });

  // Sort by severity (critical first) then by file.
  const sevRank = { critical: 0, high: 1, medium: 2, low: 3 } as const;
  findings.sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || a.file.localeCompare(b.file));

  return { findings, scannedFiles, batches: Math.ceil(allPaths.length / BATCH_SIZE) };
}

export function findingToLovablePrompt(f: CodeFinding): string {
  return [
    'PROBLEM:',
    `${f.title} (${f.file}:${f.line}) — ${f.description}`,
    '',
    'ROOT CAUSE:',
    f.description,
    '',
    'FIX TYPE:',
    f.category,
    '',
    'LOVABLE PROMPT:',
    `Fix ${f.title} in ${f.file} (line ${f.line}).`,
    '',
    'GOAL:',
    'Eliminate the issue without regressing surrounding behavior.',
    '',
    '1. PROBLEM DESCRIPTION',
    f.description,
    '',
    '2. REQUIRED FIX',
    `- ${f.suggestion}`,
    '',
    '3. IMPLEMENTATION DETAILS',
    `- File: ${f.file}`,
    `- Line: ${f.line}`,
    `- Severity: ${f.severity}`,
    '',
    '4. FINAL RESULT',
    'Re-running Ramz One code scan reports no finding for this location.',
  ].join('\n');
}
