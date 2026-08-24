/* eslint-disable react-hooks/exhaustive-deps */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { createPickupPinElement, type RiderGender } from "@/lib/pickupPin";
import { getMapboxToken, loadMapbox, resetMapboxLoader, type MapboxGL, type MapboxMapInstance } from "@/lib/mapboxLoader";
import { splitRouteAtProgress } from "@/lib/routeProgress";
import carTopWhite from "@/assets/cars/car-top-white.png";
import carTopBlack from "@/assets/cars/car-top-black.png";

export interface Coords {
  lat: number;
  lng: number;
}

export interface MapEtaCard {
  id: string;
  at: Coords;
  label: string;
  value: string;
  subvalue?: string;
  /** Offsets the card away from the pin it's anchored to, in px. */
  offset?: { x: number; y: number };
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
  drivers?: Array<{ id: string; lat: number; lng: number; isOnline?: boolean; white?: boolean }>;
  defaultCenter?: Coords;
  // An explicit recenter request (e.g. manually selecting a town) — takes
  // priority over the pickup/dropoff/driver point-fitting logic below, so a
  // stray GPS/driver update can't silently pan the camera back.
  preferredCenter?: Coords | null;
  defaultZoom?: number;
  etaMinutes?: number;
  stops?: Array<{ id: string; address: string; lat: number; lng: number }>;
  riderGender?: RiderGender;
  /** Renders the primary route as a single yellow→orange→red gradient line
   * (PickMe brand route styling) instead of the default traveled/upcoming
   * two-tone split. Used by the connected-ride and navigation screens. */
  routeGradient?: boolean;
  /** Small compact cards anchored to a map point (e.g. "Pickup · 4 min · 1.2 km"
   * beside the pickup pin) — positioned in screen space and kept in sync as
   * the map moves. */
  mapCards?: MapEtaCard[];
  /** Keeps the camera tightly centered on driverLocation at closeZoom instead
   * of running the multi-point fitBounds framing — for turn-by-turn nav. */
  navigationFollow?: boolean;
  followZoom?: number;
  /** Bump to force an immediate re-center on driverLocation even when the
   * coordinates haven't changed (a manual "recenter" tap). */
  recenterSignal?: number;
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

function useSmoothDrivers(drivers?: Array<{ id: string; lat: number; lng: number; isOnline?: boolean; white?: boolean }>) {
  const prevRef = useRef<Map<string, Coords>>(new Map());
  const [smoothed, setSmoothed] = useState<Array<{ id: string; lat: number; lng: number; isOnline?: boolean; white?: boolean }>>([]);
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
          white: d.white,
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

// Top-down car photo marker — white car for idle/nearby drivers, black car
// for the assigned driver on an in-progress ride.
function carImageElement(src: string, width: number, opacity = 1) {
  const el = document.createElement("div");
  el.className = "pickme-mapbox-marker";
  el.style.width = `${width}px`;
  el.style.filter = "drop-shadow(0 6px 10px rgba(15,23,42,0.35))";
  el.style.opacity = String(opacity);
  const img = document.createElement("img");
  img.src = src;
  img.alt = "";
  img.style.width = "100%";
  img.style.height = "auto";
  img.style.display = "block";
  el.appendChild(img);
  return el;
}

function carElement(isOnline = true) {
  return carImageElement(carTopWhite, 34, isOnline ? 1 : 0.6);
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

// A white halo layer under the colored route line keeps it readable over
// dense/gray road intersections — added first so it renders below the
// colored line added right after it.
function ensureRouteHalo(map: MapboxMapInstance, id: string, data: ReturnType<typeof routeFeature>) {
  const haloId = `${id}-halo`;
  const haloSource = map.getSource(haloId);
  if (haloSource?.setData) {
    haloSource.setData(data);
    return;
  }
  map.addSource(haloId, { type: "geojson", data });
  map.addLayer({
    id: haloId,
    type: "line",
    source: haloId,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#FFFFFF", "line-width": 6, "line-opacity": 0.9 },
  });
}

function updateRoute(map: MapboxMapInstance, id: string, points: Coords[], color: string, dashed = false) {
  if (points.length < 2) {
    clearRoute(map, id);
    return;
  }

  const data = routeFeature(points);
  ensureRouteHalo(map, id, data);

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
      "line-width": 4,
      "line-opacity": 0.95,
      ...(dashed ? { "line-dasharray": [1.4, 1.2] } : {}),
    },
  });
}

// The streets-v12 basemap renders motorways/trunk/primary/secondary roads in
// yellow-orange-cream by default, which competes with the ride route's own
// yellow. Every normal road (and its case/outline layer) is recolored to a
// neutral gray so the ride route is the only yellow-to-red line on the map.
const ROAD_MAJOR_COLOR = "#C7CCD3";
const ROAD_SECONDARY_COLOR = "#D9DDE2";
const ROAD_MINOR_COLOR = "#E5E7EB";
const ROAD_CASE_COLOR = "#B8BEC7";

// Route/halo layers this file manages itself — never touched by the road
// recolor pass below, even though their ids also start with "road" (none
// currently do, but this guards against a future id collision).
const OWN_ROUTE_LAYER_MARKERS = ["-gradient", "-traveled", "-upcoming", "-halo"];

function classifyRoadLayerColor(id: string): string {
  if (id.includes("case")) return ROAD_CASE_COLOR;
  if (/motorway|trunk|primary/.test(id)) return ROAD_MAJOR_COLOR;
  if (/secondary|tertiary/.test(id)) return ROAD_SECONDARY_COLOR;
  return ROAD_MINOR_COLOR;
}

// Soft neutral basemap so the road network and land recede behind the route.
const MAP_LAND_COLOR = "#F4F5F2";
const MAP_PARK_COLOR = "#DDE8DD";
const MAP_WATER_COLOR = "#DCEAF0";
const BACKGROUND_LAYER_COLORS: Record<string, string> = {
  background: MAP_LAND_COLOR,
  land: MAP_LAND_COLOR,
  landuse: MAP_PARK_COLOR,
  "landuse-overlay": MAP_PARK_COLOR,
  park: MAP_PARK_COLOR,
  "national-park": MAP_PARK_COLOR,
  water: MAP_WATER_COLOR,
};

function setLayerColor(map: MapboxMapInstance, id: string, property: "line-color" | "fill-color" | "background-color", color: string) {
  if (!map.getLayer(id)) return;
  try {
    map.setPaintProperty(id, property, color);
  } catch {
    // layer exists but doesn't support this paint property — skip it
  }
}

function applyMapTheme(map: MapboxMapInstance) {
  // Iterate every "road-*" line layer actually present in the loaded style,
  // rather than a fixed id list — Mapbox's road classes (and which ones
  // carry numbered-route roads like Zimbabwe's "R" trunk roads) vary by
  // style version, so a static list reliably misses some.
  const layers = map.getStyle()?.layers ?? [];
  layers.forEach((layer) => {
    if (!layer.id.startsWith("road-")) return;
    if (layer.type !== "line") return;
    if (OWN_ROUTE_LAYER_MARKERS.some((marker) => layer.id.includes(marker))) return;
    setLayerColor(map, layer.id, "line-color", classifyRoadLayerColor(layer.id));
  });
  Object.entries(BACKGROUND_LAYER_COLORS).forEach(([id, color]) => {
    const layer = map.getLayer(id);
    if (!layer) return;
    setLayerColor(map, id, layer.type === "background" ? "background-color" : "fill-color", color);
  });
}

const ROUTE_TRAVELED_COLOR = "#B81104";
const ROUTE_UPCOMING_COLOR = "#FFDD00";
// Secondary route is the driver's path to pickup, not the trip itself — green
// keeps it visually distinct from the primary route's yellow-turning-red.
const SECONDARY_ROUTE_TRAVELED_COLOR = "#15803d";
const SECONDARY_ROUTE_UPCOMING_COLOR = "#22c55e";

// Renders a route as two segments — traveled behind the vehicle's current
// progress point, upcoming ahead of it — instead of a single solid color.
function updateProgressRoute(
  map: MapboxMapInstance,
  id: string,
  points: Coords[],
  progress: Coords | null | undefined,
  traveledColor: string = ROUTE_TRAVELED_COLOR,
  upcomingColor: string = ROUTE_UPCOMING_COLOR,
) {
  const { traveled, upcoming } = splitRouteAtProgress(points, progress);
  updateRoute(map, `${id}-traveled`, traveled, traveledColor);
  updateRoute(map, `${id}-upcoming`, upcoming, upcomingColor);
  clearRoute(map, `${id}-gradient`);
}

// PickMe brand route line: a single smooth yellow → orange → red gradient
// along the whole route (start to destination), via Mapbox's line-gradient
// paint property. Requires `lineMetrics: true` on the source, which is why
// this uses its own source/layer id rather than reusing updateRoute().
function updateGradientRoute(map: MapboxMapInstance, id: string, points: Coords[]) {
  clearRoute(map, `${id}-traveled`);
  clearRoute(map, `${id}-upcoming`);

  if (points.length < 2) {
    clearRoute(map, `${id}-gradient`);
    return;
  }

  const gradientId = `${id}-gradient`;
  const data = routeFeature(points);
  ensureRouteHalo(map, gradientId, data);

  const source = map.getSource(gradientId);
  if (source?.setData) {
    source.setData(data);
    return;
  }

  map.addSource(gradientId, { type: "geojson", lineMetrics: true, data });
  map.addLayer({
    id: gradientId,
    type: "line",
    source: gradientId,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-width": 4,
      "line-opacity": 0.95,
      "line-gradient": [
        "interpolate", ["linear"], ["line-progress"],
        0, "#FFDD00",
        0.35, "#FF7A1A",
        1, "#B81104",
      ],
    },
  });
}

function clearRoute(map: MapboxMapInstance, id: string) {
  if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource(id)) map.removeSource(id);
  const haloId = `${id}-halo`;
  if (map.getLayer(haloId)) map.removeLayer(haloId);
  if (map.getSource(haloId)) map.removeSource(haloId);
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
  preferredCenter,
  defaultZoom = 13,
  stops,
  riderGender,
  routeGradient,
  mapCards,
  navigationFollow,
  followZoom = 17,
  recenterSignal,
}: MapboxMapProps & { mapboxgl: MapboxGL }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapboxMapInstance | null>(null);
  const markersRef = useRef<Array<{ remove: () => void }>>([]);
  const [loaded, setLoaded] = useState(false);
  const [cardPositions, setCardPositions] = useState<Record<string, { x: number; y: number }>>({});
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
    map.on("load", () => {
      applyMapTheme(map);
      setLoaded(true);
    });
    return () => {
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Explicit recenter override — always wins, independent of pickup/dropoff/
  // driver points. Re-fires whenever preferredCenter changes (e.g. a new
  // town is picked), flying the camera there regardless of what else is on
  // the map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || !preferredCenter) return;
    map.flyTo({ center: [preferredCenter.lng, preferredCenter.lat], zoom: 13, essential: true });
  }, [loaded, preferredCenter?.lat, preferredCenter?.lng]);

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

    const addMarker = (coords: Coords, el: HTMLElement, anchor: "center" | "bottom" = "center") => {
      markersRef.current.push(new mapboxgl.Marker({ element: el, anchor }).setLngLat([coords.lng, coords.lat]).addTo(map));
    };

    if (pickup) addMarker(pickup, createPickupPinElement(riderGender), "bottom");
    if (dropoff) addMarker(dropoff, markerElement("D", "#B81104"));
    if (driverLocation) addMarker(driverLocation, carImageElement(carTopBlack, 38));
    stops?.forEach((stop, index) => {
      if (stop.lat && stop.lng) addMarker({ lat: stop.lat, lng: stop.lng }, markerElement(String(index + 1), "#f59e0b", "#111827"));
    });
    smoothDrivers.forEach((driver) => addMarker(driver, carElement(driver.isOnline)));

    if (routeGradient) {
      updateGradientRoute(map, "primary-route", primaryRoute);
    } else {
      updateProgressRoute(map, "primary-route", primaryRoute, driverLocation);
    }
    updateProgressRoute(map, "secondary-route", secondaryRoute, driverLocation, SECONDARY_ROUTE_TRAVELED_COLOR, SECONDARY_ROUTE_UPCOMING_COLOR);

    // While an explicit recenter override or navigation-follow mode is
    // active, a dedicated effect owns the camera — don't let pickup/dropoff/
    // driver points (which can update passively, e.g. a delayed GPS fix)
    // pan it back via the multi-point fitBounds logic below.
    if (preferredCenter || navigationFollow) {
      map.resize();
      return;
    }

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
    riderGender,
    preferredCenter?.lat,
    preferredCenter?.lng,
    defaultCenter?.lat,
    defaultCenter?.lng,
    routeGradient,
    navigationFollow,
  ]);

  // Navigation-follow camera — keeps the view tightly centered on the
  // driver at a close, driving-appropriate zoom instead of the general
  // multi-point framing above. Re-fires on every driver move, and can also
  // be forced via recenterSignal (a manual "recenter" tap) even when the
  // coordinates haven't changed.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || !navigationFollow || !driverLocation) return;
    map.easeTo({ center: [driverLocation.lng, driverLocation.lat], zoom: followZoom, duration: 700 });
  }, [loaded, navigationFollow, driverLocation?.lat, driverLocation?.lng, followZoom, recenterSignal]);

  // Anchored ETA cards — kept in sync with the map's screen-space projection
  // of their target point as the camera moves.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || !mapCards?.length) {
      setCardPositions({});
      return;
    }

    const recompute = () => {
      const next: Record<string, { x: number; y: number }> = {};
      for (const card of mapCards) {
        const p = map.project([card.at.lng, card.at.lat]);
        next[card.id] = p;
      }
      setCardPositions(next);
    };

    recompute();
    map.on("move", recompute);
    map.on("zoom", recompute);
    map.on("resize", recompute);
    return () => {
      map.off("move", recompute);
      map.off("zoom", recompute);
      map.off("resize", recompute);
    };
  }, [loaded, JSON.stringify(mapCards?.map((c) => [c.id, c.at.lat, c.at.lng]))]);

  return (
    <div className={`relative ${className}`} style={{ height, minHeight: height === "100%" ? undefined : 260 }}>
      <div ref={containerRef} className="h-full w-full" />
      {mapCards?.map((card) => {
        const pos = cardPositions[card.id];
        if (!pos) return null;
        const offsetX = card.offset?.x ?? 14;
        const offsetY = card.offset?.y ?? -14;
        return (
          <div
            key={card.id}
            className="absolute z-10 pointer-events-none rounded-xl bg-white px-3 py-2 shadow-[0_6px_20px_rgba(15,23,42,0.18)]"
            style={{ left: pos.x + offsetX, top: pos.y + offsetY, transform: "translateY(-100%)" }}
          >
            <p className="text-[10px] font-semibold text-muted-foreground leading-none">{card.label}</p>
            <p className="text-[13px] font-black text-foreground leading-tight mt-0.5">{card.value}</p>
            {card.subvalue && <p className="text-[10px] text-muted-foreground leading-none mt-0.5">{card.subvalue}</p>}
          </div>
        );
      })}
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
