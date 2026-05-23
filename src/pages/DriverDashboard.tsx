import { useEffect, useState, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/hooks/useAuth";
import { useFemaleTheme } from "@/hooks/useFemaleTheme";
import { useOpenRidesRealtime } from "@/hooks/useRideRealtime";
import {
  fetchOpenRides,
  getDriverProfile,
  submitOffer,
  clampTo5,
  isNightLocal,
  defaultNightMultiplier,
  type DriverProfile,
} from "@/lib/offerHelpers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  ArrowLeft,
  MapPin,
  Navigation,
  Minus,
  Plus,
  Send,
  Radio,
  Bell,
  Volume2,
  History,
  Wallet,
  CheckCircle2,
  Clock,
  AlertTriangle,
  MessageCircle,
  Star,
  TrendingUp,
  Zap,
  BarChart3,
  CreditCard,
  Phone,
  PhoneCall,
} from "lucide-react";
import { playAlert, vibrateAlert, showBrowserNotification } from "@/lib/alerts";
import { playAcceptedSound, playNewRequestSound } from "@/lib/notificationSounds";
import { updateDriverLocation } from "@/lib/driverLocation";
import { useVoiceNavigation } from "@/hooks/useVoiceNavigation";
import { filterActiveRides, getSecondsRemaining, expireOldRides } from "@/lib/rideExpiry";
import { preloadAllTownPricing, type TownPricingConfig } from "@/hooks/useTownPricing";

import { completeTrip } from "@/lib/completeTrip";
import WalletBalance from "@/components/wallet/WalletBalance";
import DepositModal from "@/components/wallet/DepositModal";
import TransactionsSheet from "@/components/wallet/TransactionsSheet";
import { RideCommunication } from "@/components/ride/RideCommunication";
import { GlassCard } from "@/components/ui/glass-card";
import { PrimaryButton } from "@/components/ui/primary-button";
import { SecondaryButton } from "@/components/ui/secondary-button";
import { InputField } from "@/components/ui/input-field";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/section-header";
import DriverNavigationView from "@/components/driver/DriverNavigationView";
import FullScreenNavigation from "@/components/driver/FullScreenNavigation";
import DriverLiveNav from "@/components/driver/DriverLiveNav";
import DriverSettingsSheet from "@/components/driver/DriverSettingsSheet";
import type { Coordinates } from "@/lib/osrm";
import { useAgoraCall } from "@/hooks/useAgoraCall";
import IncomingCallModal from "@/components/ride/IncomingCallModal";
import ActiveCallOverlay from "@/components/ride/ActiveCallOverlay";
import VoiceCallButton from "@/components/ride/VoiceCallButton";
import DriverEarningsDashboard from "@/components/driver/DriverEarningsDashboard";
import DriverSelfieCheck from "@/components/driver/DriverSelfieCheck";
import DemandHeatmap from "@/components/driver/DemandHeatmap";
import MapGoogle from "@/components/MapGoogle";
import { isGoogleMapsDisabled } from "@/lib/mapsKillSwitch";
import { openNavTo } from "@/lib/navigation";
import { useNearbyDrivers } from "@/hooks/useNearbyDrivers";
import { useOSRMRoute } from "@/hooks/useOSRMRoute";
import { runLocationFraudChecks } from "@/lib/fraudDetection";
import { useFatigueMonitor } from "@/hooks/useFatigueMonitor";
import FatigueAlert from "@/components/driver/FatigueAlert";
import RidePreferenceTags from "@/components/ride/RidePreferenceTags";
import RideRequestCard from "@/components/driver/RideRequestCard";
import DriverOfferModal from "@/components/driver/DriverOfferModal";
import PassengerInfoCard from "@/components/driver/PassengerInfoCard";
import TopFlashBanner from "@/components/ui/top-flash-banner";
import { subscribeRiderComing } from "@/lib/rideSignals";
import { Footprints } from "lucide-react";

// Smart USD format: $4 for whole, $4.50 for halves
function fmtUSD(n: number): string {
  return n % 1 === 0 ? `$${n}` : `$${n.toFixed(2)}`;
}

type Ride = {
  id: string;
  user_id: string;
  status: string;
  pickup_address: string;
  dropoff_address: string;
  fare: number;
  distance_km: number;
  duration_minutes: number;
  created_at: string;
  expires_at?: string | null;
  town_id?: string | null;
  passenger_count?: number;
  payment_method?: string;
  gender_preference?: string | null;
  vehicle_type?: string;
  passenger_name?: string | null;
  passenger_phone?: string | null;
};

export default function DriverDashboard() {
  const nav = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { setFemaleMode } = useFemaleTheme();

  const [profile, setProfile] = useState<DriverProfile | null>(null);
  const [rides, setRides] = useState<Ride[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(false);
  const [togglingOnline, setTogglingOnline] = useState(false);

  const [selectedRide, setSelectedRide] = useState<Ride | null>(null);
  const [mult, setMult] = useState(defaultNightMultiplier());
  const [offerPrice, setOfferPrice] = useState(50);
  const [eta, setEta] = useState(10);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [messagesOpen, setMessagesOpen] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [depositModalOpen, setDepositModalOpen] = useState(false);
  const [transactionsOpen, setTransactionsOpen] = useState(false);
  const [activeTrip, setActiveTrip] = useState<{ id: string; pickup_address: string; dropoff_address: string; fare: number; user_id: string; status: string; pickup_lat: number; pickup_lon: number; dropoff_lat: number; dropoff_lon: number; payment_method: string; passenger_name?: string | null; passenger_phone?: string | null } | null>(null);
  const [earningsOpen, setEarningsOpen] = useState(false);
  const [driverCoords, setDriverCoords] = useState<Coordinates | null>(null);
  const [riderPhone, setRiderPhone] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const [isTopDriver, setIsTopDriver] = useState(false);
  const [selfieCheckOpen, setSelfieCheckOpen] = useState(false);
  const [pendingOnlineAfterSelfie, setPendingOnlineAfterSelfie] = useState(false);
  const [townPricingMap, setTownPricingMap] = useState<Record<string, TownPricingConfig>>({});
  const [ridePreferences, setRidePreferences] = useState<Record<string, { quiet_ride: boolean; cool_temperature: boolean; wav_required?: boolean; hearing_impaired?: boolean; gender_preference?: string }>>({});
  const [fullNavMode, setFullNavMode] = useState(false);
  const [riderComingBanner, setRiderComingBanner] = useState<{ open: boolean; name?: string }>({ open: false });
  const [statusUpdating, setStatusUpdating] = useState(false);

  const lastRideIds = useRef<Set<string>>(new Set());
  const locationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { speak, isSupported: voiceSupported } = useVoiceNavigation({ enabled: voiceEnabled });
  const [driverBalance, setDriverBalance] = useState(0);
  const fetchDriverBalance = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("driver_wallets")
      .select("balance_usd")
      .eq("driver_id", user.id)
      .maybeSingle();
    setDriverBalance(data?.balance_usd ?? 0);
  }, [user]);
  useEffect(() => { fetchDriverBalance(); }, [fetchDriverBalance]);
  useEffect(() => { preloadAllTownPricing().then(setTownPricingMap); }, []);

  // ── Listen for "rider is on the way" broadcast from rider ──
  useEffect(() => {
    if (!activeTrip?.id) return;
    const tripId = activeTrip.id;
    const unsub = subscribeRiderComing(tripId, async (payload) => {
      const { shouldFireOnce } = await import("@/lib/notifyThrottle");
      if (!shouldFireOnce(`ride:${tripId}`, "rider_coming", 30_000)) return;
      setRiderComingBanner({ open: true, name: payload.riderName });
      // Sound + vibrate
      import("@/lib/notificationSounds")
        .then(({ playNotificationSound }) => playNotificationSound("accepted"))
        .catch(() => {});
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        try { navigator.vibrate?.([180, 80, 180]); } catch { /* noop */ }
      }
    });
    return unsub;
  }, [activeTrip?.id]);

  // Fatigue monitor
  const fatigueState = useFatigueMonitor(user?.id, isOnline);

  // Nearby drivers for map
  const nearbyDrivers = useNearbyDrivers(isOnline);

  // OSRM routes for map polylines
  const driverToPickupRoute = useOSRMRoute(
    driverCoords && activeTrip ? { lat: driverCoords.lat, lng: driverCoords.lng } : null,
    activeTrip ? { lat: activeTrip.pickup_lat, lng: activeTrip.pickup_lon } : null
  );
  const pickupToDropoffRoute = useOSRMRoute(
    activeTrip ? { lat: activeTrip.pickup_lat, lng: activeTrip.pickup_lon } : null,
    activeTrip ? { lat: activeTrip.dropoff_lat, lng: activeTrip.dropoff_lon } : null
  );

  // WebRTC voice calling for active trip

  const {
    callStatus,
    isMuted,
    isSpeaker,
    callDuration,
    incomingCall,
    startCall,
    answerCall,
    declineCall: declineIncomingCall,
    endCall,
    toggleMute,
    toggleSpeaker,
  } = useAgoraCall({
    rideId: activeTrip?.id ?? null,
    currentUserId: user?.id ?? "",
    otherUserId: activeTrip?.user_id ?? null,
  });


  // Helper: days left in trial
  const trialDaysLeft = profile?.trial_ends_at
    ? Math.max(0, Math.ceil((new Date(profile.trial_ends_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : 0;
  const trialActive = profile?.trial_ends_at
    ? new Date(profile.trial_ends_at).getTime() > Date.now()
    : false;

  // Location tracking for admin monitoring
  const prevLocationRef = useRef<{ lat: number; lng: number; time: number } | null>(null);

  const startLocationTracking = () => {
    stopLocationTracking();
    if (!navigator.geolocation) return;
    const handlePos = (pos: GeolocationPosition) => {
      const { latitude, longitude } = pos.coords;
      updateDriverLocation(latitude, longitude);
      setDriverCoords({ lat: latitude, lng: longitude });

      // Fraud detection: check for GPS spoofing
      if (user && prevLocationRef.current) {
        runLocationFraudChecks(
          user.id,
          prevLocationRef.current.lat, prevLocationRef.current.lng, prevLocationRef.current.time,
          latitude, longitude, Date.now()
        ).catch(() => {});
      }
      prevLocationRef.current = { lat: latitude, lng: longitude, time: Date.now() };
    };
    // Send initial location
    navigator.geolocation.getCurrentPosition(handlePos, () => {});
    // Update every 10 seconds
    locationIntervalRef.current = setInterval(() => {
      navigator.geolocation.getCurrentPosition(handlePos, () => {});
    }, 10000);
  };

  const stopLocationTracking = () => {
    if (locationIntervalRef.current) {
      clearInterval(locationIntervalRef.current);
      locationIntervalRef.current = null;
    }
  };

  // Clean up location tracking on unmount
  useEffect(() => {
    return () => stopLocationTracking();
  }, []);

  // Auto-start tracking if already online on mount
  useEffect(() => {
    if (isOnline && profile?.status === "approved") {
      startLocationTracking();
    }
  }, [isOnline, profile?.status]);

  // Toggle online status with can_driver_operate check
  const toggleOnline = async (online: boolean) => {
    if (!profile || togglingOnline) return;

    // If going online, require selfie check first (once per session)
    if (online && !pendingOnlineAfterSelfie) {
      const lastSelfie = sessionStorage.getItem('pickme-selfie-verified');
      if (!lastSelfie) {
        setSelfieCheckOpen(true);
        return;
      }
    }
    setPendingOnlineAfterSelfie(false);

    setTogglingOnline(true);
    try {
      if (online) {
        const { data: canOperate, error: rpcErr } = await supabase.rpc("can_driver_operate", { p_driver_id: user!.id });
        if (rpcErr) throw new Error(rpcErr.message);
        if (!canOperate) {
          toast.error("Cannot go online", {
            description: "Your trial has ended or your wallet balance is too low. Please deposit to continue.",
            duration: 8000,
          });
          setTogglingOnline(false);
          return;
        }
      }

      const { error: updateErr } = await supabase.from("drivers").update({ is_online: online }).eq("id", profile.id);

      if (updateErr) throw new Error(updateErr.message);

      setIsOnline(online);
      setProfile({ ...profile, is_online: online });

      if (online) {
        toast.success("You're now online!", { description: "You'll see new ride requests" });
        if (voiceEnabled && voiceSupported) {
          speak("You are now online. Waiting for ride requests.");
        }
        // Start live location tracking for admin monitoring
        startLocationTracking();
        refresh();
      } else {
        toast.info("You're now offline", { description: "You won't receive new ride requests" });
        stopLocationTracking();
        setRides([]);
      }
    } catch (e: unknown) {
      toast.error("Failed to update status", { description: (e as Error).message });
    } finally {
      setTogglingOnline(false);
    }
  };

  const refresh = useCallback(async () => {
    try {
      setError(null);

      const p = await getDriverProfile();
      setProfile(p);
      setIsOnline(p?.is_online ?? false);
      // Auto-enable pink mode for female drivers
      if (p?.gender === 'female') setFemaleMode(true);

      if (!p) {
        setLoading(false);
        setError("Driver profile not found. Complete driver registration first.");
        return;
      }

      if (p.status !== "approved") {
        setLoading(false);
        return;
      }

      // Fetch active trip (accepted/in_progress) assigned to this driver
      const { data: activeTripData } = await supabase
        .from("rides")
        .select("id, pickup_address, dropoff_address, fare, status, user_id, pickup_lat, pickup_lon, dropoff_lat, dropoff_lon, payment_method, passenger_name, passenger_phone")
        .eq("driver_id", p.id)
        .in("status", ["accepted", "enroute", "enroute_pickup", "in_progress", "arrived"])
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (activeTripData) {
        const prevStatus = activeTrip?.status;
        const newStatus = activeTripData.status;

        setActiveTrip({
          id: activeTripData.id,
          pickup_address: activeTripData.pickup_address,
          dropoff_address: activeTripData.dropoff_address,
          fare: Number(activeTripData.fare),
          user_id: activeTripData.user_id,
          status: newStatus,
          pickup_lat: activeTripData.pickup_lat,
          pickup_lon: activeTripData.pickup_lon,
          dropoff_lat: activeTripData.dropoff_lat,
          dropoff_lon: activeTripData.dropoff_lon,
          payment_method: activeTripData.payment_method || 'cash',
          passenger_name: activeTripData.passenger_name || null,
          passenger_phone: activeTripData.passenger_phone || null,
        });

        // Notify driver when rider accepts their offer
        if (newStatus === 'accepted' && prevStatus !== 'accepted') {
          playAcceptedSound();
          vibrateAlert();
          showBrowserNotification(
            "✅ Ride Accepted!",
            `Rider accepted your offer — ${fmtUSD(Number(activeTripData.fare))}. Head to pickup!`,
            "/driver"
          );
          toast.success("✅ Ride Accepted!", {
            description: `Rider accepted your offer — ${fmtUSD(Number(activeTripData.fare))}. Head to pickup now!`,
            duration: 10000,
          });
        }

        // Voice nav announcement on status transitions
        if (newStatus === 'enroute_pickup' || (newStatus === 'accepted' && prevStatus !== 'accepted')) {
          toast.info("Voice navigation active — follow in-app directions");
        } else if (newStatus === 'in_progress' && prevStatus !== 'in_progress') {
          toast.info("Navigating to drop-off — follow in-app directions");
        }
        // Fetch rider phone
        const { data: riderProfile } = await supabase
          .from("profiles")
          .select("phone")
          .eq("user_id", activeTripData.user_id)
          .maybeSingle();
        setRiderPhone(riderProfile?.phone ?? null);

        // Preferences are batch-fetched below with all ride IDs
      } else {
        setActiveTrip(null);
        setRiderPhone(null);
      }

      // Check if top driver for priority access
      const { data: topStatus } = await supabase.rpc("is_top_driver", { _user_id: user!.id });
      setIsTopDriver(!!topStatus);

      // Only fetch rides if driver is online
      if (p.is_online) {
        // Expire old rides server-side first
        await expireOldRides();
        const list = await fetchOpenRides(profile?.gender);
        const activeList = filterActiveRides(list);

        setRides(activeList as Ride[]);

        // Fetch preferences for all visible rides
        const allRideIds = activeList.map(r => r.id);
        if (activeTripData) allRideIds.push(activeTripData.id);
        if (allRideIds.length > 0) {
          const { data: allPrefs } = await supabase
            .from("ride_preferences")
            .select("ride_id, quiet_ride, cool_temperature, wav_required, hearing_impaired, gender_preference")
            .in("ride_id", allRideIds);
          if (allPrefs) {
            const prefsMap: Record<string, { quiet_ride: boolean; cool_temperature: boolean; wav_required?: boolean; hearing_impaired?: boolean; gender_preference?: string }> = {};
            for (const pref of allPrefs) {
              const p = pref as Record<string, unknown>;
              prefsMap[pref.ride_id] = { 
                quiet_ride: pref.quiet_ride, 
                cool_temperature: pref.cool_temperature,
                wav_required: (p.wav_required as boolean) ?? false,
                hearing_impaired: (p.hearing_impaired as boolean) ?? false,
                gender_preference: (p.gender_preference as string) ?? 'any',
              };
            }
            setRidePreferences(prev => ({ ...prev, ...prefsMap }));
          }
        }

        // Notify on new rides with LOUD sound and voice
        const currentIds = new Set(list.map((r) => r.id));
        let hasNewRide = false;
        for (const id of currentIds) {
          if (!lastRideIds.current.has(id)) {
            hasNewRide = true;
            break;
          }
        }

        if (hasNewRide) {
          // Simple beep for incoming rides
          playNewRequestSound();
          vibrateAlert();
          showBrowserNotification(
            "🚗 New Ride Request",
            "A rider is looking for a driver near you",
            "/driver"
          );

          toast.info("🚗 NEW RIDE REQUEST!", {
            description: "A rider is looking for a driver - respond quickly!",
            duration: 10000,
          });
        }
        lastRideIds.current = currentIds;
      } else {
        setRides([]);
      }

      setLoading(false);
    } catch (e: unknown) {
      setError((e as Error).message);
      setLoading(false);
    }
  }, [voiceEnabled, voiceSupported, speak]);

  // Request notification permission on mount
  useEffect(() => {
    try {
      if (typeof globalThis.Notification !== "undefined" && Notification.permission === "default") {
        Notification.requestPermission();
      }
    } catch (_) { /* Notification API not available */ }
  }, []);

  useEffect(() => {
    if (!authLoading && !user) {
      nav("/auth");
      return;
    }
    if (!authLoading) {
      refresh();
    }
  }, [authLoading, user, nav, refresh]);

  // Realtime subscription for open rides (only triggers refresh if online)
  useOpenRidesRealtime(refresh);

  // Client-side timer to filter out expired rides every second
  useEffect(() => {
    if (!isOnline) return;
    const interval = setInterval(() => {
      setRides((prev) => {
        const filtered = filterActiveRides(prev);
        return filtered.length !== prev.length ? filtered : prev;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [isOnline]);

  const chooseRide = (r: Ride) => {
    setSelectedRide(r);
    const base = Math.max(0.50, Math.round(((r.fare || 5) * mult) * 2) / 2);
    setOfferPrice(base);
    setEta(Math.max(5, Math.round(r.duration_minutes / 2)));
    setNote(isNightLocal() ? "Night service" : "");
  };

  const fareStep = 0.50;
  const fareMin = 0.50;

  const inc = () => setOfferPrice((p) => Math.round((p + 0.50) * 2) / 2);
  const dec = () => setOfferPrice((p) => Math.max(0.50, Math.round((p - 0.50) * 2) / 2));

  const sendOffer = async () => {
    if (!selectedRide || submitting) return;

    // Check if ride has expired before sending
    if (selectedRide.expires_at && new Date(selectedRide.expires_at).getTime() < Date.now()) {
      toast.error("This request has expired");
      setSelectedRide(null);
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      await submitOffer({
        ride_id: selectedRide.id,
        price: offerPrice,
        eta_minutes: eta,
        message: note,
      });
      toast.success("Offer sent!", { description: `${fmtUSD(offerPrice)} for ${eta} min ETA` });
      setSelectedRide(null);
    } catch (e: unknown) {
      setError((e as Error).message);
      toast.error("Failed to send offer", { description: (e as Error).message });
    } finally {
      setSubmitting(false);
    }
  };

  const updateTripStatus = async (
    nextStatus: "enroute" | "arrived" | "in_progress",
    expectedStatus: string,
    successMessage: string,
    options?: { openNavigation?: boolean; notifyArrived?: boolean }
  ) => {
    if (!activeTrip || statusUpdating) return;
    if (!navigator.onLine) {
      toast.error("You're offline", { description: "Reconnect before updating trip status." });
      return;
    }
    if (activeTrip.status !== expectedStatus) {
      toast.error("Trip status changed", { description: "Refreshing latest trip details…" });
      refresh();
      return;
    }

    setStatusUpdating(true);
    try {
      const { error } = await supabase
        .from("rides")
        .update({ status: nextStatus })
        .eq("id", activeTrip.id)
        .eq("status", expectedStatus);

      if (error) throw new Error(error.message);

      setActiveTrip((prev) => prev?.id === activeTrip.id ? { ...prev, status: nextStatus } : prev);
      toast.info(successMessage);
      if (options?.openNavigation) {
        // Always use the in-app premium live navigation (Mapbox-primary).
        setFullNavMode(true);
      }

      if (options?.notifyArrived) {
        supabase.from("notifications").insert({
          user_id: activeTrip.user_id,
          title: "🚗 Your driver has arrived!",
          body: "Your driver is at the pickup point. Please meet them now.",
          notification_type: "driver_arrived",
        }).then(() => {});
      }
    } catch (e: unknown) {
      toast.error("Failed to update trip", { description: (e as Error).message });
      refresh();
    } finally {
      setStatusUpdating(false);
    }
  };

  const handleCompleteTrip = async () => {
    if (!activeTrip || completing) return;
    if (!navigator.onLine) {
      toast.error("You're offline", { description: "Reconnect before completing the trip." });
      return;
    }
    if (activeTrip.status !== "in_progress") {
      toast.error("Trip not started", { description: "Start the ride before completing it." });
      return;
    }
    setCompleting(true);
    try {
      const result = await completeTrip(activeTrip.id);
      if (!(result as Record<string, unknown>)?.ok) {
        throw new Error(((result as Record<string, unknown>)?.reason as string) || "Failed to complete trip");
      }
      const r = result as Record<string, unknown>;
      const payMethod = activeTrip.payment_method === 'ecocash' ? ' (Paid via EcoCash)' : activeTrip.payment_method === 'wallet' ? ' (Paid via Wallet)' : '';
      toast.success("Trip completed!", {
        description: `Fare: ${fmtUSD(Number(r.fare_usd ?? 0))}${payMethod} • Commission: ${fmtUSD(Number(r.commission_usd ?? 0))} • You earned: ${fmtUSD(Number(r.driver_earnings_usd ?? 0))}`,
      });
      setActiveTrip(null);
      fetchDriverBalance();
      refresh();
    } catch (e: unknown) {
      toast.error("Failed to complete trip", { description: (e as Error).message });
    } finally {
      setCompleting(false);
    }
  };

  if (authLoading || loading) {
    return (
      <div className="flex flex-col h-[100dvh] bg-background">
        <div className="shrink-0 bg-background/95 backdrop-blur-lg border-b border-border/60 px-5 py-3.5">
          <div className="flex items-center justify-between max-w-lg mx-auto">
            <div className="w-11 h-11 rounded-2xl bg-muted animate-pulse" />
            <div className="h-5 w-36 rounded bg-muted animate-pulse" />
            <div className="w-11 h-11 rounded-2xl bg-muted animate-pulse" />
          </div>
        </div>
        <div className="flex-1 bg-muted/30 animate-pulse" />
        <div className="p-4 space-y-3">
          <div className="h-14 rounded-2xl bg-muted animate-pulse" />
          <div className="h-20 rounded-2xl bg-muted animate-pulse" />
          <div className="h-14 rounded-2xl bg-muted animate-pulse w-2/3" />
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-background p-4">
        <Button variant="ghost" onClick={() => nav(-1)} className="mb-4">
          <ArrowLeft className="h-4 w-4 mr-2" /> Back
        </Button>
        <Card>
          <CardContent className="pt-6">
            <p className="text-destructive">{error || "Driver profile not found."}</p>
            <Button onClick={() => nav("/drive")} className="mt-4">
              Complete Registration
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (profile.status !== "approved") {
    return (
      <div className="min-h-screen bg-background p-4">
        <Button variant="ghost" onClick={() => nav(-1)} className="mb-4">
          <ArrowLeft className="h-4 w-4 mr-2" /> Back
        </Button>
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground">
              Your driver status is <strong>{profile.status}</strong>. Please wait for admin approval before accepting
              rides.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Full-screen in-app live navigation mode (Mapbox-primary).
  if (fullNavMode && activeTrip) {
    const useLegacyGoogleNav = !isGoogleMapsDisabled();
    return (
      <>
        {/* Active Call Overlay */}
        {callStatus !== "idle" && (
          <ActiveCallOverlay
            status={callStatus}
            duration={callDuration}
            isMuted={isMuted}
            isSpeaker={isSpeaker}
            onToggleMute={toggleMute}
            onToggleSpeaker={toggleSpeaker}
            onEndCall={endCall}
            otherUserName="Rider"
          />
        )}
        {incomingCall && (
          <IncomingCallModal
            callerId={incomingCall.callerId}
            onAnswer={answerCall}
            onDecline={declineIncomingCall}
          />
        )}
        {useLegacyGoogleNav ? (
          <FullScreenNavigation
            activeTrip={activeTrip}
            driverCoords={driverCoords}
            userId={user!.id}
            riderPhone={riderPhone}
            onTripUpdate={(trip) => setActiveTrip(trip)}
            onTripComplete={() => {
              setFullNavMode(false);
              setActiveTrip(null);
              fetchDriverBalance();
              refresh();
            }}
            onExit={() => setFullNavMode(false)}
            onStartCall={startCall}
            callStatus={callStatus}
          />
        ) : (
          <DriverLiveNav
            activeTrip={activeTrip}
            driverCoords={driverCoords}
            riderPhone={riderPhone}
            riderName={activeTrip.passenger_name ?? null}
            onTripUpdate={(trip) => setActiveTrip(trip)}
            onTripComplete={() => {
              setFullNavMode(false);
              setActiveTrip(null);
              fetchDriverBalance();
              refresh();
            }}
            onExit={() => setFullNavMode(false)}
            onStartCall={startCall}
          />
        )}
      </>
    );
  }

  return (
    <div className="flex flex-col h-[100dvh] bg-background">
      {/* Selfie Verification */}
      <DriverSelfieCheck
        open={selfieCheckOpen}
        onVerified={() => {
          setSelfieCheckOpen(false);
          sessionStorage.setItem('pickme-selfie-verified', Date.now().toString());
          setPendingOnlineAfterSelfie(true);
          toggleOnline(true);
        }}
        onSkip={() => {
          setSelfieCheckOpen(false);
          sessionStorage.setItem('pickme-selfie-verified', Date.now().toString());
          setPendingOnlineAfterSelfie(true);
          toggleOnline(true);
        }}
      />

      {/* Fatigue Alert */}
      {fatigueState.isFatigued && (
        <FatigueAlert breakTimeRemaining={fatigueState.breakTimeRemaining} totalHours={fatigueState.totalOnlineHours} />
      )}

      {/* Active Call Overlay */}
      {callStatus !== "idle" && (
        <ActiveCallOverlay
          status={callStatus}
          duration={callDuration}
          isMuted={isMuted}
          isSpeaker={isSpeaker}
          onToggleMute={toggleMute}
          onToggleSpeaker={toggleSpeaker}
          onEndCall={endCall}
          otherUserName="Rider"
        />
      )}

      {/* Incoming Call Modal */}
      {incomingCall && (
        <IncomingCallModal
          callerId={incomingCall.callerId}
          onAnswer={answerCall}
          onDecline={declineIncomingCall}
        />
      )}

      {/* ── Rider on the way — flashing top banner (10s) ── */}
      <TopFlashBanner
        open={riderComingBanner.open}
        onClose={() => setRiderComingBanner({ open: false })}
        durationMs={10_000}
        tone="info"
        icon={<Footprints className="w-7 h-7" />}
        title={`${riderComingBanner.name || "Your rider"} is on the way`}
        subtitle="They've left and are heading to your location now"
      />

      <div className="shrink-0 bg-background/95 backdrop-blur-lg border-b border-border/60 px-5 py-3.5 z-10">
        <div className="flex items-center justify-between max-w-lg mx-auto">
          <Button variant="ghost" size="icon" onClick={() => nav(-1)} className="w-11 h-11 rounded-2xl active:scale-90 transition-all">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="font-extrabold tracking-tight text-base">Driver Dashboard</h1>
          <div className="flex items-center gap-2.5">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setEarningsOpen(!earningsOpen)}
              className="w-11 h-11 rounded-2xl text-muted-foreground active:scale-90 transition-all"
              title="Earnings"
            >
              <BarChart3 className="h-5 w-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setTransactionsOpen(true)}
              className="w-11 h-11 rounded-2xl text-muted-foreground active:scale-90 transition-all"
            >
              <History className="h-5 w-5" />
            </Button>
            <WalletBalance
              balance={driverBalance}
              onClick={() => nav("/drivers/wallet")}
              size="sm"
            />
            <DriverSettingsSheet
              profile={profile}
              isOnline={isOnline}
              togglingOnline={togglingOnline}
              voiceEnabled={voiceEnabled}
              voiceSupported={voiceSupported}
              onToggleOnline={toggleOnline}
              onToggleVoice={setVoiceEnabled}
              onProfileUpdate={setProfile}
            />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain">
      <div className="max-w-lg mx-auto p-5 space-y-5 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]">

        {/* Quick Stats */}
        <div className="grid grid-cols-3 gap-1.5">
          {[
            { icon: Star, value: profile.rating_avg?.toFixed(1) || '—', label: 'Rating' },
            { icon: TrendingUp, value: String(profile.total_trips || 0), label: 'Trips' },
            { icon: Zap, value: `$${driverBalance % 1 === 0 ? driverBalance : driverBalance.toFixed(2)}`, label: 'Wallet' },
          ].map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08, type: 'spring', stiffness: 400, damping: 30 }}
              className="rounded-lg p-1.5 text-center flex flex-col items-center justify-center"
              style={{ background: 'var(--gradient-primary)' }}
            >
              <stat.icon className="h-3 w-3 text-primary-foreground/80 mb-0.5" />
              <p className="text-sm font-extrabold tabular-nums text-primary-foreground leading-tight">{stat.value}</p>
              <p className="text-[8px] text-primary-foreground/70 font-medium">{stat.label}</p>
            </motion.div>
          ))}
        </div>

        {/* Earnings Dashboard (toggled via icon) */}
        {earningsOpen && (
          <DriverEarningsDashboard />
        )}

        {/* Demand Heatmap */}
        {isOnline && (
          <GlassCard className="rounded-2xl p-4">
            <DemandHeatmap townId="gwanda" />
          </GlassCard>
        )}

        {/* Trial Banner */}
        {profile && trialActive && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl border border-accent/30 bg-accent/8 p-3.5"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-accent/15 flex items-center justify-center shrink-0">
                <Clock className="h-4.5 w-4.5 text-accent" />
              </div>
              <div>
                <p className="font-semibold text-sm text-foreground">Free Trial Active</p>
                <p className="text-xs text-muted-foreground">
                  {trialDaysLeft} day{trialDaysLeft !== 1 ? "s" : ""} remaining — no fees
                </p>
              </div>
            </div>
          </motion.div>
        )}

        {/* Available Rides — top priority */}
        <div className="space-y-3">
          <SectionHeader
            title="Available Rides"
            right={isOnline && rides.length > 0 ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Bell className="h-4 w-4" />
                <span>{rides.length} request{rides.length !== 1 ? "s" : ""}</span>
              </div>
            ) : undefined}
          />

          {!isOnline ? (
            <EmptyState
              title="You're currently offline"
              description="Go online from settings to see ride requests"
              className="py-8"
            />
          ) : rides.length === 0 ? (
            <EmptyState title="No open ride requests right now" description="Stay online — new requests will appear automatically." className="py-8" />
          ) : (
            rides.map((r, i) => (
                <RideRequestCard
                  key={r.id}
                  ride={r}
                  preferences={ridePreferences[r.id] ?? null}
                  secsLeft={getSecondsRemaining(r.expires_at ?? null)}
                  index={i}
                  onClick={() => chooseRide(r)}
                  fmtUSD={fmtUSD}
                />
            ))
          )}
        </div>

        {/* Offer Modal */}
        {selectedRide && (
          <DriverOfferModal
            ride={selectedRide}
            preferences={ridePreferences[selectedRide.id] ?? null}
            offerPrice={offerPrice}
            eta={eta}
            note={note}
            submitting={submitting}
            onClose={() => setSelectedRide(null)}
            onInc={inc}
            onDec={dec}
            onEtaChange={setEta}
            onNoteChange={setNote}
            onSubmit={sendOffer}
            fmtUSD={fmtUSD}
          />
        )}

        {/* Contact Rider — collapsed message panel */}
        {activeTrip && (
          <>
            {/* Ride for Someone Else — passenger card */}
            {activeTrip.passenger_name && activeTrip.passenger_phone && (
              <PassengerInfoCard
                passengerName={activeTrip.passenger_name}
                passengerPhone={activeTrip.passenger_phone}
                onMessage={() => setMessagesOpen(!messagesOpen)}
              />
            )}

            <Card className="glass-card border-0">
              <CardContent className="pt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="font-medium text-sm text-foreground flex items-center gap-2">
                    <PhoneCall className="h-4 w-4 text-primary" /> Contact Rider
                  </p>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setMessagesOpen(!messagesOpen)}
                    className="w-9 h-9 rounded-xl"
                    title="Messages"
                  >
                    <MessageCircle className={`h-4 w-4 ${messagesOpen ? 'text-primary' : 'text-muted-foreground'}`} />
                  </Button>
                </div>
                {activeTrip.passenger_name && (
                  <p className="text-xs text-muted-foreground">
                    Booking contact: <span className="font-medium text-foreground">{activeTrip.passenger_name}</span>
                  </p>
                )}
                <div className="grid grid-cols-3 gap-2">
                  <VoiceCallButton
                    onCall={startCall}
                    disabled={callStatus !== "idle"}
                    label="Data"
                    className="w-full text-xs"
                  />
                  <a
                    href={riderPhone ? `tel:${riderPhone.replace(/[^\d+]/g, "")}` : "#"}
                    className="flex items-center justify-center gap-1 py-3 rounded-2xl font-medium text-xs text-center active:scale-95 transition-all"
                    style={{ background: 'var(--gradient-primary)' }}
                  >
                    <Phone className="h-3.5 w-3.5 text-primary-foreground shrink-0" />
                    <span className="text-primary-foreground">Phone</span>
                  </a>
                  <button
                    onClick={() => setMessagesOpen(!messagesOpen)}
                    className="flex items-center justify-center gap-1 py-3 rounded-2xl bg-accent/80 backdrop-blur-sm text-accent-foreground font-medium text-xs text-center active:scale-95 transition-all"
                  >
                    <MessageCircle className="h-3.5 w-3.5" /> <span>Message</span>
                  </button>
                </div>
                {!riderPhone && (
                  <p className="text-xs text-muted-foreground">Rider phone not available — use Call (Data) for in-app voice.</p>
                )}
              </CardContent>
            </Card>

            {/* Messages Panel — only when toggled */}
            {messagesOpen && (
              <Card className="glass-card border-0">
                <CardContent className="pt-4">
                  <RideCommunication
                    rideId={activeTrip.id}
                    currentUserId={user!.id}
                    otherUserPhone={riderPhone}
                    riderId={activeTrip.user_id}
                  />
                </CardContent>
              </Card>
            )}
          </>
        )}

        {/* Live map — always visible. Shows nearby cars when idle, and pickup/dropoff/driver route during active trip */}
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className="rounded-2xl overflow-hidden border border-border/30 shadow-sm"
        >
          <div className="h-[45vh] min-h-[300px]">
            <MapGoogle
              driverLocation={driverCoords ? { lat: driverCoords.lat, lng: driverCoords.lng } : undefined}
              drivers={!activeTrip ? nearbyDrivers : undefined}
              pickup={activeTrip ? { lat: activeTrip.pickup_lat, lng: activeTrip.pickup_lon } : undefined}
              dropoff={activeTrip ? { lat: activeTrip.dropoff_lat, lng: activeTrip.dropoff_lon } : undefined}
              routeGeometry={(activeTrip as unknown as { route_polyline?: string })?.route_polyline ?? undefined}
              defaultCenter={driverCoords ? { lat: driverCoords.lat, lng: driverCoords.lng } : undefined}
              defaultZoom={15}
              className="w-full h-full"
            />
          </div>
        </motion.div>

        {/* Active Trip — fare + complete */}
        {activeTrip && (
          <Card className="border-accent/40 bg-accent/5 backdrop-blur-sm">
            <CardContent className="pt-4">
              <div className="flex items-start gap-3 mb-3">
                <div className="flex flex-col items-center">
                  <MapPin className="h-4 w-4 text-primary" />
                  <div className="w-0.5 h-6 bg-border" />
                  <Navigation className="h-4 w-4 text-destructive" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate">{activeTrip.pickup_address}</p>
                  <p className="text-sm text-muted-foreground truncate mt-5">{activeTrip.dropoff_address}</p>
                  {/* Ride preferences tags */}
                  {ridePreferences[activeTrip.id] && (
                    <div className="mt-1.5">
                      <RidePreferenceTags quietRide={ridePreferences[activeTrip.id]?.quiet_ride} coolTemperature={ridePreferences[activeTrip.id]?.cool_temperature} wavRequired={ridePreferences[activeTrip.id]?.wav_required} hearingImpaired={ridePreferences[activeTrip.id]?.hearing_impaired} genderPreference={ridePreferences[activeTrip.id]?.gender_preference} />
                    </div>
                  )}
                </div>
                <div className="text-right">
                  <p className="font-black text-lg">{fmtUSD(Number(activeTrip.fare))}</p>
                  {activeTrip.payment_method && activeTrip.payment_method !== 'cash' && (
                    <div className="flex items-center gap-1 mt-1 justify-end">
                      <CreditCard className="h-3 w-3 text-primary" />
                      <span className="text-xs font-medium text-primary capitalize">{activeTrip.payment_method}</span>
                    </div>
                  )}
                  {activeTrip.payment_method === 'cash' && (
                    <span className="text-xs text-muted-foreground">Cash</span>
                  )}
                </div>
              </div>
              {activeTrip.status === 'accepted' && (
                <Button
                  className="w-full bg-primary text-primary-foreground hover:brightness-110 mb-2"
                  size="lg"
                  disabled={statusUpdating}
                  onClick={() => updateTripStatus("enroute", "accepted", "Status: Enroute — heading to pickup", { openNavigation: true })}
                >
                  <Navigation className="h-4 w-4 mr-2" />
                  Enroute to Pickup
                </Button>
              )}
              {/* Navigate button for already-enroute trips */}
              {['enroute', 'enroute_pickup', 'arrived', 'in_progress'].includes(activeTrip.status) && (
                <Button
                  className="w-full bg-blue-600 text-white hover:bg-blue-700 mb-2"
                  size="lg"
                  onClick={() => {
                    if (isGoogleMapsDisabled()) {
                      const target = activeTrip.status === 'in_progress' ? 'dropoff' : 'pickup';
                      const lat = target === 'dropoff' ? activeTrip.dropoff_lat : activeTrip.pickup_lat;
                      const lng = target === 'dropoff' ? activeTrip.dropoff_lon : activeTrip.pickup_lon;
                      openNavTo(lat, lng, activeTrip.id, target);
                    } else {
                      setFullNavMode(true);
                    }
                  }}
                >
                  <Navigation className="h-4 w-4 mr-2" />
                  Open Navigation
                </Button>
              )}
              {activeTrip.status === 'enroute' && (
                <Button
                  className="w-full bg-primary text-primary-foreground hover:brightness-105 mb-2"
                  size="lg"
                  disabled={statusUpdating}
                  onClick={() => updateTripStatus("arrived", "enroute", "Status: Arrived — waiting for rider", { notifyArrived: true })}
                >
                  <MapPin className="h-4 w-4 mr-2" />
                  I've Arrived
                </Button>
              )}
              {activeTrip.status === 'arrived' && (
                <Button
                  className="w-full bg-primary text-primary-foreground hover:brightness-105 mb-2"
                  size="lg"
                  disabled={statusUpdating}
                  onClick={() => updateTripStatus("in_progress", "arrived", "Rider picked up — navigating to dropoff", { openNavigation: true })}
                >
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Start Ride
                </Button>
              )}
              <Button
                className="w-full bg-amber-500 hover:bg-amber-600 text-white font-bold"
                size="lg"
                onClick={handleCompleteTrip}
                disabled={completing || statusUpdating || activeTrip.status !== "in_progress"}
              >
                <CheckCircle2 className="h-4 w-4 mr-2" />
                {completing ? "Completing..." : "Complete Trip (15%)"}
              </Button>
            </CardContent>
          </Card>
        )}

        {error && <p className="text-sm text-destructive text-center">{error}</p>}
        </div>
      </div>

      {/* Deposit Modal */}
      <DepositModal
        isOpen={depositModalOpen}
        onClose={() => { setDepositModalOpen(false); fetchDriverBalance(); }}
        onDeposit={async (amount: number, desc?: string) => {
          return { error: 'Use the deposit page at /drivers/deposit' };
        }}
        currentBalance={driverBalance}
      />

      {/* Transactions Sheet */}
      <TransactionsSheet
        isOpen={transactionsOpen}
        onClose={() => setTransactionsOpen(false)}
        transactions={[]}
        title="Wallet History"
      />
    </div>
  );
}
