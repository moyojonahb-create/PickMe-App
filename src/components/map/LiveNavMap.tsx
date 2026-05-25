/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useMemo, useRef, useState, memo } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { getMapboxToken, resetMapboxToken } from '@/lib/mapboxLoader';
import { decodePolyline, trimRouteAhead, bearing as bearingOf, haversineMeters, EMA } from '@/lib/routeProgress';

interface Coords { lat: number; lng: number }

export type NavPhase = 'to_pickup' | 'to_dropoff';

export interface LiveNavMapProps {
  phase: NavPhase;
  driverLocation: Coords | null;
  pickup: Coords | null;
  dropoff: Coords | null;
  /** OSRM/Google-encoded polyline for the current leg (driver → pickup or pickup → dropoff). */
  routeGeometry?: string | null;
  /** Render bearing/speed to caller for SpeedBadge & DirectionArrow3D. */
  onTelemetry?: (t: { speedKmh: number; bearing: number; remainingMeters: number }) => void;
  /** Dark navigation style by default. */
  dark?: boolean;
  className?: string;
}

const ZW_CENTER: Coords = { lat: -19.015, lng: 29.155 };
const YELLOW = '#FACC15';
const BLUE = '#1B3FA0';

function carMarkerEl(color: string): HTMLDivElement {
  const el = document.createElement('div');
  el.style.cssText = `
    width:42px;height:42px;border-radius:50%;
    background:radial-gradient(circle at 30% 30%, ${color}, #0a0a0a);
    border:3px solid #fff;
    box-shadow:0 6px 18px rgba(0,0,0,.45), 0 0 0 6px ${color}33;
    display:flex;align-items:center;justify-content:center;
    font-size:18px;line-height:1;
  `;
  el.textContent = '🚗';
  return el;
}

function pinEl(color: string, label: string): HTMLDivElement {
  const el = document.createElement('div');
  el.style.cssText = `
    width:30px;height:30px;border-radius:50% 50% 50% 0;
    background:${color};border:3px solid #fff;
    box-shadow:0 4px 12px rgba(0,0,0,.35);
    transform:rotate(-45deg);
    display:flex;align-items:center;justify-content:center;
    color:#fff;font-weight:800;font-size:12px;font-family:Inter,system-ui,sans-serif;
  `;
  const inner = document.createElement('span');
  inner.style.transform = 'rotate(45deg)';
  inner.textContent = label;
  el.appendChild(inner);
  return el;
}

function LiveNavMapInner({
  phase,
  driverLocation,
  pickup,
  dropoff,
  routeGeometry,
  onTelemetry,
  dark = true,
  className = '',
}: LiveNavMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const driverMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const pickupMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const dropoffMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const lastPosRef = useRef<{ lat: number; lng: number; t: number } | null>(null);
  const speedEmaRef = useRef(new EMA(0.3));
  const bearingRef = useRef(0);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const routeColor = phase === 'to_pickup' ? YELLOW : BLUE;
  const startCenter = driverLocation ?? pickup ?? dropoff ?? ZW_CENTER;
  const decoded = useMemo(
    () => (routeGeometry ? decodePolyline(routeGeometry) : []),
    [routeGeometry],
  );

  // ── Init map ──
  useEffect(() => {
    let cancelled = false;
    if (!containerRef.current) return;

    (async () => {
      try {
        const token = await getMapboxToken();
        if (cancelled) return;
        if (!token || !token.startsWith('pk.')) {
          throw new Error('Invalid Mapbox token (expected pk.*)');
        }
        mapboxgl.accessToken = token;

        const map = new mapboxgl.Map({
          container: containerRef.current!,
          style: dark ? 'mapbox://styles/mapbox/navigation-night-v1' : 'mapbox://styles/mapbox/navigation-day-v1',
          center: [startCenter.lng, startCenter.lat],
          zoom: 16,
          pitch: 55,
          bearing: 0,
          minZoom: 4,
          maxZoom: 19,
          attributionControl: false,
        });

        // Surface auth/tile errors instead of staying silent on a black canvas.
        map.on('error', (ev: { error?: { message?: string; status?: number } }) => {
          const msg = ev?.error?.message || 'Unknown map error';
          console.error('[LiveNavMap] mapbox error:', msg, ev);
          if (/401|403|Unauthor|access token|Forbidden/i.test(msg)) {
            setLoadError(`Mapbox auth error: ${msg}`);
          }
        });

        map.on('load', () => {
          if (cancelled) return;
          // Force a resize once style is ready — fixes 0px container races.
          requestAnimationFrame(() => map.resize());

          // Glow casing (soft outer halo)
          map.addSource('nav-route', {
            type: 'geojson',
            data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } },
          });
          map.addLayer({
            id: 'nav-route-glow',
            type: 'line',
            source: 'nav-route',
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-color': routeColor,
              'line-width': 18,
              'line-opacity': 0.18,
              'line-blur': 6,
            },
          });
          map.addLayer({
            id: 'nav-route-casing',
            type: 'line',
            source: 'nav-route',
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': '#0b1220', 'line-width': 10, 'line-opacity': 0.55 },
          });
          map.addLayer({
            id: 'nav-route-line',
            type: 'line',
            source: 'nav-route',
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': routeColor, 'line-width': 6 },
          });

          setReady(true);
        });
        mapRef.current = map;
      } catch (e) {
        console.error('[LiveNavMap] init failed:', e);
        if (!cancelled) setLoadError((e as Error).message);
      }
    })();

    return () => {
      cancelled = true;
      if (animFrameRef.current !== null) cancelAnimationFrame(animFrameRef.current);
      driverMarkerRef.current?.remove();
      pickupMarkerRef.current?.remove();
      dropoffMarkerRef.current?.remove();
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // ── Route color reflects phase ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    try {
      map.setPaintProperty('nav-route-line', 'line-color', routeColor);
      map.setPaintProperty('nav-route-glow', 'line-color', routeColor);
    } catch { /* layers may be replaced on style change */ }
  }, [ready, routeColor]);

  // ── Pickup / dropoff markers ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    if (pickup) {
      if (!pickupMarkerRef.current) {
        pickupMarkerRef.current = new mapboxgl.Marker({ element: pinEl(YELLOW, 'P'), anchor: 'bottom' })
          .setLngLat([pickup.lng, pickup.lat])
          .addTo(map);
      } else {
        pickupMarkerRef.current.setLngLat([pickup.lng, pickup.lat]);
      }
    } else {
      pickupMarkerRef.current?.remove();
      pickupMarkerRef.current = null;
    }

    if (dropoff) {
      if (!dropoffMarkerRef.current) {
        dropoffMarkerRef.current = new mapboxgl.Marker({ element: pinEl(BLUE, 'D'), anchor: 'bottom' })
          .setLngLat([dropoff.lng, dropoff.lat])
          .addTo(map);
      } else {
        dropoffMarkerRef.current.setLngLat([dropoff.lng, dropoff.lat]);
      }
    } else {
      dropoffMarkerRef.current?.remove();
      dropoffMarkerRef.current = null;
    }
  }, [ready, pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng]);

  // ── Driver marker w/ smooth animation, telemetry, route trim, camera follow ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !driverLocation) return;

    // Speed + bearing from previous tick
    const now = performance.now();
    const last = lastPosRef.current;
    let speedKmh = 0;
    if (last) {
      const dtSec = Math.max(0.001, (now - last.t) / 1000);
      const dM = haversineMeters({ lat: last.lat, lng: last.lng }, driverLocation);
      const raw = (dM / dtSec) * 3.6;
      if (Number.isFinite(raw) && raw < 250) speedKmh = speedEmaRef.current.push(raw);
      const b = bearingOf({ lat: last.lat, lng: last.lng }, driverLocation);
      // Avoid jitter when virtually stationary
      if (dM > 1.5) bearingRef.current = b;
    }
    lastPosRef.current = { lat: driverLocation.lat, lng: driverLocation.lng, t: now };

    // Trim route ahead of driver
    const { ahead, remainingMeters, snapped } = trimRouteAhead(decoded, driverLocation);
    const src = map.getSource('nav-route') as mapboxgl.GeoJSONSource | undefined;
    src?.setData({
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: ahead },
    });

    onTelemetry?.({ speedKmh, bearing: bearingRef.current, remainingMeters });

    // Animate car marker to snapped position (or raw GPS if no route)
    const target: [number, number] = snapped ?? [driverLocation.lng, driverLocation.lat];
    if (!driverMarkerRef.current) {
      driverMarkerRef.current = new mapboxgl.Marker({ element: carMarkerEl(routeColor), anchor: 'center' })
        .setLngLat(target)
        .addTo(map);
    } else {
      const start = driverMarkerRef.current.getLngLat();
      const startArr: [number, number] = [start.lng, start.lat];
      const t0 = performance.now();
      const dur = 900;
      if (animFrameRef.current !== null) cancelAnimationFrame(animFrameRef.current);
      const tick = () => {
        const t = Math.min(1, (performance.now() - t0) / dur);
        const k = 1 - Math.pow(1 - t, 3);
        const lng = startArr[0] + (target[0] - startArr[0]) * k;
        const lat = startArr[1] + (target[1] - startArr[1]) * k;
        driverMarkerRef.current!.setLngLat([lng, lat]);
        if (t < 1) animFrameRef.current = requestAnimationFrame(tick);
      };
      animFrameRef.current = requestAnimationFrame(tick);
    }

    // Camera follow — auto-zoom by remaining distance.
    const zoom = remainingMeters > 4000 ? 14.5
      : remainingMeters > 1500 ? 15.8
      : remainingMeters > 500 ? 16.8
      : 17.6;
    map.easeTo({
      center: target,
      zoom,
      bearing: bearingRef.current,
      pitch: 55,
      duration: 850,
      essential: true,
    });
  }, [ready, driverLocation?.lat, driverLocation?.lng, decoded, routeColor]);

  // ── Initial fit when no driver location yet ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || driverLocation) return;
    const pts: [number, number][] = [];
    if (pickup) pts.push([pickup.lng, pickup.lat]);
    if (dropoff) pts.push([dropoff.lng, dropoff.lat]);
    decoded.forEach((p) => pts.push(p));
    if (pts.length >= 2) {
      const bounds = pts.reduce(
        (b, p) => b.extend(p as mapboxgl.LngLatLike),
        new mapboxgl.LngLatBounds(pts[0] as mapboxgl.LngLatLike, pts[0] as mapboxgl.LngLatLike),
      );
      map.fitBounds(bounds, {
        padding: { top: 120, bottom: 260, left: 60, right: 60 },
        duration: 900,
        pitch: 45,
        maxZoom: 16.5,
        essential: true,
      });
    } else if (pts.length === 1) {
      map.easeTo({ center: pts[0], zoom: 15, duration: 700, essential: true });
    }
  }, [ready, decoded, pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng, driverLocation]);

  if (loadError) {
    return (
      <div className={`flex items-center justify-center bg-muted ${className}`}>
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
    <div className={className} style={{ position: 'absolute', inset: 0 }}>
      <div ref={containerRef} className="absolute inset-0 w-full h-full bg-[#0b1220]" />
      {!ready && !loadError && (
        <div className="absolute inset-0 z-10 pointer-events-none">
          <Skeleton className="absolute inset-0 rounded-none opacity-60" />
        </div>
      )}
    </div>
  );
}

export default memo(LiveNavMapInner);
