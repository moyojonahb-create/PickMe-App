import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { completeTrip } from "@/lib/completeTrip";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { resolveAvatarUrl } from "@/lib/avatarUrl";
import { useAuth } from "@/hooks/useAuth";
import { useRideRealtime } from "@/hooks/useRideRealtime";
import { useDriverTracking } from "@/hooks/useDriverTracking";
import { useNearbyDrivers } from "@/hooks/useNearbyDrivers";
import { useRideViewerCount } from "@/lib/rideViewerPresence";
import { useAgoraCall } from "@/hooks/useAgoraCall";
import { getSecondsRemaining } from "@/lib/rideExpiry";
import { goBackend } from "@/lib/goBackendClient";
import { decimalToMinor } from "@/lib/money";
import { isRequestedRideStatus, normalizeRideRow } from "@/lib/rideContract";
import { isGoBackendConfigured } from "@/lib/rideMatching";
import {
  fetchPendingOffers,
  fetchDriversByIds,
  acceptOffer,
  declineOffer,
  type Offer,
  type DriverProfile
} from "@/lib/offerHelpers";
import { RideCommunication } from "@/components/ride/RideCommunication";
import OffersModal from "@/components/OffersModal";
import MapboxMap from "@/components/MapboxMap";
import TripMapboxMap from "@/components/TripMapboxMap";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { ArrowLeft, MapPin, Users, Eye, Minus, Plus, MessageCircle, Phone, Clock, Star, Navigation, Car, ChevronUp, LifeBuoy } from "lucide-react";
import CancellationPolicy from "@/components/ride/CancellationPolicy";
import SafetySheet from "@/components/ride/SafetySheet";
import DriverRatingModal from "@/components/ride/DriverRatingModal";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { playAcceptedSound, playNewRequestSound, playArrivedSound, playCompletedSound } from "@/lib/notificationSounds";
import SearchingOverlay from "@/components/ride/SearchingOverlay";
import RideCompleteSummary from "@/components/ride/RideCompleteSummary";
import TripReceiptButton from "@/components/ride/TripReceiptButton";
import DisputeForm from "@/components/ride/DisputeForm";
import { haptic } from "@/lib/haptics";
import IncomingCallModal from "@/components/ride/IncomingCallModal";
import ActiveCallOverlay from "@/components/ride/ActiveCallOverlay";
import VoiceCallButton from "@/components/ride/VoiceCallButton";
import ShareTripButton from "@/components/ride/ShareTripButton";
import DriverBidAcceptedModal from "@/components/ride/DriverBidAcceptedModal";
import { requestRide } from "@/lib/requestRide";
import EcoCashPaymentModal from "@/components/wallet/EcoCashPaymentModal";
import PayRideButton from "@/components/ride/PayRideButton";
import PaymentStatusBadge from "@/components/ride/PaymentStatusBadge";
// Rider wallet removed — riders pay drivers directly
import RideBottomSheet, { type SheetState } from "@/components/ride/RideBottomSheet";
import { createFavoriteLocation } from "@/lib/businessApi";
import PilotReadinessCard from "@/components/pilot/PilotReadinessCard";

type Ride = {
  id: string;
  user_id: string;
  driver_id: string | null;
  status: string;
  ride_status?: string;
  pickup_address: string;
  dropoff_address: string;
  pickup_lat: number;
  pickup_lon: number;
  dropoff_lat: number;
  dropoff_lon: number;
  fare: number;
  distance_km: number;
  duration_minutes: number;
  expires_at?: string | null;
  route_polyline?: string | null;
  passenger_name?: string | null;
  passenger_phone?: string | null;
  payment_method?: string;
  wallet_paid?: boolean;
  wallet_paid_at?: string | null;
  payment_failed?: boolean | null;
  payment_failure_reason?: string | null;
  updated_at?: string;
};

export default function RiderRideDetail() {
  const { rideId } = useParams<{rideId: string;}>();
  const nav = useNavigate();
  const { user, loading: authLoading } = useAuth();

  const [ride, setRide] = useState<Ride | null>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [driversById, setDriversById] = useState<Record<string, DriverProfile>>({});
  const [driverProfile, setDriverProfile] = useState<DriverProfile | null>(null);
  const [driverPhone, setDriverPhone] = useState<string | null>(null);
  const [driverName, setDriverName] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [safetyOpen, setSafetyOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingFare, setUpdatingFare] = useState(false);
  const [showCommunication, setShowCommunication] = useState(false);
  const [lastOfferCount, setLastOfferCount] = useState(0);
  const [showRating, setShowRating] = useState(false);
  const [hasRated, setHasRated] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(30);
  const [showEcoCashPay, setShowEcoCashPay] = useState(false);
  const [sheetState, setSheetState] = useState<SheetState>('half');
  const [showAcceptedOverlay, setShowAcceptedOverlay] = useState(false);
  const showAcceptedOverlayRef = useRef(showAcceptedOverlay);
  useEffect(() => { showAcceptedOverlayRef.current = showAcceptedOverlay; }, [showAcceptedOverlay]);

  // Rider wallet removed — direct payment to driver
  const walletPin: string | null = null;

  const {
    callStatus, isMuted, isSpeaker, callDuration, incomingCall,
    startCall, answerCall, declineCall: declineIncomingCall, endCall,
    toggleMute, toggleSpeaker
  } = useAgoraCall({
    rideId: rideId ?? null,
    currentUserId: user?.id ?? "",
    otherUserId: (driverProfile as Record<string, unknown>)?.user_id as string ?? null
  });

  const refreshRide = useCallback(async () => {
    if (!rideId) return;
    let data: Ride;
    try {
      if (!isGoBackendConfigured()) throw new Error("backend not configured");
      data = normalizeRideRow(await goBackend.get<Record<string, unknown>>(`/api/rides/${rideId}`)) as unknown as Ride;
    } catch (error) {
      // Same fallback pattern used throughout offerHelpers/rideMatching —
      // read the ride straight from Supabase when the Go backend call
      // fails for any reason, instead of leaving the rider stuck on
      // "ride not found". Unlike isBackendUnavailable()'s narrower check
      // (used where a real 401 should prompt re-login), a rider's own ride
      // is safe to read directly regardless of why the backend rejected
      // the request — if their session is genuinely invalid, this read
      // fails the same way and surfaces the same error.
      const { data: rideRow, error: rideErr } = await supabase.from("rides").select("*").eq("id", rideId).maybeSingle();
      if (rideErr || !rideRow) {
        setError(rideErr?.message ?? (error as Error).message ?? "Ride not found");
        return;
      }
      data = normalizeRideRow(rideRow as unknown as Record<string, unknown>) as unknown as Ride;
    }

    const wasAccepted = ride?.status !== "accepted" && data.status === "accepted";
    const wasArrived = ride?.status !== "driver_arrived" && ride?.status !== "arrived" && (data.status === "driver_arrived" || data.status === "arrived");
    const wasCompleted = ride?.status !== "completed" && data.status === "completed";
    const cancelledWhileConfirming = showAcceptedOverlayRef.current && data.status === "cancelled";
    setRide(data);

    if (wasAccepted) {
      // Sound/haptic fire from DriverBidAcceptedModal itself when it opens —
      // it owns the full "driver accepted" moment (50s confirm/decline),
      // replacing the old auto-dismissing celebration overlay.
      setShowAcceptedOverlay(true);
      setModalOpen(false);
      try {
        if (typeof globalThis.Notification !== "undefined" && Notification.permission === "granted") {
          new Notification("🎉 Driver Accepted!", { body: "Your ride has been confirmed. Driver is on the way!", icon: "/icons/icon-192x192.png" });
        }
      } catch (_) {}
    }

    if (cancelledWhileConfirming) {
      setShowAcceptedOverlay(false);
      toast.info("This driver cancelled the ride", { description: "Please request a new ride." });
    }

    if (wasArrived) {
      playArrivedSound();
      haptic('heavy');
      try {
        if (typeof globalThis.Notification !== "undefined" && Notification.permission === "granted") {
          new Notification("📍 Driver Has Arrived!", { body: "Your driver is waiting at the pickup point.", icon: "/icons/icon-192x192.png" });
        }
      } catch (_) {}
    }

    if (wasCompleted) {
      playCompletedSound();
      haptic('medium');
      if (!hasRated) setShowRating(true);
    }

    if (data.driver_id && (data.status === "accepted" || data.status === "in_progress" || data.status === "arrived" || data.status === "enroute")) {
      try {
        const { data: driverData } = await supabase.from("drivers").select("*").or(`id.eq.${data.driver_id},user_id.eq.${data.driver_id}`).maybeSingle();
        if (driverData) {
          const resolvedAvatar = await resolveAvatarUrl(driverData.avatar_url);
          setDriverProfile({ ...driverData, avatar_url: resolvedAvatar });
          const { data: profileData } = await supabase.from("profiles").select("full_name, phone").eq("user_id", driverData.user_id).maybeSingle();
          if (profileData?.phone) setDriverPhone(profileData.phone);
          if (profileData?.full_name) setDriverName(profileData.full_name);
        }
      } catch (e: unknown) { console.warn("Error fetching driver details:", (e as Error).message); }
    }
  }, [rideId, ride?.status]);

  const refreshOffers = useCallback(async () => {
    if (!rideId) return;
    try {
      const list = await fetchPendingOffers(rideId);
      if (list.length > lastOfferCount && lastOfferCount > 0) {
        playNewRequestSound();
        haptic('medium');
        // Auto-open offers modal so rider sees the new offer immediately
        setModalOpen(true);
        toast.success("🚗 New driver offer received!", {
          description: `${list.length} driver${list.length > 1 ? 's' : ''} bidding on your ride — tap to review`,
          duration: 8000,
        });
        try {
          if (typeof globalThis.Notification !== "undefined" && Notification.permission === "granted") {
            new Notification("🚗 New Driver Offer!", { body: "A driver has made an offer on your ride. Tap to review.", icon: "/icons/icon-192x192.png" });
          }
        } catch (_) {}
      }
      setLastOfferCount(list.length);
      setOffers(list);
      const ids = [...new Set(list.map((o) => o.driver_id))];
      const map = await fetchDriversByIds(ids);
      setDriversById(map);
    } catch (e: unknown) { console.error("Failed to fetch offers:", e); }
  }, [rideId, lastOfferCount]);

  useRideRealtime(rideId ?? null, { onRideChange: refreshRide, onOfferChange: refreshOffers });

  useEffect(() => {
    try {
      if (typeof globalThis.Notification !== "undefined" && Notification.permission === "default") {
        Notification.requestPermission();
      }
    } catch (_) {}
  }, []);

  const driverLocation = useDriverTracking(
    (driverProfile as Record<string, unknown>)?.user_id as string ?? null,
    ride?.status ?? null
  );

  const isPendingStatus = isRequestedRideStatus(ride?.status, ride?.ride_status);
  const nearbyDrivers = useNearbyDrivers(isPendingStatus);
  const viewerCount = useRideViewerCount(isPendingStatus ? rideId : null);

  useEffect(() => {
    if (!ride || !isRequestedRideStatus(ride.status, ride.ride_status) || !ride.expires_at) return;
    const updateCountdown = () => {
      const secs = getSecondsRemaining(ride.expires_at ?? null);
      setSecondsLeft(secs);
      if (secs <= 0 && isRequestedRideStatus(ride.status, ride.ride_status)) {
        toast.info("Ride request expired", { description: "Your request timed out." });
        nav("/ride");
      }
    };
    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [ride, nav]);

  useEffect(() => {
    if (!authLoading && !user) { nav("/auth"); return; }
    if (!authLoading && rideId) Promise.all([refreshRide(), refreshOffers()]).finally(() => setLoading(false));
  }, [authLoading, user, rideId, nav, refreshRide, refreshOffers]);

  // Auto-adjust sheet based on ride status — default collapsed for max map
  useEffect(() => {
    if (!ride) return;
    if (ride.status === "in_progress") {
      setSheetState('collapsed');
    } else if (ride.status === "arrived" || ride.status === "driver_arrived") {
      setSheetState('half');
    } else if (ride.status === "accepted") {
      setSheetState('collapsed');
    } else if (ride.status === "completed") {
      setSheetState('half');
    }
  }, [ride?.status]);

  const updateFare = async (newFare: number) => {
    if (!rideId || !ride || !isRequestedRideStatus(ride.status, ride.ride_status)) return;
    const clampedFare = Math.max(0.50, Math.round(newFare * 2) / 2);
    if (clampedFare === ride.fare) return;
    setUpdatingFare(true);
    try {
      await goBackend.patch(`/api/rides/${rideId}`, {
        fare_minor: decimalToMinor(clampedFare),
      });
      setRide({ ...ride, fare: clampedFare });
      toast.success(`Fare updated to $${clampedFare.toFixed(2)}`);
    } catch (e: unknown) { toast.error("Failed to update fare", { description: (e as Error).message }); }
    finally { setUpdatingFare(false); }
  };

  const handleAcceptOffer = async (offerId: string) => {
    const offer = offers.find((o) => o.id === offerId);
    if (!offer || !rideId) return;
    try {
      setError(null);
      await acceptOffer(rideId, offer);
      setModalOpen(false);
      playAcceptedSound();
      toast.success("Driver accepted!", { description: "You can now contact your driver" });
      await refreshRide();
    } catch (e: unknown) { setError((e as Error).message); toast.error("Failed to accept offer", { description: (e as Error).message }); }
  };

  const handleDeclineOffer = async (offerId: string) => {
    try { await declineOffer(offerId, rideId); toast.info("Offer declined"); await refreshOffers(); }
    catch (e: unknown) { toast.error("Failed to decline offer", { description: (e as Error).message }); }
  };

  const handleCancelRide = async () => {
    if (!rideId) return;
    try {
      await goBackend.post(`/api/rides/${rideId}/status`, { status: "cancelled" });
      toast.info("Ride cancelled");
      nav("/ride");
    } catch (e: unknown) { toast.error("Failed to cancel ride", { description: (e as Error).message }); }
  };

  // Rider declined the driver who accepted their bid (or the 50s confirm
  // window ran out) — release this ride and re-request an equivalent one so
  // it re-enters the open pool for other drivers, using the same cancel +
  // request-ride primitives as everywhere else in the app rather than a new
  // "reopen for other drivers" backend transition.
  const handleDeclineDriver = async () => {
    setShowAcceptedOverlay(false);
    if (!ride) { nav("/ride"); return; }
    const declined = ride;
    try {
      await goBackend.post(`/api/rides/${declined.id}/status`, { status: "cancelled" });
      const result = await requestRide({
        pickup_address: declined.pickup_address,
        dropoff_address: declined.dropoff_address,
        fare: declined.fare,
        distance_km: declined.distance_km,
        duration_minutes: declined.duration_minutes,
        pickup_lat: declined.pickup_lat,
        pickup_lng: declined.pickup_lon,
        dropoff_lat: declined.dropoff_lat,
        dropoff_lng: declined.dropoff_lon,
        payment_method: declined.payment_method,
      });
      if (result.ok) {
        toast.info("Looking for another driver…");
        nav(`/ride/${result.ride.id}/matching`, { replace: true });
      } else {
        toast.error("Could not release this ride", { description: result.error });
        nav("/ride");
      }
    } catch (e: unknown) {
      toast.error("Failed to decline driver", { description: (e as Error).message });
      nav("/ride");
    }
  };

  const modalViewing = offers.map((o) => {
    const d = driversById[o.driver_id];
    return {
      driverId: o.driver_id,
      name: d?.vehicle_make ? `${d.vehicle_make} ${d.vehicle_model}` : "Driver",
      phone: "+263",
      vehicleType: d?.vehicle_type as "Car" | "Taxi" | "Motorbike" || "Car",
      plateNumber: (d?.plate_number as string) || "—",
      languages: ["English"],
      distanceKm: 0,
      etaMinutes: o.eta_minutes || 10
    };
  });

  const modalOffers = offers.map((o) => {
    const d = driversById[o.driver_id];
    const driverFullName = (d as Record<string, unknown>)?.full_name as string | undefined;
    return {
      driverId: o.driver_id,
      name: d?.vehicle_make ? `${d.vehicle_make} ${d.vehicle_model}` : "Driver",
      phone: "+263",
      vehicleType: d?.vehicle_type as "Car" | "Taxi" | "Motorbike" || "Car",
      plateNumber: (d?.plate_number as string) || "—",
      languages: ["English"],
      distanceKm: 0,
      etaMinutes: o.eta_minutes || 10,
      offerId: o.id,
      offeredFareR: o.price,
      createdAt: o.created_at || new Date().toISOString(),
      driverName: driverFullName || (d?.vehicle_make ? `${d.vehicle_make} Driver` : "Driver"),
      vehicleMake: (d?.vehicle_make as string) || undefined,
      vehicleModel: (d?.vehicle_model as string) || undefined,
      gender: (d?.gender as string) || null,
      avatarUrl: (d?.avatar_url as string) || null,
      ratingAvg: ((d as Record<string, unknown>)?.rating_avg as number) || null,
      totalTrips: ((d as Record<string, unknown>)?.total_trips as number) || null
    };
  });

  const isAccepted = ride ? ["accepted", "enroute", "in_progress", "arrived"].includes(ride.status) : false;
  const isPending = isRequestedRideStatus(ride?.status, ride?.ride_status);
  const isInProgress = ride?.status === "in_progress";
  const isArrived = ride?.status === "arrived" || ride?.status === "driver_arrived";

  const pickupCoords = ride ? { lat: ride.pickup_lat, lng: ride.pickup_lon } : null;
  const dropoffCoords = ride ? { lat: ride.dropoff_lat, lng: ride.dropoff_lon } : null;

  // Distance & ETA calculation
  const tripMetrics = driverLocation && ride ? (() => {
    const R = 6371;
    const targetLat = isInProgress ? ride.dropoff_lat : ride.pickup_lat;
    const targetLng = isInProgress ? ride.dropoff_lon : ride.pickup_lon;
    const dLat = (targetLat - driverLocation.lat) * Math.PI / 180;
    const dLon = (targetLng - driverLocation.lng) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(driverLocation.lat * Math.PI / 180) * Math.cos(targetLat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    const distanceKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const etaMin = Math.max(1, Math.round(distanceKm / 25 * 60));
    return { distanceKm, etaMinutes: etaMin };
  })() : null;

  const etaMinutes = tripMetrics?.etaMinutes ?? null;
  const distanceLeftKm = tripMetrics?.distanceKm ?? null;

  // Compact map-anchored "Arrival" card — PickMe route styling shows the
  // whole route as a single gradient, so the ETA lives beside the relevant
  // pin instead of as a floating overlay.
  const arrivalMapCards = useMemo(() => {
    if (!isAccepted || !ride || etaMinutes === null) return undefined;
    const target = isInProgress ? dropoffCoords : pickupCoords;
    if (!target) return undefined;
    const arrivalTime = new Date(Date.now() + etaMinutes * 60_000);
    const timeLabel = arrivalTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const km = distanceLeftKm !== null ? `${distanceLeftKm.toFixed(1)} km` : undefined;
    return [{ id: 'arrival', at: target, label: 'Arrival', value: timeLabel, subvalue: km }];
  }, [isAccepted, isInProgress, ride, etaMinutes, distanceLeftKm, pickupCoords?.lat, pickupCoords?.lng, dropoffCoords?.lat, dropoffCoords?.lng]);

  // Ultra-compact collapsed content — thin floating bar
  const collapsedContent = (
    <div className="flex items-center justify-between h-8">
      {isAccepted && driverProfile ? (
        <>
          <div className="flex items-center gap-2 min-w-0">
            <Avatar className="h-7 w-7 shrink-0">
              {(driverProfile as Record<string, unknown>).avatar_url ? (
                <AvatarImage src={(driverProfile as Record<string, unknown>).avatar_url as string} alt="Driver" />
              ) : null}
              <AvatarFallback className="text-[10px] font-bold bg-primary/10 text-primary">
                {(driverProfile as Record<string, unknown>).gender === 'female' ? '♀' : '♂'}
              </AvatarFallback>
            </Avatar>
            <span className="font-semibold text-sm text-foreground truncate">
              {String((driverProfile as Record<string, unknown>).plate_number || 'Driver')}
            </span>
            <span className="text-xs text-muted-foreground">•</span>
            <span className="text-xs text-muted-foreground truncate">
              {isInProgress ? "On trip" : isArrived ? "Arrived" : "En route"}
            </span>
          </div>
          <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
        </>
      ) : ride ? (
        <>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
            <span className="font-semibold text-sm text-foreground">
              {isPending ? "Finding drivers…" : ride.status.replace('_', ' ')}
            </span>
            <span className="font-bold text-sm text-foreground">${ride.fare.toFixed(2)}</span>
          </div>
          <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
        </>
      ) : (
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-muted-foreground">Loading…</span>
        </div>
      )}
    </div>
  );

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-background">
      {/* Active Call Overlay */}
      {callStatus !== "idle" && (
        <ActiveCallOverlay
          status={callStatus} duration={callDuration} isMuted={isMuted} isSpeaker={isSpeaker}
          onToggleMute={toggleMute} onToggleSpeaker={toggleSpeaker} onEndCall={endCall} otherUserName="Driver" />
      )}

      {/* Incoming Call Modal */}
      {incomingCall && (
        <IncomingCallModal callerId={incomingCall.callerId} onAnswer={answerCall} onDecline={declineIncomingCall} />
      )}

      {/* ═══ FULL-SCREEN MAP ═══ */}
      <div className="absolute inset-0">
        {pickupCoords && isAccepted ? (
          <TripMapboxMap
            driverLocation={driverLocation}
            pickup={pickupCoords}
            dropoff={dropoffCoords!}
            tripStatus={ride!.status}
            height="100%"
            className="w-full h-full"
            routeGradient
            mapCards={arrivalMapCards}
          />
        ) : pickupCoords ? (
          <MapboxMap
            pickup={pickupCoords}
            dropoff={dropoffCoords!}
            driverLocation={driverLocation}
            drivers={isPending ? nearbyDrivers : undefined}
            routeGeometry={ride?.route_polyline}
            className="w-full h-full"
            height="100%"
          />
        ) : (
          <MapboxMap
            className="w-full h-full"
            height="100%"
            defaultCenter={{ lat: -20.9408, lng: 29.0147 }}
            defaultZoom={13}
          />
        )}
      </div>

      {/* ═══ TOP BAR (floating) ═══ */}
      <div className="absolute top-0 left-0 right-0 z-40 flex items-center justify-between px-4" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 12px)' }}>
        <button onClick={() => nav("/ride")} aria-label="Back" className="w-10 h-10 flex items-center justify-center rounded-full bg-card/90 backdrop-blur-sm shadow-md active:scale-95 transition-transform">
          <ArrowLeft className="w-5 h-5 text-foreground" />
        </button>

        {/* Status pill */}
        <AnimatePresence mode="wait">
          {isArrived && (
            <motion.div
              key="arrived"
              initial={{ y: -20, opacity: 0, scale: 0.9 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: -20, opacity: 0 }}
              className="flex items-center gap-2 bg-accent text-accent-foreground px-4 py-2 rounded-full shadow-md"
            >
              <motion.div animate={{ scale: [1, 1.3, 1] }} transition={{ repeat: Infinity, duration: 1.5 }}>
                <MapPin className="w-4 h-4" />
              </motion.div>
              <span className="text-xs font-bold">Driver arrived!</span>
            </motion.div>
          )}
          {isInProgress && (
            <motion.div
              key="inprogress"
              initial={{ y: -20, opacity: 0, scale: 0.9 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: -20, opacity: 0 }}
              className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-full shadow-md"
            >
              <Navigation className="w-3.5 h-3.5" />
              <span className="text-xs font-bold">
                {etaMinutes ? `${etaMinutes} min to destination` : "On your way"}
              </span>
            </motion.div>
          )}
          {isPending && (
            <motion.div
              key="searching"
              initial={{ y: -20, opacity: 0, scale: 0.9 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: -20, opacity: 0 }}
              className="flex items-center gap-2 bg-card/90 backdrop-blur-sm text-foreground px-4 py-2 rounded-full shadow-md"
            >
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
              >
                <Car className="w-3.5 h-3.5 text-primary" />
              </motion.div>
              <span className="text-xs font-semibold">Finding drivers…</span>
            </motion.div>
          )}
        </AnimatePresence>

        <button
          onClick={() => setSafetyOpen(true)}
          className="flex items-center gap-1.5 h-10 px-4 rounded-full bg-card/90 backdrop-blur-sm shadow-md active:scale-95 transition-transform"
        >
          <LifeBuoy className="w-4 h-4 text-primary" />
          <span className="text-sm font-bold text-foreground">Help</span>
        </button>
      </div>

      {/* ═══ "BOOKED FOR YOU" BANNER ═══ */}
      {ride && ride.passenger_name && ride.user_id !== user?.id && (
        <motion.div
          initial={{ y: -40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="absolute z-30 left-4 right-4 flex items-center gap-3 bg-amber-500 text-white rounded-2xl px-4 py-3 shadow-lg"
          style={{ top: 'calc(env(safe-area-inset-top) + 64px)' }}
        >
          <Users className="w-5 h-5 shrink-0" />
          <div>
            <p className="text-xs font-bold">This ride was booked for you</p>
            <p className="text-[10px] opacity-90">
              Requested by someone on your behalf
            </p>
          </div>
        </motion.div>
      )}

      {/* ═══ DRIVER ACCEPTED YOUR RIDE — 50s confirm popup ═══ */}
      <DriverBidAcceptedModal
        open={showAcceptedOverlay}
        driver={driverProfile ? {
          name: driverName || 'Your Driver',
          avatarUrl: (driverProfile as Record<string, unknown>).avatar_url as string ?? null,
          gender: (driverProfile as Record<string, unknown>).gender as string ?? null,
          ratingAvg: (driverProfile as Record<string, unknown>).rating_avg as number ?? null,
          vehicleMake: driverProfile.vehicle_make,
          vehicleModel: driverProfile.vehicle_model,
          vehicleColor: driverProfile.vehicle_color,
          plateNumber: driverProfile.plate_number,
        } : null}
        fare={ride?.fare ?? 0}
        etaMinutes={etaMinutes}
        onConfirm={() => setShowAcceptedOverlay(false)}
        onDecline={handleDeclineDriver}
      />

      {/* ═══ ON-MAP LIVE TRIP INFO ═══ */}
      {isInProgress && sheetState === 'collapsed' && (
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="absolute left-4 right-4 z-30 bg-card/95 backdrop-blur-sm rounded-2xl px-4 py-3 shadow-lg border border-border/30"
          style={{ bottom: 100 }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center">
                <Navigation className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-lg font-black text-foreground tabular-nums leading-none">{etaMinutes ?? '—'} min</p>
                <p className="text-[10px] text-muted-foreground font-medium">to destination</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-center">
                <p className="text-sm font-bold text-foreground tabular-nums">{distanceLeftKm ? distanceLeftKm.toFixed(1) : '—'}</p>
                <p className="text-[10px] text-muted-foreground font-medium">km left</p>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* ═══ DRAGGABLE BOTTOM SHEET ═══ */}
      <RideBottomSheet
        state={sheetState}
        onStateChange={setSheetState}
        collapsedContent={collapsedContent}
        className="z-40"
      >
        <div className="space-y-4">
          {/* Loading skeleton */}
          {loading && !ride && (
            <div className="space-y-3 animate-fade-in">
              <div className="bg-muted rounded-2xl p-4">
                <div className="flex items-start gap-3">
                  <div className="flex flex-col items-center">
                    <div className="w-3 h-3 rounded-full bg-accent/50 animate-pulse" />
                    <div className="w-0.5 h-6 bg-border/50" />
                    <div className="w-3 h-3 rounded-full bg-primary/50 animate-pulse" />
                  </div>
                  <div className="flex-1 space-y-3">
                    <div className="h-4 bg-muted-foreground/10 rounded w-3/4 animate-pulse" />
                    <div className="h-4 bg-muted-foreground/10 rounded w-2/3 animate-pulse" />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Ride not found */}
          {!loading && !ride && (
            <div className="text-center py-8">
              <p className="text-muted-foreground">Ride not found.</p>
              <Button variant="outline" onClick={() => nav("/ride")} className="mt-3">Back to rides</Button>
            </div>
          )}

          {/* ─── COMPLETED SUMMARY ─── */}
          {ride && ride.status !== "completed" && (
            <PilotReadinessCard
              title="Live ride checklist"
              subtitle="Keep this ready during the pilot trip."
              items={[
                {
                  label: isPending ? "Offers pending" : "Trip connected",
                  detail: isPending ? "Stay in the app while drivers send offers." : "Driver and rider screens are linked to this ride.",
                  done: !isPending || offers.length > 0,
                },
                {
                  label: "Safety tools visible",
                  detail: "Use SOS if the trip feels unsafe or if support must intervene.",
                  done: true,
                },
                {
                  label: ride.payment_method === "cash" ? "Cash handoff ready" : "Payment method ready",
                  detail: ride.payment_method === "cash" ? "Confirm cash amount with the driver before completion." : "Keep cash as backup for the controlled pilot.",
                  done: true,
                },
              ]}
            />
          )}

          {ride?.status === "completed" && (
            <>
              <RideCompleteSummary
                fare={ride.fare}
                distanceKm={ride.distance_km}
                durationMinutes={ride.duration_minutes}
                pickupAddress={ride.pickup_address}
                dropoffAddress={ride.dropoff_address}
                driverName={driverProfile?.vehicle_make ? `${driverProfile.vehicle_make} Driver` : undefined}
                onRate={() => setShowRating(true)}
                onBookAgain={() => nav('/ride', { state: { rebook: { pickup: { name: ride.pickup_address, lat: ride.pickup_lat, lng: ride.pickup_lon }, dropoff: { name: ride.dropoff_address, lat: ride.dropoff_lat, lng: ride.dropoff_lon } } } })}
                onSaveLocation={() => {
                  if (user) {
                    createFavoriteLocation({
                      name: ride.dropoff_address, address: ride.dropoff_address,
                      latitude: ride.dropoff_lat, longitude: ride.dropoff_lon
                    }).then(() => toast.success('Location saved!'));
                  }
                }}
                hasRated={hasRated}
              />
              <div className="flex items-center gap-2 mt-3">
                <TripReceiptButton data={{
                  rideId: ride.id,
                  pickupAddress: ride.pickup_address,
                  dropoffAddress: ride.dropoff_address,
                  fare: ride.fare,
                  distanceKm: ride.distance_km,
                  durationMinutes: ride.duration_minutes,
                  driverName: driverProfile?.vehicle_make ? `${driverProfile.vehicle_make} Driver` : undefined,
                  vehicleInfo: driverProfile ? `${driverProfile.vehicle_make || ''} ${driverProfile.vehicle_model || ''}`.trim() : undefined,
                  plateNumber: driverProfile?.plate_number || undefined,
                  paymentMethod: ride.payment_method,
                  completedAt: ride.updated_at,
                }} />
                <DisputeForm rideId={ride.id} role="rider" />
              </div>
            </>
          )}

          {/* ─── ACTIVE RIDE: DRIVER CARD + ROUTE ─── */}
          {isAccepted && driverProfile && ride && (
            <>
              {/* ─── DRIVER ARRIVED ALERT CARD ─── */}
              {isArrived && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: -10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                  className="rounded-2xl bg-primary text-white p-5 shadow-lg"
                >
                  <div className="flex items-center gap-4">
                    <motion.div
                      animate={{ scale: [1, 1.2, 1] }}
                      transition={{ repeat: Infinity, duration: 1.5 }}
                      className="w-14 h-14 rounded-2xl bg-white/20 flex items-center justify-center shrink-0"
                    >
                      <Car className="w-7 h-7 text-white" />
                    </motion.div>
                    <div className="flex-1 min-w-0">
                      <p className="font-black text-lg leading-tight">🚗 Your driver has arrived</p>
                      <p className="text-sm text-white/90 mt-1">Head to your pickup point now — your driver is waiting.</p>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* ─── IN-PROGRESS LIVE TRIP CARD ─── */}
              {isInProgress && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: -10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                  className="rounded-2xl bg-primary text-white p-5 shadow-lg"
                >
                  <div className="flex items-center gap-3 mb-3">
                    <motion.div
                      animate={{ x: [0, 4, 0] }}
                      transition={{ repeat: Infinity, duration: 1.5, ease: 'easeInOut' }}
                    >
                      <Navigation className="w-5 h-5" />
                    </motion.div>
                    <p className="font-bold text-sm">Trip in Progress</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-white/15 rounded-xl px-3 py-2.5 text-center">
                      <p className="text-2xl font-black tabular-nums leading-none">{etaMinutes ?? '—'}</p>
                      <p className="text-[10px] text-white/80 font-medium mt-1">min ETA</p>
                    </div>
                    <div className="bg-white/15 rounded-xl px-3 py-2.5 text-center">
                      <p className="text-2xl font-black tabular-nums leading-none">{distanceLeftKm ? distanceLeftKm.toFixed(1) : '—'}</p>
                      <p className="text-[10px] text-white/80 font-medium mt-1">km left</p>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* "Your driver is on the way" — the pre-pickup hero moment */}
              {!isArrived && !isInProgress && (
                <p className="text-lg font-extrabold text-foreground">Your driver is on the way</p>
              )}

              {/* Driver info card */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-3"
              >
                <Avatar className="h-14 w-14 shrink-0 ring-2 ring-primary/20">
                  {(driverProfile as Record<string, unknown>).avatar_url ? (
                    <AvatarImage
                      src={(driverProfile as Record<string, unknown>).avatar_url as string}
                      alt="Driver"
                      className="object-cover"
                      loading="eager"
                      decoding="async"
                    />
                  ) : null}
                  <AvatarFallback className={`text-lg font-bold ${(driverProfile as Record<string, unknown>).gender === 'female' ? 'bg-pink-100 text-pink-700' : 'bg-primary/10 text-primary'}`}>
                    {(driverProfile as Record<string, unknown>).gender === 'female' ? '♀' : '♂'}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-bold text-foreground text-base truncate">{driverName || 'Your Driver'}</p>
                    {((driverProfile as Record<string, unknown>).rating_avg as number) > 0 && (
                      <span className="flex items-center gap-0.5 text-xs font-semibold text-muted-foreground shrink-0">
                        <Star className="h-3 w-3 fill-accent text-accent" />
                        {Number((driverProfile as Record<string, unknown>).rating_avg).toFixed(1)}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground truncate">
                    {(driverProfile as Record<string, unknown>).gender === 'female' ? 'Female' : 'Male'}
                    {" • "}
                    {String((driverProfile as Record<string, unknown>).vehicle_make || '')} {String((driverProfile as Record<string, unknown>).vehicle_model || '')}
                  </p>
                  {(driverProfile as Record<string, unknown>).plate_number && (
                    <span className="inline-block mt-1 bg-muted rounded-lg px-2.5 py-1 text-xs font-bold text-foreground">
                      {String((driverProfile as Record<string, unknown>).plate_number)}
                    </span>
                  )}
                </div>
                {driverPhone && (
                  <a
                    href={`tel:${driverPhone}`}
                    aria-label="Call driver"
                    className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 active:scale-90 transition-transform"
                    style={{ background: 'var(--gradient-primary)' }}
                  >
                    <Phone className="h-4.5 w-4.5 text-white" />
                  </a>
                )}
              </motion.div>

              {/* Route summary */}
              <div className="bg-muted/50 rounded-2xl p-4">
                <div className="flex items-start gap-3">
                  <div className="flex flex-col items-center pt-0.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-accent" />
                    <div className="w-0.5 h-8 bg-border" />
                    <div className="w-2.5 h-2.5 rounded-full bg-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-semibold text-muted-foreground">Pickup</p>
                    <p className="text-sm font-medium text-foreground truncate">{ride.pickup_address}</p>
                    <p className="text-[11px] font-semibold text-muted-foreground mt-3">Drop off</p>
                    <p className="text-sm text-muted-foreground truncate">{ride.dropoff_address}</p>
                  </div>
                </div>
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/30">
                  <span className="text-xs text-muted-foreground">{ride.distance_km.toFixed(1)} km • ~{ride.duration_minutes} min</span>
                  <span className="font-bold text-foreground">${ride.fare.toFixed(2)}</span>
                </div>
              </div>

              {/* Quick actions row — Call, Message, Share. Safety lives on the
                  "Help" map button above (SafetySheet), not duplicated here. */}
              {driverPhone && (
                <div className="grid grid-cols-3 gap-2">
                  <a href={`tel:${driverPhone}`} className="flex flex-col items-center gap-1.5 py-3 rounded-2xl border border-border active:scale-95 transition-transform">
                    <Phone className="h-5 w-5 text-foreground" />
                    <span className="text-[11px] font-medium text-foreground">Call</span>
                  </a>
                  <button onClick={() => { setShowCommunication(!showCommunication); setSheetState('half'); }} className="flex flex-col items-center gap-1.5 py-3 rounded-2xl border border-border active:scale-95 transition-transform">
                    <MessageCircle className="h-5 w-5 text-foreground" />
                    <span className="text-[11px] font-medium text-foreground">Message</span>
                  </button>
                  <ShareTripButton rideId={ride.id} pickupAddress={ride.pickup_address} dropoffAddress={ride.dropoff_address} driverName={driverName ?? undefined} variant="square" />
                </div>
              )}

              {/* Payment status indicator */}
              {(ride.status === 'completed' || ride.payment_failed) && (
                <div className="flex justify-center">
                  <PaymentStatusBadge
                    status={ride.status}
                    paymentMethod={ride.payment_method}
                    walletPaid={ride.wallet_paid}
                    paymentFailed={ride.payment_failed}
                    paymentFailureReason={ride.payment_failure_reason}
                    size="md"
                  />
                </div>
              )}

              {/* Wallet Pay Ride (only for wallet payment method) */}
              {ride.payment_method === 'wallet' && ['accepted','in_progress','arrived','completed'].includes(ride.status) && (
                <PayRideButton
                  rideId={ride.id}
                  fare={Number(ride.fare)}
                  walletPaid={!!ride.wallet_paid}
                  onPaid={refreshRide}
                />
              )}

              {/* EcoCash payment */}
              {ride.payment_method !== 'wallet' && (() => {
                const ecocashNum = (driverProfile as Record<string, unknown>)?.ecocash_number as string | undefined;
                const driverName = (driverProfile as Record<string, unknown>)?.vehicle_make
                  ? `${(driverProfile as Record<string, unknown>)?.vehicle_make} Driver`
                  : 'Driver';
                return (
                  <>
                    <Button
                      onClick={() => setShowEcoCashPay(true)}
                      className="w-full h-12 rounded-2xl bg-primary hover:brightness-110 text-primary-foreground font-bold"
                    >
                      💰 Pay ${Number(ride.fare).toFixed(2)} with EcoCash
                    </Button>
                    <EcoCashPaymentModal
                      isOpen={showEcoCashPay}
                      onClose={() => setShowEcoCashPay(false)}
                      amount={Number(ride.fare)}
                      currency="$"
                      driverName={driverName}
                      driverEcoCash={ecocashNum}
                      walletPin={walletPin}
                      onVerifyPin={async (pin) => pin === walletPin}
                      onSetPin={async () => false}
                      onPaymentComplete={() => toast.success('Payment sent to driver!')}
                    />
                  </>
                );
              })()}

              {/* Complete trip */}
              {isInProgress && (
                <Button
                  className="w-full h-12 rounded-2xl font-bold text-base bg-amber-500 hover:bg-amber-600 text-white"
                  onClick={async () => {
                    try {
                      const result = await completeTrip(ride.id);
                      if (result.ok) {
                        toast.success(`Trip completed! Fare: $${Number(result.fare_usd).toFixed(2)}`);
                        setShowRating(true);
                        refreshRide();
                      } else {
                        toast.error(result.reason || "Could not complete trip");
                      }
                    } catch (e: unknown) {
                      toast.error((e as Error)?.message || "Failed to complete trip");
                    }
                  }}
                >
                  ✅ Complete Trip
                </Button>
              )}

              {/* Cancel ride */}
              {!isInProgress && (
                <Button
                  className="w-full h-11 rounded-2xl font-bold text-sm bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                  onClick={handleCancelRide}
                >
                  Cancel Ride
                </Button>
              )}

              {/* Communication panel */}
              {showCommunication && user && (
                <div className="bg-muted/30 rounded-2xl p-3 border border-border/30">
                  <RideCommunication rideId={ride.id} currentUserId={user.id} otherUserPhone={driverPhone} riderId={ride.user_id} />
                </div>
              )}
            </>
          )}

          {/* ─── PENDING: Route + Offers ─── */}
          {ride && ride.status !== "completed" && !isAccepted && (
            <>
              {/* Route card */}
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                <div className="flex items-start gap-3">
                  <div className="flex flex-col items-center pt-0.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-accent" />
                    <div className="w-0.5 h-8 bg-border" />
                    <div className="w-2.5 h-2.5 rounded-full bg-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{ride.pickup_address}</p>
                    <p className="text-sm text-muted-foreground truncate mt-4">{ride.dropoff_address}</p>
                  </div>
                </div>

                {/* Fare adjuster */}
                <div className="flex items-center justify-between mt-4 pt-3 border-t border-border/30">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Your offer</span>
                  {isPending ? (
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="icon" className="h-8 w-8 rounded-xl" onClick={() => updateFare(ride.fare - 5)} disabled={updatingFare || ride.fare <= 10}>
                        <Minus className="h-4 w-4" />
                      </Button>
                      <span className="text-2xl font-black min-w-[60px] text-center text-primary tabular-nums">${ride.fare.toFixed(2)}</span>
                      <Button variant="outline" size="icon" className="h-8 w-8 rounded-xl" onClick={() => updateFare(ride.fare + 5)} disabled={updatingFare}>
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <span className="text-2xl font-black text-primary tabular-nums">${ride.fare.toFixed(2)}</span>
                  )}
                </div>
              </motion.div>

              {/* Searching state */}
              {isPending && (
                <SearchingOverlay
                  secondsLeft={secondsLeft}
                  driversNearby={nearbyDrivers.length}
                  offersCount={offers.length}
                  viewingCount={viewerCount}
                  onCancel={handleCancelRide}
                />
              )}

              {/* Offers button */}
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
                <Button
                  className="w-full h-12 bg-primary hover:bg-primary/90 text-primary-foreground font-bold rounded-2xl"
                  onClick={() => setModalOpen(true)}
                  disabled={offers.length === 0}
                >
                  <Eye className="h-4 w-4 mr-2" />
                  View Offers ({offers.length})
                </Button>
              </motion.div>

              {/* Cancel */}
              {ride.status !== "cancelled" && ride.status !== "expired" && (
                <CancellationPolicy rideId={ride.id} rideStatus={ride.status} onCancelled={() => nav("/ride")} />
              )}
            </>
          )}

          {/* Rate driver button */}
          {ride?.status === "completed" && !hasRated && !showRating && ride.driver_id && user && (
            <Button className="w-full h-12 gap-2 rounded-2xl bg-primary hover:brightness-110 text-primary-foreground font-bold" onClick={() => setShowRating(true)}>
              <Star className="h-4 w-4" /> Rate Your Driver
            </Button>
          )}

          {error && <p className="text-sm text-destructive text-center">{error}</p>}
        </div>
      </RideBottomSheet>

      {/* ═══ MODALS ═══ */}
      {ride && (
        <OffersModal
          isOpen={modalOpen} tripId={ride.id} viewing={modalViewing} offers={modalOffers}
          onAcceptOffer={handleAcceptOffer} onDeclineOffer={handleDeclineOffer}
          onCancelRide={handleCancelRide} onClose={() => setModalOpen(false)} />
      )}

      {showRating && ride?.driver_id && user && (
        <DriverRatingModal
          rideId={ride.id} driverId={ride.driver_id} riderId={user.id}
          driverName={driverProfile ? `${(driverProfile as Record<string, unknown>).vehicle_make || ''} Driver`.trim() : undefined}
          onClose={() => { setShowRating(false); setHasRated(true); }} />
      )}

      {ride && (
        <SafetySheet
          open={safetyOpen}
          onClose={() => setSafetyOpen(false)}
          rideId={ride.id}
          driverName={driverName || 'Your driver'}
          driverAvatarUrl={driverProfile?.avatar_url}
          vehicleLabel={[driverProfile?.vehicle_color, driverProfile?.vehicle_make, driverProfile?.vehicle_model].filter(Boolean).join(' ') || 'Vehicle details pending'}
          plateNumber={driverProfile?.plate_number ?? null}
          startedAt={null}
          pickupAddress={ride.pickup_address}
          dropoffAddress={ride.dropoff_address}
        />
      )}
    </div>
  );
}
