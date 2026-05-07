import React, { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, XCircle, AlertTriangle, RefreshCw, Copy, MapPin } from 'lucide-react';
import { getMapsDiagnostics, resetGoogleMapsLoader, type MapsDiagnostics } from '@/hooks/useGoogleMaps';
import { toast } from 'sonner';

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

/**
 * Admin-only diagnostic panel for the Google Maps integration.
 * Shows live status, the API key in use (masked), the current origin
 * (which must be allow-listed in API key referrer restrictions), and
 * the last error message Google returned.
 */
export default function MapsDebugPanel() {
  const [diag, setDiag] = useState<MapsDiagnostics>(() => getMapsDiagnostics(GOOGLE_MAPS_API_KEY));
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setDiag(getMapsDiagnostics(GOOGLE_MAPS_API_KEY));
    const id = setInterval(() => {
      setDiag(getMapsDiagnostics(GOOGLE_MAPS_API_KEY));
    }, 1500);
    return () => clearInterval(id);
  }, [tick]);

  const handleReload = () => {
    resetGoogleMapsLoader();
    setTick((t) => t + 1);
    toast.success('Maps loader reset — reload the page to retry.');
  };

  const copy = (label: string, value: string) => {
    navigator.clipboard.writeText(value).then(() => toast.success(`${label} copied`));
  };

  const status: { label: string; color: string; icon: typeof CheckCircle2 } = diag.isLoaded
    ? { label: 'Loaded & Healthy', color: 'bg-primary/15 text-primary border-primary/30', icon: CheckCircle2 }
    : diag.loadError || diag.authFailure
      ? { label: 'Failed', color: 'bg-destructive/15 text-destructive border-destructive/30', icon: XCircle }
      : { label: 'Loading…', color: 'bg-muted text-muted-foreground border-border', icon: AlertTriangle };
  const StatusIcon = status.icon;

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
            <MapPin className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-base text-foreground">Google Maps Diagnostics</h3>
            <p className="text-xs text-muted-foreground">Live status of the Maps JavaScript API integration.</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={handleReload}>
          <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Reset loader
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Row label="Status">
          <Badge variant="outline" className={`gap-1.5 ${status.color}`}>
            <StatusIcon className="w-3 h-3" /> {status.label}
          </Badge>
        </Row>
        <Row label="Auth failure (gm_authFailure)">
          {diag.authFailure ? (
            <Badge variant="destructive">Yes — key rejected</Badge>
          ) : (
            <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">No</Badge>
          )}
        </Row>
        <Row label="Script tag injected">
          <span className="text-sm text-foreground">{diag.scriptInjected ? 'Yes' : 'No'}</span>
        </Row>
        <Row label="API key present">
          <span className="text-sm text-foreground">{diag.apiKeyPresent ? 'Yes' : 'No (missing)'}</span>
        </Row>
        <Row label="API key (masked)">
          <div className="flex items-center gap-2">
            <code className="text-xs bg-muted px-2 py-0.5 rounded">{diag.apiKeyMasked ?? '—'}</code>
            {diag.apiKeyPresent && (
              <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => copy('API key', GOOGLE_MAPS_API_KEY)}>
                <Copy className="w-3 h-3" />
              </Button>
            )}
          </div>
        </Row>
        <Row label="Current origin">
          <div className="flex items-center gap-2 min-w-0">
            <code className="text-xs bg-muted px-2 py-0.5 rounded truncate">{diag.origin || '—'}</code>
            <Button size="sm" variant="ghost" className="h-7 px-2 shrink-0" onClick={() => copy('Origin', diag.origin)}>
              <Copy className="w-3 h-3" />
            </Button>
          </div>
        </Row>
      </div>

      {(diag.loadError || diag.lastGoogleConsoleError) && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 space-y-2">
          <p className="text-xs font-bold text-destructive uppercase tracking-wider flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" /> Last error
          </p>
          {diag.loadError && (
            <p className="text-xs text-destructive break-words leading-relaxed">{diag.loadError.message}</p>
          )}
          {diag.lastGoogleConsoleError && diag.lastGoogleConsoleError !== diag.loadError?.message && (
            <details className="text-[11px] text-destructive/80">
              <summary className="cursor-pointer">Raw console error</summary>
              <pre className="mt-1 whitespace-pre-wrap break-words">{diag.lastGoogleConsoleError}</pre>
            </details>
          )}
        </div>
      )}

      <div className="rounded-xl bg-muted/40 border border-border/50 p-3 text-xs text-muted-foreground space-y-1.5">
        <p className="font-semibold text-foreground">Setup checklist (Google Cloud Console)</p>
        <ol className="list-decimal list-inside space-y-0.5">
          <li>Enable <strong>billing</strong> on the Cloud project.</li>
          <li>Enable <strong>Maps JavaScript API</strong>, <strong>Places API</strong>, and <strong>Directions API</strong>.</li>
          <li>
            Add this origin to the API key&apos;s <strong>HTTP referrer restrictions</strong>:
            <code className="ml-1 bg-background px-1.5 py-0.5 rounded">{diag.origin}/*</code>
          </li>
          <li>Restrict the key to only the 3 APIs above (API restrictions).</li>
          <li>Wait ~2 minutes for changes to propagate, then click <em>Reset loader</em>.</li>
        </ol>
      </div>

      <p className="text-[10px] text-muted-foreground/70 text-right">
        Last checked {new Date(diag.timestamp).toLocaleTimeString()}
      </p>
    </Card>
  );
}

/**
 * Row helper — uses React.forwardRef so it can safely receive a ref from
 * parents (Radix primitives, Tooltip wrappers, etc.) without triggering
 * "Function components cannot be given refs" warnings.
 */
const Row = React.forwardRef<
  HTMLDivElement,
  { label: string; children: React.ReactNode }
>(function Row({ label, children }, ref) {
  return (
    <div
      ref={ref}
      className="flex flex-col gap-1 p-2.5 rounded-lg bg-muted/30 border border-border/40 min-w-0"
    >
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
});
Row.displayName = "Row";
