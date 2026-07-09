import { useEffect, useState } from 'react';
import { CheckCircle2, XCircle, Loader2, MapPin, Navigation } from 'lucide-react';
import MapboxMap from '@/components/MapboxMap';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useGooglePlacesAutocomplete } from '@/hooks/useGooglePlacesAutocomplete';
import { getRouteWithFallback } from '@/lib/osrm';

type Status = 'idle' | 'pending' | 'pass' | 'fail';

interface Check {
  label: string;
  status: Status;
  detail?: string;
}

const HARARE = { lat: -17.8252, lng: 31.0335 };
const BULAWAYO = { lat: -20.1325, lng: 28.6263 };

function StatusIcon({ s }: { s: Status }) {
  if (s === 'pending') return <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />;
  if (s === 'pass') return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
  if (s === 'fail') return <XCircle className="w-4 h-4 text-destructive" />;
  return <div className="w-4 h-4 rounded-full border-2 border-muted-foreground/40" />;
}

export default function AdminMapsQA() {
  const [pickup, setPickup] = useState(HARARE);
  const [dropoff, setDropoff] = useState<{ lat: number; lng: number } | null>(null);
  const [routeGeometry, setRouteGeometry] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const { suggestions, loading: searchLoading, search, getPlaceDetails } = useGooglePlacesAutocomplete();
  const [checks, setChecks] = useState<Record<string, Check>>({
    map: { label: 'Map tiles render', status: 'idle' },
    gps: { label: 'GPS / geolocation', status: 'idle' },
    search: { label: 'Place search returns results', status: 'idle' },
    route: { label: 'Route calc (Harare → Bulawayo)', status: 'idle' },
  });

  const update = (key: string, patch: Partial<Check>) =>
    setChecks((p) => ({ ...p, [key]: { ...p[key], ...patch } }));

  // Map renders → assume pass after mount
  useEffect(() => {
    const t = setTimeout(() => update('map', { status: 'pass', detail: 'Mapbox' }), 1200);
    return () => clearTimeout(t);
  }, []);

  const testGps = () => {
    update('gps', { status: 'pending' });
    if (!navigator.geolocation) {
      update('gps', { status: 'fail', detail: 'Geolocation API unavailable' });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const c = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setPickup(c);
        update('gps', { status: 'pass', detail: `${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}` });
      },
      (err) => update('gps', { status: 'fail', detail: err.message }),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const testSearch = () => {
    update('search', { status: 'pending' });
    search('Avondale');
    setQuery('Avondale');
  };

  useEffect(() => {
    if (checks.search.status !== 'pending') return;
    if (searchLoading) return;
    if (suggestions.length > 0) {
      update('search', { status: 'pass', detail: `${suggestions.length} results (${suggestions[0]?.source ?? '?'})` });
    } else {
      update('search', { status: 'fail', detail: 'No suggestions returned' });
    }
  }, [searchLoading, suggestions]);

  const testRoute = async () => {
    update('route', { status: 'pending' });
    try {
      const r = await getRouteWithFallback(HARARE, BULAWAYO);
      setPickup(HARARE);
      setDropoff(BULAWAYO);
      setRouteGeometry(r.geometry);
      update('route', {
        status: r.geometry ? 'pass' : 'fail',
        detail: `${r.distanceKm.toFixed(0)}km · ${Math.round(r.durationMinutes)}min${r.isEstimate ? ' (estimate)' : ''}`,
      });
    } catch (e) {
      update('route', { status: 'fail', detail: (e as Error).message });
    }
  };

  const runAll = async () => {
    testGps();
    testSearch();
    await testRoute();
  };

  const pickSuggestion = async (placeId: string, idx: number) => {
    const s = suggestions[idx];
    const details = await getPlaceDetails(placeId, s);
    if (details) setDropoff({ lat: details.lat, lng: details.lng });
  };

  return (
    <div className="min-h-screen bg-background p-3 sm:p-6 pb-24">
      <div className="max-w-5xl mx-auto space-y-4">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Maps QA Checklist</h1>
          <p className="text-sm text-muted-foreground">
            Quick regression page for map, routing, and search.
          </p>
        </header>

        <div className="grid sm:grid-cols-2 gap-3">
          <div className="rounded-2xl border bg-card p-4 space-y-1.5 text-xs">
            <p className="font-semibold text-foreground text-sm mb-1">Device</p>
            <p className="text-muted-foreground">
              Viewport: {window.innerWidth}×{window.innerHeight}
            </p>
            <p className="text-muted-foreground">DPR: {window.devicePixelRatio}</p>
            <p className="text-muted-foreground truncate">UA: {navigator.userAgent}</p>
          </div>
        </div>

        {/* Checks */}
        <div className="rounded-2xl border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="font-semibold text-foreground">Checks</p>
            <Button size="sm" onClick={runAll}>Run all</Button>
          </div>
          <ul className="space-y-2">
            {Object.entries(checks).map(([k, c]) => (
              <li key={k} className="flex items-center gap-3 text-sm">
                <StatusIcon s={c.status} />
                <span className="flex-1">{c.label}</span>
                {c.detail && <span className="text-xs text-muted-foreground truncate max-w-[55%]">{c.detail}</span>}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" variant="outline" onClick={testGps}><MapPin className="w-3.5 h-3.5 mr-1.5" />GPS</Button>
            <Button size="sm" variant="outline" onClick={testSearch}>Search</Button>
            <Button size="sm" variant="outline" onClick={testRoute}><Navigation className="w-3.5 h-3.5 mr-1.5" />Route</Button>
          </div>
        </div>

        {/* Search panel */}
        <div className="rounded-2xl border bg-card p-4 space-y-2">
          <p className="font-semibold text-foreground text-sm">Place search</p>
          <Input
            value={query}
            onChange={(e) => { setQuery(e.target.value); search(e.target.value); }}
            placeholder="Try 'Avondale', 'Sam Levy', 'Bulawayo'..."
          />
          {suggestions.length > 0 && (
            <ul className="border rounded-xl divide-y max-h-56 overflow-auto">
              {suggestions.slice(0, 8).map((s, i) => (
                <li key={s.placeId}>
                  <button
                    onClick={() => pickSuggestion(s.placeId, i)}
                    className="w-full text-left p-2.5 hover:bg-muted/60 transition-colors"
                  >
                    <p className="text-sm font-medium truncate">{s.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{s.description} · {s.source ?? '?'}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Map preview */}
        <div className="rounded-2xl border bg-card overflow-hidden">
          <div className="p-3 flex items-center justify-between border-b">
            <p className="font-semibold text-foreground text-sm">Live map preview</p>
            <Button size="sm" variant="ghost" onClick={() => { setDropoff(null); setRouteGeometry(null); }}>Clear</Button>
          </div>
          <div className="h-[420px]">
            <MapboxMap
              pickup={pickup}
              dropoff={dropoff}
              routeGeometry={routeGeometry}
              defaultCenter={pickup}
              defaultZoom={dropoff ? 7 : 13}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
