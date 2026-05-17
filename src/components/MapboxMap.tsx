/* eslint-disable react-hooks/exhaustive-deps */
import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { AlertTriangle, RefreshCw, Maximize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { getMapboxToken, resetMapboxToken } from '@/lib/mapboxLoader';

interface Coords { lat: number; lng: number }

export interface MapboxMapProps {
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
  etaMinutes?: number;
  stops?: Array<{ id: string; address: string; lat: number; lng: number }>;
  /** Top autocomplete suggestions to preview on the map as labelled pins. */
  suggestions?: Array<{ id?: string; name?: string; lat?: number; lng?: number }>;
  /** Show a floating "Fit map" button (defaults to true). */
  showFitButton?: boolean;
}

// Keep streets readable: never zoom further than ~country level, never deeper than building level.
const MIN_ZOOM = 4;
const MAX_ZOOM = 19;
// Minimum zoom we'll settle on after auto-fit so labels stay legible.
const LABEL_FRIENDLY_MIN_FIT_ZOOM = 12.5;

const ZW_CENTER: Coords = { lat: -19.015, lng: 29.155 };

// Decode Google-style encoded polyline (used by OSRM/Google interchangeably).
function decodePolyline(encoded: string): [number, number][] {
  const points: [number, number][] = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let b: number, shift = 0, result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0; result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    points.push([lng / 1e5, lat / 1e5]); // GeoJSON = [lng, lat]
  }
  return points;
}

function buildMarkerEl(color: string, label: string, dark = false): HTMLDivElement {
  const el = document.createElement('div');
  el.style.cssText = `width:26px;height:26px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;color:${dark ? '#000' : '#fff'};font-weight:700;font-size:11px;font-family:Inter,system-ui,sans-serif;`;
  el.textContent = label;
  return el;
}

function MapboxMapInner({
  pickup, dropoff, driverLocation, routeGeometry, secondaryRouteGeometry,
  onMapClick, className = '', height = '100%', drivers, defaultCenter, defaultZoom = 14.5, stops,
  suggestions, showFitButton = true,
}: MapboxMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Record<string, mapboxgl.Marker>>({});
  const driverMarkersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const suggestionMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const startCenter = useMemo(
    () => pickup || dropoff || driverLocation || defaultCenter || ZW_CENTER,
    [],
  );

  // ── Init map ──
  useEffect(() => {
    let cancelled = false;
    if (!containerRef.current) return;

    (async () => {
      try {
        const token = await getMapboxToken();
        if (cancelled) return;
        mapboxgl.accessToken = token;

        const map = new mapboxgl.Map({
          container: containerRef.current!,
          style: 'mapbox://styles/mapbox/streets-v12',
          center: [startCenter.lng, startCenter.lat],
          zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, defaultZoom)),
          minZoom: MIN_ZOOM,
          maxZoom: MAX_ZOOM,
          attributionControl: true,
          cooperativeGestures: false,
        });
        map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
        map.on('load', () => {
          if (cancelled) return;
          // Empty route sources
          map.addSource('route', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } } });
          map.addLayer({ id: 'route-casing', type: 'line', source: 'route', paint: { 'line-color': '#ffffff', 'line-width': 9 } });
          map.addLayer({ id: 'route-line', type: 'line', source: 'route', paint: { 'line-color': '#1B3FA0', 'line-width': 5 } });

          map.addSource('route2', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } } });
          map.addLayer({ id: 'route2-casing', type: 'line', source: 'route2', paint: { 'line-color': '#ffffff', 'line-width': 7 } });
          map.addLayer({ id: 'route2-line', type: 'line', source: 'route2', paint: { 'line-color': '#60a5fa', 'line-width': 4, 'line-dasharray': [1.5, 1.5] } });

          setReady(true);
        });
        if (onMapClick) {
          map.on('click', (e) => onMapClick({ lat: e.lngLat.lat, lng: e.lngLat.lng }));
        }
        mapRef.current = map;
      } catch (e) {
        if (!cancelled) setLoadError((e as Error).message);
      }
    })();

    return () => {
      cancelled = true;
      Object.values(markersRef.current).forEach((m) => m.remove());
      driverMarkersRef.current.forEach((m) => m.remove());
      suggestionMarkersRef.current.forEach((m) => m.remove());
      markersRef.current = {};
      driverMarkersRef.current.clear();
      suggestionMarkersRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // ── Marker management ──
  const setMarker = useCallback((key: string, pos: Coords | null | undefined, el: () => HTMLElement) => {
    const map = mapRef.current;
    if (!map) return;
    if (!pos) {
      markersRef.current[key]?.remove();
      delete markersRef.current[key];
      return;
    }
    const existing = markersRef.current[key];
    if (existing) {
      existing.setLngLat([pos.lng, pos.lat]);
    } else {
      const marker = new mapboxgl.Marker({ element: el() }).setLngLat([pos.lng, pos.lat]).addTo(map);
      markersRef.current[key] = marker;
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    setMarker('pickup', pickup, () => buildMarkerEl('#FBBF24', 'P', true));
  }, [ready, pickup?.lat, pickup?.lng]);

  useEffect(() => {
    if (!ready) return;
    setMarker('dropoff', dropoff, () => buildMarkerEl('#1B3FA0', 'D'));
  }, [ready, dropoff?.lat, dropoff?.lng]);

  useEffect(() => {
    if (!ready) return;
    setMarker('driver', driverLocation, () => buildMarkerEl('#22c55e', '•'));
  }, [ready, driverLocation?.lat, driverLocation?.lng]);

  // Stops
  useEffect(() => {
    if (!ready) return;
    // Remove old stop markers
    Object.keys(markersRef.current).filter((k) => k.startsWith('stop-')).forEach((k) => {
      markersRef.current[k].remove();
      delete markersRef.current[k];
    });
    stops?.forEach((s, i) => {
      if (!s.lat || !s.lng) return;
      setMarker(`stop-${s.id}`, { lat: s.lat, lng: s.lng }, () => buildMarkerEl('#f59e0b', `${i + 1}`, true));
    });
  }, [ready, stops]);

  // Nearby drivers
  useEffect(() => {
    if (!ready || !mapRef.current) return;
    const map = mapRef.current;
    const seen = new Set<string>();
    drivers?.forEach((d) => {
      seen.add(d.id);
      const existing = driverMarkersRef.current.get(d.id);
      if (existing) {
        existing.setLngLat([d.lng, d.lat]);
      } else {
        const el = buildMarkerEl(d.isOnline ? '#22c55e' : '#9ca3af', '🚗');
        el.style.fontSize = '14px';
        const m = new mapboxgl.Marker({ element: el }).setLngLat([d.lng, d.lat]).addTo(map);
        driverMarkersRef.current.set(d.id, m);
      }
    });
    // Remove drivers no longer present
    Array.from(driverMarkersRef.current.keys()).forEach((id) => {
      if (!seen.has(id)) {
        driverMarkersRef.current.get(id)?.remove();
        driverMarkersRef.current.delete(id);
      }
    });
  }, [ready, drivers]);

  // ── Routes ──
  useEffect(() => {
    if (!ready || !mapRef.current) return;
    const coords = routeGeometry ? decodePolyline(routeGeometry) : [];
    const src = mapRef.current.getSource('route') as mapboxgl.GeoJSONSource | undefined;
    src?.setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } });
  }, [ready, routeGeometry]);

  useEffect(() => {
    if (!ready || !mapRef.current) return;
    const coords = secondaryRouteGeometry ? decodePolyline(secondaryRouteGeometry) : [];
    const src = mapRef.current.getSource('route2') as mapboxgl.GeoJSONSource | undefined;
    src?.setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } });
  }, [ready, secondaryRouteGeometry]);

  // ── Auto-fit ──
  useEffect(() => {
    if (!ready || !mapRef.current) return;
    const map = mapRef.current;
    const pts: [number, number][] = [];
    if (pickup) pts.push([pickup.lng, pickup.lat]);
    if (dropoff) pts.push([dropoff.lng, dropoff.lat]);
    if (driverLocation) pts.push([driverLocation.lng, driverLocation.lat]);
    stops?.forEach((s) => { if (s.lat && s.lng) pts.push([s.lng, s.lat]); });
    if (routeGeometry) decodePolyline(routeGeometry).forEach((p) => pts.push(p));

    // Adaptive padding: don't let the bottom sheet eat the map on short viewports.
    const h = map.getContainer().clientHeight || 600;
    const w = map.getContainer().clientWidth || 600;
    const padding = {
      top: Math.max(40, Math.min(80, h * 0.1)),
      bottom: Math.max(80, Math.min(280, h * 0.32)),
      left: Math.max(32, Math.min(64, w * 0.08)),
      right: Math.max(32, Math.min(64, w * 0.08)),
    };

    if (pts.length >= 2) {
      const bounds = pts.reduce(
        (b, p) => b.extend(p as mapboxgl.LngLatLike),
        new mapboxgl.LngLatBounds(pts[0] as mapboxgl.LngLatLike, pts[0] as mapboxgl.LngLatLike),
      );
      map.fitBounds(bounds, { padding, duration: 600, maxZoom: 16.5 });
    } else if (pts.length === 1) {
      map.flyTo({ center: pts[0], zoom: 15.5, duration: 600 });
    }
  }, [ready, pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng, driverLocation?.lat, driverLocation?.lng, routeGeometry, stops]);

  // ── Render ──
  if (loadError) {
    return (
      <div className={`flex items-center justify-center bg-muted ${className}`} style={{ height, minHeight: 260 }}>
        <div className="text-center p-6 space-y-3 max-w-sm">
          <AlertTriangle className="w-10 h-10 mx-auto text-destructive" />
          <p className="font-semibold text-foreground">Map failed to load</p>
          <p className="text-xs text-muted-foreground">{loadError}</p>
          <Button size="sm" variant="outline" onClick={() => { resetMapboxToken(); window.location.reload(); }}>
            <RefreshCw className="w-4 h-4 mr-1.5" /> Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative ${className}`} style={{ height, minHeight: height === '100%' ? undefined : 260 }}>
      {!ready && (
        <div className="absolute inset-0 z-10">
          <Skeleton className="absolute inset-0 rounded-none" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex items-center gap-2 bg-card px-4 py-2 rounded-full shadow-md">
              <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <span className="text-sm font-medium text-foreground">Loading map…</span>
            </div>
          </div>
        </div>
      )}
      <div ref={containerRef} className="absolute inset-0 w-full h-full" />
    </div>
  );
}

export default memo(MapboxMapInner);
