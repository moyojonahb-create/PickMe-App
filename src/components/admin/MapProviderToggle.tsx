import { useEffect, useState } from 'react';
import { Map, Satellite, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { isGoogleMapsDisabled } from '@/lib/mapsKillSwitch';

/**
 * Runtime toggle between OSM (Leaflet) and Google Maps.
 * Persists choice in localStorage('enableGoogleMaps') and reloads.
 * No env change required.
 */
export default function MapProviderToggle({ compact = false }: { compact?: boolean }) {
  const [googleOn, setGoogleOn] = useState(false);

  useEffect(() => {
    setGoogleOn(!isGoogleMapsDisabled());
  }, []);

  const apply = (next: boolean) => {
    if (next) localStorage.setItem('enableGoogleMaps', '1');
    else localStorage.removeItem('enableGoogleMaps');
    setGoogleOn(next);
  };

  return (
    <div className={`rounded-2xl border bg-card p-4 ${compact ? 'space-y-2' : 'space-y-3'}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          {googleOn ? <Satellite className="w-4 h-4 text-primary shrink-0" /> : <Map className="w-4 h-4 text-primary shrink-0" />}
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">
              {googleOn ? 'Google Maps' : 'Mapbox'}
            </p>
            {!compact && (
              <p className="text-xs text-muted-foreground truncate">
                {googleOn ? 'Google tiles + Places' : 'Mapbox tiles + Geocoding (default)'}
              </p>
            )}
          </div>
        </div>
        <Switch checked={googleOn} onCheckedChange={apply} aria-label="Enable Google Maps" />
      </div>
      <Button
        size="sm"
        variant="outline"
        className="w-full"
        onClick={() => window.location.reload()}
      >
        <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
        Reload to apply
      </Button>
    </div>
  );
}
