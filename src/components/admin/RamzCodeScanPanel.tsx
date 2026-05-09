/**
 * Ramz One — Code Scan panel.
 *
 * Lets an admin trigger an AI review of the project's most bug-prone source
 * files (hooks, lib, ride/wallet/admin components). Shows progress, findings
 * sorted by severity, and a copy-paste Lovable.dev fix prompt per finding.
 */
import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { ScanSearch, Loader2, Bot, Copy, Check, FileCode2, AlertTriangle, CheckCircle2, Wand2, Download } from 'lucide-react';
import { runCodeScan, findingToLovablePrompt, type CodeFinding } from '@/lib/ramzCodeScan';
import { generatePatchForFinding, computeLineDiff, downloadPatchedFile, buildLovableApplyPrompt, type PatchResult } from '@/lib/ramzPatch';

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

export default function RamzCodeScanPanel() {
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState({ scanned: 0, total: 0 });
  const [currentBatch, setCurrentBatch] = useState<string[]>([]);
  const [findings, setFindings] = useState<CodeFinding[] | null>(null);
  const [scannedCount, setScannedCount] = useState(0);

  const start = async () => {
    setScanning(true);
    setFindings(null);
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
            <Button onClick={start} disabled={scanning} className="font-bold gap-2 shrink-0">
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
                    <FindingCard key={`${f.file}:${f.line}:${i}`} f={f} />
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function FindingCard({ f }: { f: CodeFinding }) {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);

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

  return (
    <Card className={f.severity === 'critical' ? 'border-red-500/30' : ''}>
      <CardContent className="pt-3 pb-3">
        <div className="flex items-start gap-2 flex-wrap">
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
            <div className="flex items-center gap-2 mt-2">
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
    </Card>
  );
}
