import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { backendPost, cancelRide } from "@/lib/backendClient";
import { resolveAvatarUrl } from "@/lib/avatarUrl";
import { joinRidePresence, countDriversViewing } from "@/lib/koloiRealtime";
import { useAgoraCall } from "@/hooks/useAgoraCall";
import TripGoogleMap from "@/components/TripGoogleMap";
import { useDriverTracking } from "@/hooks/useDriverTracking";
import IncomingCallModal from "@/components/ride/IncomingCallModal";
import ActiveCallOverlay from "@/components/ride/ActiveCallOverlay";
import PremiumOffersSheet from "@/components/ride/PremiumOffersSheet";
import { type PremiumOffer } from "@/components/ride/PremiumOfferCard";
import { ArrowLeft, MessageCircle, Phone, Shield, Star, Car, ChevronDown, ChevronUp, MapPin, Navigation, X, Send, Share2, CheckCircle2 } from "lucide-react";
import { motion } from "framer-motion";
import ShareTripButton from "@/components/ride/ShareTripButton";
import DriverRatingModal from "@/components/ride/DriverRatingModal";
import RideCompleteSummary from "@/components/ride/RideCompleteSummary";
import TripReceiptButton from "@/components/ride/TripReceiptButton";
import DisputeForm from "@/components/ride/DisputeForm";
import TopFlashBanner from "@/components/ui/top-flash-banner";


/** Avatar with automatic fallback to initial when image fails or is missing. */
function DriverAvatar({ url, name, size = 56 }: { url: string | null; name: string; size?: number }) {
  const [errored, setErrored] = useState(false);
  const showImage = !!url && !errored;
  const initial = (name?.trim()?.charAt(0) || "?").toUpperCase();
  return (
    <div
      className="relative rounded-full bg-primary/10 border-2 border-primary/20 overflow-hidden flex items-center justify-center shrink-0"
      style={{ width: size, height: size }}
    >
      {showImage ? (
        <img
          src={url!}
          alt={name}
          className="w-full h-full object-cover"
          loading="eager"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setErrored(true)}
        />
      ) : (
        <span className="text-lg font-bold text-primary">{initial}</span>
      )}
    </div>
  );
}
function SettlementInfo({ tripId, onSettled }: { tripId: string; onSettled?: () => void }) {
  const [settlement, setSettlement] = useState<{ status: string; created_at: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [settling, setSettling] = useState(false);

  useEffect(() => {
    supabase
      .from("platform_ledger")
      .select("status, created_at")
      .eq("trip_id", tripId)
      .maybeSingle()
      .then(({ data }) => {
        setSettlement(data);
        setLoading(false);
        if (data) onSettled?.();
      });
  }, [tripId]);

  const handleSettle = async () => {
    setSettling(true);
    try {
      await backendPost(`/api/rides/${tripId}/settle`);
      const { data } = await supabase.from("platform_ledger").select("status, created_at").eq("trip_id", tripId).maybeSingle();
      setSettlement(data);
      onSettled?.();
    } catch (err: unknown) { console.warn("Settlement fetch failed:", err); }
    setSettling(false);
  };

  if (loading) return <div className="mt-3 h-12 rounded-2xl bg-muted animate-pulse" />;
  if (settlement) {
    return (
      <div className="mt-3 px-4 py-3 bg-primary/10 rounded-2xl text-sm text-primary font-semibold">
        <p>Trip completed ✓</p>
        <p className="text-xs text-muted-foreground mt-0.5">Settled • {new Date(settlement.created_at).toLocaleString()}</p>
      </div>
    );
  }
  return (
    <button onClick={handleSettle} disabled={settling}
      className="mt-3 w-full py-3 rounded-2xl border border-white/30 bg-primary/20 backdrop-blur-xl text-primary font-bold text-sm active:scale-[0.98] transition-all shadow-[0_4px_16px_hsl(var(--primary)/0.2)]">
      {settling ? "Settling..." : "Settle Now"}
    </button>
  );
}

type RideRow = {
  id: string; user_id: string; pickup_address: string | null; dropoff_address: string | null;
  fare: number | null; status: string | null; pickup_lat?: number | null; pickup_lon?: number | null;
  dropoff_lat?: number | null; dropoff_lon?: number | null; driver_id?: string | null;
  distance_km?: number | null; duration_minutes?: number | null; payment_method?: string | null;
};
type OfferRow = {
  id: string; ride_id: string; driver_id: string; price: number;
  eta_minutes: number | null; message: string | null; status: string | null; created_at?: string | null;
};
type MessageRow = { id: string; ride_id: string; sender_id: string; text: string; created_at?: string | null; };
type DriverProfile = {
  fullName: string;
  phone: string | null;
  avatarUrl: string | null;
  ratingAvg: number;
  totalTrips: number;
  vehicleMake: string | null;
  vehicleModel: string | null;
  plateNumber: string | null;
  carColor: string;
  etaMinutes: number | null;
};

function msLeftFromCreatedAt(created_at?: string | null, windowMs = 60_000) {
  if (!created_at) return 0;
  const t = new Date(created_at).getTime();
  return Math.max(0, windowMs - (Date.now() - t));
}

export default function RideDetail() {
  const { rideId } = useParams();
  const nav = useNavigate();
  const [userId, setUserId] = useState("");
  const [ride, setRide] = useState<RideRow | null>(null);
  const [offers, setOffers] = useState<OfferRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [driversViewing, setDriversViewing] = useState(0);
  const [acceptingOfferId, setAcceptingOfferId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [msgText, setMsgText] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [showOffersModal, setShowOffersModal] = useState(false);
  const [premiumOffers, setPremiumOffers] = useState<PremiumOffer[]>([]);
  const [driverUserIdForTracking, setDriverUserIdForTracking] = useState<string | null>(null);
  const [driverProfile, setDriverProfile] = useState<DriverProfile | null>(null);
  const [showRatingModal, setShowRatingModal] = useState(false);
  const [hasRated, setHasRated] = useState(false);

  useEffect(() => {
    if (!ride?.driver_id) { setDriverUserIdForTracking(null); return; }
    (async () => {
      const { data } = await supabase.from("drivers").select("user_id").eq("id", ride.driver_id!).maybeSingle();
      if (data) setDriverUserIdForTracking(data.user_id);
    })();
  }, [ride?.driver_id]);

  useEffect(() => {
    if (!ride?.driver_id) { setDriverProfile(null); return; }
    (async () => {
      const { data: d } = await supabase
        .from("drivers")
        .select("user_id, vehicle_make, vehicle_model, vehicle_color, plate_number, rating_avg, total_trips, avatar_url")
        .eq("id", ride.driver_id)
        .maybeSingle();
      if (!d) return;
      const { data: p } = await supabase
        .from("profiles")
        .select("full_name, phone")
        .eq("user_id", d.user_id)
        .maybeSingle();

      const acceptedOffer = offers.find((o) => o.driver_id === d.user_id);
      const resolvedAvatar = await resolveAvatarUrl(d.avatar_url);
      setDriverProfile({
        fullName: p?.full_name || "Your driver",
        phone: p?.phone || null,
        avatarUrl: resolvedAvatar,
        ratingAvg: Number(d.rating_avg || 0),
        totalTrips: Number(d.total_trips || 0),
        vehicleMake: d.vehicle_make || null,
        vehicleModel: d.vehicle_model || null,
        plateNumber: d.plate_number || null,
        carColor: d.vehicle_color || "Not listed",
        etaMinutes: acceptedOffer?.eta_minutes ?? null,
      });
    })();
  }, [ride?.driver_id, offers]);

  const driverLocation = useDriverTracking(driverUserIdForTracking, ride?.status ?? null);
  const accepted = useMemo(() => !!ride?.driver_id, [ride]);

  const { callStatus, isMuted, isSpeaker, callDuration, incomingCall, startCall, answerCall,
    declineCall: declineIncomingCall, endCall, toggleMute, toggleSpeaker
  } = useAgoraCall({ rideId: rideId ?? null, currentUserId: userId, otherUserId: driverUserIdForTracking });

  useEffect(() => { (async () => { const { data } = await supabase.auth.getUser(); if (data?.user) setUserId(data.user.id); })(); }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const load = useCallback(async (silent = false) => {
    if (!rideId) return;
    if (!silent) setLoading(true);
    try {
      const { data: r, error: rErr } = await supabase.from("rides").select("*").eq("id", rideId).single();
      if (rErr) throw new Error(rErr.message);
      setRide(r as RideRow);
      const { data: o } = await supabase.from("offers").select("*").eq("ride_id", rideId).order("created_at", { ascending: false });
      const rawOffers = o as OfferRow[] || [];
      setOffers(rawOffers);

      const pendingRaw = rawOffers.filter((off) => off.status === "pending");
      if (pendingRaw.length > 0) {
        const driverIds = pendingRaw.map((off) => off.driver_id);
        const [driversRes, profilesRes] = await Promise.all([
          supabase.from("drivers").select("user_id, vehicle_make, vehicle_model, plate_number, rating_avg, total_trips, gender, avatar_url").in("user_id", driverIds),
          supabase.from("profiles").select("user_id, full_name").in("user_id", driverIds)
        ]);
        const driverMap: Record<string, typeof driversRes.data extends (infer T)[] ? T : never> = {};
        for (const d of driversRes.data ?? []) driverMap[d.user_id] = d;
        const profileMap: Record<string, string> = {};
        for (const p of profilesRes.data ?? []) if (p.full_name) profileMap[p.user_id] = p.full_name;

        const OFFER_WINDOW_MS = 60_000;
        const premium: PremiumOffer[] = await Promise.all(pendingRaw.map(async (off) => {
          const d = driverMap[off.driver_id];
          const createdMs = off.created_at ? new Date(off.created_at).getTime() : Date.now();
          const resolvedOfferAvatar = await resolveAvatarUrl(d?.avatar_url ?? null);
          return {
            offerId: off.id, driverId: off.driver_id,
            driverName: profileMap[off.driver_id] || 'Driver',
            avatarUrl: resolvedOfferAvatar,
            ratingAvg: Number(d?.rating_avg ?? 0),
            totalTrips: Number(d?.total_trips ?? 0),
            carModel: d ? `${d.vehicle_make || ''} ${d.vehicle_model || ''}`.trim() || 'Vehicle' : 'Vehicle',
            carColor: (d as any)?.vehicle_color ?? null,
            plateNumber: d?.plate_number || '—',
            etaMinutes: off.eta_minutes ?? 5,
            fare: off.price,
            gender: d?.gender ?? null,
            acceptedAt: createdMs,
            expiresAt: createdMs + OFFER_WINDOW_MS
          };
        }));
        setPremiumOffers(premium);
      } else {
        setPremiumOffers([]);
      }

      const { data: m } = await supabase.from("messages").select("*").eq("ride_id", rideId).order("created_at", { ascending: true });
      setMessages(m as MessageRow[] || []);
    } catch (e: unknown) { setToast((e as Error)?.message || "Failed to load ride."); } finally { setLoading(false); }
  }, [rideId]);

  useEffect(() => { load(false); }, [load]);

  useEffect(() => {
    if (!rideId) return;
    const ch = supabase
      .channel(`db:ride:${rideId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "offers", filter: `ride_id=eq.${rideId}` }, () => load(true))
      .on("postgres_changes", { event: "*", schema: "public", table: "rides", filter: `id=eq.${rideId}` }, () => load(true))
      .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `ride_id=eq.${rideId}` }, () => load(true))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [rideId, load]);

  useEffect(() => {
    if (!rideId) return;
    let pres: import("@supabase/supabase-js").RealtimeChannel | null = null;
    (async () => {
      pres = await joinRidePresence(rideId, { role: "rider", name: "rider" });
      pres.on("presence", { event: "sync" }, () => {
        const state = pres!.presenceState() as Record<string, unknown[]>;
        setDriversViewing(countDriversViewing(state));
      });
    })();
    return () => { if (pres) supabase.removeChannel(pres); };
  }, [rideId]);

  const canAcceptNow = (offer: OfferRow) => msLeftFromCreatedAt(offer.created_at, 60_000) > 0 && offer.status === "pending" && !accepted;

  const acceptOffer = async (offer: OfferRow) => {
    if (!ride || !rideId || !canAcceptNow(offer)) { setToast("This offer expired."); return; }
    setAcceptingOfferId(offer.id);
    try {
      await backendPost(`/api/rides/${rideId}/offers/${offer.id}/accept`);
      setToast("Driver accepted ✅");
      setShowOffersModal(false);
    } catch (e: unknown) { setToast((e as Error)?.message || "Failed to accept offer."); } finally { setAcceptingOfferId(null); }
  };

  const sendMessage = async () => {
    if (!rideId || !msgText.trim()) return;
    try {
      const { error } = await supabase.from("messages").insert({ ride_id: rideId, sender_id: userId, text: msgText.trim() });
      if (error) throw new Error(error.message);
      setMsgText("");
    } catch (e: unknown) { setToast((e as Error)?.message || "Message failed."); }
  };

  const sendQuickReply = async (text: string) => {
    if (!rideId || !text.trim()) return;
    try {
      const { error } = await supabase.from("messages").insert({ ride_id: rideId, sender_id: userId, text: text.trim() });
      if (error) throw new Error(error.message);
    } catch (e: unknown) { setToast((e as Error)?.message || "Message failed."); }
  };

  const pendingOfferCount = premiumOffers.filter((o) => o.expiresAt > Date.now()).length;
  const prevOfferCountRef = useRef(pendingOfferCount);

  useEffect(() => {
    if (pendingOfferCount > prevOfferCountRef.current) {
      import('@/lib/notificationSounds').then(({ playNotificationSound }) => {
        playNotificationSound('offerReceived');
      });
    }
    prevOfferCountRef.current = pendingOfferCount;
  }, [pendingOfferCount]);

  // Auto-show rating modal on completion
  const rideStatusForHook = ride?.status ?? "pending";
  const isCompletedForHook = rideStatusForHook === "completed";
  useEffect(() => {
    if (isCompletedForHook && !hasRated && driverProfile) {
      const timer = setTimeout(() => setShowRatingModal(true), 800);
      return () => clearTimeout(timer);
    }
  }, [isCompletedForHook, hasRated, driverProfile]);

  // ── Driver-arrived flashing top banner ──
  const [arrivedBannerOpen, setArrivedBannerOpen] = useState(false);
  const prevStatusRef = useRef<string | null>(null);
  useEffect(() => {
    const current = ride?.status ?? null;
    const prev = prevStatusRef.current;
    if (prev && prev !== current && (current === "arrived" || current === "driver_arrived")) {
      // Throttle: don't fire more than once per ride within 30s
      import("@/lib/notifyThrottle").then(({ shouldFireOnce }) => {
        if (!shouldFireOnce(`ride:${rideId ?? "?"}`, "arrived", 30_000)) return;
        setArrivedBannerOpen(true);
        // Configurable arrived sound
        import("@/lib/arrivedSoundPrefs")
          .then(({ playConfiguredArrivedSound }) => playConfiguredArrivedSound())
          .catch(() => {});
        // Vibration
        if (typeof navigator !== "undefined" && "vibrate" in navigator) {
          try { navigator.vibrate?.([220, 90, 220, 90, 220]); } catch { /* noop */ }
        }
      });
    }
    prevStatusRef.current = current;
  }, [ride?.status, rideId]);

  const handleImComing = useCallback(async () => {
    if (!rideId) return;
    try {
      const { broadcastRiderComing } = await import("@/lib/rideSignals");
      await broadcastRiderComing(rideId, { riderName: "Rider", etaSeconds: 60 });
      setToast("✓ Driver notified — they'll wait for you");
    } catch (e) {
      console.warn("[RideDetail] failed to notify driver", e);
      setToast("Couldn't notify driver. Try again.");
    }
  }, [rideId]);

  if (loading || !ride) {
    return (
      <div className="relative h-[100dvh] w-full overflow-hidden bg-background">
        {/* Animated map placeholder */}
        <div className="absolute inset-0 bg-gradient-to-b from-muted/40 via-muted/20 to-background">
          {/* Animated road lines */}
          <div className="absolute inset-0 overflow-hidden opacity-20">
            {[...Array(5)].map((_, i) => (
              <div
                key={i}
                className="absolute h-px bg-primary/40"
                style={{
                  top: `${20 + i * 15}%`,
                  left: 0,
                  right: 0,
                  animation: `shimmer ${2 + i * 0.3}s ease-in-out infinite`,
                  animationDelay: `${i * 0.2}s`,
                }}
              />
            ))}
          </div>
          {/* Pulsing car icon */}
          <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-3">
            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-primary/20 animate-ping" style={{ animationDuration: '2s' }} />
              <div className="relative w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
                <Car className="w-7 h-7 text-primary animate-bounce" style={{ animationDuration: '2s' }} />
              </div>
            </div>
          </div>
        </div>

        {/* Back button */}
        <div className="absolute top-0 left-0 right-0 z-40 px-4 flex items-center" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 12px)' }}>
          <button onClick={() => nav("/ride")} className="w-11 h-11 flex items-center justify-center rounded-full bg-card shadow-md active:scale-95 transition-all">
            <ArrowLeft className="w-5 h-5 text-foreground" />
          </button>
        </div>

        {/* Bottom panel */}
        <div className="absolute bottom-0 left-0 right-0 z-50 bg-card rounded-t-3xl shadow-[0_-8px_40px_rgba(0,0,0,0.12)]"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 8px)' }}>
          <div className="flex justify-center pt-3 pb-2"><div className="w-10 h-1 rounded-full bg-border" /></div>
          <div className="px-5 pb-5 space-y-4">
            {loading ? (
              <>
                {/* Live status indicator */}
                <div className="flex items-center gap-3">
                  <div className="relative flex items-center justify-center">
                    <div className="w-3 h-3 rounded-full bg-primary animate-pulse" />
                    <div className="absolute w-3 h-3 rounded-full bg-primary/50 animate-ping" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-foreground">Loading your ride</p>
                    <p className="text-xs text-muted-foreground">Getting the latest details…</p>
                  </div>
                </div>

                {/* Pickup/Dropoff skeleton with route line */}
                <div className="flex gap-3">
                  <div className="flex flex-col items-center pt-1">
                    <div className="w-3 h-3 rounded-full border-2 border-primary bg-card" />
                    <div className="w-0.5 flex-1 bg-gradient-to-b from-primary/40 to-accent/40 my-1 rounded-full min-h-[24px]" />
                    <div className="w-3 h-3 rounded-full border-2 border-accent bg-card" />
                  </div>
                  <div className="flex-1 space-y-3">
                    <div className="space-y-1.5">
                      <div className="h-3 w-16 rounded bg-muted animate-pulse" />
                      <div className="h-5 w-3/4 rounded-lg bg-muted animate-pulse" />
                    </div>
                    <div className="space-y-1.5">
                      <div className="h-3 w-16 rounded bg-muted animate-pulse" />
                      <div className="h-5 w-2/3 rounded-lg bg-muted animate-pulse" />
                    </div>
                  </div>
                </div>

                {/* Fare skeleton */}
                <div className="flex items-center justify-between px-4 py-3 rounded-2xl bg-muted/50">
                  <div className="h-4 w-20 rounded bg-muted animate-pulse" />
                  <div className="h-6 w-16 rounded-lg bg-muted animate-pulse" />
                </div>
              </>
            ) : (
              <div className="text-center py-6 space-y-3">
                <div className="w-14 h-14 rounded-full bg-muted/60 flex items-center justify-center mx-auto">
                  <Car className="w-6 h-6 text-muted-foreground" />
                </div>
                <p className="text-base font-semibold text-foreground">Ride not found</p>
                <p className="text-sm text-muted-foreground">This trip may no longer be available.</p>
                <button onClick={() => nav("/ride")} className="w-full py-3 rounded-2xl bg-primary text-primary-foreground font-semibold active:scale-[0.98] transition-all">
                  Back to rides
                </button>
              </div>
            )}
          </div>
        </div>

        <style>{`
          @keyframes shimmer {
            0%, 100% { opacity: 0.1; transform: scaleX(0.8); }
            50% { opacity: 0.3; transform: scaleX(1); }
          }
        `}</style>
      </div>
    );
  }

  const rideStatus = ride.status ?? "pending";
  const isSearching = rideStatus === "pending" || rideStatus === "searching";
  const isActive = ["accepted", "enroute_pickup", "driver_arriving", "driver_arrived", "arrived", "in_progress", "near_destination"].includes(rideStatus);
  const isCompleted = rideStatus === "completed";
  const isCancelled = rideStatus === "cancelled";
  const isDriverArrived = rideStatus === "driver_arrived" || rideStatus === "arrived";
  const statusConfig: Record<string, { label: string; color: string; icon: string }> = {
    pending: { label: "Looking for drivers", color: "bg-yellow-500", icon: "🔍" },
    searching: { label: "Looking for drivers", color: "bg-yellow-500", icon: "🔍" },
    accepted: { label: "Driver accepted", color: "bg-primary", icon: "✓" },
    enroute_pickup: { label: "Driver on the way", color: "bg-primary", icon: "🚗" },
    driver_arriving: { label: "Driver on the way", color: "bg-primary", icon: "🚗" },
    driver_arrived: { label: "Driver has arrived", color: "bg-green-500", icon: "📍" },
    arrived: { label: "Driver has arrived", color: "bg-green-500", icon: "📍" },
    in_progress: { label: "Trip in progress", color: "bg-primary", icon: "🛣️" },
    near_destination: { label: "Almost there", color: "bg-primary", icon: "🏁" },
    completed: { label: "Trip completed", color: "bg-primary", icon: "✅" },
    cancelled: { label: "Trip cancelled", color: "bg-destructive", icon: "✕" },
  };

  const status = statusConfig[rideStatus] || { label: rideStatus, color: "bg-muted", icon: "•" };

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-background">
      {/* Call overlays */}
      {callStatus !== "idle" &&
        <ActiveCallOverlay status={callStatus} duration={callDuration} isMuted={isMuted} isSpeaker={isSpeaker}
          onToggleMute={toggleMute} onToggleSpeaker={toggleSpeaker} onEndCall={endCall} otherUserName="Rider" />
      }
      {incomingCall && <IncomingCallModal callerId={incomingCall.callerId} onAnswer={answerCall} onDecline={declineIncomingCall} />}

      {/* ── Driver Arrived — flashing top banner (10s) ── */}
      <TopFlashBanner
        open={arrivedBannerOpen}
        onClose={() => setArrivedBannerOpen(false)}
        durationMs={10_000}
        tone="success"
        icon={<CheckCircle2 className="w-7 h-7" />}
        title={`${driverProfile?.fullName ?? "Your driver"} is outside`}
        subtitle={
          driverProfile?.plateNumber
            ? `Look for ${driverProfile.vehicleMake ?? ""} ${driverProfile.vehicleModel ?? ""} · ${driverProfile.plateNumber}`.trim()
            : "Please head to the pickup point now"
        }
        trailing={
          <div className="flex flex-col items-center justify-center px-2.5 py-1.5 rounded-xl bg-white/20 min-w-[58px]">
            <span className="text-base font-extrabold leading-none">~1</span>
            <span className="text-[9px] font-bold tracking-wider mt-0.5 opacity-90">MIN</span>
          </div>
        }
        actionLabel="I'm coming"
        onAction={handleImComing}
      />


      {/* Map — takes top portion */}
      <div className="absolute inset-0 bottom-0">
        {ride.pickup_lat != null && ride.pickup_lon != null && ride.dropoff_lat != null && ride.dropoff_lon != null ? (
          <TripGoogleMap
            pickup={{ lat: ride.pickup_lat, lng: ride.pickup_lon! }}
            dropoff={{ lat: ride.dropoff_lat, lng: ride.dropoff_lon! }}
            driverLocation={driverLocation}
            tripStatus={ride.status ?? "pending"}
            height="100%" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-muted/30">
            <p className="text-sm font-medium text-muted-foreground">Map unavailable</p>
          </div>
        )}
      </div>

      {/* Back button */}
      <div className="absolute top-0 left-0 right-0 z-40 px-4 flex items-center justify-between" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 12px)' }}>
        <button onClick={() => nav("/ride")} className="w-11 h-11 flex items-center justify-center rounded-full bg-card shadow-md active:scale-95 transition-all">
          <ArrowLeft className="w-5 h-5 text-foreground" />
        </button>
        {accepted && (
          <button onClick={() => setChatOpen(v => !v)} className="w-11 h-11 flex items-center justify-center rounded-full bg-card shadow-md active:scale-95 transition-all relative">
            <MessageCircle className="w-5 h-5 text-foreground" />
            {messages.length > 0 && (
              <span className="absolute -top-1 -right-1 w-5 h-5 bg-primary rounded-full text-[10px] text-primary-foreground font-bold flex items-center justify-center">
                {messages.length}
              </span>
            )}
          </button>
        )}
      </div>

      {/* ── Bottom Panel — Premium Redesign ── */}
      <div className="absolute bottom-0 left-0 right-0 z-50 bg-card shadow-[0_-8px_40px_rgba(0,0,0,0.15)]"
        style={{ borderRadius: '28px 28px 0 0', paddingBottom: 'calc(env(safe-area-inset-bottom) + 8px)' }}>

        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1.5 rounded-full bg-border/60" />
        </div>

        <div className="px-5 pb-4 space-y-3 max-h-[50vh] overflow-y-auto">

          {/* ── Status Banner ── */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className={`w-3.5 h-3.5 rounded-full ${status.color} ${isSearching ? 'animate-pulse' : ''}`} />
                {isSearching && <div className={`absolute inset-0 rounded-full ${status.color} animate-ping opacity-40`} />}
              </div>
              <div>
                <p className="text-base font-bold text-foreground">{status.label}</p>
                {isSearching && (
                  <p className="text-xs text-muted-foreground">We're matching you with the best driver</p>
                )}
              </div>
            </div>
            <div className="text-right">
              <p className="text-xl font-extrabold text-foreground">${Number(ride.fare ?? 0).toFixed(2)}</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
                {ride.payment_method === 'wallet' ? 'Wallet' : ride.payment_method === 'ecocash' ? 'EcoCash' : 'Cash'}
              </p>
            </div>
          </div>

          {/* ── Drivers Viewing — stylish live counter ── */}
          {isSearching && driversViewing > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-primary/10 border border-primary/20"
            >
              <div className="relative flex items-center">
                {/* Stacked avatar circles */}
                {[...Array(Math.min(driversViewing, 3))].map((_, i) => (
                  <div key={i} className="w-8 h-8 rounded-full bg-primary/20 border-2 border-card flex items-center justify-center -ml-2 first:ml-0" style={{ zIndex: 3 - i }}>
                    <Car className="w-3.5 h-3.5 text-primary" />
                  </div>
                ))}
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold text-primary">
                  {driversViewing} {driversViewing === 1 ? 'driver' : 'drivers'} viewing your request
                </p>
                <p className="text-[11px] text-muted-foreground">Expect offers shortly</p>
              </div>
              <div className="relative">
                <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
                <div className="absolute inset-0 w-2.5 h-2.5 rounded-full bg-green-500 animate-ping opacity-60" />
              </div>
            </motion.div>
          )}

          {isSearching && driversViewing === 0 && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-muted/50">
              <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                <Car className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-muted-foreground">Searching for nearby drivers…</p>
                <div className="mt-1.5 h-1 rounded-full bg-muted overflow-hidden">
                  <motion.div
                    className="h-full bg-primary/40 rounded-full"
                    animate={{ x: ['-100%', '100%'] }}
                    transition={{ repeat: Infinity, duration: 1.5, ease: 'easeInOut' }}
                    style={{ width: '40%' }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* ── Route Card ── */}
          <div className="flex items-start gap-3 px-4 py-3 rounded-2xl bg-muted/40">
            <div className="flex flex-col items-center gap-0.5 pt-1">
              <div className="w-3 h-3 rounded-full border-2 border-primary bg-card" />
              <div className="w-0.5 flex-1 bg-gradient-to-b from-primary/50 to-accent/50 min-h-[20px] rounded-full" />
              <div className="w-3 h-3 rounded-full border-2 border-accent bg-card" />
            </div>
            <div className="flex-1 min-w-0 space-y-2">
              <div>
                <p className="text-[10px] font-bold text-primary uppercase tracking-widest">Pickup</p>
                <p className="text-sm font-semibold text-foreground truncate">{ride.pickup_address ?? "My location"}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-accent-foreground uppercase tracking-widest">Dropoff</p>
                <p className="text-sm font-semibold text-foreground truncate">{ride.dropoff_address ?? "—"}</p>
              </div>
            </div>
            {ride.distance_km != null && (
              <div className="shrink-0 self-center flex flex-col items-center justify-center px-2.5 py-1.5 rounded-xl bg-primary/10 min-w-[52px]">
                <p className="text-base font-extrabold text-primary leading-none">{Number(ride.distance_km).toFixed(1)}</p>
                <p className="text-[9px] text-primary/70 font-bold tracking-wider mt-0.5">KM</p>
              </div>
            )}
          </div>

          {/* ── Driver Info Card (when accepted) ── */}
          {driverProfile && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-muted/40">
              <DriverAvatar url={driverProfile.avatarUrl} name={driverProfile.fullName} size={56} />
              <div className="flex-1 min-w-0">
                <p className="text-base font-bold text-foreground truncate">{driverProfile.fullName}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <Star className="w-3.5 h-3.5 text-yellow-500 fill-yellow-500" />
                  <span className="text-sm font-semibold text-foreground">{driverProfile.ratingAvg.toFixed(1)}</span>
                  <span className="text-xs text-muted-foreground">· {driverProfile.totalTrips} trips</span>
                </div>
                {driverProfile.vehicleMake && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {driverProfile.vehicleMake} {driverProfile.vehicleModel} · {driverProfile.plateNumber}
                  </p>
                )}
                {driverProfile.carColor && driverProfile.carColor !== "Not listed" && (
                  <div className="flex items-center gap-1.5 mt-1">
                    <div className="w-3 h-3 rounded-full border border-border/50" style={{ backgroundColor: driverProfile.carColor.toLowerCase() }} />
                    <span className="text-xs text-muted-foreground capitalize">{driverProfile.carColor}</span>
                  </div>
                )}
              </div>
              {driverProfile.etaMinutes != null && (
                <div className="text-center shrink-0">
                  <p className="text-xl font-extrabold text-primary">{driverProfile.etaMinutes}</p>
                  <p className="text-[10px] text-muted-foreground font-semibold">MIN</p>
                </div>
              )}
            </div>
          )}

          {/* ── Action buttons ── */}
          {driverProfile && (
            <div className="flex items-center gap-2">
              <button onClick={startCall} disabled={callStatus !== "idle"}
                className="flex-1 h-11 rounded-2xl bg-primary text-primary-foreground font-bold text-sm inline-flex items-center justify-center gap-2 active:scale-[0.97] transition-all disabled:opacity-50 shadow-[0_4px_12px_hsl(var(--primary)/0.25)]">
                <Phone className="w-4 h-4" /> Call Driver
              </button>
              <button onClick={() => setChatOpen(v => !v)}
                className="flex-1 h-11 rounded-2xl bg-muted text-foreground font-bold text-sm inline-flex items-center justify-center gap-2 active:scale-[0.97] transition-all">
                <MessageCircle className="w-4 h-4" /> Message
              </button>
              {rideId && ride.pickup_address && ride.dropoff_address && (
                <ShareTripButton
                  rideId={rideId}
                  pickupAddress={ride.pickup_address}
                  dropoffAddress={ride.dropoff_address}
                  driverName={driverProfile.fullName}
                />
              )}
            </div>
          )}

          {/* Settlement for completed trips */}
          {isCompleted && <SettlementInfo tripId={ride.id} onSettled={() => setTimeout(() => nav('/app'), 2000)} />}
          {isCompleted && (
            <div className="flex items-center gap-2 mt-1">
              <TripReceiptButton data={{
                rideId: ride.id,
                pickupAddress: ride.pickup_address,
                dropoffAddress: ride.dropoff_address,
                fare: ride.fare,
                distanceKm: ride.distance_km,
                durationMinutes: ride.duration_minutes,
                paymentMethod: ride.payment_method,
              }} />
              <DisputeForm rideId={ride.id} role="driver" />
            </div>
          )}

          {/* ── View Offers button — premium ── */}
          {!accepted && (
            <motion.button
              onClick={() => setShowOffersModal(true)}
              whileTap={{ scale: 0.97 }}
              className={`relative w-full h-14 rounded-2xl bg-primary text-primary-foreground font-bold text-lg inline-flex items-center justify-center gap-2 shadow-[0_6px_24px_hsl(var(--primary)/0.3)] transition-all ${pendingOfferCount > 0 ? 'animate-[pulse_2s_cubic-bezier(0.4,0,0.6,1)_infinite]' : ''}`}>
              <Car className="w-5 h-5" />
              View Offers
              {pendingOfferCount > 0 && (
                <motion.span
                  key={pendingOfferCount}
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="absolute -top-2.5 -right-2.5 min-w-6 h-6 px-2 rounded-full bg-destructive text-white text-xs font-bold flex items-center justify-center shadow-lg border-2 border-card">
                  {pendingOfferCount}
                </motion.span>
              )}
            </motion.button>
          )}

          {/* ── Cancel Ride button — clearly visible ── */}
          {(isSearching || isActive) && (
            <button
              onClick={async () => {
                if (!rideId) return;
                if (!window.confirm("Cancel this ride request?")) return;
                await cancelRide(rideId);
                nav("/ride");
              }}
              className="w-full h-12 rounded-2xl border-2 border-destructive/30 bg-destructive/10 text-destructive font-bold text-sm inline-flex items-center justify-center gap-2 active:scale-[0.97] transition-all hover:bg-destructive/20">
              <X className="w-4 h-4" />
              Cancel Ride
            </button>
          )}

          {/* Chat panel — inline expand */}
          {accepted && chatOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="rounded-2xl border border-border bg-card p-4 space-y-3"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-base text-foreground">Messages</h3>
                <button onClick={() => setChatOpen(false)} className="w-8 h-8 rounded-full bg-muted flex items-center justify-center active:scale-95 transition-all">
                  <X className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>

              {/* Quick replies */}
              <div className="flex flex-wrap gap-2">
                {["I'm here", "On my way", "Call me", "Okay 👍"].map((q) => (
                  <button key={q} onClick={() => sendQuickReply(q)}
                    className="px-3 py-2 rounded-full text-xs font-semibold bg-muted text-foreground active:scale-95 transition-all hover:bg-muted/80">
                    {q}
                  </button>
                ))}
              </div>

              {/* Messages list */}
              <div className="h-44 overflow-y-auto space-y-2 bg-muted/30 rounded-xl p-3">
                {messages.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">No messages yet</p>
                ) : (
                  messages.map((m) => (
                    <div key={m.id} className={`flex ${m.sender_id === userId ? "justify-start" : "justify-end"}`}>
                      <div className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 ${
                        m.sender_id === userId
                          ? "bg-primary text-primary-foreground rounded-bl-sm"
                          : "bg-accent text-accent-foreground rounded-br-sm"
                      }`}>
                        <p className="text-sm">{m.text}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Input */}
              <div className="flex gap-2">
                <input type="text" value={msgText} onChange={(e) => setMsgText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                  placeholder="Type a message…"
                  className="flex-1 px-4 py-3 rounded-xl bg-muted border-0 outline-none focus:ring-2 focus:ring-primary/30 text-foreground text-sm" />
                <button onClick={sendMessage} disabled={!msgText.trim()}
                  className="w-12 h-12 rounded-xl bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-40 active:scale-95 transition-all shadow-md">
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          )}
        </div>
      </div>

      {/* Premium Offers Sheet */}
      <PremiumOffersSheet
        isOpen={showOffersModal}
        offers={premiumOffers}
        riderFare={Number(ride.fare ?? 0)}
        onAccept={async (offerId) => {
          const offer = offers.find((o) => o.id === offerId);
          if (offer) await acceptOffer(offer);
        }}
        onDecline={async (offerId) => {
          await backendPost(`/api/offers/${encodeURIComponent(offerId)}/decline`);
          setPremiumOffers((prev) => prev.filter((o) => o.offerId !== offerId));
        }}
        onCancel={async () => {
          if (rideId) await cancelRide(rideId);
          nav("/ride");
        }}
        onClose={() => setShowOffersModal(false)} />

      {/* Driver Rating Modal */}
      {showRatingModal && rideId && ride.driver_id && (
        <DriverRatingModal
          rideId={rideId}
          driverId={ride.driver_id}
          riderId={userId}
          driverName={driverProfile?.fullName}
          driverAvatar={driverProfile?.avatarUrl ?? undefined}
          fare={Number(ride.fare ?? 0)}
          onClose={() => {
            setShowRatingModal(false);
            setHasRated(true);
          }}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-24 left-4 right-4 z-[9999] p-4 rounded-2xl bg-card border border-border shadow-lg text-sm font-medium text-foreground text-center">
          {toast}
        </div>
      )}
    </div>
  );
}
