/**
 * Ramz One — patch audit log + rollback + verification helpers.
 *
 * - Records every patch lifecycle event (generated / applied / skipped /
 *   reverted / verified) into `ramz_patch_audit` so admins have an
 *   immutable trail of AI code changes.
 * - "Verification" re-runs the AI scanner on the patched file in isolation
 *   and reports whether the original finding cleared.
 * - "Rollback" produces the reverse Lovable apply-prompt + downloads the
 *   original file body so the admin can paste it back into chat.
 */
import { supabase } from '@/lib/supabaseClient';
import type { CodeFinding } from '@/lib/ramzCodeScan';
import type { PatchResult } from '@/lib/ramzPatch';
import { downloadPatchedFile } from '@/lib/ramzPatch';

export type AuditAction = 'generated' | 'applied' | 'skipped' | 'reverted' | 'verified';

export interface AuditEntry {
  id: string;
  admin_id: string;
  file_path: string;
  finding_title: string;
  finding_severity: string;
  finding_category: string;
  finding_line: number | null;
  ai_summary: string | null;
  action: AuditAction;
  verification_status: string | null;
  verification_findings: unknown;
  original_content: string | null;
  patched_content: string | null;
  created_at: string;
}

export interface VerificationResult {
  cleared: boolean;
  remaining: CodeFinding[];
  scannedFiles: string[];
  error?: string;
}

export async function logAudit(
  patch: PatchResult,
  finding: CodeFinding,
  action: AuditAction,
  extra: { verification?: VerificationResult; storeContent?: boolean } = {},
): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const row = {
    admin_id: user.id,
    file_path: patch.path,
    finding_title: finding.title,
    finding_severity: finding.severity,
    finding_category: finding.category,
    finding_line: finding.line ?? null,
    ai_summary: patch.summary || null,
    action,
    verification_status: extra.verification
      ? (extra.verification.cleared ? 'cleared' : extra.verification.error ? 'error' : 'remaining')
      : null,
    verification_findings: extra.verification?.remaining ? JSON.parse(JSON.stringify(extra.verification.remaining)) : null,
    // Only store the heavy content snapshots for actions where rollback is meaningful.
    original_content: extra.storeContent ? patch.originalContent : null,
    patched_content: extra.storeContent ? patch.patchedContent : null,
  };

  const { data, error } = await supabase
    .from('ramz_patch_audit')
    .insert([row])
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('ramz audit insert failed', error);
    return null;
  }
  return data?.id ?? null;
}

export async function listRecentAudit(limit = 30): Promise<AuditEntry[]> {
  const { data, error } = await supabase
    .from('ramz_patch_audit')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.error('ramz audit list failed', error);
    return [];
  }
  return (data ?? []) as AuditEntry[];
}

export async function listRollbackable(limit = 20): Promise<AuditEntry[]> {
  const { data, error } = await supabase
    .from('ramz_patch_audit')
    .select('*')
    .eq('action', 'applied')
    .not('original_content', 'is', null)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.error('ramz audit rollback list failed', error);
    return [];
  }
  return (data ?? []) as AuditEntry[];
}

/** Re-run the scanner on the patched file alone and report whether the finding cleared. */
export async function verifyPatch(
  patch: PatchResult,
  finding: CodeFinding,
): Promise<VerificationResult> {
  try {
    const { data, error } = await supabase.functions.invoke('ramz-code-scan', {
      body: { files: [{ path: patch.path, content: patch.patchedContent }] },
    });
    if (error) return { cleared: false, remaining: [], scannedFiles: [], error: error.message };
    const remaining: CodeFinding[] = Array.isArray(data?.findings)
      ? (data.findings as CodeFinding[]).filter((f) => f && f.file)
      : [];
    // Treat as cleared if the same title is no longer reported on this file.
    const stillThere = remaining.some(
      (f) =>
        f.file === patch.path &&
        (f.title.trim().toLowerCase() === finding.title.trim().toLowerCase() ||
         (typeof f.line === 'number' && Math.abs(f.line - (finding.line || 0)) <= 2)),
    );
    return {
      cleared: !stillThere,
      remaining,
      scannedFiles: data?.scannedFiles ?? [patch.path],
    };
  } catch (e) {
    return {
      cleared: false,
      remaining: [],
      scannedFiles: [],
      error: e instanceof Error ? e.message : 'verification failed',
    };
  }
}

export function buildRollbackPrompt(entry: AuditEntry): string {
  return [
    `Rollback Ramz One auto-patch — ${entry.finding_title}`,
    '',
    `FILE: ${entry.file_path}`,
    `ORIGINAL FINDING: ${entry.finding_title} (${entry.finding_severity}, ${entry.finding_category})`,
    `REASON: Admin requested rollback via Ramz One panel on ${new Date().toISOString()}.`,
    '',
    'INSTRUCTION:',
    `Restore the entire contents of \`${entry.file_path}\` to the original body below. Do not modify any other file.`,
    '',
    `===== BEGIN ${entry.file_path} =====`,
    entry.original_content ?? '',
    `===== END ${entry.file_path} =====`,
  ].join('\n');
}

export async function performRollback(entry: AuditEntry): Promise<void> {
  if (!entry.original_content) throw new Error('No original snapshot stored for this patch.');
  const prompt = buildRollbackPrompt(entry);
  try { await navigator.clipboard.writeText(prompt); } catch { /* clipboard may be blocked */ }
  downloadPatchedFile(entry.file_path, entry.original_content);

  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    await supabase.from('ramz_patch_audit').insert({
      admin_id: user.id,
      file_path: entry.file_path,
      finding_title: entry.finding_title,
      finding_severity: entry.finding_severity,
      finding_category: entry.finding_category,
      finding_line: entry.finding_line,
      ai_summary: `Rollback of audit entry ${entry.id}`,
      action: 'reverted' as AuditAction,
      original_content: null,
      patched_content: null,
    });
  }
}
