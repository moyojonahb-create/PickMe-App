/* eslint-disable react-hooks/exhaustive-deps */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  GoogleMap,
  Marker,
} from "@react-google-maps/api";
import { useGoogleMaps } from "@/hooks/useGoogleMaps";
import { calculateDistance } from "@/lib/driverLocation";
import { Loader2 } from "lucide-react";
import PremiumTrackingMap from "@/components/map/PremiumTrackingMap";
import MapboxMap from "@/components/MapboxMap";
import { isGoogleMapsDisabled } from "@/lib/mapsKillSwitch";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Coords {
  lat: number;
  lng: number;
}

export type TripPhase = "driver_to_pickup" | "pickup_to_dropoff" | "idle";

interface TripGoogleMapProps {
  driverLocation: Coords | null;
  pickup: Coords;
  dropoff: Coords;
  tripStatus: string;
  height?: string;
  className?: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const CONTAINER_STYLE: React.CSSProperties = { width: "100%", height: "100%" };

const MAP_OPTIONS: google.maps.MapOptions = {
  disableDefaultUI: true,
  zoomControl: true,
  streetViewControl: false,
  mapTypeControl: false,
  fullscreenControl: false,
  clickableIcons: false,
  gestureHandling: "greedy",
  styles: [
    { featureType: "poi", stylers: [{ visibility: "off" }] },
  ],
};

const PICKUP_ICON_URL = "https://maps.google.com/mapfiles/ms/icons/yellow-dot.png";
const DROPOFF_ICON_URL = "https://maps.google.com/mapfiles/ms/icons/blue-dot.png";

function getPhase(status: string): TripPhase {
  if (["accepted", "enroute", "enroute_pickup", "driver_arriving"].includes(status)) return "driver_to_pickup";
  if (["arrived", "driver_arrived", "in_progress", "near_destination"].includes(status)) return "pickup_to_dropoff";
  return "idle";
}

const MIN_MOVE_KM = 0.075;
const MIN_INTERVAL_MS = 20_000;
const LERP_DURATION_MS = 1500;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.min(1, Math.max(0, t));
}

/* ------------------------------------------------------------------ */
/*  Smooth driver position hook                                        */
/* ------------------------------------------------------------------ */

function useSmoothPosition(target: Coords | null): Coords | null {
  const [display, setDisplay] = useState<Coords | null>(target);
  const fromRef = useRef<Coords | null>(null);
  const toRef = useRef<Coords | null>(null);
  const startTimeRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!target) {
      setDisplay(null);
      fromRef.current = null;
      toRef.current = null;
      return;
    }

    if (!fromRef.current) {
      fromRef.current = target;
      toRef.current = target;
      setDisplay(target);
      return;
    }

    fromRef.current = toRef.current ?? fromRef.current;
    toRef.current = target;
    startTimeRef.current = performance.now();

    const animate = (now: number) => {
      const elapsed = now - startTimeRef.current;
      const t = Math.min(1, elapsed / LERP_DURATION_MS);
      const eased = 1 - Math.pow(1 - t, 3);

      if (fromRef.current && toRef.current) {
        setDisplay({
          lat: lerp(fromRef.current.lat, toRef.current.lat, eased),
          lng: lerp(fromRef.current.lng, toRef.current.lng, eased),
        });
      }

      if (t < 1) rafRef.current = requestAnimationFrame(animate);
    };

    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(animate);

    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [target?.lat, target?.lng]);

  return display;
}

/* ------------------------------------------------------------------ */
/*  Inner map                                                          */
/* ------------------------------------------------------------------ */

function InnerMap({
  driverLocation,
  pickup,
  dropoff,
  tripStatus,
  height,
}: TripGoogleMapProps) {
  // API is already loaded by the wrapper via useGoogleMaps
  const isLoaded = !!window.google?.maps;

  const mapRef = useRef<google.maps.Map | null>(null);
  const [routePath, setRoutePath] = useState<Coords[]>([]);
  const [etaMinutes, setEtaMinutes] = useState(0);
  const lastFetchPos = useRef<Coords | null>(null);
  const lastFetchTime = useRef(0);
  const lastPhase = useRef<TripPhase>("idle");
  const hasFitBounds = useRef(false);

  const phase = getPhase(tripStatus);
  const smoothDriverPos = useSmoothPosition(driverLocation);

  const origin: Coords | null =
    phase === "driver_to_pickup"
      ? driverLocation
      : phase === "pickup_to_dropoff"
      ? driverLocation ?? pickup
      : null;

  const destination: Coords | null =
    phase === "driver_to_pickup"
      ? pickup
      : phase === "pickup_to_dropoff"
      ? dropoff
      : null;

  // Fetch directions and extract route path + ETA
  const fetchDirections = useCallback(() => {
    if (!origin || !destination || !isLoaded) return;

    const now = Date.now();
    const moved =
      lastFetchPos.current == null ||
      calculateDistance(lastFetchPos.current.lat, lastFetchPos.current.lng, origin.lat, origin.lng) >= MIN_MOVE_KM;
    const elapsed = now - lastFetchTime.current >= MIN_INTERVAL_MS;
    const phaseChanged = lastPhase.current !== phase;

    if (!phaseChanged && !moved && !elapsed) return;

    const svc = new google.maps.DirectionsService();
    svc.route(
      {
        origin: { lat: origin.lat, lng: origin.lng },
        destination: { lat: destination.lat, lng: destination.lng },
        travelMode: google.maps.TravelMode.DRIVING,
      },
      (result, status) => {
        if (status === google.maps.DirectionsStatus.OK && result) {
          lastFetchPos.current = { ...origin };
          lastFetchTime.current = Date.now();
          lastPhase.current = phase;

          // Extract path from the overview polyline
          const path = result.routes[0]?.overview_path?.map((p) => ({
            lat: p.lat(),
            lng: p.lng(),
          })) ?? [];
          setRoutePath(path);

          // Extract ETA
          const leg = result.routes[0]?.legs[0];
          if (leg?.duration?.value) {
            setEtaMinutes(Math.round(leg.duration.value / 60));
          }

          if ((!hasFitBounds.current || phaseChanged) && mapRef.current && result.routes[0]) {
            const bounds = result.routes[0].bounds;
            if (bounds) mapRef.current.fitBounds(bounds, { top: 60, bottom: 320, left: 48, right: 48 });
            hasFitBounds.current = true;
          }
        }
      }
    );
  }, [origin?.lat, origin?.lng, destination?.lat, destination?.lng, phase, isLoaded]);

  useEffect(() => { fetchDirections(); }, [fetchDirections]);

  useEffect(() => {
    if (phase === "idle") {
      setRoutePath([]);
      setEtaMinutes(0);
      hasFitBounds.current = false;
    }
  }, [phase]);

  const onMapLoad = useCallback(
    (map: google.maps.Map) => {
      mapRef.current = map;
      if (!hasFitBounds.current) {
        const bounds = new google.maps.LatLngBounds();
        bounds.extend(pickup);
        bounds.extend(dropoff);
        if (driverLocation) bounds.extend(driverLocation);
        map.fitBounds(bounds, { top: 60, bottom: 320, left: 48, right: 48 });
      }
    },
    [pickup, dropoff, driverLocation]
  );

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center bg-muted" style={{ height: height ?? "300px" }}>
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const target = phase === "driver_to_pickup" ? pickup : dropoff;

  return (
    <div style={{ width: "100%", height: height ?? "300px" }}>
      <GoogleMap
        mapContainerStyle={CONTAINER_STYLE}
        center={pickup}
        zoom={14}
        options={MAP_OPTIONS}
        onLoad={onMapLoad}
      >
        {/* Pickup marker */}
        <Marker
          position={pickup}
          icon={{ url: PICKUP_ICON_URL, scaledSize: new google.maps.Size(40, 40) }}
          label={{ text: "P", color: "#000", fontWeight: "bold", fontSize: "11px" }}
          zIndex={10}
        />

        {/* Dropoff marker */}
        <Marker
          position={dropoff}
          icon={{ url: DROPOFF_ICON_URL, scaledSize: new google.maps.Size(40, 40) }}
          label={{ text: "D", color: "#fff", fontWeight: "bold", fontSize: "11px" }}
          zIndex={10}
        />

        {/* Premium driver tracking overlay with distance-based route coloring */}
        {smoothDriverPos && mapRef.current && phase !== "idle" && routePath.length > 1 && (
          <PremiumTrackingMap
            map={mapRef.current}
            driverPosition={smoothDriverPos}
            riderPosition={target}
            routePath={routePath}
            etaMinutes={etaMinutes}
          />
        )}
      </GoogleMap>
    </div>
  );
}

function GoogleTripMap(props: TripGoogleMapProps) {
  const { isLoaded, loadError, apiKey } = useGoogleMaps();

  if (!apiKey) {
    return (
      <div className="flex items-center justify-center bg-muted rounded-xl text-sm text-muted-foreground" style={{ height: props.height ?? "300px" }}>
        Map API key missing
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex items-center justify-center bg-muted rounded-xl text-sm text-muted-foreground" style={{ height: props.height ?? "300px" }}>
        Map failed to load
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center bg-muted rounded-xl" style={{ height: props.height ?? "300px" }}>
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return <InnerMap {...props} />;
}

/* ------------------------------------------------------------------ */
/*  Exported wrapper                                                   */
/* ------------------------------------------------------------------ */

export default function TripGoogleMap(props: TripGoogleMapProps) {
  const googleDisabled = isGoogleMapsDisabled();

  // Default path: Mapbox (Google can be opted into via localStorage/env).
  if (googleDisabled) {
    return (
      <MapboxMap
        pickup={props.pickup}
        dropoff={props.dropoff}
        driverLocation={props.driverLocation}
        defaultZoom={14}
        height={props.height ?? '300px'}
      />
    );
  }

  return <GoogleTripMap {...props} />;
}
