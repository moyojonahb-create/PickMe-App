import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CornerUpLeft,
  CornerUpRight,
  MapPin,
  MessageCircle,
  Navigation as NavigationIcon,
  Phone,
  RotateCw,
  Undo2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { completeTrip } from "@/lib/completeTrip";
import { eventString } from "@/lib/backendSocketClient";
import { useRideRealtime } from "@/hooks/useRideRealtime";
import { useVoiceNavigation } from "@/hooks/useVoiceNavigation";
import { RideCommunication } from "@/components/ride/RideCommunication";
import { goBackend } from "@/lib/goBackendClient";
import { createNotification } from "@/lib/businessApi";
import type { Coordinates } from "@/lib/osrm";
import { getDetailedRoute, findCurrentStep, getManeuverInstruction, getVoiceInstruction, type RouteStep } from "@/lib/osrmSteps";
import MapboxMap from "@/components/map/LazyMapboxMap";
import type { MapEtaCard } from "@/components/MapboxMap";
import type { RiderInfo } from "@/components/driver/DriverConnectedTrip";

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
  distance_km?: number | null;
  passenger_count?: number | null;
  passenger_name?: string | null;
  passenger_phone?: string | null;
}

interface FullScreenNavigationProps {
  activeTrip: ActiveTrip;
  driverCoords: Coordinates | null;
  userId: string;
  riderPhone: string | null;
  riderInfo?: RiderInfo | null;
  onTripUpdate: (trip: ActiveTrip) => void;
  onTripComplete: () => void;
  onExit: () => void;
  onStartCall: () => void;
  callStatus: string;
}

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

function useSmoothPosition(target: Coordinates | null): Coordinates | null {
  const [display, setDisplay] = useState<Coordinates | null>(target);
  const fromRef = useRef<Coordinates | null>(null);
  const toRef = useRef<Coordinates | null>(null);
  const startRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!target) {
      setDisplay(null);
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
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [target?.lat, target?.lng]);

  return display;
}

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
        setSpeed(Math.min(200, Math.max(0, Math.round((dist / dt) * 3.6))));
      }
    }
    prev.current = { coords, time: now };
  }, [coords?.lat, coords?.lng]);

  return speed;
}

/** Short imperative headline matching the reference's "TURN LEFT" style —
 * derived from the real OSRM maneuver, not guessed. */
function maneuverHeadline(step: RouteStep): string {
  const { type, modifier } = step.maneuver;
  if (type === "arrive") return "ARRIVE";
  if (type === "roundabout" || type === "rotary") return "ENTER ROUNDABOUT";
  if (type === "depart") return "HEAD OUT";
  if (type === "fork") return modifier === "left" ? "KEEP LEFT" : "KEEP RIGHT";
  if (type === "merge") return "MERGE";
  switch (modifier) {
    case "left": return "TURN LEFT";
    case "right": return "TURN RIGHT";
    case "slight left": return "KEEP LEFT";
    case "slight right": return "KEEP RIGHT";
    case "sharp left": return "SHARP LEFT";
    case "sharp right": return "SHARP RIGHT";
    case "uturn": return "MAKE A U-TURN";
    default: return "CONTINUE STRAIGHT";
  }
}

function ManeuverIcon({ step, size = "lg" }: { step: RouteStep | null; size?: "lg" | "sm" }) {
  const cls = size === "lg" ? "h-8 w-8" : "h-4 w-4";
  if (!step) return <NavigationIcon className={cls} />;
  const { type, modifier } = step.maneuver;
  if (type === "arrive") return <CheckCircle2 className={cls} />;
  if (type === "roundabout" || type === "rotary") return <RotateCw className={cls} />;
  if (modifier === "uturn") return <Undo2 className={cls} />;
  if (modifier?.includes("left")) return <CornerUpLeft className={cls} />;
  if (modifier?.includes("right")) return <CornerUpRight className={cls} />;
  return <ArrowUp className={cls} />;
}

function fmtDistance(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m / 10) * 10} m`;
}

export default function FullScreenNavigation({
  activeTrip,
  driverCoords,
  userId,
  riderPhone,
  riderInfo,
  onTripUpdate,
  onTripComplete,
  onExit,
  onStartCall,
  callStatus,
}: FullScreenNavigationProps) {
  const [route, setRoute] = useState<{ geometry: string; steps: RouteStep[]; distanceKm: number; durationMinutes: number } | null>(null);
  const [routeFailed, setRouteFailed] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [lastSpokenStepIndex, setLastSpokenStepIndex] = useState(-1);
  const [chatOpen, setChatOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [recenterSignal, setRecenterSignal] = useState(0);
  const lastFetchPhase = useRef("");
  const lastFetchPos = useRef<Coordinates | null>(null);
  const lastFetchTime = useRef(0);

  const smoothPos = useSmoothPosition(driverCoords);
  const speed = useSpeed(driverCoords);
  const { speak, isSupported: voiceSupported } = useVoiceNavigation({ enabled: voiceEnabled });

  useRideRealtime(activeTrip.id, {
    onRideChange: (event) => {
      const eventStatus = event?.type === "ride_started"
        ? "in_progress"
        : event?.type === "ride_completed"
          ? "completed"
          : eventString(event!, ["status"]);
      if (!eventStatus) return;

      if (eventStatus === "completed" || eventStatus === "cancelled") {
        if (voiceEnabled) speak("Trip completed. Returning to dashboard.", true);
        onTripComplete();
        return;
      }

      if (eventStatus !== activeTrip.status) {
        onTripUpdate({ ...activeTrip, status: eventStatus });
        lastFetchPhase.current = "";

        if (eventStatus === "arrived" && voiceEnabled) {
          speak("You have arrived at the pickup point.", true);
        } else if (eventStatus === "in_progress" && voiceEnabled) {
          speak("Rider picked up. Navigating to destination.", true);
        }
      }
    },
  });

  const isPickupPhase = ["accepted", "enroute", "enroute_pickup"].includes(activeTrip.status);
  const origin = driverCoords;
  const destination = isPickupPhase
    ? { lat: activeTrip.pickup_lat, lng: activeTrip.pickup_lon }
    : { lat: activeTrip.dropoff_lat, lng: activeTrip.dropoff_lon };
  const phaseKey = isPickupPhase ? "pickup" : "dropoff";

  const fetchRoute = useCallback(async () => {
    if (!origin) return;
    const now = Date.now();
    const phaseChanged = lastFetchPhase.current !== phaseKey;
    const moved = !lastFetchPos.current || haversineM(lastFetchPos.current, origin) >= MIN_MOVE_M;
    const elapsed = now - lastFetchTime.current >= ROUTE_REFETCH_INTERVAL;
    if (!phaseChanged && !moved && !elapsed) return;

    lastFetchPhase.current = phaseKey;
    lastFetchPos.current = { ...origin };
    lastFetchTime.current = now;
    if (phaseChanged) setLastSpokenStepIndex(-1);

    const detailed = await getDetailedRoute(origin, destination);
    if (detailed) {
      setRoute({ geometry: detailed.geometry, steps: detailed.steps, distanceKm: detailed.distanceKm, durationMinutes: detailed.durationMinutes });
      setRouteFailed(false);
    } else {
      // OSRM unreachable — fall back to a straight-line estimate rather than
      // leaving the driver with no guidance at all.
      setRoute(null);
      setRouteFailed(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin?.lat, origin?.lng, destination.lat, destination.lng, phaseKey]);

  useEffect(() => { fetchRoute(); }, [fetchRoute]);

  const { currentStep, currentStepIndex, distToManeuverM } = (() => {
    if (!route?.steps.length || !driverCoords) return { currentStep: null as RouteStep | null, currentStepIndex: 0, distToManeuverM: 0 };
    const { stepIndex } = findCurrentStep(route.steps, driverCoords);
    const step = route.steps[stepIndex];
    const dist = haversineM(driverCoords, { lat: step.maneuver.location[1], lng: step.maneuver.location[0] });
    return { currentStep: step, currentStepIndex: stepIndex, distToManeuverM: dist };
  })();

  const nextStep = route?.steps[currentStepIndex + 1] ?? null;

  useEffect(() => {
    if (!currentStep || !voiceEnabled || lastSpokenStepIndex === currentStepIndex) return;
    speak(getVoiceInstruction(currentStep, distToManeuverM));
    setLastSpokenStepIndex(currentStepIndex);
  }, [currentStep, currentStepIndex, voiceEnabled, lastSpokenStepIndex, distToManeuverM, speak]);

  // Straight-line fallback distance/ETA when OSRM couldn't be reached.
  const straightDistanceM = driverCoords ? haversineM(driverCoords, destination) : 0;
  const totalDistanceKm = route ? route.distanceKm : straightDistanceM / 1000;
  const remainingDistanceKm = driverCoords ? haversineM(driverCoords, destination) / 1000 : totalDistanceKm;
  const etaMinutes = route
    ? Math.max(1, Math.round(route.durationMinutes * (remainingDistanceKm / Math.max(0.1, route.distanceKm))))
    : Math.max(1, Math.round((straightDistanceM / 1000 / 25) * 60));

  // Progress dots — how far along the whole route the driver has come.
  const progressFraction = totalDistanceKm > 0 ? Math.min(1, Math.max(0, 1 - remainingDistanceKm / totalDistanceKm)) : 0;
  const DOT_COUNT = 8;
  const litDots = Math.round(progressFraction * DOT_COUNT);
  const dotColors = ["#FFDD00", "#FFDD00", "#FF9A1A", "#FF7A1A", "#F0501F", "#D93010", "#C21C08", "#B81104"];

  const mapCards: MapEtaCard[] = driverCoords
    ? [{ id: phaseKey, at: destination, label: isPickupPhase ? "Pickup" : "Drop-off", value: `${etaMinutes} min`, subvalue: `${remainingDistanceKm.toFixed(1)} km` }]
    : [];

  const handleStatusUpdate = async (newStatus: string, message: string, voiceMsg?: string) => {
    try {
      await goBackend.post(`/api/rides/${activeTrip.id}/status`, {
        status: newStatus,
        expectedStatus: activeTrip.status,
      });
      onTripUpdate({ ...activeTrip, status: newStatus });
      toast.info(message);
      if (voiceEnabled && voiceMsg) speak(voiceMsg, true);
      lastFetchPhase.current = "";

      if (newStatus === "arrived") {
        createNotification({
          user_id: activeTrip.user_id,
          title: "Your driver has arrived",
          body: "Your driver is at the pickup point. Please meet them now.",
          notification_type: "driver_arrived",
        }).catch(() => {});
      }
    } catch (e: unknown) {
      toast.error("Failed to update trip", { description: (e as Error).message });
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

  const actionButton = (() => {
    switch (activeTrip.status) {
      case "accepted":
      case "enroute":
      case "enroute_pickup":
        return {
          label: "Arrived at Pickup",
          action: () => handleStatusUpdate("arrived", "Status: Arrived - waiting for rider", "You have arrived at the pickup point"),
        };
      case "arrived":
        return {
          label: "Start Ride",
          action: () => handleStatusUpdate("in_progress", "Rider picked up - navigating to dropoff", "Rider picked up. Navigating to destination."),
        };
      case "in_progress":
      case "ongoing":
        return {
          label: completing ? "Completing…" : "Complete Trip",
          action: handleComplete,
        };
      default:
        return null;
    }
  })();

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] bg-background">
      <div className="absolute inset-0">
        <MapboxMap
          pickup={{ lat: activeTrip.pickup_lat, lng: activeTrip.pickup_lon }}
          dropoff={{ lat: activeTrip.dropoff_lat, lng: activeTrip.dropoff_lon }}
          driverLocation={smoothPos}
          routeGeometry={route?.geometry ?? null}
          routeCoordinates={!route ? ([smoothPos, destination].filter(Boolean) as Coordinates[]) : undefined}
          routeGradient
          mapCards={mapCards}
          navigationFollow
          followZoom={17}
          recenterSignal={recenterSignal}
          className="h-full w-full"
          height="100%"
        />
      </div>

      {/* ═══ Turn-by-turn instruction card ═══ */}
      <div className="absolute left-0 right-0 top-0 z-10 px-3" style={{ paddingTop: "calc(env(safe-area-inset-top, 12px) + 12px)" }}>
        <motion.div
          initial={{ y: -40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
          className="overflow-hidden rounded-3xl bg-[#151515] text-white shadow-[0_12px_36px_rgba(0,0,0,0.35)] p-4"
        >
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/15">
              <ManeuverIcon step={currentStep} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-lg font-black leading-tight tracking-tight truncate">
                {currentStep ? maneuverHeadline(currentStep) : isPickupPhase ? "HEAD TO PICKUP" : "HEAD TO DESTINATION"}
              </p>
              <p className="text-sm text-white/70 truncate mt-0.5">
                {currentStep?.name || (isPickupPhase ? activeTrip.pickup_address : activeTrip.dropoff_address)}
              </p>
              <p className="text-xs font-bold text-white/90 mt-1">
                {fmtDistance(currentStep ? distToManeuverM : straightDistanceM)}
              </p>
            </div>
            <button onClick={() => setVoiceEnabled(!voiceEnabled)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 transition-transform active:scale-90">
              {voiceEnabled && voiceSupported ? <Volume2 className="h-4 w-4 text-white" /> : <VolumeX className="h-4 w-4 text-white/60" />}
            </button>
          </div>

          {/* Progress dots */}
          <div className="flex items-center gap-1.5 mt-3">
            {Array.from({ length: DOT_COUNT }).map((_, i) => (
              <span
                key={i}
                className="h-1.5 flex-1 rounded-full"
                style={{ background: i < litDots ? dotColors[i] : "rgba(255,255,255,0.2)" }}
              />
            ))}
          </div>
          {nextStep && (
            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-white/50">
              <span className="font-semibold uppercase tracking-wider">Then</span>
              <ManeuverIcon step={nextStep} size="sm" />
              <span className="truncate">{getManeuverInstruction(nextStep)}</span>
            </div>
          )}
        </motion.div>
      </div>

      {/* ═══ Speed badge ═══ */}
      <div className="absolute left-4 z-10" style={{ bottom: "calc(env(safe-area-inset-bottom, 8px) + 220px)" }}>
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className="flex h-16 w-16 flex-col items-center justify-center rounded-full bg-white shadow-lg border-4"
          style={{ borderColor: "#B81104" }}
        >
          <span className="text-lg font-black leading-none text-foreground">{speed}</span>
          <span className="text-[9px] font-bold text-muted-foreground leading-none mt-0.5">km/h</span>
        </motion.div>
      </div>

      {/* ═══ Right-side controls ═══ */}
      <div className="absolute right-4 z-10 flex flex-col gap-3" style={{ top: "calc(env(safe-area-inset-top, 12px) + 190px)" }}>
        <motion.button initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.1 }} onClick={onExit} aria-label="Minimize" className="flex h-12 w-12 items-center justify-center rounded-full border border-border/40 bg-card/90 shadow-lg backdrop-blur-xl transition-transform active:scale-90">
          <ChevronDown className="h-5 w-5 text-foreground" />
        </motion.button>
        <motion.button initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.15 }} onClick={() => setVoiceEnabled(!voiceEnabled)} aria-label="Toggle voice" className="flex h-12 w-12 items-center justify-center rounded-full border border-border/40 bg-card/90 shadow-lg backdrop-blur-xl transition-transform active:scale-90">
          {voiceEnabled ? <Volume2 className="h-5 w-5 text-foreground" /> : <VolumeX className="h-5 w-5 text-muted-foreground" />}
        </motion.button>
        <motion.button initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.2 }} onClick={() => setRecenterSignal((s) => s + 1)} aria-label="Recenter" className="flex h-12 w-12 items-center justify-center rounded-full border border-border/40 bg-card/90 shadow-lg backdrop-blur-xl transition-transform active:scale-90">
          <NavigationIcon className="h-5 w-5 text-foreground" />
        </motion.button>
      </div>

      <AnimatePresence>
        {chatOpen && (
          <motion.div initial={{ opacity: 0, x: 100 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 100 }} className="absolute right-4 z-10 w-[calc(100%-2rem)] max-w-sm overflow-hidden rounded-2xl border border-border/40 bg-card/95 shadow-2xl backdrop-blur-xl" style={{ top: "calc(env(safe-area-inset-top, 12px) + 350px)" }}>
            <div className="flex items-center justify-between border-b border-border/30 px-4 py-3">
              <p className="text-sm font-bold">Chat with Rider</p>
              <button onClick={() => setChatOpen(false)} className="flex h-7 w-7 items-center justify-center rounded-full bg-secondary">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="max-h-[200px] overflow-y-auto">
              <RideCommunication rideId={activeTrip.id} currentUserId={userId} otherUserPhone={riderPhone} riderId={activeTrip.user_id} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ═══ Bottom card — PickMe red bar + rider info + arrival ═══ */}
      <div className="absolute bottom-0 left-0 right-0 z-10" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 8px) + 8px)" }}>
        <motion.div initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: "spring", stiffness: 300, damping: 30, delay: 0.1 }} className="mx-3 overflow-hidden rounded-3xl bg-card shadow-[0_-8px_40px_rgba(0,0,0,0.15)]">
          <div className="flex flex-col items-center py-2" style={{ background: "var(--gradient-primary)" }}>
            <div className="w-9 h-1 bg-white/90 rounded-full" />
          </div>

          <div className="px-4 pt-3 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full overflow-hidden shrink-0 bg-muted flex items-center justify-center">
              {riderInfo?.avatar_url ? (
                <img src={riderInfo.avatar_url} alt={riderInfo.full_name ?? "Rider"} className="w-full h-full object-cover" />
              ) : (
                <span className={`text-sm font-bold ${riderInfo?.gender === "female" ? "text-pink-600" : "text-primary"}`}>
                  {riderInfo?.gender === "female" ? "♀" : "♂"}
                </span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-bold text-sm text-foreground truncate">{riderInfo?.full_name || "Rider"}</p>
              {riderInfo?.completedTrips !== null && riderInfo?.completedTrips !== undefined && (
                <p className="text-xs text-muted-foreground">{riderInfo.completedTrips} trip{riderInfo.completedTrips !== 1 ? "s" : ""}</p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {riderPhone && (
                <a href={`tel:${riderPhone.replace(/[^\d+]/g, "")}`} aria-label="Call rider" className="w-9 h-9 rounded-full flex items-center justify-center active:scale-90 transition-transform" style={{ background: "var(--gradient-primary)" }}>
                  <Phone className="h-3.5 w-3.5 text-white" />
                </a>
              )}
              <button onClick={() => setChatOpen(!chatOpen)} aria-label="Message rider" className={`w-9 h-9 rounded-full flex items-center justify-center transition-transform active:scale-90 ${chatOpen ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}>
                <MessageCircle className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="px-4 pt-3">
            <div className="rounded-2xl px-3.5 py-3" style={{ background: "#FFE6E6" }}>
              <p className="text-xs font-semibold text-muted-foreground">{isPickupPhase ? "Pickup in" : "Arriving in"}</p>
              <p className="text-lg font-black text-primary">
                {etaMinutes} min <span className="text-sm font-semibold text-primary/70">({remainingDistanceKm.toFixed(1)} km)</span>
              </p>
              <p className="flex items-center gap-1.5 text-xs text-foreground mt-1">
                <MapPin className="h-3.5 w-3.5 shrink-0 text-primary" />
                <span className="truncate">{isPickupPhase ? activeTrip.pickup_address : activeTrip.dropoff_address}</span>
              </p>
            </div>
          </div>

          {actionButton && (
            <div className="px-4 py-3 flex items-center gap-2">
              <Button className="h-13 flex-1 rounded-2xl text-base font-bold bg-primary text-primary-foreground hover:brightness-110 shadow-lg" onClick={actionButton.action} disabled={completing}>
                {actionButton.label}
              </Button>
              <button
                onClick={() => setExpanded((v) => !v)}
                aria-label="More details"
                className="h-13 w-13 shrink-0 rounded-2xl bg-primary text-primary-foreground flex items-center justify-center active:scale-95 transition-transform"
              >
                {expanded ? <ChevronDown className="h-5 w-5" /> : <ChevronUp className="h-5 w-5" />}
              </button>
            </div>
          )}

          {expanded && (
            <div className="px-4 pb-4 pt-1 border-t border-border/20 space-y-1.5">
              <p className="text-xs text-muted-foreground">Fare</p>
              <p className="text-base font-bold text-foreground">{fmtUSD(activeTrip.fare)}</p>
              {routeFailed && (
                <p className="text-[11px] text-muted-foreground">Live turn-by-turn directions are temporarily unavailable — showing a direct-line estimate instead.</p>
              )}
            </div>
          )}
        </motion.div>
      </div>
    </motion.div>
  );
}
