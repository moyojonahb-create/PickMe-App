/* eslint-disable react-hooks/exhaustive-deps */
import { useCallback, useEffect, useRef, useState, memo, useMemo } from 'react';
import { GoogleMap, Marker, Polyline } from '@react-google-maps/api';
import { useGoogleMaps, resetGoogleMapsLoader } from '@/hooks/useGoogleMaps';
import { AlertTriangle, RefreshCw, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import PremiumTrackingMap from '@/components/map/PremiumTrackingMap';
import StaticMapFallback from '@/components/map/StaticMapFallback';
import MapboxMap from '@/components/MapboxMap';
import { isGoogleMapsDisabled } from '@/lib/mapsKillSwitch';

// ── Types ──
interface Coords {
  lat: number;
  lng: number;
}

interface MapGoogleProps {
  pickup?: Coords | null;
  dropoff?: Coords | null;
  driverLocation?: Coords | null;
  routeGeometry?: string | null;
  secondaryRouteGeometry?: string | null;
  onMapClick?: (coords: Coords) => void;
  className?: string;
  height?: string;
  drivers?: Array<{ id: string; lat: number; lng: number; isOnline?: boolean }>;
  defaultCenter?: Coords;
  defaultZoom?: number;
  /** ETA in minutes for the premium driver overlay */
  etaMinutes?: number;
  /** Intermediate ride stops to show as numbered markers */
  stops?: Array<{ id: string; address: string; lat: number; lng: number }>;
  /** Top autocomplete suggestions to preview on the map (Mapbox path only). */
  suggestions?: Array<{ id?: string; name?: string; lat?: number; lng?: number }>;
}

const ZW_CENTER: Coords = { lat: -19.015, lng: 29.155 };
const containerStyle = { width: '100%', height: '100%' };

const mapOptions: google.maps.MapOptions = {
  disableDefaultUI: true,
  zoomControl: true,
  zoomControlOptions: { position: 9 },
  mapTypeControl: false,
  streetViewControl: false,
  fullscreenControl: false,
  gestureHandling: 'greedy',
  styles: [
    { featureType: 'poi', stylers: [{ visibility: 'off' }] },
    { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  ],
};

// PickMe electric-blue car. `__ROT__` is replaced per driver with the heading angle.
const NEARBY_CAR_SVG = (rot: number) => `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36"><circle cx="18" cy="18" r="16" fill="#1B3FA0" stroke="#FBBF24" stroke-width="2"/><g transform="rotate(${rot} 18 18)"><path d="M18 7 L23 16 L20 16 L20 26 L16 26 L16 16 L13 16 Z" fill="#ffffff"/></g></svg>`;

const OFFLINE_CAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 36 36"><circle cx="18" cy="18" r="15" fill="#9ca3af" stroke="white" stroke-width="2.5"/><path d="M25.92 13.01C25.72 12.42 25.16 12 24.5 12h-13c-.66 0-1.21.42-1.42 1.01L8 19v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h14v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM12.5 23c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM11 18l1.5-4.5h11L25 18H11z" fill="white"/></svg>`;

function computeBearing(from: { lat: number; lng: number }, to: { lat: number; lng: number }): number {
  const dLng = (to.lng - from.lng) * Math.PI / 180;
  const lat1 = from.lat * Math.PI / 180;
  const lat2 = to.lat * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function decodePolyline(encoded: string): Coords[] {
  const points: Coords[] = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let b: number, shift = 0, result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0; result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

// ── Smooth driver position interpolation ──
const LERP_MS = 1200;
function lerpVal(a: number, b: number, t: number) { return a + (b - a) * Math.min(1, Math.max(0, t)); }

function useSmoothDrivers(drivers?: Array<{ id: string; lat: number; lng: number; isOnline?: boolean }>) {
  const prevRef = useRef<Map<string, Coords>>(new Map());
  const headingRef = useRef<Map<string, number>>(new Map());
  const [smoothed, setSmoothed] = useState<Array<{ id: string; lat: number; lng: number; isOnline?: boolean; heading: number }>>([]);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!drivers?.length) { setSmoothed([]); return; }

    const targets = new Map<string, { lat: number; lng: number; isOnline?: boolean }>();
    const froms = new Map<string, Coords>();

    for (const d of drivers) {
      targets.set(d.id, { lat: d.lat, lng: d.lng, isOnline: d.isOnline });
      const prev = prevRef.current.get(d.id) ?? { lat: d.lat, lng: d.lng };
      froms.set(d.id, prev);
      // Only update bearing when the driver actually moved a meaningful amount
      const dist = Math.hypot(d.lat - prev.lat, d.lng - prev.lng);
      if (dist > 1e-5) {
        headingRef.current.set(d.id, computeBearing(prev, d));
      }
    }

    const start = performance.now();
    const animate = (now: number) => {
      const t = Math.min(1, (now - start) / LERP_MS);
      const eased = 1 - Math.pow(1 - t, 3);
      const result: Array<{ id: string; lat: number; lng: number; isOnline?: boolean; heading: number }> = [];

      for (const d of drivers) {
        const from = froms.get(d.id)!;
        const to = targets.get(d.id)!;
        result.push({
          id: d.id,
          lat: lerpVal(from.lat, to.lat, eased),
          lng: lerpVal(from.lng, to.lng, eased),
          isOnline: to.isOnline,
          heading: headingRef.current.get(d.id) ?? 0,
        });
      }
      setSmoothed(result);
      if (t < 1) rafRef.current = requestAnimationFrame(animate);
      else {
        for (const d of drivers) prevRef.current.set(d.id, { lat: d.lat, lng: d.lng });
      }
    };

    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(animate);

    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [drivers]);

  return smoothed;
}

// ── Map Failure Help Card ──
function MapFailureCard({ error, className, height }: { error: Error; className?: string; height?: string }) {
  return (
    <div className={`flex items-center justify-center bg-muted ${className}`} style={{ height, minHeight: 260 }}>
      <div className="text-center p-6 space-y-4 max-w-sm">
        <AlertTriangle className="w-12 h-12 mx-auto text-destructive" />
        <div>
          <p className="font-semibold text-foreground text-lg">Map failed to load</p>
          <p className="text-sm text-muted-foreground mt-1">{error.message}</p>
        </div>
        <div className="text-left bg-card rounded-xl p-4 space-y-2 text-sm">
          <p className="font-semibold text-foreground">Please verify:</p>
          <ul className="space-y-1.5 text-muted-foreground">
            <li className="flex items-start gap-2">
              <span className="text-primary mt-0.5">•</span>
              <span>Billing is enabled in Google Cloud Console</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary mt-0.5">•</span>
              <span>Maps JavaScript API is enabled</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary mt-0.5">•</span>
              <span>Places API is enabled</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary mt-0.5">•</span>
              <span>Geocoding API is enabled</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary mt-0.5">•</span>
              <span>Directions / Routes API is enabled</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary mt-0.5">•</span>
              <span>HTTP referrers include your Lovable preview domain, published domain, and localhost</span>
            </li>
          </ul>
        </div>
        <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
          <RefreshCw className="w-4 h-4 mr-1.5" /> Retry
        </Button>
      </div>
    </div>
  );
}

// ── Inner map component (only renders when API is loaded) ──
function InnerMapGoogle({
  pickup, dropoff, driverLocation, routeGeometry, secondaryRouteGeometry, onMapClick,
  className = '', height = '100%', drivers, defaultCenter, defaultZoom = 13, etaMinutes = 0, stops,
}: MapGoogleProps) {
  const mapRef = useRef<google.maps.Map | null>(null);
  const [routePath, setRoutePath] = useState<Coords[]>([]);
  const [secondaryPath, setSecondaryPath] = useState<Coords[]>([]);
  const smoothDrivers = useSmoothDrivers(drivers);

  // Whether the premium overlay is active (driver + pickup present)
  const hasPremiumOverlay = !!(driverLocation && pickup && mapRef.current);

  useEffect(() => {
    if (routeGeometry) {
      try { setRoutePath(decodePolyline(routeGeometry)); }
      catch { setRoutePath([]); }
    } else { setRoutePath([]); }
  }, [routeGeometry]);

  useEffect(() => {
    if (secondaryRouteGeometry) {
      try { setSecondaryPath(decodePolyline(secondaryRouteGeometry)); }
      catch { setSecondaryPath([]); }
    } else { setSecondaryPath([]); }
  }, [secondaryRouteGeometry]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (pickup || dropoff || driverLocation) return;
    if (defaultCenter) {
      map.panTo(defaultCenter);
      map.setZoom(defaultZoom);
    }
  }, [defaultCenter?.lat, defaultCenter?.lng, pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng, driverLocation?.lat, driverLocation?.lng]);

  // Auto-fit bounds: include all markers AND route path points so nothing is clipped
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const pts: Coords[] = [];
    if (pickup) pts.push(pickup);
    if (dropoff) pts.push(dropoff);
    if (driverLocation) pts.push(driverLocation);
    // Include stop waypoints
    if (stops?.length) stops.forEach((s) => { if (s.lat && s.lng) pts.push({ lat: s.lat, lng: s.lng }); });
    // Include every point along the route polyline so curved routes aren't cut off
    if (routePath.length > 1) routePath.forEach((p) => pts.push(p));
    if (secondaryPath.length > 1) secondaryPath.forEach((p) => pts.push(p));

    if (pts.length >= 2) {
      const bounds = new google.maps.LatLngBounds();
      pts.forEach((p) => bounds.extend(p));
      // Premium Uber/Bolt-style asymmetric padding. Bottom is much larger to
      // reserve space for the blue booking card; top leaves room for floating
      // header pills. Clamped responsively so it adapts across devices.
      const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
      const vw = typeof window !== 'undefined' ? window.innerWidth : 400;
      // Push route UP: small top padding pulls D near the top bell icon,
      // large bottom padding keeps P clear of the blue booking card.
      const top = Math.round(Math.max(36, Math.min(64, vh * 0.07)));
      const bottom = Math.round(Math.max(300, Math.min(420, vh * 0.48)));
      const side = Math.round(Math.max(48, Math.min(72, vw * 0.08)));
      map.fitBounds(bounds, { top, bottom, left: side, right: side });
      // Clamp zoom after fit so very short trips don't over-zoom.
      google.maps.event.addListenerOnce(map, 'idle', () => {
        const z = map.getZoom();
        if (typeof z === 'number' && z > 16.5) map.setZoom(16.5);
      });
    } else if (pts.length === 1) {
      map.panTo(pts[0]);
      map.setZoom(15);
    }
  }, [pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng, driverLocation?.lat, driverLocation?.lng, routePath, secondaryPath]);

  const handleLoad = useCallback((map: google.maps.Map) => { mapRef.current = map; }, []);
  const handleClick = useCallback((e: google.maps.MapMouseEvent) => {
    if (!onMapClick || !e.latLng) return;
    onMapClick({ lat: e.latLng.lat(), lng: e.latLng.lng() });
  }, [onMapClick]);

  const center = pickup || dropoff || driverLocation || defaultCenter || ZW_CENTER;

  return (
    <div className={className} style={{ height, minHeight: height === '100%' ? undefined : 260 }}>
      <GoogleMap
        mapContainerStyle={containerStyle}
        center={center}
        zoom={defaultZoom}
        options={mapOptions}
        onLoad={handleLoad}
        onClick={handleClick}
      >
        {pickup && (
          <Marker position={pickup} icon={{ path: google.maps.SymbolPath.CIRCLE, scale: 10, fillColor: '#FBBF24', fillOpacity: 1, strokeColor: '#ffffff', strokeWeight: 3 }} label={{ text: 'P', color: '#000', fontWeight: 'bold', fontSize: '11px' }} zIndex={10} />
        )}
        {dropoff && (
          <Marker position={dropoff} icon={{ path: google.maps.SymbolPath.CIRCLE, scale: 10, fillColor: '#1B3FA0', fillOpacity: 1, strokeColor: '#ffffff', strokeWeight: 3 }} label={{ text: 'D', color: '#fff', fontWeight: 'bold', fontSize: '11px' }} zIndex={10} />
        )}

        {/* Numbered stop waypoint markers */}
        {stops?.map((stop, i) => (
          stop.lat && stop.lng ? (
            <Marker
              key={stop.id}
              position={{ lat: stop.lat, lng: stop.lng }}
              icon={{ path: google.maps.SymbolPath.CIRCLE, scale: 10, fillColor: '#f59e0b', fillOpacity: 1, strokeColor: '#ffffff', strokeWeight: 3 }}
              label={{ text: `${i + 1}`, color: '#000', fontWeight: 'bold', fontSize: '12px' }}
              zIndex={9}
            />
          ) : null
        ))}

        {driverLocation && pickup && mapRef.current && (
          <PremiumTrackingMap
            map={mapRef.current}
            driverPosition={driverLocation}
            riderPosition={pickup}
            routePath={secondaryPath.length > 1 ? secondaryPath : (routePath.length > 1 ? routePath : [driverLocation, pickup])}
            etaMinutes={etaMinutes}
          />
        )}

        {/* Nearby drivers as animated, rotated, brand-blue car icons with a soft halo */}
        {smoothDrivers.map((d) => (
          <Marker key={d.id} position={{ lat: d.lat, lng: d.lng }} icon={{
            url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(d.isOnline ? NEARBY_CAR_SVG(d.heading) : OFFLINE_CAR_SVG),
            scaledSize: new google.maps.Size(d.isOnline ? 36 : 28, d.isOnline ? 36 : 28),
            anchor: new google.maps.Point(d.isOnline ? 18 : 14, d.isOnline ? 18 : 14),
          }} zIndex={5} />
        ))}

        {/* Driver → Pickup dashed line (only when premium overlay is NOT handling it) */}
        {!hasPremiumOverlay && driverLocation && pickup && (
          <>
            {/* White outline underneath */}
            <Polyline path={[driverLocation, pickup]} options={{ strokeColor: '#ffffff', strokeWeight: 6, strokeOpacity: 1, zIndex: 1 }} />
            {/* Dashed blue animated line */}
            <Polyline path={[driverLocation, pickup]} options={{ strokeColor: '#1B3FA0', strokeWeight: 3, strokeOpacity: 0, zIndex: 3, icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 4, strokeColor: '#1B3FA0' }, offset: '0', repeat: '16px' }] }} />
          </>
        )}
        {/* Secondary route (only when premium overlay is NOT handling it) */}
        {!hasPremiumOverlay && secondaryPath.length > 1 && (
          <>
            <Polyline path={secondaryPath} options={{ strokeColor: '#ffffff', strokeWeight: 7, strokeOpacity: 1, zIndex: 1 }} />
            <Polyline path={secondaryPath} options={{ strokeColor: '#60a5fa', strokeWeight: 4, strokeOpacity: 0.7, zIndex: 2, icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 3 }, offset: '0', repeat: '15px' }] }} />
          </>
        )}
        {/* Primary route: pickup → dropoff (solid bold blue with white outline) */}
        {routePath.length > 1 && (
          <>
            <Polyline path={routePath} options={{ strokeColor: '#ffffff', strokeWeight: 9, strokeOpacity: 1, zIndex: 1 }} />
            <Polyline path={routePath} options={{ strokeColor: '#1B3FA0', strokeWeight: 5, strokeOpacity: 1, zIndex: 2 }} />
          </>
        )}
      </GoogleMap>
    </div>
  );
}

// ── Outer wrapper ──
// Default provider is now Mapbox. Google can be opted into via
// `localStorage.enableGoogleMaps = '1'` or `VITE_ENABLE_GOOGLE_MAPS=true`.
function MapGoogle(props: MapGoogleProps) {
  const [retryKey, setRetryKey] = useState(0);
  const googleDisabled = isGoogleMapsDisabled();
  const { isLoaded, loadError, apiKey } = useGoogleMaps(googleDisabled ? -1 : retryKey);
  const { className = '', height = '100%' } = props;

  const handleRetry = useCallback(() => {
    resetGoogleMapsLoader();
    setRetryKey((k) => k + 1);
  }, []);

  // Default path: Mapbox (replaces OSM + Google).
  if (googleDisabled) {
    return (
      <MapboxMap
        pickup={props.pickup}
        dropoff={props.dropoff}
        driverLocation={props.driverLocation}
        routeGeometry={props.routeGeometry}
        secondaryRouteGeometry={props.secondaryRouteGeometry}
        onMapClick={props.onMapClick}
        defaultCenter={props.defaultCenter}
        defaultZoom={props.defaultZoom}
        drivers={props.drivers}
        stops={props.stops}
        etaMinutes={props.etaMinutes}
        suggestions={props.suggestions}
        className={className}
        height={height}
      />
    );
  }

  if (!apiKey) {
    return (
      <div className={`flex items-center justify-center bg-muted ${className}`} style={{ height, minHeight: 260 }}>
        <div className="text-center p-6 space-y-3">
          <AlertTriangle className="w-10 h-10 mx-auto text-destructive" />
          <p className="font-semibold text-foreground">Google Maps API key missing</p>
        </div>
      </div>
    );
  }
  if (loadError) {
    return (
      <StaticMapFallback
        lat={props.pickup?.lat ?? props.dropoff?.lat}
        lng={props.pickup?.lng ?? props.dropoff?.lng}
        errorMessage={loadError.message}
        onRetry={handleRetry}
        className={className}
        height={height}
      />
    );
  }
  if (!isLoaded) {
    return (
      <div className={`relative ${className}`} style={{ height, minHeight: 260 }}>
        <Skeleton className="absolute inset-0 rounded-none" />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex items-center gap-2 bg-card px-4 py-2 rounded-full shadow-md">
            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <span className="text-sm font-medium text-foreground">Loading map…</span>
          </div>
        </div>
      </div>
    );
  }
  return <InnerMapGoogle {...props} />;
}

export default memo(MapGoogle);
