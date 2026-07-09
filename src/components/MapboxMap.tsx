/* eslint-disable react-hooks/exhaustive-deps */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getMapboxToken, loadMapbox, resetMapboxLoader, type MapboxGL, type MapboxMapInstance } from "@/lib/mapboxLoader";

export interface Coords {
  lat: number;
  lng: number;
}

interface MapboxMapProps {
  pickup?: Coords | null;
  dropoff?: Coords | null;
  driverLocation?: Coords | null;
  routeGeometry?: string | null;
  secondaryRouteGeometry?: string | null;
  routeCoordinates?: Coords[] | null;
  onMapClick?: (coords: Coords) => void;
  className?: string;
  height?: string;
  drivers?: Array<{ id: string; lat: number; lng: number; isOnline?: boolean }>;
  defaultCenter?: Coords;
  defaultZoom?: number;
  etaMinutes?: number;
  stops?: Array<{ id: string; address: string; lat: number; lng: number }>;
}

const ZW_CENTER: Coords = { lat: -19.015, lng: 29.155 };
const LERP_MS = 1200;

function decodePolyline(encoded: string): Coords[] {
  const points: Coords[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    let b: number;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

function lerpVal(a: number, b: number, t: number) {
  return a + (b - a) * Math.min(1, Math.max(0, t));
}

function useSmoothDrivers(drivers?: Array<{ id: string; lat: number; lng: number; isOnline?: boolean }>) {
  const prevRef = useRef<Map<string, Coords>>(new Map());
  const [smoothed, setSmoothed] = useState<Array<{ id: string; lat: number; lng: number; isOnline?: boolean }>>([]);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!drivers?.length) {
      setSmoothed([]);
      return;
    }

    const froms = new Map<string, Coords>();
    for (const d of drivers) {
      froms.set(d.id, prevRef.current.get(d.id) ?? { lat: d.lat, lng: d.lng });
    }

    const start = performance.now();
    const animate = (now: number) => {
      const eased = 1 - Math.pow(1 - Math.min(1, (now - start) / LERP_MS), 3);
      const result = drivers.map((d) => {
        const from = froms.get(d.id) ?? d;
        return {
          id: d.id,
          lat: lerpVal(from.lat, d.lat, eased),
          lng: lerpVal(from.lng, d.lng, eased),
          isOnline: d.isOnline,
        };
      });
      setSmoothed(result);
      if (eased < 1) rafRef.current = requestAnimationFrame(animate);
      else drivers.forEach((d) => prevRef.current.set(d.id, { lat: d.lat, lng: d.lng }));
    };

    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(animate);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [drivers]);

  return smoothed;
}

function markerElement(label: string, color: string, textColor = "#fff", size = 30) {
  const el = document.createElement("div");
  el.className = "pickme-mapbox-marker";
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  el.style.borderRadius = "999px";
  el.style.background = color;
  el.style.color = textColor;
  el.style.border = "3px solid #fff";
  el.style.boxShadow = "0 10px 24px rgba(15,23,42,0.24)";
  el.style.display = "flex";
  el.style.alignItems = "center";
  el.style.justifyContent = "center";
  el.style.fontWeight = "800";
  el.style.fontSize = "12px";
  el.textContent = label;
  return el;
}

function carElement(isOnline = true) {
  const el = markerElement(">", isOnline ? "#22c55e" : "#9ca3af", "#fff", isOnline ? 34 : 30);
  el.style.fontSize = "16px";
  return el;
}

function routeFeature(points: Coords[]) {
  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "LineString",
      coordinates: points.map((p) => [p.lng, p.lat]),
    },
  };
}

function updateRoute(map: MapboxMapInstance, id: string, points: Coords[], color: string, dashed = false) {
  if (points.length < 2) {
    if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(id)) map.removeSource(id);
    return;
  }

  const data = routeFeature(points);
  const source = map.getSource(id);
  if (source?.setData) {
    source.setData(data);
    return;
  }

  map.addSource(id, { type: "geojson", data });
  map.addLayer({
    id,
    type: "line",
    source: id,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": color,
      "line-width": 5,
      "line-opacity": 0.95,
      ...(dashed ? { "line-dasharray": [1.4, 1.2] } : {}),
    },
  });
}

function MapboxFailure({ message, className, height, onRetry }: { message: string; className?: string; height?: string; onRetry?: () => void }) {
  return (
    <div className={`flex items-center justify-center bg-muted ${className ?? ""}`} style={{ height, minHeight: 260 }}>
      <div className="max-w-sm space-y-4 p-6 text-center">
        <AlertTriangle className="mx-auto h-10 w-10 text-destructive" />
        <div>
          <p className="font-semibold text-foreground">Mapbox map unavailable</p>
          <p className="mt-1 text-sm text-muted-foreground">{message}</p>
        </div>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw className="mr-1.5 h-4 w-4" /> Retry
          </Button>
        )}
      </div>
    </div>
  );
}

function InnerMapboxMap({
  mapboxgl,
  pickup,
  dropoff,
  driverLocation,
  routeGeometry,
  secondaryRouteGeometry,
  routeCoordinates,
  onMapClick,
  className = "",
  height = "100%",
  drivers,
  defaultCenter,
  defaultZoom = 13,
  stops,
}: MapboxMapProps & { mapboxgl: MapboxGL }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapboxMapInstance | null>(null);
  const markersRef = useRef<Array<{ remove: () => void }>>([]);
  const [loaded, setLoaded] = useState(false);
  const smoothDrivers = useSmoothDrivers(drivers);

  const primaryRoute = useMemo(() => {
    if (routeGeometry) {
      try {
        return decodePolyline(routeGeometry);
      } catch {
        return [];
      }
    }
    if (routeCoordinates?.length) return routeCoordinates;
    if (pickup && dropoff) return [pickup, dropoff];
    return [];
  }, [routeGeometry, routeCoordinates, pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng]);

  const secondaryRoute = useMemo(() => {
    if (secondaryRouteGeometry) {
      try {
        return decodePolyline(secondaryRouteGeometry);
      } catch {
        return [];
      }
    }
    if (driverLocation && pickup) return [driverLocation, pickup];
    return [];
  }, [secondaryRouteGeometry, driverLocation?.lat, driverLocation?.lng, pickup?.lat, pickup?.lng]);

  const center = pickup || dropoff || driverLocation || defaultCenter || ZW_CENTER;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: [center.lng, center.lat],
      zoom: defaultZoom,
      attributionControl: true,
    });

    mapRef.current = map;
    map.on("load", () => setLoaded(true));
    return () => {
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;

    const clickHandler = (e: any) => {
      if (!onMapClick) return;
      onMapClick({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    };
    map.on("click", clickHandler);
    return () => map.off("click", clickHandler);
  }, [loaded, onMapClick]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;

    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];

    const addMarker = (coords: Coords, el: HTMLElement) => {
      markersRef.current.push(new mapboxgl.Marker({ element: el }).setLngLat([coords.lng, coords.lat]).addTo(map));
    };

    if (pickup) addMarker(pickup, markerElement("P", "#fbbf24", "#111827"));
    if (dropoff) addMarker(dropoff, markerElement("D", "#1B3FA0"));
    if (driverLocation) addMarker(driverLocation, markerElement("D", "#2563eb"));
    stops?.forEach((stop, index) => {
      if (stop.lat && stop.lng) addMarker({ lat: stop.lat, lng: stop.lng }, markerElement(String(index + 1), "#f59e0b", "#111827"));
    });
    smoothDrivers.forEach((driver) => addMarker(driver, carElement(driver.isOnline)));

    updateRoute(map, "primary-route", primaryRoute, "#1B3FA0");
    updateRoute(map, "secondary-route", secondaryRoute, "#60a5fa", true);

    const points = [
      pickup,
      dropoff,
      driverLocation,
      ...(stops?.map((s) => (s.lat && s.lng ? { lat: s.lat, lng: s.lng } : null)) ?? []),
      ...primaryRoute,
      ...secondaryRoute,
      ...smoothDrivers,
    ].filter(Boolean) as Coords[];

    if (points.length >= 2) {
      const bounds = new mapboxgl.LngLatBounds();
      points.forEach((p) => bounds.extend([p.lng, p.lat]));
      map.fitBounds(bounds, { padding: { top: 70, bottom: 260, left: 48, right: 48 }, maxZoom: 16 });
    } else if (points.length === 1) {
      map.panTo([points[0].lng, points[0].lat]);
      map.setZoom(15);
    } else if (defaultCenter) {
      map.panTo([defaultCenter.lng, defaultCenter.lat]);
      map.setZoom(defaultZoom);
    }
    map.resize();
  }, [
    loaded,
    pickup?.lat,
    pickup?.lng,
    dropoff?.lat,
    dropoff?.lng,
    driverLocation?.lat,
    driverLocation?.lng,
    primaryRoute,
    secondaryRoute,
    smoothDrivers,
    stops,
    defaultCenter?.lat,
    defaultCenter?.lng,
  ]);

  return (
    <div className={className} style={{ height, minHeight: height === "100%" ? undefined : 260 }}>
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}

function MapboxMap(props: MapboxMapProps) {
  const [retryKey, setRetryKey] = useState(0);
  const [mapboxgl, setMapboxgl] = useState<MapboxGL | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const token = getMapboxToken();
  const { className = "", height = "100%" } = props;

  const retry = useCallback(() => {
    resetMapboxLoader();
    setError(null);
    setMapboxgl(null);
    setRetryKey((key) => key + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!token) return;
    loadMapbox()
      .then((loaded) => {
        if (!cancelled) setMapboxgl(loaded);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err : new Error("Mapbox failed to load"));
      });
    return () => {
      cancelled = true;
    };
  }, [token, retryKey]);

  if (!token) {
    return (
      <MapboxFailure
        className={className}
        height={height}
        message="Set VITE_MAPBOX_ACCESS_TOKEN in your frontend environment, then restart the dev server."
      />
    );
  }

  if (error) {
    return <MapboxFailure className={className} height={height} message={error.message} onRetry={retry} />;
  }

  if (!mapboxgl) {
    return (
      <div className={`relative ${className}`} style={{ height, minHeight: 260 }}>
        <Skeleton className="absolute inset-0 rounded-none" />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex items-center gap-2 rounded-full bg-card px-4 py-2 shadow-md">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <span className="text-sm font-medium text-foreground">Loading Mapbox...</span>
          </div>
        </div>
      </div>
    );
  }

  return <InnerMapboxMap {...props} mapboxgl={mapboxgl} />;
}

export default memo(MapboxMap);
