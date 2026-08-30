import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowUp,
  CheckCircle2,
  CornerUpLeft,
  CornerUpRight,
  Flag,
  MessageCircle,
  Navigation as NavigationIcon,
  Phone,
  RotateCw,
  ShieldAlert,
  Undo2,
  User,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { completeTrip } from "@/lib/completeTrip";
import { eventString } from "@/lib/backendSocketClient";
import { useRideRealtime } from "@/hooks/useRideRealtime";
import { useUnreadRideMessages } from "@/hooks/useUnreadRideMessages";
import { useVoiceNavigation } from "@/hooks/useVoiceNavigation";
import DriverMessageSheet from "@/components/driver/DriverMessageSheet";
import SafetySheet from "@/components/ride/SafetySheet";
import { goBackend } from "@/lib/goBackendClient";
import { createNotification } from "@/lib/businessApi";
import { supabase } from "@/lib/supabaseClient";
import { haptic } from "@/lib/haptics";
import { useMinutesSince, formatWaitingLabel } from "@/hooks/useMinutesSince";
import type { Coordinates } from "@/lib/osrm";
import { getDetailedRoute, findCurrentStep, getManeuverInstruction, getVoiceInstruction, type RouteStep } from "@/lib/osrmSteps";
import MapboxMap from "@/components/map/LazyMapboxMap";
import type { MapEtaCard } from "@/components/MapboxMap";
import RideGlassPanel from "@/components/ride/RideGlassPanel";
import { glassSurface, redCta, tintBlue, RIDE_RED, RIDE_RED_GRADIENT, RIDE_TEXT, RIDE_TEXT_2 } from "@/components/ride/rideGlass";

export interface RiderInfo {
  full_name: string | null;
  avatar_url: string | null;
  gender: string | null;
  completedTrips: number | null;
}

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
  /** Server-set once, on the transition into 'arrived' — never written by
   * this client (see trg_set_driver_arrived_at). */
  driver_arrived_at?: string | null;
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
// A driver ending the trip more than this far from the recorded drop-off
// gets an "are you sure" — an accidental early end strands a passenger
// mid-journey with a completed trip on record.
const END_TRIP_CONFIRM_DISTANCE_M = 250;

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

interface NavigationMapProps {
  pickup: Coordinates;
  dropoff: Coordinates;
  driverCoords: Coordinates | null;
  routeGeometry: string | null;
  destination: Coordinates;
  mapCards: MapEtaCard[];
  recenterSignal: number;
}

/** Owns the map and the 60fps driver-position smoothing that used to live on
 * FullScreenNavigation itself — every eased animation frame re-rendered the
 * entire ~900-line screen (banner, bottom sheet, chat, buttons) instead of
 * just the marker. Isolating it here means that rAF loop only re-renders
 * this small leaf component. */
const NavigationMap = memo(function NavigationMap({
  pickup, dropoff, driverCoords, routeGeometry, destination, mapCards, recenterSignal,
}: NavigationMapProps) {
  const smoothPos = useSmoothPosition(driverCoords);
  const routeCoordinates = useMemo(
    () => (!routeGeometry ? ([smoothPos, destination].filter(Boolean) as Coordinates[]) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [routeGeometry, smoothPos?.lat, smoothPos?.lng, destination.lat, destination.lng]
  );

  return (
    <div className="absolute inset-0">
      <MapboxMap
        pickup={pickup}
        dropoff={dropoff}
        driverLocation={smoothPos}
        routeGeometry={routeGeometry}
        routeCoordinates={routeCoordinates}
        routeGradient
        mapCards={mapCards}
        navigationFollow
        followZoom={17}
        recenterSignal={recenterSignal}
        className="h-full w-full"
        height="100%"
      />
    </div>
  );
});

/** Ticks on its own 60s interval so the rest of the screen doesn't
 * re-render once a minute just for this label. */
function ArrivedWaitingLine({ arrivedAt }: { arrivedAt: string }) {
  const minutes = useMinutesSince(arrivedAt);
  return (
    <p style={{ fontSize: 12, fontWeight: 700, color: RIDE_RED, textAlign: 'center' }}>
      Rider notified — {formatWaitingLabel(minutes)}
    </p>
  );
}

/** Keeps the display awake for as long as this screen is mounted — a driver
 * following directions cannot have the phone sleep mid-navigation. No-op
 * (never throws) where the Wake Lock API isn't supported. Re-acquires on
 * visibility change, since the OS releases the lock whenever the tab/app
 * is backgrounded. */
function useWakeLock() {
  useEffect(() => {
    let sentinel: WakeLockSentinel | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinel> } };
    const acquire = async () => {
      try {
        sentinel = (await nav.wakeLock?.request('screen')) ?? null;
      } catch {
        // Unsupported or denied — navigation still works, just no wake lock.
      }
    };
    void acquire();
    const onVisible = () => { if (document.visibilityState === 'visible') void acquire(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      sentinel?.release().catch(() => {});
    };
  }, []);
}

function ManeuverIcon({ step }: { step: RouteStep | null }) {
  const style = { width: 24, height: 24, color: '#fff' } as const;
  if (!step) return <NavigationIcon style={style} strokeWidth={2.4} />;
  const { type, modifier } = step.maneuver;
  if (type === "arrive") return <CheckCircle2 style={style} strokeWidth={2.4} />;
  if (type === "roundabout" || type === "rotary") return <RotateCw style={style} strokeWidth={2.4} />;
  if (modifier === "uturn") return <Undo2 style={style} strokeWidth={2.4} />;
  if (modifier?.includes("left")) return <CornerUpLeft style={style} strokeWidth={2.4} />;
  if (modifier?.includes("right")) return <CornerUpRight style={style} strokeWidth={2.4} />;
  return <ArrowUp style={style} strokeWidth={2.4} />;
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
  onStartCall,
  callStatus,
}: FullScreenNavigationProps) {
  const [route, setRoute] = useState<{ geometry: string; steps: RouteStep[]; distanceKm: number; durationMinutes: number } | null>(null);
  const [routeFailed, setRouteFailed] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [lastSpokenStepIndex, setLastSpokenStepIndex] = useState(-1);
  const [chatOpen, setChatOpen] = useState(false);
  const unreadMessages = useUnreadRideMessages(activeTrip?.id, userId, chatOpen);
  const [safetyOpen, setSafetyOpen] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [confirmingEndTrip, setConfirmingEndTrip] = useState(false);
  const [recenterSignal, setRecenterSignal] = useState(0);
  const [riderNote, setRiderNote] = useState<string | null>(null);
  const lastFetchPhase = useRef("");
  const lastFetchPos = useRef<Coordinates | null>(null);
  const lastFetchTime = useRef(0);

  const [cancelling, setCancelling] = useState(false);
  const [cancelReasonOpen, setCancelReasonOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  const { speak, isSupported: voiceSupported } = useVoiceNavigation({ enabled: voiceEnabled });
  useWakeLock();

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

  // The note the rider attached when booking — the driver is about to look
  // for a person, this is how they find them. Same trip_events source the
  // rider-side pickup note row reads from.
  useEffect(() => {
    let cancelled = false;
    supabase
      .from('trip_events')
      .select('payload')
      .eq('ride_id', activeTrip.id)
      .eq('event_type', 'rider_note')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        const note = (data?.payload as Record<string, unknown> | null)?.note;
        if (typeof note === 'string' && note.trim()) setRiderNote(note);
      });
    return () => { cancelled = true; };
  }, [activeTrip.id]);

  const isPickupPhase = ["accepted", "enroute", "enroute_pickup"].includes(activeTrip.status);
  const isArrivedWaiting = activeTrip.status === "arrived";
  const isInTrip = activeTrip.status === "in_progress" || activeTrip.status === "ongoing";
  const canCancel = isPickupPhase || isArrivedWaiting;
  const origin = driverCoords;
  const destination = useMemo(
    () => (isPickupPhase || isArrivedWaiting
      ? { lat: activeTrip.pickup_lat, lng: activeTrip.pickup_lon }
      : { lat: activeTrip.dropoff_lat, lng: activeTrip.dropoff_lon }),
    [isPickupPhase, isArrivedWaiting, activeTrip.pickup_lat, activeTrip.pickup_lon, activeTrip.dropoff_lat, activeTrip.dropoff_lon]
  );
  const pickup = useMemo(() => ({ lat: activeTrip.pickup_lat, lng: activeTrip.pickup_lon }), [activeTrip.pickup_lat, activeTrip.pickup_lon]);
  const dropoff = useMemo(() => ({ lat: activeTrip.dropoff_lat, lng: activeTrip.dropoff_lon }), [activeTrip.dropoff_lat, activeTrip.dropoff_lon]);
  const phaseKey = isPickupPhase || isArrivedWaiting ? "pickup" : "dropoff";

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

  const { currentStep, currentStepIndex, distToManeuverM } = useMemo(() => {
    if (!route?.steps.length || !driverCoords) return { currentStep: null as RouteStep | null, currentStepIndex: 0, distToManeuverM: 0 };
    const { stepIndex } = findCurrentStep(route.steps, driverCoords);
    const step = route.steps[stepIndex];
    const dist = haversineM(driverCoords, { lat: step.maneuver.location[1], lng: step.maneuver.location[0] });
    return { currentStep: step, currentStepIndex: stepIndex, distToManeuverM: dist };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route?.steps, driverCoords?.lat, driverCoords?.lng]);

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
  // "Arriving" is a clock time, not a countdown — computed once from the
  // same etaMinutes the banner uses, not a second estimate.
  const arrivingClockTime = new Date(Date.now() + etaMinutes * 60000)
    .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const mapCards: MapEtaCard[] = useMemo(
    () => (driverCoords
      ? [{ id: phaseKey, at: destination, label: isPickupPhase || isArrivedWaiting ? "Pickup" : "Drop-off", value: `${etaMinutes} min`, subvalue: `${remainingDistanceKm.toFixed(1)} km` }]
      : []),
    [driverCoords, phaseKey, destination, isPickupPhase, isArrivedWaiting, etaMinutes, remainingDistanceKm]
  );

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

        // The status POST above doesn't return the row, and this client
        // never sets driver_arrived_at itself (trg_set_driver_arrived_at
        // does, server-side, in the same transaction as the status write)
        // — read it back so the waiting timer can start immediately instead
        // of waiting for the next full reload.
        // driver_arrived_at isn't in the generated types yet (column added
        // by a migration newer than the last typegen) — untyped client call.
        (supabase as any).from('rides').select('driver_arrived_at').eq('id', activeTrip.id).maybeSingle()
          .then(({ data }: any) => {
            if (data?.driver_arrived_at) {
              onTripUpdate({ ...activeTrip, status: newStatus, driver_arrived_at: data.driver_arrived_at });
            }
          })
          .catch(() => {});
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
      setConfirmingEndTrip(false);
    }
  };

  const handleEndTripTap = () => {
    const distFromDropoff = driverCoords ? haversineM(driverCoords, { lat: activeTrip.dropoff_lat, lng: activeTrip.dropoff_lon }) : 0;
    if (distFromDropoff > END_TRIP_CONFIRM_DISTANCE_M && !confirmingEndTrip) {
      setConfirmingEndTrip(true);
      return;
    }
    void handleComplete();
  };

  // Cancellation — recorded against the driver server-side (rideStatus
  // 'cancelled' + driverRowID set triggers recordReputationRideCancelled in
  // the Go handler); the reason is best-effort logged the same way the
  // rider-side cancel flow logs its reason.
  const submitCancel = async (reason: string) => {
    if (cancelling) return;
    setCancelling(true);
    try {
      await goBackend.post(`/api/rides/${activeTrip.id}/status`, {
        status: 'cancelled',
        expectedStatus: activeTrip.status,
      });
      if (reason) {
        supabase.from('trip_events').insert([{
          ride_id: activeTrip.id,
          actor_id: userId,
          event_type: 'ride_cancelled',
          payload: { reason, cancelled_by: 'driver' },
        }] as never).then(({ error }) => {
          if (error) console.warn('Could not log cancellation reason:', error.message);
        });
      }
      toast.info('Ride cancelled');
      onTripComplete();
    } catch (e: unknown) {
      toast.error('Could not cancel', { description: (e as Error).message });
    } finally {
      setCancelling(false);
      setCancelReasonOpen(false);
    }
  };


  const passengerName = activeTrip.passenger_name || riderInfo?.full_name || 'Passenger';
  const dialNumber = activeTrip.passenger_phone || riderPhone;
  const metaBits = [
    activeTrip.passenger_count && activeTrip.passenger_count > 1 ? `${activeTrip.passenger_count} passengers` : null,
  ].filter(Boolean) as string[];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] bg-background">
      <NavigationMap
        pickup={pickup}
        dropoff={dropoff}
        driverCoords={driverCoords}
        routeGeometry={route?.geometry ?? null}
        destination={destination}
        mapCards={mapCards}
        recenterSignal={recenterSignal}
      />

      {/* Navigation banner — owns the top of the screen, not the sheet. */}
      <div className="absolute z-20" style={{ top: 'calc(env(safe-area-inset-top) + 7px)', left: 16, right: 16 }}>
        <button
          type="button"
          onClick={() => setRecenterSignal((s) => s + 1)}
          className="flex items-center w-full text-left active:scale-[0.98] transition-transform"
          style={{ padding: '12px 14px', borderRadius: 18, gap: 12, background: RIDE_RED_GRADIENT, boxShadow: '0 12px 28px rgba(184,17,4,.32), inset 0 1px 0 rgba(255,255,255,.28)' }}
        >
          <ManeuverIcon step={currentStep} />
          <div className="min-w-0" style={{ flex: 1 }}>
            <p className="tabular-nums" style={{ fontSize: 19, fontWeight: 700, letterSpacing: '-.02em', lineHeight: 1.1, color: '#fff' }}>
              {fmtDistance(currentStep ? distToManeuverM : straightDistanceM)}
            </p>
            <p className="truncate" style={{ marginTop: 2, fontSize: 12.5, fontWeight: 500, lineHeight: 1.2, color: 'rgba(255,255,255,.85)' }}>
              {currentStep ? getManeuverInstruction(currentStep) : (isPickupPhase || isArrivedWaiting ? 'Head to pickup' : 'Head to drop-off')}
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="tabular-nums" style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>{etaMinutes} min</p>
            <p style={{ fontSize: 11, fontWeight: 500, color: 'rgba(255,255,255,.78)' }}>
              to {isPickupPhase || isArrivedWaiting ? 'pickup' : 'drop-off'}
            </p>
          </div>
        </button>
      </div>

      {/* 4q — "Trip in progress" chip beneath the banner */}
      {isInTrip && (
        <div
          className="absolute z-20 inline-flex items-center"
          style={{ top: 130, left: 16, height: 34, padding: '0 12px', borderRadius: 999, gap: 7, ...glassSurface }}
        >
          <span className="rounded-full shrink-0" style={{ width: 7, height: 7, background: '#22A447' }} />
          <span style={{ fontSize: 12.5, fontWeight: 700, color: RIDE_TEXT }}>Trip in progress</span>
        </div>
      )}

      {/* Voice + minimize controls, right side */}
      <div className="absolute right-4 z-20 flex flex-col gap-3" style={{ top: 'calc(env(safe-area-inset-top) + 76px)' }}>
        <button
          type="button"
          onClick={() => setVoiceEnabled(!voiceEnabled)}
          aria-label="Toggle voice"
          className="flex items-center justify-center active:scale-90 transition-transform"
          style={{ width: 44, height: 44, borderRadius: 999, ...glassSurface }}
        >
          {voiceEnabled && voiceSupported ? <Volume2 style={{ width: 19, height: 19, color: RIDE_TEXT }} /> : <VolumeX style={{ width: 19, height: 19, color: RIDE_TEXT_2 }} />}
        </button>
      </div>

      <DriverMessageSheet
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        rideId={activeTrip.id}
        currentUserId={userId}
        passengerName={passengerName}
        passengerPhone={dialNumber}
        etaMinutes={etaMinutes}
      />


      {/* Bottom sheet */}
      <div className="absolute left-0 right-0 bottom-0 z-20">
        <RideGlassPanel
          panelStyle={{
            background: 'rgba(255,255,255,.86)',
            backdropFilter: 'blur(28px) saturate(190%)',
            WebkitBackdropFilter: 'blur(28px) saturate(190%)',
            boxShadow: 'inset 0 0 0 .5px rgba(255,255,255,.6), 0 -8px 30px rgba(17,17,17,.06)',
          }}
          style={{ maxHeight: '70vh', paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
            <div className="p-4" style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
              {isInTrip ? (
                <>
                  {/* 4q — passenger collapses to one strip */}
                  <div className="flex items-center" style={{ gap: 10 }}>
                    <span
                      className="shrink-0 flex items-center justify-center rounded-full"
                      style={{ width: 34, height: 34, background: 'linear-gradient(135deg,#C6CBD4,#868E9B)', boxShadow: '0 0 0 2px rgba(255,255,255,.95)' }}
                    >
                      {riderInfo?.avatar_url ? (
                        <img src={riderInfo.avatar_url} alt="" className="w-full h-full object-cover rounded-full" />
                      ) : (
                        <User style={{ width: 17, height: 17 }} className="text-white" strokeWidth={2.2} />
                      )}
                    </span>
                    <div className="min-w-0" style={{ flex: 1 }}>
                      <p className="truncate" style={{ fontSize: 14.5, fontWeight: 700, letterSpacing: '-.015em', lineHeight: 1.2, color: RIDE_TEXT }}>
                        {passengerName}{metaBits.length ? ` · ${metaBits.join(' · ')}` : ''}
                      </p>
                      <p className="truncate" style={{ marginTop: 2, fontSize: 11.5, fontWeight: 500, lineHeight: 1.2, color: RIDE_TEXT_2 }}>
                        {activeTrip.dropoff_address}
                      </p>
                    </div>
                    {dialNumber && (
                      <button
                        type="button"
                        onClick={onStartCall}
                        disabled={callStatus !== 'idle'}
                        aria-label="Call passenger"
                        className="shrink-0 flex items-center justify-center rounded-full active:scale-90 transition-transform disabled:opacity-60"
                        style={{ width: 38, height: 38, ...glassSurface }}
                      >
                        <Phone style={{ width: 17, height: 17, color: RIDE_TEXT }} />
                      </button>
                    )}
                  </div>

                  {/* Three stat tiles */}
                  <div className="flex items-stretch" style={{ gap: 8 }}>
                    <div className="min-w-0" style={{ flex: 1, padding: '10px 12px', borderRadius: 14, ...glassSurface }}>
                      <p style={{ fontSize: 10.5, fontWeight: 600, color: RIDE_TEXT_2 }}>Distance left</p>
                      <p className="tabular-nums" style={{ marginTop: 2, fontSize: 15, fontWeight: 700, color: RIDE_TEXT }}>{remainingDistanceKm.toFixed(1)} km</p>
                    </div>
                    <div className="min-w-0" style={{ flex: 1, padding: '10px 12px', borderRadius: 14, ...glassSurface }}>
                      <p style={{ fontSize: 10.5, fontWeight: 600, color: RIDE_TEXT_2 }}>Arriving</p>
                      <p className="tabular-nums" style={{ marginTop: 2, fontSize: 15, fontWeight: 700, color: RIDE_TEXT }}>{arrivingClockTime}</p>
                    </div>
                    <div
                      className="min-w-0"
                      style={{ flex: 1, padding: '10px 12px', borderRadius: 14, background: 'linear-gradient(135deg, rgba(255,250,205,.95), rgba(255,221,0,.2))', boxShadow: 'inset 0 .5px 0 rgba(255,255,255,.9), inset 0 0 0 .5px rgba(255,221,0,.5)' }}
                    >
                      <p style={{ fontSize: 10.5, fontWeight: 600, color: RIDE_TEXT_2 }}>Collect</p>
                      <p className="tabular-nums" style={{ marginTop: 2, fontSize: 15, fontWeight: 700, color: RIDE_TEXT }}>{fmtUSD(activeTrip.fare)}</p>
                    </div>
                  </div>

                  {confirmingEndTrip && (
                    <p style={{ fontSize: 12, fontWeight: 600, color: RIDE_RED, textAlign: 'center' }}>
                      You're still far from the drop-off — tap Complete trip again to confirm.
                    </p>
                  )}

                  {/* Action row */}
                  <div className="flex items-center" style={{ gap: 12 }}>
                    <button
                      type="button"
                      onClick={() => setSafetyOpen(true)}
                      className="shrink-0 flex items-center justify-center active:scale-[0.97] transition-transform"
                      style={{ width: 104, height: 48, borderRadius: 15, gap: 7, ...glassSurface, boxShadow: 'inset 0 .75px 0 rgba(255,255,255,.98), inset 0 0 0 1px rgba(184,17,4,.22)' }}
                    >
                      <ShieldAlert style={{ width: 17, height: 17, color: RIDE_RED }} />
                      <span style={{ fontSize: 14, fontWeight: 700, color: RIDE_RED }}>Safety</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleEndTripTap}
                      disabled={completing}
                      className="relative flex-1 flex items-center justify-center active:scale-[0.97] transition-transform disabled:opacity-70"
                      style={{ height: 48, borderRadius: 15, gap: 9, ...redCta }}
                    >
                      <Flag style={{ width: 17, height: 17 }} className="text-white" strokeWidth={2.4} />
                      <span style={{ fontSize: 15.5, fontWeight: 700 }} className="text-white">
                        {completing ? 'Completing…' : confirmingEndTrip ? 'Confirm complete trip' : 'Complete trip'}
                      </span>
                    </button>
                  </div>
                </>
              ) : (
                <>
                  {/* 4p (and the arrived-waiting variant) — full passenger identity */}
                  <div className="flex items-center" style={{ gap: 11 }}>
                    <span
                      className="shrink-0 flex items-center justify-center rounded-full"
                      style={{ width: 44, height: 44, background: 'linear-gradient(135deg,#C6CBD4,#868E9B)', boxShadow: '0 0 0 2px rgba(255,255,255,.95), 0 4px 12px rgba(17,17,17,.12)' }}
                    >
                      {riderInfo?.avatar_url ? (
                        <img src={riderInfo.avatar_url} alt="" className="w-full h-full object-cover rounded-full" />
                      ) : (
                        <User style={{ width: 22, height: 22 }} className="text-white" strokeWidth={2.2} />
                      )}
                    </span>
                    <div className="min-w-0" style={{ flex: 1 }}>
                      <p className="truncate" style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-.02em', lineHeight: 1.2, color: RIDE_TEXT }}>
                        {passengerName}
                      </p>
                      <div className="flex items-center" style={{ marginTop: 3, gap: 5, fontSize: 12, fontWeight: 500, color: RIDE_TEXT_2 }}>
                        {riderInfo?.completedTrips != null && (
                          <span className="whitespace-nowrap">{riderInfo.completedTrips} trips</span>
                        )}
                        {activeTrip.passenger_count && activeTrip.passenger_count > 1 && (
                          <>
                            {riderInfo?.completedTrips != null && <span className="rounded-full" style={{ width: 2.5, height: 2.5, background: RIDE_TEXT_2 }} />}
                            <span className="whitespace-nowrap">{activeTrip.passenger_count} passengers</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center shrink-0" style={{ gap: 8 }}>
                      <button
                        type="button"
                        onClick={() => setChatOpen((v) => !v)}
                        aria-label="Message passenger"
                        className="relative flex items-center justify-center rounded-full active:scale-90 transition-transform"
                        style={{ width: 40, height: 40, ...glassSurface }}
                      >
                        <MessageCircle style={{ width: 18, height: 18, color: RIDE_TEXT }} />
                        {unreadMessages > 0 && (
                          <span
                            className="absolute flex items-center justify-center rounded-full"
                            style={{ top: -2, right: -2, minWidth: 16, height: 16, padding: '0 3px', background: RIDE_RED, color: '#fff', fontSize: 9.5, fontWeight: 800, boxShadow: '0 0 0 2px rgba(255,255,255,.95)' }}
                          >
                            {unreadMessages > 9 ? '9+' : unreadMessages}
                          </span>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (!dialNumber) {
                            toast.info('No phone number available for this passenger');
                            return;
                          }
                          onStartCall();
                        }}
                        disabled={callStatus !== 'idle' || !dialNumber}
                        aria-label="Call passenger"
                        className="flex items-center justify-center rounded-full active:scale-90 transition-transform disabled:opacity-50"
                        style={{ width: 40, height: 40, background: RIDE_RED_GRADIENT, boxShadow: '0 6px 14px rgba(184,17,4,.3)' }}
                      >
                        <Phone style={{ width: 18, height: 18 }} className="text-white" />
                      </button>
                    </div>
                  </div>

                  {/* Note from passenger */}
                  {riderNote && (
                    <div
                      className="flex items-start"
                      style={{ background: 'linear-gradient(135deg, rgba(255,248,247,.9), rgba(184,17,4,.05))', boxShadow: 'inset 0 .5px 0 rgba(255,255,255,.9), inset 0 0 0 .5px rgba(184,17,4,.14)', borderRadius: 16, padding: '10px 12px', gap: 10 }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={RIDE_RED} strokeWidth="2" style={{ marginTop: 1 }} className="shrink-0">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                      </svg>
                      <div className="min-w-0">
                        <p style={{ fontSize: 10.5, fontWeight: 700, color: RIDE_RED, textTransform: 'uppercase', letterSpacing: '.06em' }}>
                          Note from {passengerName.split(' ')[0]}
                        </p>
                        <p style={{ marginTop: 3, fontSize: 12.5, fontWeight: 600, lineHeight: 1.35, color: RIDE_TEXT }}>{riderNote}</p>
                      </div>
                    </div>
                  )}

                  {/* Route card */}
                  <div className="flex items-center" style={{ ...tintBlue, borderRadius: 16, padding: '11px 13px', gap: 11 }}>
                    <div className="flex flex-col items-center shrink-0" style={{ paddingTop: 2, gap: 3 }}>
                      <span className="rounded-full" style={{ width: 9, height: 9, background: '#1A73E8', boxShadow: '0 0 0 2px rgba(255,255,255,.9)' }} />
                      <span style={{ width: 1.5, height: 14, background: 'rgba(17,17,17,.16)' }} />
                      <span className="rounded-full" style={{ width: 9, height: 9, background: RIDE_RED, boxShadow: '0 0 0 2px rgba(255,255,255,.9)' }} />
                    </div>
                    <div className="min-w-0" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <p className="truncate" style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.15, color: RIDE_TEXT_2 }}>{activeTrip.pickup_address}</p>
                      <p className="truncate" style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.15, color: RIDE_TEXT }}>{activeTrip.dropoff_address}</p>
                    </div>
                    <div className="flex flex-col items-end shrink-0">
                      <span className="tabular-nums" style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-.02em', color: RIDE_RED }}>{fmtUSD(activeTrip.fare)}</span>
                      <span style={{ fontSize: 10.5, fontWeight: 600, color: RIDE_TEXT_2 }}>{activeTrip.payment_method || 'cash'}</span>
                    </div>
                  </div>

                  {routeFailed && (
                    <p style={{ fontSize: 11, color: RIDE_TEXT_2 }}>
                      Live turn-by-turn is temporarily unavailable — showing a direct-line estimate instead.
                    </p>
                  )}

                  {isArrivedWaiting && activeTrip.driver_arrived_at && (
                    <ArrivedWaitingLine arrivedAt={activeTrip.driver_arrived_at} />
                  )}

                  {/* Action row */}
                  <div className="flex items-center" style={{ gap: 12 }}>
                    <button
                      type="button"
                      onClick={() => { haptic('light'); setCancelReasonOpen(true); }}
                      disabled={!canCancel}
                      className="relative shrink-0 flex items-center justify-center overflow-hidden select-none active:scale-[0.97] transition-transform disabled:opacity-40"
                      style={{ width: 104, height: 48, borderRadius: 15, ...glassSurface }}
                    >
                      <span className="relative" style={{ fontSize: 13.5, fontWeight: 700, color: RIDE_TEXT_2 }}>Cancel</span>
                    </button>
                    {isArrivedWaiting ? (
                      <button
                        type="button"
                        onClick={() => handleStatusUpdate("in_progress", "Rider picked up - navigating to dropoff", "Rider picked up. Navigating to destination.")}
                        className="relative flex-1 flex items-center justify-center active:scale-[0.97] transition-transform"
                        style={{ height: 48, borderRadius: 15, gap: 9, ...redCta }}
                      >
                        <CheckCircle2 style={{ width: 18, height: 18 }} className="text-white" strokeWidth={2.6} />
                        <span style={{ fontSize: 15.5, fontWeight: 700 }} className="text-white">Start trip</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleStatusUpdate("arrived", "Status: Arrived - waiting for rider", "You have arrived at the pickup point")}
                        className="relative flex-1 flex items-center justify-center active:scale-[0.97] transition-transform"
                        style={{ height: 48, borderRadius: 15, gap: 9, ...redCta }}
                      >
                        <CheckCircle2 style={{ width: 18, height: 18 }} className="text-white" strokeWidth={2.6} />
                        <span style={{ fontSize: 15.5, fontWeight: 700 }} className="text-white">I've arrived</span>
                      </button>
                    )}
                  </div>
                </>
              )}

              {/* Home indicator */}
              <div style={{ padding: '6px 0 10px' }} className="flex justify-center">
                <span className="rounded-full" style={{ width: 140, height: 5, background: RIDE_TEXT }} />
              </div>
            </div>
          </div>
        </RideGlassPanel>
      </div>

      {/* Cancel reason — asked after a completed hold, before the cancel actually submits */}
      <AnimatePresence>
        {cancelReasonOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-[110]" style={{ background: 'rgba(17,17,17,.4)' }}
              onClick={() => !cancelling && setCancelReasonOpen(false)}
            />
            <motion.div
              initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
              className="fixed left-4 right-4 z-[120]" style={{ bottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}
            >
              <div className="flex flex-col" style={{ background: '#fff', borderRadius: 20, padding: 16, gap: 10, boxShadow: '0 20px 50px rgba(0,0,0,.25)' }}>
                <p style={{ fontSize: 15, fontWeight: 700, color: RIDE_TEXT }}>Why are you cancelling?</p>
                <textarea
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="e.g. Rider unreachable, wrong pickup pin…"
                  rows={2}
                  maxLength={140}
                  className="w-full outline-none resize-none"
                  style={{ padding: '8px 10px', borderRadius: 10, fontSize: 13, background: 'rgba(17,17,17,.04)', color: RIDE_TEXT }}
                />
                <div className="flex items-center" style={{ gap: 10 }}>
                  <button
                    type="button"
                    onClick={() => { setCancelReasonOpen(false); setCancelReason(''); }}
                    disabled={cancelling}
                    className="flex-1 flex items-center justify-center active:scale-95 transition-transform"
                    style={{ height: 44, borderRadius: 12, background: 'rgba(17,17,17,.06)' }}
                  >
                    <span style={{ fontSize: 13.5, fontWeight: 700, color: RIDE_TEXT_2 }}>Never mind</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => submitCancel(cancelReason.trim())}
                    disabled={cancelling}
                    className="flex-1 flex items-center justify-center active:scale-95 transition-transform disabled:opacity-60"
                    style={{ height: 44, borderRadius: 12, background: RIDE_RED }}
                  >
                    <span style={{ fontSize: 13.5, fontWeight: 700, color: '#fff' }}>{cancelling ? 'Cancelling…' : 'Cancel ride'}</span>
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <SafetySheet
        open={safetyOpen}
        onClose={() => setSafetyOpen(false)}
        rideId={activeTrip.id}
        counterpartName={passengerName}
        counterpartAvatarUrl={riderInfo?.avatar_url}
        plateNumber={null}
        startedAt={null}
        pickupAddress={activeTrip.pickup_address}
        dropoffAddress={activeTrip.dropoff_address}
        role="driver"
      />
    </motion.div>
  );
}
