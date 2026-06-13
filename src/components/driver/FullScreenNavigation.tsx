/* eslint-disable react-hooks/exhaustive-deps */
import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { GoogleMap, Marker, Polyline } from "@react-google-maps/api";
import { useGoogleMaps } from "@/hooks/useGoogleMaps";
import {
  Navigation,
  MapPin,
  Phone,
  MessageCircle,
  Volume2,
  VolumeX,
  ArrowUp,
  CornerUpLeft,
  CornerUpRight,
  Flag,
  CheckCircle2,
  X,
  Gauge,
  Clock,
  Route,
  Loader2,
  ChevronDown,
  RotateCw,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";
import { completeTrip } from "@/lib/completeTrip";
import { useVoiceNavigation } from "@/hooks/useVoiceNavigation";
import { RideCommunication } from "@/components/ride/RideCommunication";
import { goBackend } from "@/lib/goBackendClient";
import type { Coordinates } from "@/lib/osrm";

// ── Types ──

interface ActiveTrip {
  id: string;
  pickup_address: string;
  dropoff_address: string;
  fare: number;
  user_id: string;
  status: string;
  pickup_lat: number;
  pickup_lon: number;
  dropoff_lat: number;
  dropoff_lon: number;
  payment_method: string;
  passenger_name?: string | null;
  passenger_phone?: string | null;
}

interface FullScreenNavigationProps {
  activeTrip: ActiveTrip;
  driverCoords: Coordinates | null;
  userId: string;
  riderPhone: string | null;
  onTripUpdate: (trip: ActiveTrip) => void;
  onTripComplete: () => void;
  onExit: () => void;
  onStartCall: () => void;
  callStatus: string;
}

// ── Google Directions step ──
interface GoogleStep {
  instruction: string;
  distance: number; // meters
  duration: number; // seconds
  maneuver: string;
  startLocation: google.maps.LatLngLiteral;
  endLocation: google.maps.LatLngLiteral;
}

// ── Constants ──

const CONTAINER_STYLE: React.CSSProperties = { width: "100%", height: "100%" };

const NAV_MAP_STYLES: google.maps.MapTypeStyle[] = [
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry.fill", stylers: [{ color: "#e8eaed" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#d4d6d8" }] },
  { featureType: "road.highway", elementType: "geometry.fill", stylers: [{ color: "#fcd669" }] },
  { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#e6b800" }] },
  { featureType: "landscape", elementType: "geometry.fill", stylers: [{ color: "#f5f5f5" }] },
  { featureType: "water", elementType: "geometry.fill", stylers: [{ color: "#aadaff" }] },
];

const MAP_OPTIONS: google.maps.MapOptions = {
  disableDefaultUI: true,
  zoomControl: false,
  streetViewControl: false,
  mapTypeControl: false,
  fullscreenControl: false,
  clickableIcons: false,
  gestureHandling: "greedy",
  styles: NAV_MAP_STYLES,
};

const PICKUP_ICON = "https://maps.google.com/mapfiles/ms/icons/yellow-dot.png";
const DROPOFF_ICON = "https://maps.google.com/mapfiles/ms/icons/blue-dot.png";

const ROUTE_REFETCH_INTERVAL = 30_000;
const MIN_MOVE_M = 50;

function fmtUSD(n: number): string {
  return n % 1 === 0 ? `$${n}` : `$${n.toFixed(2)}`;
}

function haversineM(a: Coordinates, b: Coordinates): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

// ── Smooth driver position ──

function useSmoothPosition(target: Coordinates | null): Coordinates | null {
  const [display, setDisplay] = useState<Coordinates | null>(target);
  const fromRef = useRef<Coordinates | null>(null);
  const toRef = useRef<Coordinates | null>(null);
  const startRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!target) { setDisplay(null); return; }
    if (!fromRef.current) {
      fromRef.current = target;
      toRef.current = target;
      setDisplay(target);
      return;
    }
    fromRef.current = toRef.current ?? fromRef.current;
    toRef.current = target;
    startRef.current = performance.now();

    const animate = (now: number) => {
      const t = Math.min(1, (now - startRef.current) / 1500);
      const eased = 1 - Math.pow(1 - t, 3);
      if (fromRef.current && toRef.current) {
        setDisplay({
          lat: fromRef.current.lat + (toRef.current.lat - fromRef.current.lat) * eased,
          lng: fromRef.current.lng + (toRef.current.lng - fromRef.current.lng) * eased,
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

// ── Speed tracking ──

function useSpeed(coords: Coordinates | null): number {
  const prev = useRef<{ coords: Coordinates; time: number } | null>(null);
  const [speed, setSpeed] = useState(0);

  useEffect(() => {
    if (!coords) return;
    const now = Date.now();
    if (prev.current) {
      const dt = (now - prev.current.time) / 1000;
      if (dt > 1) {
        const dist = haversineM(prev.current.coords, coords);
        const kmh = (dist / dt) * 3.6;
        setSpeed(Math.min(200, Math.max(0, Math.round(kmh))));
      }
    }
    prev.current = { coords, time: now };
  }, [coords?.lat, coords?.lng]);

  return speed;
}

// ── Maneuver Icon ──

function ManeuverIcon({ maneuver, size = "lg" }: { maneuver: string; size?: "lg" | "sm" }) {
  const cls = size === "lg" ? "w-10 h-10" : "w-5 h-5";
  if (maneuver.includes("left") && maneuver.includes("u-turn")) return <Undo2 className={cls} />;
  if (maneuver.includes("left")) return <CornerUpLeft className={cls} />;
  if (maneuver.includes("right") && maneuver.includes("u-turn")) return <Undo2 className={`${cls} scale-x-[-1]`} />;
  if (maneuver.includes("right")) return <CornerUpRight className={cls} />;
  if (maneuver.includes("roundabout")) return <RotateCw className={cls} />;
  if (maneuver === "" || maneuver.includes("straight") || maneuver.includes("head") || maneuver.includes("continue"))
    return <ArrowUp className={cls} />;
  return <ArrowUp className={cls} />;
}

// ══════════════════════════════════════════════
//  MAIN COMPONENT
// ══════════════════════════════════════════════

export default function FullScreenNavigation({
  activeTrip,
  driverCoords,
  userId,
  riderPhone,
  onTripUpdate,
  onTripComplete,
  onExit,
  onStartCall,
  callStatus,
}: FullScreenNavigationProps) {
  const { isLoaded } = useGoogleMaps();
  const mapRef = useRef<google.maps.Map | null>(null);
  const hasFitRef = useRef(false);

  // Nav state
  const [steps, setSteps] = useState<GoogleStep[]>([]);
  const [routePath, setRoutePath] = useState<google.maps.LatLngLiteral[]>([]);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [totalDistanceM, setTotalDistanceM] = useState(0);
  const [totalDurationS, setTotalDurationS] = useState(0);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [lastSpokenStep, setLastSpokenStep] = useState(-1);
  const [chatOpen, setChatOpen] = useState(false);
  const [completing, setCompleting] = useState(false);
  const lastFetchPhase = useRef<string>("");
  const lastFetchPos = useRef<Coordinates | null>(null);
  const lastFetchTime = useRef(0);

  const smoothPos = useSmoothPosition(driverCoords);
  const speed = useSpeed(driverCoords);

  const { speak, isSupported: voiceSupported } = useVoiceNavigation({ enabled: voiceEnabled });

  // ── Realtime subscription for instant route switching & auto-exit ──
  useEffect(() => {
    const channel = supabase
      .channel(`nav-trip-${activeTrip.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "rides", filter: `id=eq.${activeTrip.id}` },
        (payload) => {
          const updated = payload.new as Record<string, unknown>;
          const newStatus = updated.status as string;

          if (newStatus === "completed" || newStatus === "cancelled") {
            if (voiceEnabled) speak("Trip completed. Returning to dashboard.", true);
            onTripComplete();
            return;
          }

          if (newStatus !== activeTrip.status) {
            onTripUpdate({ ...activeTrip, status: newStatus });
            lastFetchPhase.current = "";

            if (newStatus === "arrived" && voiceEnabled) {
              speak("You have arrived at the pickup point.", true);
            } else if (newStatus === "in_progress" && voiceEnabled) {
              speak("Rider picked up. Navigating to destination.", true);
            }
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [activeTrip.id, activeTrip.status, voiceEnabled]);

  // Trip phase
  const isPickupPhase = ["accepted", "enroute", "enroute_pickup"].includes(activeTrip.status);
  const destination = isPickupPhase
    ? { lat: activeTrip.pickup_lat, lng: activeTrip.pickup_lon }
    : { lat: activeTrip.dropoff_lat, lng: activeTrip.dropoff_lon };

  const phaseKey = isPickupPhase ? "pickup" : "dropoff";

  // ── Fetch route from Google Directions API ──
  const fetchGoogleRoute = useCallback(() => {
    if (!driverCoords || !isLoaded) return;

    const now = Date.now();
    const phaseChanged = lastFetchPhase.current !== phaseKey;
    const moved = !lastFetchPos.current || haversineM(lastFetchPos.current, driverCoords) >= MIN_MOVE_M;
    const elapsed = now - lastFetchTime.current >= ROUTE_REFETCH_INTERVAL;

    if (!phaseChanged && !moved && !elapsed) return;

    const svc = new google.maps.DirectionsService();
    svc.route(
      {
        origin: { lat: driverCoords.lat, lng: driverCoords.lng },
        destination: { lat: destination.lat, lng: destination.lng },
        travelMode: google.maps.TravelMode.DRIVING,
      },
      (result, status) => {
        if (status !== google.maps.DirectionsStatus.OK || !result) return;

        lastFetchPhase.current = phaseKey;
        lastFetchPos.current = { ...driverCoords };
        lastFetchTime.current = Date.now();

        const leg = result.routes[0]?.legs[0];
        if (!leg) return;

        // Extract steps
        const gSteps: GoogleStep[] = (leg.steps || []).map((s) => ({
          instruction: stripHtml(s.instructions || ""),
          distance: s.distance?.value ?? 0,
          duration: s.duration?.value ?? 0,
          maneuver: (s as unknown as Record<string, string>).maneuver || "",
          startLocation: { lat: s.start_location.lat(), lng: s.start_location.lng() },
          endLocation: { lat: s.end_location.lat(), lng: s.end_location.lng() },
        }));
        setSteps(gSteps);
        setCurrentStepIndex(0);
        if (phaseChanged) setLastSpokenStep(-1);

        // Total distance/duration
        setTotalDistanceM(leg.distance?.value ?? 0);
        setTotalDurationS(leg.duration?.value ?? 0);

        // Extract path
        const path = result.routes[0]?.overview_path?.map((p) => ({
          lat: p.lat(),
          lng: p.lng(),
        })) ?? [];
        setRoutePath(path);

        // Fit bounds
        if ((!hasFitRef.current || phaseChanged) && mapRef.current && result.routes[0]?.bounds) {
          mapRef.current.fitBounds(result.routes[0].bounds, {
            top: 160,
            bottom: 280,
            left: 48,
            right: 48,
          });
          hasFitRef.current = true;
        }
      }
    );
  }, [driverCoords?.lat, driverCoords?.lng, destination.lat, destination.lng, phaseKey, isLoaded]);

  // Initial fetch + periodic refetch
  useEffect(() => { fetchGoogleRoute(); }, [fetchGoogleRoute]);

  // Re-center on phase change
  useEffect(() => { hasFitRef.current = false; }, [phaseKey]);

  // ── Update current step based on driver position ──
  useEffect(() => {
    if (!steps.length || !driverCoords) return;

    // Find nearest step start
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < steps.length; i++) {
      const d = haversineM(driverCoords, steps[i].startLocation);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    // If close to a step's end, advance
    if (bestIdx < steps.length - 1) {
      const dEnd = haversineM(driverCoords, steps[bestIdx].endLocation);
      if (dEnd < 30) bestIdx = Math.min(bestIdx + 1, steps.length - 1);
    }

    setCurrentStepIndex(bestIdx);

    // Voice announcement
    if (voiceEnabled && bestIdx !== lastSpokenStep && bestIdx < steps.length) {
      const step = steps[bestIdx];
      const distToStep = haversineM(driverCoords, step.startLocation);
      const distText = distToStep >= 1000
        ? `In ${(distToStep / 1000).toFixed(1)} kilometers`
        : `In ${Math.round(distToStep / 10) * 10} meters`;
      speak(`${distText}, ${step.instruction}`);
      setLastSpokenStep(bestIdx);
    }
  }, [driverCoords, steps, voiceEnabled, lastSpokenStep, speak]);

  // Map load callback
  const onMapLoad = useCallback((map: google.maps.Map) => {
    mapRef.current = map;
  }, []);

  // ── Trip Actions ──

  const handleStatusUpdate = async (newStatus: string, message: string, voiceMsg?: string) => {
    await goBackend.post(`/api/rides/${activeTrip.id}/status`, { status: newStatus });
    onTripUpdate({ ...activeTrip, status: newStatus });
    toast.info(message);
    if (voiceEnabled && voiceMsg) speak(voiceMsg, true);
    lastFetchPhase.current = "";

    if (newStatus === "arrived") {
      supabase.from("notifications").insert({
        user_id: activeTrip.user_id,
        title: "🚗 Your driver has arrived!",
        body: "Your driver is at the pickup point. Please meet them now.",
        notification_type: "driver_arrived",
      }).then(() => {});
    }
  };

  const handleComplete = async () => {
    if (completing) return;
    setCompleting(true);
    try {
      const result = await completeTrip(activeTrip.id);
      const r = result as Record<string, unknown>;
      if (!r?.ok) throw new Error((r?.reason as string) || "Failed to complete trip");
      toast.success("Trip completed!", { description: `Earned ${fmtUSD(Number(r.driver_earnings_usd ?? 0))}` });
      if (voiceEnabled) speak("Trip completed. Great job!", true);
      onTripComplete();
    } catch (e: unknown) {
      toast.error("Failed to complete trip", { description: (e as Error).message });
    } finally {
      setCompleting(false);
    }
  };

  // ── Current step data ──
  const currentStep = steps[currentStepIndex];
  const nextStep = steps[currentStepIndex + 1];
  const etaMinutes = Math.round(totalDurationS / 60);
  const distanceKm = (totalDistanceM / 1000).toFixed(1);
  const distToCurrentStep = currentStep && driverCoords
    ? haversineM(driverCoords, currentStep.startLocation)
    : 0;

  // ── Action button config ──
  const actionButton = (() => {
    switch (activeTrip.status) {
      case "accepted":
      case "enroute":
      case "enroute_pickup":
        return {
          label: "Arrived at Pickup",
          icon: <MapPin className="h-5 w-5" />,
          color: "bg-blue-600 hover:bg-blue-700",
          action: () => handleStatusUpdate("arrived", "Status: Arrived — waiting for rider", "You have arrived at the pickup point"),
        };
      case "arrived":
        return {
          label: "Start Ride",
          icon: <CheckCircle2 className="h-5 w-5" />,
          color: "bg-emerald-600 hover:bg-emerald-700",
          action: () => handleStatusUpdate("in_progress", "Rider picked up — navigating to dropoff", "Rider picked up. Navigating to destination."),
        };
      case "in_progress":
        return {
          label: completing ? "Completing..." : "Complete Trip",
          icon: <CheckCircle2 className="h-5 w-5" />,
          color: "bg-yellow-500 hover:bg-yellow-600",
          action: handleComplete,
        };
      default:
        return null;
    }
  })();

  if (!isLoaded) {
    return (
      <div className="fixed inset-0 z-[100] bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] bg-background"
    >
      {/* ═══ FULL SCREEN MAP ═══ */}
      <div className="absolute inset-0">
        <GoogleMap
          mapContainerStyle={CONTAINER_STYLE}
          center={smoothPos ?? { lat: activeTrip.pickup_lat, lng: activeTrip.pickup_lon }}
          zoom={16}
          options={MAP_OPTIONS}
          onLoad={onMapLoad}
        >
          {/* Route polyline shadow */}
          {routePath.length > 1 && (
            <Polyline
              path={routePath}
              options={{ strokeColor: "#000000", strokeOpacity: 0.12, strokeWeight: 12 }}
            />
          )}
          {/* Route polyline main */}
          {routePath.length > 1 && (
            <Polyline
              path={routePath}
              options={{
                strokeColor: isPickupPhase ? "#4285F4" : "#0F9D58",
                strokeOpacity: 1,
                strokeWeight: 6,
                geodesic: true,
              }}
            />
          )}

          {/* Driver marker */}
          {smoothPos && (
            <Marker
              position={smoothPos}
              icon={{
                path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
                scale: 7,
                fillColor: "#4285F4",
                fillOpacity: 1,
                strokeColor: "#ffffff",
                strokeWeight: 2.5,
                rotation: 0,
              }}
              zIndex={20}
            />
          )}

          {/* Pickup marker */}
          <Marker
            position={{ lat: activeTrip.pickup_lat, lng: activeTrip.pickup_lon }}
            icon={{ url: PICKUP_ICON, scaledSize: new google.maps.Size(40, 40) }}
            label={{ text: "P", color: "#000", fontWeight: "bold", fontSize: "11px" }}
            zIndex={10}
          />

          {/* Dropoff marker */}
          <Marker
            position={{ lat: activeTrip.dropoff_lat, lng: activeTrip.dropoff_lon }}
            icon={{ url: DROPOFF_ICON, scaledSize: new google.maps.Size(40, 40) }}
            label={{ text: "D", color: "#fff", fontWeight: "bold", fontSize: "11px" }}
            zIndex={10}
          />
        </GoogleMap>
      </div>

      {/* ═══ TOP: Turn-by-turn Navigation Card ═══ */}
      <div
        className="absolute top-0 left-0 right-0 z-10 px-4"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 12px) + 12px)" }}
      >
        <motion.div
          initial={{ y: -40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
          className="rounded-2xl bg-card/95 backdrop-blur-xl shadow-[0_8px_32px_rgba(0,0,0,0.12)] border border-border/40 overflow-hidden"
        >
          {/* Phase indicator */}
          <div className={`h-1.5 ${isPickupPhase ? "bg-blue-500" : "bg-emerald-500"}`} />

          <div className="p-4">
            {currentStep ? (
              <div className="flex items-start gap-4">
                {/* Maneuver icon */}
                <div className="w-14 h-14 rounded-xl flex items-center justify-center shrink-0 bg-accent/15 text-accent">
                  <ManeuverIcon maneuver={currentStep.maneuver || currentStep.instruction} />
                </div>

                <div className="flex-1 min-w-0">
                  {/* Distance to next maneuver */}
                  <p className="text-2xl font-black leading-none tracking-tight">
                    {distToCurrentStep > 50
                      ? distToCurrentStep >= 1000
                        ? `${(distToCurrentStep / 1000).toFixed(1)} km`
                        : `${Math.round(distToCurrentStep / 10) * 10} m`
                      : "Now"}
                  </p>
                  {/* Instruction */}
                  <p className="text-sm text-muted-foreground mt-1 leading-snug line-clamp-2">
                    {currentStep.instruction}
                  </p>
                  {/* Next step preview */}
                  {nextStep && (
                    <div className="flex items-center gap-1.5 mt-2 text-xs text-muted-foreground/70">
                      <span className="uppercase tracking-wider font-semibold text-[10px]">Then</span>
                      <ManeuverIcon maneuver={nextStep.maneuver || nextStep.instruction} size="sm" />
                      <span className="truncate">{nextStep.instruction}</span>
                    </div>
                  )}
                </div>

                {/* Voice toggle */}
                <button
                  onClick={() => setVoiceEnabled(!voiceEnabled)}
                  className="w-10 h-10 rounded-xl bg-secondary/80 flex items-center justify-center shrink-0 active:scale-90 transition-transform"
                >
                  {voiceEnabled ? (
                    <Volume2 className="w-4 h-4 text-foreground" />
                  ) : (
                    <VolumeX className="w-4 h-4 text-muted-foreground" />
                  )}
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                  isPickupPhase ? "bg-blue-500/15 text-blue-600" : "bg-emerald-500/15 text-emerald-600"
                }`}>
                  <Navigation className="w-5 h-5" />
                </div>
                <div>
                  <p className="font-bold text-sm">
                    {isPickupPhase ? "Heading to pickup" : "Heading to destination"}
                  </p>
                  <p className="text-xs text-muted-foreground">Calculating route…</p>
                </div>
              </div>
            )}
          </div>
        </motion.div>
      </div>

      {/* ═══ TOP-RIGHT: Quick Actions ═══ */}
      <div
        className="absolute right-4 z-10 flex flex-col gap-3"
        style={{ top: "calc(env(safe-area-inset-top, 12px) + 130px)" }}
      >
        {/* Exit nav */}
        <motion.button
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.2 }}
          onClick={onExit}
          className="w-12 h-12 rounded-full bg-card/90 backdrop-blur-xl shadow-lg border border-border/40 flex items-center justify-center active:scale-90 transition-transform"
        >
          <ChevronDown className="w-5 h-5 text-foreground" />
        </motion.button>

        {/* Call */}
        <motion.button
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.3 }}
          onClick={onStartCall}
          disabled={callStatus !== "idle"}
          className="w-12 h-12 rounded-full bg-blue-600 shadow-lg flex items-center justify-center active:scale-90 transition-transform disabled:opacity-50"
        >
          <Phone className="w-5 h-5 text-white" />
        </motion.button>

        {/* Message */}
        <motion.button
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.4 }}
          onClick={() => setChatOpen(!chatOpen)}
          className={`w-12 h-12 rounded-full shadow-lg flex items-center justify-center active:scale-90 transition-transform ${
            chatOpen
              ? "bg-primary text-primary-foreground"
              : "bg-card/90 backdrop-blur-xl border border-border/40 text-foreground"
          }`}
        >
          <MessageCircle className="w-5 h-5" />
        </motion.button>

        {/* Re-center */}
        <motion.button
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.5 }}
          onClick={() => {
            if (mapRef.current && smoothPos) {
              mapRef.current.panTo(smoothPos);
              mapRef.current.setZoom(17);
            }
          }}
          className="w-12 h-12 rounded-full bg-card/90 backdrop-blur-xl shadow-lg border border-border/40 flex items-center justify-center active:scale-90 transition-transform"
        >
          <Navigation className="w-5 h-5 text-foreground" />
        </motion.button>
      </div>

      {/* ═══ CHAT OVERLAY ═══ */}
      <AnimatePresence>
        {chatOpen && (
          <motion.div
            initial={{ opacity: 0, x: 100 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 100 }}
            className="absolute right-4 z-10 w-[calc(100%-2rem)] max-w-sm rounded-2xl bg-card/95 backdrop-blur-xl shadow-2xl border border-border/40 overflow-hidden"
            style={{ top: "calc(env(safe-area-inset-top, 12px) + 300px)" }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
              <p className="font-bold text-sm">Chat with Rider</p>
              <button
                onClick={() => setChatOpen(false)}
                className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="max-h-[200px] overflow-y-auto">
              <RideCommunication
                rideId={activeTrip.id}
                currentUserId={userId}
                otherUserPhone={riderPhone}
                riderId={activeTrip.user_id}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ═══ BOTTOM: Trip Data + Action ═══ */}
      <div
        className="absolute bottom-0 left-0 right-0 z-10"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 8px) + 8px)" }}
      >
        <motion.div
          initial={{ y: 60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 30, delay: 0.1 }}
          className="mx-3 rounded-3xl bg-card/95 backdrop-blur-xl shadow-[0_-8px_40px_rgba(0,0,0,0.15)] border border-border/40 overflow-hidden"
        >
          {/* Phase label */}
          <div className="px-4 py-2 text-center text-xs font-bold tracking-wider uppercase bg-blue-500/10 text-blue-600">
            {isPickupPhase ? "Heading to Pickup" : "En route to Destination"}
          </div>

          {/* Live metrics */}
          <div className="grid grid-cols-3 divide-x divide-border/30 px-2 py-3">
            <div className="flex flex-col items-center justify-center px-2">
              <div className="flex items-center gap-1 text-muted-foreground mb-0.5">
                <Clock className="w-3 h-3" />
                <span className="text-[10px] font-semibold uppercase tracking-wider">ETA</span>
              </div>
              <p className="text-xl font-black tabular-nums">{etaMinutes}</p>
              <p className="text-[10px] text-muted-foreground">min</p>
            </div>

            <div className="flex flex-col items-center justify-center px-2">
              <div className="flex items-center gap-1 text-muted-foreground mb-0.5">
                <Route className="w-3 h-3" />
                <span className="text-[10px] font-semibold uppercase tracking-wider">Distance</span>
              </div>
              <p className="text-xl font-black tabular-nums">{distanceKm}</p>
              <p className="text-[10px] text-muted-foreground">km</p>
            </div>

            <div className="flex flex-col items-center justify-center px-2">
              <div className="flex items-center gap-1 text-muted-foreground mb-0.5">
                <Gauge className="w-3 h-3" />
                <span className="text-[10px] font-semibold uppercase tracking-wider">Speed</span>
              </div>
              <p className="text-xl font-black tabular-nums">{speed}</p>
              <p className="text-[10px] text-muted-foreground">km/h</p>
            </div>
          </div>

          {/* Address info */}
          <div className="px-4 py-2 border-t border-border/20">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {isPickupPhase ? (
                <MapPin className="w-3.5 h-3.5 text-blue-500 shrink-0" />
              ) : (
                <Navigation className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
              )}
              <p className="truncate font-medium">
                {isPickupPhase ? activeTrip.pickup_address : activeTrip.dropoff_address}
              </p>
              <span className="ml-auto font-black text-foreground text-sm whitespace-nowrap">
                {fmtUSD(activeTrip.fare)}
              </span>
            </div>
          </div>

          {/* Action button */}
          {actionButton && (
            <div className="px-4 pb-3 pt-1">
              <Button
                className={`w-full h-14 rounded-2xl text-white font-bold text-base shadow-lg active:scale-[0.97] transition-all ${actionButton.color}`}
                onClick={actionButton.action}
                disabled={completing}
              >
                {actionButton.icon}
                <span className="ml-2">{actionButton.label}</span>
              </Button>
            </div>
          )}
        </motion.div>
      </div>
    </motion.div>
  );
}
