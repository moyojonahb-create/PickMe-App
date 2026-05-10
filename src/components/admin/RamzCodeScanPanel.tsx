/**
 * Ramz One — Code Scan panel.
 *
 * Lets an admin trigger an AI review of the project's most bug-prone source
 * files (hooks, lib, ride/wallet/admin components). Shows progress, findings
 * sorted by severity, generates one-click patches, runs a quick verification
 * scan after each patch, supports batch generate/apply, rollback, and an
 * append-only admin audit log.
 */
import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import {
  ScanSearch, Loader2, Bot, Copy, Check, FileCode2, AlertTriangle, CheckCircle2,
  Wand2, Download, ListChecks, Undo2, History, ShieldCheck, ShieldAlert,
} from 'lucide-react';
import { runCodeScan, findingToLovablePrompt, type CodeFinding } from '@/lib/ramzCodeScan';
import {
  generatePatchForFinding, computeLineDiff, downloadPatchedFile,
  buildLovableApplyPrompt, type PatchResult,
} from '@/lib/ramzPatch';
import {
  logAudit, listRecentAudit, listRollbackable, verifyPatch, performRollback,
  type AuditEntry, type VerificationResult,
} from '@/lib/ramzAudit';

const SEV_COLORS: Record<CodeFinding['severity'], string> = {
  critical: 'bg-red-500/10 text-red-600 border-red-500/20',
  high: 'bg-orange-500/10 text-orange-600 border-orange-500/20',
  medium: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  low: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
};

const CAT_COLORS: Record<CodeFinding['category'], string> = {
  bug: 'bg-red-500/5 text-red-700 border-red-500/20',
  react: 'bg-sky-500/5 text-sky-700 border-sky-500/20',
  supabase: 'bg-emerald-500/5 text-emerald-700 border-emerald-500/20',
  security: 'bg-purple-500/5 text-purple-700 border-purple-500/20',
  performance: 'bg-amber-500/5 text-amber-700 border-amber-500/20',
  accessibility: 'bg-pink-500/5 text-pink-700 border-pink-500/20',
  'type-safety': 'bg-slate-500/5 text-slate-700 border-slate-500/20',
};

function findingKey(f: CodeFinding) {
  return `${f.file}:${f.line}:${f.title}`;
}

export default function RamzCodeScanPanel() {
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState({ scanned: 0, total: 0 });
  const [currentBatch, setCurrentBatch] = useState<string[]>([]);
  const [findings, setFindings] = useState<CodeFinding[] | null>(null);
  const [scannedCount, setScannedCount] = useState(0);

  // Batch selection.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchCursor, setBatchCursor] = useState<{ index: number; total: number } | null>(null);
  const [batchPatch, setBatchPatch] = useState<{ patch: PatchResult; finding: CodeFinding } | null>(null);
  const [batchDecisionResolver, setBatchDecisionResolver] = useState<((v: 'apply' | 'skip' | 'cancel') => void) | null>(null);

  // Audit + rollback.
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [rollbacks, setRollbacks] = useState<AuditEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  const refreshAudit = async () => {
    setAuditLoading(true);
    const [a, r] = await Promise.all([listRecentAudit(20), listRollbackable(10)]);
    setAudit(a);
    setRollbacks(r);
    setAuditLoading(false);
  };

  useEffect(() => { refreshAudit(); }, []);

  const start = async () => {
    setScanning(true);
    setFindings(null);
    setSelected(new Set());
    setProgress({ scanned: 0, total: 0 });
    try {
      const result = await runCodeScan({
        onProgress: (p) => {
          setProgress({ scanned: p.scanned, total: p.total });
          setCurrentBatch(p.currentBatch);
        },
      });
      setFindings(result.findings);
      setScannedCount(result.scannedFiles.length);
      toast.success(
        result.findings.length === 0
          ? `Scan complete — ${result.scannedFiles.length} files clean.`
          : `Scan complete — ${result.findings.length} finding${result.findings.length > 1 ? 's' : ''} across ${result.scannedFiles.length} files.`,
      );
    } catch (e) {
      console.error(e);
      toast.error('Code scan failed — see console.');
    } finally {
      setScanning(false);
      setCurrentBatch([]);
    }
  };

  const pct = progress.total ? Math.round((progress.scanned / progress.total) * 100) : 0;

  const toggleSelect = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };
  const selectAll = () => {
    if (!findings) return;
    setSelected(new Set(findings.map(findingKey)));
  };
  const clearSelection = () => setSelected(new Set());

  const runBatch = async () => {
    if (!findings || selected.size === 0) return;
    const queue = findings.filter((f) => selected.has(findingKey(f)));
    setBatchRunning(true);
    let applied = 0, skipped = 0, failed = 0;

    try {
      for (let i = 0; i < queue.length; i++) {
        const f = queue[i];
        setBatchCursor({ index: i + 1, total: queue.length });
        try {
          const patch = await generatePatchForFinding(f);
          await logAudit(patch, f, 'generated', { storeContent: false });
          if (!patch.changed) {
            await logAudit(patch, f, 'skipped');
            skipped++;
            continue;
          }
          // Surface the diff for admin review and wait for their decision.
          setBatchPatch({ patch, finding: f });
          const decision = await new Promise<'apply' | 'skip' | 'cancel'>((resolve) => {
            setBatchDecisionResolver(() => resolve);
          });
          setBatchPatch(null);
          setBatchDecisionResolver(null);
          if (decision === 'cancel') break;
          if (decision === 'skip') {
            await logAudit(patch, f, 'skipped');
            skipped++;
            continue;
          }
          // Apply.
          const prompt = buildLovableApplyPrompt(patch, f);
          try { await navigator.clipboard.writeText(prompt); } catch { /* ignore */ }
          downloadPatchedFile(patch.path, patch.patchedContent);
          const verification = await verifyPatch(patch, f);
          await logAudit(patch, f, 'applied', { verification, storeContent: true });
          applied++;
        } catch (e) {
          console.error('batch item failed', f, e);
          failed++;
        }
      }
    } finally {
      setBatchRunning(false);
      setBatchCursor(null);
      setBatchPatch(null);
      setBatchDecisionResolver(null);
      await refreshAudit();
      toast.success(`Batch complete — ${applied} applied, ${skipped} skipped${failed ? `, ${failed} failed` : ''}.`);
    }
  };

  const handleRollback = async (entry: AuditEntry) => {
    if (!confirm(`Rollback ${entry.file_path}? The original file will be downloaded and a Lovable revert prompt copied to your clipboard.`)) return;
    try {
      await performRollback(entry);
      toast.success('Rollback ready', {
        description: 'Original file downloaded and revert-prompt copied. Paste it into Lovable chat to commit the rollback.',
      });
      await refreshAudit();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Rollback failed');
    }
  };

  return (
    <div>
      <h2 className="font-bold text-lg flex items-center gap-2 mb-3">
        <ScanSearch className="h-5 w-5 text-primary" />
        Code Scan
        <Badge variant="outline" className="text-[10px] font-mono bg-primary/10 text-primary border-primary/20">
          AI
        </Badge>
      </h2>

      <Card>
        <CardContent className="pt-4 space-y-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0 flex-1">
              <p className="text-sm text-foreground">
                Ramz One reviews the project's hooks, libraries, and ride/wallet/admin components for bugs,
                React mistakes, Supabase misuse, security gaps, and performance traps — then suggests fixes.
              </p>
              <p className="text-[11px] text-muted-foreground mt-1">
                Scans run in batches; results stream in as each batch completes.
              </p>
            </div>
            <Button onClick={start} disabled={scanning || batchRunning} className="font-bold gap-2 shrink-0">
              {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanSearch className="w-4 h-4" />}
              {scanning ? 'Scanning…' : 'Scan code now'}
            </Button>
          </div>

          {scanning && (
            <div className="space-y-2">
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
              </div>
              <p className="text-[11px] text-muted-foreground">
                {progress.scanned} / {progress.total} files reviewed{currentBatch.length ? ` · current: ${currentBatch[0].replace(/^\/?src\//, '')}${currentBatch.length > 1 ? ` +${currentBatch.length - 1}` : ''}` : ''}
              </p>
            </div>
          )}

          {findings !== null && !scanning && findings.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap border-t border-border pt-3">
              <Badge variant="outline" className="text-[10px] gap-1">
                <ListChecks className="w-3 h-3" /> {selected.size} selected
              </Badge>
              <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={selectAll} disabled={batchRunning}>
                Select all
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={clearSelection} disabled={batchRunning}>
                Clear
              </Button>
              <div className="ml-auto flex items-center gap-2">
                {batchRunning && batchCursor && (
                  <span className="text-[11px] text-muted-foreground">
                    {batchCursor.index} / {batchCursor.total}
                  </span>
                )}
                <Button
                  size="sm"
                  onClick={runBatch}
                  disabled={batchRunning || selected.size === 0}
                  className="h-7 gap-1 text-[11px] font-bold"
                >
                  {batchRunning ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
                  {batchRunning ? 'Batch running…' : `Batch generate & apply (${selected.size})`}
                </Button>
              </div>
            </div>
          )}

          {findings !== null && !scanning && (
            <div className="border-t border-border pt-3">
              {findings.length === 0 ? (
                <div className="text-center py-6">
                  <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
                  <p className="font-bold text-sm">No issues detected across {scannedCount} files</p>
                  <p className="text-xs text-muted-foreground">Ramz One thinks the scanned code is healthy.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground mb-2">
                    {findings.length} finding{findings.length > 1 ? 's' : ''} across {scannedCount} files — sorted by severity.
                  </p>
                  {findings.map((f, i) => (
                    <FindingCard
                      key={`${findingKey(f)}:${i}`}
                      f={f}
                      checked={selected.has(findingKey(f))}
                      onToggle={() => toggleSelect(findingKey(f))}
                      onAfterApply={refreshAudit}
                      disabled={batchRunning}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <RollbackPanel entries={rollbacks} loading={auditLoading} onRollback={handleRollback} onRefresh={refreshAudit} />
      <AuditPanel entries={audit} loading={auditLoading} onRefresh={refreshAudit} />

      {/* Batch review dialog — surfaces the diff per item and waits for a decision. */}
      <Dialog open={!!batchPatch} onOpenChange={(v) => { if (!v && batchDecisionResolver) batchDecisionResolver('cancel'); }}>
        <DialogContent className="max-w-3xl">
          {batchPatch && (
            <BatchReviewBody
              patch={batchPatch.patch}
              finding={batchPatch.finding}
              cursor={batchCursor}
              onDecision={(d) => batchDecisionResolver?.(d)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FindingCard({
  f, checked, onToggle, onAfterApply, disabled,
}: {
  f: CodeFinding;
  checked: boolean;
  onToggle: () => void;
  onAfterApply: () => void;
  disabled?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [patch, setPatch] = useState<PatchResult | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(findingToLovablePrompt(f));
      setCopied(true);
      toast.success('Lovable prompt copied — paste into chat to apply the fix.');
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error('Could not copy — select the text manually.');
    }
  };

  const generateFix = async () => {
    setGenerating(true);
    try {
      const result = await generatePatchForFinding(f);
      setPatch(result);
      setDialogOpen(true);
      await logAudit(result, f, 'generated', { storeContent: false });
      if (!result.changed) {
        toast.message('Ramz One declined to auto-patch', {
          description: result.summary || 'Manual review required.',
        });
      }
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : 'Could not generate patch.');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Card className={f.severity === 'critical' ? 'border-red-500/30' : ''}>
      <CardContent className="pt-3 pb-3">
        <div className="flex items-start gap-2 flex-wrap">
          <Checkbox
            checked={checked}
            onCheckedChange={onToggle}
            disabled={disabled}
            aria-label={`Select ${f.title}`}
            className="mt-0.5"
          />
          <AlertTriangle className={`w-4 h-4 mt-0.5 shrink-0 ${f.severity === 'critical' ? 'text-red-600' : f.severity === 'high' ? 'text-orange-600' : 'text-amber-600'}`} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-bold text-sm text-foreground">{f.title}</p>
              <Badge variant="outline" className={`text-[9px] ${SEV_COLORS[f.severity]}`}>{f.severity}</Badge>
              <Badge variant="outline" className={`text-[9px] ${CAT_COLORS[f.category]}`}>{f.category}</Badge>
            </div>
            <p className="text-[11px] text-muted-foreground font-mono mt-0.5 flex items-center gap-1">
              <FileCode2 className="w-3 h-3" /> {f.file}:{f.line}
            </p>
            <p className="text-xs text-foreground/80 mt-1.5">{f.description}</p>
            <div className="bg-primary/5 border border-primary/10 rounded-lg p-2 mt-2">
              <p className="text-[11px] font-semibold text-primary mb-0.5">Suggested fix</p>
              <p className="text-xs text-foreground/80">{f.suggestion}</p>
            </div>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <Button size="sm" onClick={generateFix} disabled={generating || disabled} className="h-7 gap-1 text-[11px] font-bold">
                {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
                {generating ? 'Generating…' : 'Generate fix'}
              </Button>
              <Button size="sm" variant="outline" onClick={copy} className="h-7 gap-1 text-[11px] font-semibold">
                {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                {copied ? 'Copied' : 'Copy Lovable prompt'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setOpen(v => !v)} className="h-7 gap-1 text-[11px]">
                <Bot className="w-3 h-3" /> {open ? 'Hide' : 'Show'} prompt
              </Button>
            </div>
            {open && (
              <pre className="mt-2 px-2.5 py-2 text-[10.5px] leading-relaxed font-mono text-foreground/85 whitespace-pre-wrap break-words max-h-72 overflow-auto bg-muted/30 border border-border rounded-lg">
{findingToLovablePrompt(f)}
              </pre>
            )}
          </div>
        </div>
      </CardContent>
      {patch && (
        <PatchReviewDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          finding={f}
          patch={patch}
          onAfterApply={onAfterApply}
        />
      )}
    </Card>
  );
}

function PatchReviewDialog({
  open, onOpenChange, finding, patch, onAfterApply,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  finding: CodeFinding;
  patch: PatchResult;
  onAfterApply: () => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [applying, setApplying] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verification, setVerification] = useState<VerificationResult | null>(null);
  const diff = useMemo(() => computeLineDiff(patch.originalContent, patch.patchedContent), [patch]);
  const adds = diff.filter(d => d.type === 'add').length;
  const removes = diff.filter(d => d.type === 'remove').length;

  const apply = async () => {
    if (!confirmed) {
      setConfirmed(true);
      return;
    }
    setApplying(true);
    try {
      const prompt = buildLovableApplyPrompt(patch, finding);
      try { await navigator.clipboard.writeText(prompt); } catch { /* clipboard may be blocked */ }
      downloadPatchedFile(patch.path, patch.patchedContent);
      // Run quick verification (re-scan the patched file in isolation).
      setVerifying(true);
      const v = await verifyPatch(patch, finding);
      setVerification(v);
      setVerifying(false);
      await logAudit(patch, finding, 'applied', { verification: v, storeContent: true });
      onAfterApply();
      toast.success('Patch ready', {
        description: v.cleared
          ? 'Verification: finding cleared. Paste the Lovable prompt to commit the change.'
          : v.error
            ? `Verification skipped (${v.error}).`
            : 'Verification: similar issue still detected — review before committing.',
      });
    } catch (e) {
      console.error(e);
      toast.error('Could not finish applying patch.');
    } finally {
      setApplying(false);
    }
  };

  const close = (v: boolean) => {
    onOpenChange(v);
    if (!v) {
      setConfirmed(false);
      setVerification(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="w-4 h-4 text-primary" />
            Review auto-patch — {finding.title}
          </DialogTitle>
          <DialogDescription className="font-mono text-[11px]">
            {patch.path} · +{adds} / -{removes} lines
          </DialogDescription>
        </DialogHeader>

        {!patch.changed ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
            <p className="font-bold text-amber-700 mb-1">Ramz One did not auto-fix this.</p>
            <p className="text-foreground/80">{patch.summary || 'The fix was deemed too risky to apply automatically. Use the Lovable prompt instead.'}</p>
          </div>
        ) : (
          <>
            <p className="text-xs text-foreground/80 -mt-1">{patch.summary}</p>
            <DiffTable diff={diff} />
            {(verifying || verification) && (
              <div className={`rounded-lg border p-2.5 text-xs ${
                verifying ? 'border-border bg-muted/30' :
                verification?.cleared ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-800' :
                verification?.error ? 'border-amber-500/30 bg-amber-500/5 text-amber-800' :
                'border-orange-500/30 bg-orange-500/5 text-orange-800'
              }`}>
                {verifying ? (
                  <div className="flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Running quick verification scan…</div>
                ) : verification?.cleared ? (
                  <div className="flex items-center gap-2"><ShieldCheck className="w-3.5 h-3.5" /> Verification passed — original finding no longer reported.</div>
                ) : verification?.error ? (
                  <div className="flex items-center gap-2"><ShieldAlert className="w-3.5 h-3.5" /> Verification skipped: {verification.error}</div>
                ) : (
                  <div className="flex items-center gap-2"><ShieldAlert className="w-3.5 h-3.5" /> Verification flagged a similar issue still present. Review before committing.</div>
                )}
              </div>
            )}
          </>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={() => close(false)}>Cancel</Button>
          {patch.changed && (
            <Button
              onClick={apply}
              disabled={applying}
              className="gap-1.5 font-bold"
              variant={confirmed ? 'destructive' : 'default'}
            >
              {applying ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : confirmed ? (
                <Download className="w-4 h-4" />
              ) : (
                <Wand2 className="w-4 h-4" />
              )}
              {applying ? 'Applying…' : confirmed ? 'Confirm — download, copy & verify' : 'Apply patch'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BatchReviewBody({
  patch, finding, cursor, onDecision,
}: {
  patch: PatchResult;
  finding: CodeFinding;
  cursor: { index: number; total: number } | null;
  onDecision: (d: 'apply' | 'skip' | 'cancel') => void;
}) {
  const diff = useMemo(() => computeLineDiff(patch.originalContent, patch.patchedContent), [patch]);
  const adds = diff.filter(d => d.type === 'add').length;
  const removes = diff.filter(d => d.type === 'remove').length;

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <ListChecks className="w-4 h-4 text-primary" />
          Batch review {cursor ? `(${cursor.index} / ${cursor.total})` : ''} — {finding.title}
        </DialogTitle>
        <DialogDescription className="font-mono text-[11px]">
          {patch.path} · +{adds} / -{removes} lines · {finding.severity} {finding.category}
        </DialogDescription>
      </DialogHeader>
      {!patch.changed ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
          <p className="font-bold text-amber-700 mb-1">Ramz One declined to auto-fix this item.</p>
          <p className="text-foreground/80">{patch.summary || 'Manual review required.'}</p>
        </div>
      ) : (
        <>
          <p className="text-xs text-foreground/80 -mt-1">{patch.summary}</p>
          <DiffTable diff={diff} />
        </>
      )}
      <DialogFooter className="gap-2 sm:gap-2">
        <Button variant="ghost" onClick={() => onDecision('cancel')}>Stop batch</Button>
        <Button variant="outline" onClick={() => onDecision('skip')}>Skip</Button>
        {patch.changed && (
          <Button onClick={() => onDecision('apply')} className="gap-1.5 font-bold">
            <Download className="w-4 h-4" /> Apply &amp; verify
          </Button>
        )}
      </DialogFooter>
    </>
  );
}

function DiffTable({ diff }: { diff: ReturnType<typeof computeLineDiff> }) {
  return (
    <div className="border border-border rounded-lg overflow-hidden bg-muted/20 max-h-[420px] overflow-y-auto">
      <table className="w-full text-[11px] font-mono">
        <tbody>
          {diff.map((d, i) => (
            <tr
              key={i}
              className={
                d.type === 'add'
                  ? 'bg-emerald-500/10'
                  : d.type === 'remove'
                    ? 'bg-red-500/10'
                    : ''
              }
            >
              <td className="text-muted-foreground/70 text-right px-2 py-0.5 select-none w-10 border-r border-border/50">
                {d.oldLine ?? ''}
              </td>
              <td className="text-muted-foreground/70 text-right px-2 py-0.5 select-none w-10 border-r border-border/50">
                {d.newLine ?? ''}
              </td>
              <td className="px-2 py-0.5 w-4 select-none">
                {d.type === 'add' ? '+' : d.type === 'remove' ? '−' : ' '}
              </td>
              <td className="px-2 py-0.5 whitespace-pre-wrap break-words">{d.text}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RollbackPanel({
  entries, loading, onRollback, onRefresh,
}: {
  entries: AuditEntry[];
  loading: boolean;
  onRollback: (e: AuditEntry) => void;
  onRefresh: () => void;
}) {
  return (
    <div className="mt-4">
      <h3 className="font-bold text-sm flex items-center gap-2 mb-2">
        <Undo2 className="h-4 w-4 text-primary" /> Rollback applied patches
        <Button variant="ghost" size="sm" className="h-6 text-[11px] ml-auto" onClick={onRefresh} disabled={loading}>
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Refresh'}
        </Button>
      </h3>
      <Card>
        <CardContent className="pt-3 pb-3">
          {entries.length === 0 ? (
            <p className="text-xs text-muted-foreground">No rollback-eligible patches yet.</p>
          ) : (
            <div className="space-y-1.5">
              {entries.map((e) => (
                <div key={e.id} className="flex items-center gap-2 text-xs border-b border-border/50 pb-1.5 last:border-0 last:pb-0">
                  <FileCode2 className="w-3 h-3 text-muted-foreground shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-[11px] truncate">{e.file_path}</p>
                    <p className="text-[10.5px] text-muted-foreground truncate">
                      {e.finding_title} · {new Date(e.created_at).toLocaleString()}
                    </p>
                  </div>
                  <Badge variant="outline" className={`text-[9px] ${SEV_COLORS[(e.finding_severity as CodeFinding['severity']) || 'low']}`}>
                    {e.finding_severity}
                  </Badge>
                  <Button size="sm" variant="outline" className="h-7 gap-1 text-[11px]" onClick={() => onRollback(e)}>
                    <Undo2 className="w-3 h-3" /> Rollback
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

const ACTION_COLORS: Record<string, string> = {
  generated: 'bg-slate-500/10 text-slate-700 border-slate-500/20',
  applied: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20',
  skipped: 'bg-muted text-muted-foreground border-border',
  reverted: 'bg-orange-500/10 text-orange-700 border-orange-500/20',
  verified: 'bg-sky-500/10 text-sky-700 border-sky-500/20',
};

function AuditPanel({
  entries, loading, onRefresh,
}: {
  entries: AuditEntry[];
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="mt-4">
      <h3 className="font-bold text-sm flex items-center gap-2 mb-2">
        <History className="h-4 w-4 text-primary" /> Patch audit log
        <Button variant="ghost" size="sm" className="h-6 text-[11px] ml-auto" onClick={onRefresh} disabled={loading}>
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Refresh'}
        </Button>
      </h3>
      <Card>
        <CardContent className="pt-3 pb-3">
          {entries.length === 0 ? (
            <p className="text-xs text-muted-foreground">No patch activity recorded yet.</p>
          ) : (
            <div className="space-y-1.5 max-h-72 overflow-y-auto">
              {entries.map((e) => (
                <div key={e.id} className="text-xs border-b border-border/50 pb-1.5 last:border-0 last:pb-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className={`text-[9px] ${ACTION_COLORS[e.action] || ''}`}>{e.action}</Badge>
                    <span className="font-mono text-[10.5px] truncate">{e.file_path}</span>
                    {e.verification_status && (
                      <Badge variant="outline" className={`text-[9px] ${
                        e.verification_status === 'cleared'
                          ? 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20'
                          : e.verification_status === 'remaining'
                            ? 'bg-orange-500/10 text-orange-700 border-orange-500/20'
                            : 'bg-amber-500/10 text-amber-700 border-amber-500/20'
                      }`}>
                        verify: {e.verification_status}
                      </Badge>
                    )}
                    <span className="text-[10.5px] text-muted-foreground ml-auto">
                      {new Date(e.created_at).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-[11px] text-foreground/80 mt-0.5 truncate">
                    {e.finding_title}{e.ai_summary ? ` — ${e.ai_summary}` : ''}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
