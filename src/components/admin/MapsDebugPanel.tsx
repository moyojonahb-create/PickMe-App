import React, { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Copy, MapPin, XCircle } from "lucide-react";
import { getMapboxToken } from "@/lib/mapboxLoader";
import { toast } from "sonner";

function maskToken(token: string | null) {
  if (!token) return null;
  if (token.length <= 12) return `${token.slice(0, 4)}...`;
  return `${token.slice(0, 8)}...${token.slice(-4)}`;
}

export default function MapsDebugPanel() {
  const token = getMapboxToken();
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const masked = useMemo(() => maskToken(token), [token]);

  const copy = (label: string, value: string) => {
    navigator.clipboard.writeText(value).then(() => toast.success(`${label} copied`));
  };

  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <MapPin className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-foreground">Mapbox Diagnostics</h3>
            <p className="text-xs text-muted-foreground">Live status of the Mapbox map integration.</p>
          </div>
        </div>
        <Badge variant="outline" className={token ? "gap-1.5 bg-primary/10 text-primary border-primary/30" : "gap-1.5 bg-destructive/10 text-destructive border-destructive/30"}>
          {token ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
          {token ? "Configured" : "Token missing"}
        </Badge>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Row label="Provider">
          <span className="text-sm text-foreground">Mapbox GL JS</span>
        </Row>
        <Row label="Access token">
          <code className="rounded bg-muted px-2 py-0.5 text-xs">{masked ?? "Not configured"}</code>
        </Row>
        <Row label="Environment variable">
          <code className="rounded bg-muted px-2 py-0.5 text-xs">VITE_MAPBOX_ACCESS_TOKEN</code>
        </Row>
        <Row label="Current origin">
          <div className="flex min-w-0 items-center gap-2">
            <code className="truncate rounded bg-muted px-2 py-0.5 text-xs">{origin || "-"}</code>
            {origin && (
              <Button size="sm" variant="ghost" className="h-7 shrink-0 px-2" onClick={() => copy("Origin", origin)}>
                <Copy className="h-3 w-3" />
              </Button>
            )}
          </div>
        </Row>
      </div>

      <div className="space-y-1.5 rounded-xl border border-border/50 bg-muted/40 p-3 text-xs text-muted-foreground">
        <p className="font-semibold text-foreground">Setup checklist</p>
        <ol className="list-inside list-decimal space-y-0.5">
          <li>Create a Mapbox public access token.</li>
          <li>Add it to the frontend environment as <strong>VITE_MAPBOX_ACCESS_TOKEN</strong>.</li>
          <li>Restart the Vite dev server or rebuild the production bundle.</li>
          <li>Restrict the token to your pilot domains once the public domain is final.</li>
        </ol>
      </div>
    </Card>
  );
}

const Row = React.forwardRef<HTMLDivElement, { label: string; children: React.ReactNode }>(function Row({ label, children }, ref) {
  return (
    <div ref={ref} className="flex min-w-0 flex-col gap-1 rounded-lg border border-border/40 bg-muted/30 p-2.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
});
Row.displayName = "Row";
