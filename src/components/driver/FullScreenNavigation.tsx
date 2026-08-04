import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  Clock,
  CornerUpLeft,
  CornerUpRight,
  Gauge,
  MapPin,
  MessageCircle,
  Navigation,
  Phone,
  RotateCw,
  Route,
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
import MapboxMap from "@/components/map/LazyMapboxMap";

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

interface NavigationStep {
  instruction: string;
  distance: number;
  duration: number;
  maneuver: string;
  startLocation: Coordinates;
  endLocation: Coordinates;
}

const ROUTE_REFETCH_INTERVAL = 30_000;
const MIN_MOVE_M = 50;
const ASSUMED_CITY_SPEED_MPS = 9.7;

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

function ManeuverIcon({ maneuver, size = "lg" }: { maneuver: string; size?: "lg" | "sm" }) {
  const cls = size === "lg" ? "h-10 w-10" : "h-5 w-5";
  if (maneuver.includes("left") && maneuver.includes("u-turn")) return <Undo2 className={cls} />;
  if (maneuver.includes("left")) return <CornerUpLeft className={cls} />;
  if (maneuver.includes("right") && maneuver.includes("u-turn")) return <Undo2 className={`${cls} scale-x-[-1]`} />;
  if (maneuver.includes("right")) return <CornerUpRight className={cls} />;
  if (maneuver.includes("roundabout")) return <RotateCw className={cls} />;
  return <ArrowUp className={cls} />;
}

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
  const [steps, setSteps] = useState<NavigationStep[]>([]);
  const [routePath, setRoutePath] = useState<Coordinates[]>([]);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [totalDistanceM, setTotalDistanceM] = useState(0);
  const [totalDurationS, setTotalDurationS] = useState(0);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [lastSpokenStep, setLastSpokenStep] = useState(-1);
  const [chatOpen, setChatOpen] = useState(false);
  const [completing, setCompleting] = useState(false);
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
  const destination = isPickupPhase
    ? { lat: activeTrip.pickup_lat, lng: activeTrip.pickup_lon }
    : { lat: activeTrip.dropoff_lat, lng: activeTrip.dropoff_lon };
  const phaseKey = isPickupPhase ? "pickup" : "dropoff";

  const updateRouteEstimate = useCallback(() => {
    if (!driverCoords) return;

    const now = Date.now();
    const phaseChanged = lastFetchPhase.current !== phaseKey;
    const moved = !lastFetchPos.current || haversineM(lastFetchPos.current, driverCoords) >= MIN_MOVE_M;
    const elapsed = now - lastFetchTime.current >= ROUTE_REFETCH_INTERVAL;
    if (!phaseChanged && !moved && !elapsed) return;

    const distanceM = haversineM(driverCoords, destination);
    const durationS = Math.max(60, Math.round(distanceM / ASSUMED_CITY_SPEED_MPS));
    const instruction = isPickupPhase ? "Head to the pickup point" : "Continue to the destination";

    lastFetchPhase.current = phaseKey;
    lastFetchPos.current = { ...driverCoords };
    lastFetchTime.current = now;
    setSteps([{ instruction, distance: distanceM, duration: durationS, maneuver: "straight", startLocation: driverCoords, endLocation: destination }]);
    setCurrentStepIndex(0);
    if (phaseChanged) setLastSpokenStep(-1);
    setTotalDistanceM(distanceM);
    setTotalDurationS(durationS);
    setRoutePath([driverCoords, destination]);
  }, [driverCoords?.lat, driverCoords?.lng, destination.lat, destination.lng, phaseKey, isPickupPhase]);

  useEffect(() => {
    updateRouteEstimate();
  }, [updateRouteEstimate]);

  useEffect(() => {
    lastFetchPhase.current = "";
  }, [phaseKey]);

  useEffect(() => {
    if (!steps.length || !driverCoords) return;
    const step = steps[0];
    setCurrentStepIndex(0);
    if (voiceEnabled && lastSpokenStep !== 0) {
      const distToStep = haversineM(driverCoords, step.startLocation);
      const distText = distToStep >= 1000 ? `In ${(distToStep / 1000).toFixed(1)} kilometers` : `In ${Math.round(distToStep / 10) * 10} meters`;
      speak(`${distText}, ${step.instruction}`);
      setLastSpokenStep(0);
    }
  }, [driverCoords, steps, voiceEnabled, lastSpokenStep, speak]);

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

  const currentStep = steps[currentStepIndex];
  const nextStep = steps[currentStepIndex + 1];
  const etaMinutes = Math.round(totalDurationS / 60);
  const distanceKm = (totalDistanceM / 1000).toFixed(1);
  const distToCurrentStep = currentStep && driverCoords ? haversineM(driverCoords, currentStep.endLocation) : 0;

  const actionButton = (() => {
    switch (activeTrip.status) {
      case "accepted":
      case "enroute":
      case "enroute_pickup":
        return {
          label: "Arrived at Pickup",
          icon: <MapPin className="h-5 w-5" />,
          color: "bg-blue-600 hover:bg-blue-700",
          action: () => handleStatusUpdate("arrived", "Status: Arrived - waiting for rider", "You have arrived at the pickup point"),
        };
      case "arrived":
        return {
          label: "Start Ride",
          icon: <CheckCircle2 className="h-5 w-5" />,
          color: "bg-emerald-600 hover:bg-emerald-700",
          action: () => handleStatusUpdate("in_progress", "Rider picked up - navigating to dropoff", "Rider picked up. Navigating to destination."),
        };
      case "in_progress":
      case "ongoing":
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

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] bg-background">
      <div className="absolute inset-0">
        <MapboxMap
          pickup={{ lat: activeTrip.pickup_lat, lng: activeTrip.pickup_lon }}
          dropoff={{ lat: activeTrip.dropoff_lat, lng: activeTrip.dropoff_lon }}
          driverLocation={smoothPos}
          routeCoordinates={routePath.length > 1 ? routePath : ([smoothPos, destination].filter(Boolean) as Coordinates[])}
          defaultCenter={smoothPos ?? { lat: activeTrip.pickup_lat, lng: activeTrip.pickup_lon }}
          defaultZoom={16}
          className="h-full w-full"
          height="100%"
        />
      </div>

      <div className="absolute left-0 right-0 top-0 z-10 px-4" style={{ paddingTop: "calc(env(safe-area-inset-top, 12px) + 12px)" }}>
        <motion.div initial={{ y: -40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: "spring", stiffness: 300, damping: 30 }} className="overflow-hidden rounded-2xl border border-border/40 bg-card/95 shadow-[0_8px_32px_rgba(0,0,0,0.12)] backdrop-blur-xl">
          <div className={`h-1.5 ${isPickupPhase ? "bg-blue-500" : "bg-emerald-500"}`} />
          <div className="p-4">
            {currentStep ? (
              <div className="flex items-start gap-4">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent">
                  <ManeuverIcon maneuver={currentStep.maneuver || currentStep.instruction} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-2xl font-black leading-none tracking-tight">
                    {distToCurrentStep > 50 ? (distToCurrentStep >= 1000 ? `${(distToCurrentStep / 1000).toFixed(1)} km` : `${Math.round(distToCurrentStep / 10) * 10} m`) : "Now"}
                  </p>
                  <p className="mt-1 line-clamp-2 text-sm leading-snug text-muted-foreground">{currentStep.instruction}</p>
                  {nextStep && (
                    <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground/70">
                      <span className="text-[10px] font-semibold uppercase tracking-wider">Then</span>
                      <ManeuverIcon maneuver={nextStep.maneuver || nextStep.instruction} size="sm" />
                      <span className="truncate">{nextStep.instruction}</span>
                    </div>
                  )}
                </div>
                <button onClick={() => setVoiceEnabled(!voiceEnabled)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary/80 transition-transform active:scale-90">
                  {voiceEnabled && voiceSupported ? <Volume2 className="h-4 w-4 text-foreground" /> : <VolumeX className="h-4 w-4 text-muted-foreground" />}
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${isPickupPhase ? "bg-blue-500/15 text-blue-600" : "bg-emerald-500/15 text-emerald-600"}`}>
                  <Navigation className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-bold">{isPickupPhase ? "Heading to pickup" : "Heading to destination"}</p>
                  <p className="text-xs text-muted-foreground">Waiting for location...</p>
                </div>
              </div>
            )}
          </div>
        </motion.div>
      </div>

      <div className="absolute right-4 z-10 flex flex-col gap-3" style={{ top: "calc(env(safe-area-inset-top, 12px) + 130px)" }}>
        <motion.button initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.2 }} onClick={onExit} className="flex h-12 w-12 items-center justify-center rounded-full border border-border/40 bg-card/90 shadow-lg backdrop-blur-xl transition-transform active:scale-90">
          <ChevronDown className="h-5 w-5 text-foreground" />
        </motion.button>
        <motion.button initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.3 }} onClick={onStartCall} disabled={callStatus !== "idle"} className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-600 shadow-lg transition-transform active:scale-90 disabled:opacity-50">
          <Phone className="h-5 w-5 text-white" />
        </motion.button>
        <motion.button initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.4 }} onClick={() => setChatOpen(!chatOpen)} className={`flex h-12 w-12 items-center justify-center rounded-full shadow-lg transition-transform active:scale-90 ${chatOpen ? "bg-primary text-primary-foreground" : "border border-border/40 bg-card/90 text-foreground backdrop-blur-xl"}`}>
          <MessageCircle className="h-5 w-5" />
        </motion.button>
        <motion.button initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.5 }} onClick={() => toast.info("Mapbox follows the active route automatically")} className="flex h-12 w-12 items-center justify-center rounded-full border border-border/40 bg-card/90 shadow-lg backdrop-blur-xl transition-transform active:scale-90">
          <Navigation className="h-5 w-5 text-foreground" />
        </motion.button>
      </div>

      <AnimatePresence>
        {chatOpen && (
          <motion.div initial={{ opacity: 0, x: 100 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 100 }} className="absolute right-4 z-10 w-[calc(100%-2rem)] max-w-sm overflow-hidden rounded-2xl border border-border/40 bg-card/95 shadow-2xl backdrop-blur-xl" style={{ top: "calc(env(safe-area-inset-top, 12px) + 300px)" }}>
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

      <div className="absolute bottom-0 left-0 right-0 z-10" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 8px) + 8px)" }}>
        <motion.div initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: "spring", stiffness: 300, damping: 30, delay: 0.1 }} className="mx-3 overflow-hidden rounded-3xl border border-border/40 bg-card/95 shadow-[0_-8px_40px_rgba(0,0,0,0.15)] backdrop-blur-xl">
          <div className="bg-blue-500/10 px-4 py-2 text-center text-xs font-bold uppercase tracking-wider text-blue-600">
            {isPickupPhase ? "Heading to Pickup" : "En route to Destination"}
          </div>
          <div className="grid grid-cols-3 divide-x divide-border/30 px-2 py-3">
            <Metric icon={<Clock className="h-3 w-3" />} label="ETA" value={etaMinutes} unit="min" />
            <Metric icon={<Route className="h-3 w-3" />} label="Distance" value={distanceKm} unit="km" />
            <Metric icon={<Gauge className="h-3 w-3" />} label="Speed" value={speed} unit="km/h" />
          </div>
          <div className="border-t border-border/20 px-4 py-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {isPickupPhase ? <MapPin className="h-3.5 w-3.5 shrink-0 text-blue-500" /> : <Navigation className="h-3.5 w-3.5 shrink-0 text-emerald-500" />}
              <p className="truncate font-medium">{isPickupPhase ? activeTrip.pickup_address : activeTrip.dropoff_address}</p>
              <span className="ml-auto whitespace-nowrap text-sm font-black text-foreground">{fmtUSD(activeTrip.fare)}</span>
            </div>
          </div>
          {actionButton && (
            <div className="px-4 pb-3 pt-1">
              <Button className={`h-14 w-full rounded-2xl text-base font-bold text-white shadow-lg transition-all active:scale-[0.97] ${actionButton.color}`} onClick={actionButton.action} disabled={completing}>
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

function Metric({ icon, label, value, unit }: { icon: React.ReactNode; label: string; value: string | number; unit: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-2">
      <div className="mb-0.5 flex items-center gap-1 text-muted-foreground">
        {icon}
        <span className="text-[10px] font-semibold uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-xl font-black tabular-nums">{value}</p>
      <p className="text-[10px] text-muted-foreground">{unit}</p>
    </div>
  );
}
