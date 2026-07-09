import { AlertTriangle, RefreshCw, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface StaticMapFallbackProps {
  /** Center latitude. Defaults to Harare, Zimbabwe. */
  lat?: number;
  /** Center longitude. */
  lng?: number;
  /** Zoom level (1-19). */
  zoom?: number;
  /** Error message shown to the user. */
  errorMessage?: string;
  /** Called when the user clicks Retry. */
  onRetry?: () => void;
  className?: string;
  height?: string | number;
}

/**
 * Graceful fallback shown when Mapbox fails to load.
 * Renders an OpenStreetMap static tile (no API key required) plus a
 * troubleshooting card with a retry button. Works on any device.
 */
export default function StaticMapFallback({
  lat = -17.8252,
  lng = 31.0335,
  zoom = 13,
  errorMessage,
  onRetry,
  className = '',
  height = '100%',
}: StaticMapFallbackProps) {
  // OSM "staticmap" service via wikimedia (no API key, free).
  // Falls back to OSM embed iframe URL for the visible area.
  const delta = 0.05;
  const bbox = `${lng - delta},${lat - delta},${lng + delta},${lat + delta}`;
  const osmEmbed = `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${lat},${lng}`;

  return (
    <div className={`relative overflow-hidden bg-muted ${className}`} style={{ height, minHeight: 260 }}>
      {/* OSM static map */}
      <iframe
        title="OpenStreetMap fallback"
        src={osmEmbed}
        className="absolute inset-0 w-full h-full border-0 opacity-90"
        loading="lazy"
        referrerPolicy="no-referrer"
      />

      {/* Translucent overlay with troubleshooting card */}
      <div className="absolute inset-0 bg-background/40 backdrop-blur-[2px] flex items-end sm:items-center justify-center p-3 sm:p-6 pointer-events-none">
        <div className="pointer-events-auto bg-card/95 backdrop-blur-md border border-border/60 rounded-2xl shadow-xl max-w-sm w-full p-5 space-y-3">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-destructive/10 text-destructive flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="font-bold text-foreground text-sm">Mapbox unavailable</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Showing a basic OpenStreetMap view instead.
              </p>
            </div>
          </div>

          {errorMessage && (
            <div className="text-[11px] text-destructive bg-destructive/5 border border-destructive/20 rounded-lg px-3 py-2 break-words">
              {errorMessage}
            </div>
          )}

          <div className="text-[11px] text-muted-foreground space-y-1">
            <p className="font-semibold text-foreground">Common fixes:</p>
            <ul className="list-disc list-inside space-y-0.5">
              <li>Set VITE_MAPBOX_ACCESS_TOKEN</li>
              <li>Restart the app after changing frontend env</li>
              <li>Allow this domain in token URL restrictions</li>
            </ul>
          </div>

          <div className="flex gap-2 pt-1">
            {onRetry && (
              <Button size="sm" variant="outline" onClick={onRetry} className="flex-1">
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Retry
              </Button>
            )}
            <a
              href="https://account.mapbox.com/access-tokens/"
              target="_blank"
              rel="noreferrer"
              className="flex-1"
            >
              <Button size="sm" variant="default" className="w-full">
                <ExternalLink className="w-3.5 h-3.5 mr-1.5" /> Mapbox
              </Button>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
