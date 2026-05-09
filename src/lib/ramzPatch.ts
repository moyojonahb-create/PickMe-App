/**
 * Ramz One — patch generation + apply helpers (client side).
 *
 * The browser cannot write to the project filesystem, so "apply" actually:
 *   1. Asks the `ramz-generate-patch` edge function for a fully patched
 *      version of the source file.
 *   2. Shows the admin a unified diff to confirm.
 *   3. On confirmation, downloads the patched file AND copies a
 *      Lovable-ready prompt that pastes the entire updated file in one
 *      step — which is how Lovable applies code changes.
 */
import { supabase } from '@/lib/supabaseClient';
import type { CodeFinding } from '@/lib/ramzCodeScan';

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

export interface PatchResult {
  path: string;
  changed: boolean;
  summary: string;
  originalContent: string;
  patchedContent: string;
}

async function loadRawFile(filePath: string): Promise<string | null> {
  const key = '/' + filePath.replace(/^\/?/, '');
  const loader = RAW_MODULES[key];
  if (!loader) return null;
  return await loader();
}

export async function generatePatchForFinding(finding: CodeFinding): Promise<PatchResult> {
  const original = await loadRawFile(finding.file);
  if (original == null) {
    throw new Error(`Source file ${finding.file} is not in the scannable set; cannot patch.`);
  }

  const { data, error } = await supabase.functions.invoke('ramz-generate-patch', {
    body: { file: { path: finding.file, content: original }, finding },
  });
  if (error) throw new Error(error.message || 'Patch generation failed');
  if (!data || data.error) throw new Error(data?.error || 'Patch generation failed');

  return {
    path: data.path ?? finding.file,
    changed: !!data.changed,
    summary: data.summary || '',
    originalContent: data.originalContent ?? original,
    patchedContent: data.patchedContent ?? original,
  };
}

/** Compact line-oriented diff. Not a real Myers diff, but enough for review. */
export interface DiffLine {
  type: 'context' | 'add' | 'remove';
  oldLine?: number;
  newLine?: number;
  text: string;
}

export function computeLineDiff(oldText: string, newText: string, contextLines = 3): DiffLine[] {
  const a = oldText.split('\n');
  const b = newText.split('\n');
  // LCS table — bounded by file size ceiling already enforced server-side.
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      ops.push({ type: 'context', oldLine: i + 1, newLine: j + 1, text: a[i] });
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'remove', oldLine: i + 1, text: a[i] });
      i++;
    } else {
      ops.push({ type: 'add', newLine: j + 1, text: b[j] });
      j++;
    }
  }
  while (i < m) { ops.push({ type: 'remove', oldLine: i + 1, text: a[i] }); i++; }
  while (j < n) { ops.push({ type: 'add', newLine: j + 1, text: b[j] }); j++; }

  // Trim long stretches of unchanged context.
  const keep = new Array(ops.length).fill(false);
  ops.forEach((op, idx) => {
    if (op.type !== 'context') {
      for (let k = Math.max(0, idx - contextLines); k <= Math.min(ops.length - 1, idx + contextLines); k++) {
        keep[k] = true;
      }
    }
  });
  const out: DiffLine[] = [];
  let lastShown = -2;
  ops.forEach((op, idx) => {
    if (!keep[idx]) return;
    if (idx > lastShown + 1 && out.length) {
      out.push({ type: 'context', text: '…' });
    }
    out.push(op);
    lastShown = idx;
  });
  return out;
}

export function downloadPatchedFile(path: string, content: string) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = path.split('/').pop() || 'patched.txt';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function buildLovableApplyPrompt(result: PatchResult, finding: CodeFinding): string {
  return [
    `Apply Ramz One auto-patch — ${finding.title}`,
    '',
    `FILE: ${result.path}`,
    `FINDING: ${finding.title} (${finding.severity}, ${finding.category}) at line ${finding.line}`,
    `SUMMARY: ${result.summary}`,
    '',
    'INSTRUCTION:',
    `Replace the entire contents of \`${result.path}\` with the file body below. Do not modify any other file. After applying, run the Code Scan again to confirm the finding is gone.`,
    '',
    `===== BEGIN ${result.path} =====`,
    result.patchedContent,
    `===== END ${result.path} =====`,
  ].join('\n');
}
