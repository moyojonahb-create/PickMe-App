import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { motion } from "framer-motion";
import { useNavigate, useLocation } from "react-router-dom";
import DriverBottomNav from "@/components/driver/DriverBottomNav";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/hooks/useAuth";
import { useFemaleTheme } from "@/hooks/useFemaleTheme";
import { useOpenRidesRealtime } from "@/hooks/useRideRealtime";
import {
  fetchOpenRides,
  getDriverProfile,
  type DriverProfile,
} from "@/lib/offerHelpers";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  ArrowLeft,
  Navigation,
  Minus,
  Plus,
  Send,
  Radio,
  Volume2,
  Wallet,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Star,
  TrendingUp,
  Zap,
  Menu,
  ChevronRight,
  Car,
  DollarSign,
} from "lucide-react";
import { playAlert, vibrateAlert, showBrowserNotification } from "@/lib/alerts";
import { playAcceptedSound, playNewRequestSound } from "@/lib/notificationSounds";
import { updateDriverLocation } from "@/lib/driverLocation";
import { useVoiceNavigation } from "@/hooks/useVoiceNavigation";
import { filterActiveRides, expireOldRides } from "@/lib/rideExpiry";
import { normalizeRideRow } from "@/lib/rideContract";
import { preloadAllTownPricing, type TownPricingConfig } from "@/hooks/useTownPricing";

import { canCurrentDriverOperate, isCurrentDriverTopDriver } from "@/lib/businessApi";
import PickMeLogo from "@/components/PickMeLogo";
import { NotificationBell } from "@/components/NotificationCenter";
import defaultDriverAvatar from "@/assets/driver-avatar-jonah.png";
import searchCarImage from "@/assets/search-car.png";

import FullScreenNavigation from "@/components/driver/FullScreenNavigation";
import DriverConnectedTrip, { type RiderInfo } from "@/components/driver/DriverConnectedTrip";
import DriverSettingsSheet from "@/components/driver/DriverSettingsSheet";
import type { Coordinates } from "@/lib/osrm";
import { useAgoraCall } from "@/hooks/useAgoraCall";
import IncomingCallModal from "@/components/ride/IncomingCallModal";
import ActiveCallOverlay from "@/components/ride/ActiveCallOverlay";
import DriverEarningsDashboard from "@/components/driver/DriverEarningsDashboard";
import DriverSelfieCheck from "@/components/driver/DriverSelfieCheck";

import { runLocationFraudChecks } from "@/lib/fraudDetection";
import { useFatigueMonitor } from "@/hooks/useFatigueMonitor";
import FatigueAlert from "@/components/driver/FatigueAlert";
import TopFlashBanner from "@/components/ui/top-flash-banner";

import { subscribeRiderComing } from "@/lib/rideSignals";
import { setDriverOnline } from "@/lib/driverPresence";
import { useDriverRideAlerts, type DriverServiceArea } from "@/hooks/useDriverRideAlerts";
import { useAppBootstrap } from "@/hooks/useAppBootstrap";
import { getDriverWalletSummary } from "@/lib/walletApi";
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
  const location = useLocation();
  const { user, loading: authLoading } = useAuth();
  const { setFemaleMode } = useFemaleTheme();
  const { profile: cachedProfile, driverProfile: cachedDriverProfile, refreshDriverProfile } = useAppBootstrap();

  // Seeded from the splash-time cache (see useAppBootstrap) so a returning
  // driver gets a fully-rendered dashboard on the very first frame instead
  // of a skeleton — refresh() below still re-fetches for freshness, but
  // never flips `loading` back to true, so there's no flash once seeded.
  const [profile, setProfile] = useState<DriverProfile | null>((cachedDriverProfile as unknown as DriverProfile) ?? null);
  const [rides, setRides] = useState<Ride[]>([]);
  const [loading, setLoading] = useState(!cachedDriverProfile);
  const [error, setError] = useState<string | null>(null);
  // Seeded from the splash-time cache so the toggle shows the driver's real
  // last-known status instead of flashing "Offline" on every mount while
  // refresh() below re-fetches it — this is corrected against the DB within
  // one refresh() cycle either way.
  const [isOnline, setIsOnline] = useState(cachedDriverProfile?.is_online ?? false);
  const [togglingOnline, setTogglingOnline] = useState(false);

  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [todayTrips, setTodayTrips] = useState(0);
  const [todayDistanceKm, setTodayDistanceKm] = useState(0);
  const [todayEarnings, setTodayEarnings] = useState<number | null>(null);
  const [yesterdayEarnings, setYesterdayEarnings] = useState<number | null>(null);
  const [onlineMinutesToday, setOnlineMinutesToday] = useState<number | null>(null);
  const [activeTrip, setActiveTrip] = useState<{ id: string; pickup_address: string; dropoff_address: string; fare: number; user_id: string; status: string; pickup_lat: number; pickup_lon: number; dropoff_lat: number; dropoff_lon: number; payment_method: string; distance_km?: number | null; passenger_count?: number | null; passenger_name?: string | null; passenger_phone?: string | null } | null>(null);
  const [riderInfo, setRiderInfo] = useState<RiderInfo | null>(null);
  const [earningsOpen, setEarningsOpen] = useState(Boolean((location.state as { openEarnings?: boolean } | null)?.openEarnings));
  const [driverCoords, setDriverCoords] = useState<Coordinates | null>(null);
  const [riderPhone, setRiderPhone] = useState<string | null>(null);
  const [isTopDriver, setIsTopDriver] = useState(false);
  const [selfieCheckOpen, setSelfieCheckOpen] = useState(false);
  const [pendingOnlineAfterSelfie, setPendingOnlineAfterSelfie] = useState(false);
  const [townPricingMap, setTownPricingMap] = useState<Record<string, TownPricingConfig>>({});
  const [fullNavMode, setFullNavMode] = useState(false);
  const [riderComingBanner, setRiderComingBanner] = useState<{ open: boolean; name?: string }>({ open: false });
  const [driverBalance, setDriverBalance] = useState(0);

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  }, []);

  const lastRideIds = useRef<Set<string>>(new Set());
  const locationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { speak, isSupported: voiceSupported } = useVoiceNavigation({ enabled: voiceEnabled });
  const fetchDriverBalance = useCallback(async () => {
    if (!user) return;
    const data = await getDriverWalletSummary();
    setDriverBalance(data.balance ?? 0);

    // Today's/yesterday's net earnings — same driver_earnings figures shown
    // on the Wallet screen, just bucketed by day for the dashboard summary.
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startOfYesterday = new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000);
    let todaySum = 0;
    let yestSum = 0;
    for (const e of data.earnings) {
      const t = new Date(e.created_at).getTime();
      if (t >= startOfToday.getTime()) todaySum += Number(e.driver_earnings);
      else if (t >= startOfYesterday.getTime()) yestSum += Number(e.driver_earnings);
    }
    setTodayEarnings(todaySum);
    setYesterdayEarnings(yestSum);
  }, [user]);
  // Wallet summary is non-critical (only feeds the earnings cards) — deferred
  // until the shell has actually rendered (`loading` false) instead of firing
  // in the same burst as the profile/active-trip queries the first paint
  // depends on. `loading` only ever goes true → false once per mount, so this
  // still fires exactly once on load.
  useEffect(() => {
    if (loading || !user) return;
    fetchDriverBalance();
  }, [loading, user, fetchDriverBalance]);
  useEffect(() => { preloadAllTownPricing().then(setTownPricingMap); }, []);

  // Driver's display name for the header greeting — sourced from the
  // splash-time profile cache (see useAppBootstrap) instead of a dedicated
  // `profiles` query, since that data is already in memory by the time this
  // screen mounts.
  useEffect(() => {
    if (!user) return;
    setFullName(cachedProfile?.full_name || user.email?.split('@')[0] || 'Driver');
  }, [user, cachedProfile]);

  // Service-area preference — gates which new-ride alerts fire below. Reused
  // from the driver-profile fetch (refresh() below) instead of its own
  // separate `drivers` round trip.
  const [driverServiceArea, setDriverServiceArea] = useState<DriverServiceArea>(
    (cachedDriverProfile?.preferred_service_area as DriverServiceArea | undefined) ?? 'both'
  );
  useEffect(() => {
    setDriverServiceArea((profile?.preferred_service_area as DriverServiceArea | undefined) ?? 'both');
  }, [profile?.preferred_service_area]);

  // New-ride-request alert — real Supabase realtime subscription, fires the
  // banner/sound/haptic/badge the instant a matching open ride is inserted.
  const newRideAlert = useDriverRideAlerts(isOnline, driverServiceArea, profile?.gender);

  // Today's completed-trip count + distance for the shift/performance cards.
  const loadTodayTrips = useCallback(async () => {
    if (!profile) return;
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const { data } = await supabase
      .from('rides')
      .select('distance_km')
      .eq('driver_id', profile.id)
      .eq('status', 'completed')
      .gte('created_at', startOfToday.toISOString());
    const list = data ?? [];
    setTodayTrips(list.length);
    setTodayDistanceKm(list.reduce((sum, r) => sum + Number((r as { distance_km: number | null }).distance_km ?? 0), 0));
  }, [profile]);
  useEffect(() => { loadTodayTrips(); }, [loadTodayTrips]);

  // Today's online time — same driver_sessions source the fatigue monitor
  // already reads, just bucketed to "since local midnight" instead of a
  // rolling 24h window.
  const loadOnlineTimeToday = useCallback(async () => {
    if (!user) return;
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const { data } = await supabase
      .from('driver_sessions')
      .select('went_online_at, went_offline_at')
      .eq('driver_id', user.id)
      .gte('went_online_at', startOfToday.toISOString());
    if (!data || data.length === 0) {
      setOnlineMinutesToday(null);
      return;
    }
    let totalMs = 0;
    for (const s of data) {
      const start = new Date(s.went_online_at).getTime();
      const end = s.went_offline_at ? new Date(s.went_offline_at).getTime() : Date.now();
      totalMs += Math.max(0, end - start);
    }
    setOnlineMinutesToday(Math.round(totalMs / 60000));
  }, [user]);
  useEffect(() => {
    loadOnlineTimeToday();
    if (!isOnline) return;
    const id = setInterval(loadOnlineTimeToday, 60_000);
    return () => clearInterval(id);
  }, [loadOnlineTimeToday, isOnline]);

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

  // Keep online/offline status in sync across devices/tabs — e.g. an admin
  // force-offline, or the driver having the dashboard open on two devices.
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`driver-presence-${user.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "drivers", filter: `user_id=eq.${user.id}` },
        (payload) => {
          const next = (payload.new as { is_online?: boolean } | null)?.is_online;
          if (typeof next === "boolean") {
            setIsOnline(next);
            setProfile((prev) => (prev ? { ...prev, is_online: next } : prev));
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user]);

  // Fatigue monitor
  const fatigueState = useFatigueMonitor(user?.id, isOnline);

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

    // Local dev only: skip the selfie check and operability gate so going
    // online doesn't require a camera/trial-status round trip while testing
    // UI. import.meta.env.DEV is false in any real production build, so
    // this never applies to real drivers.
    const skipVerification = import.meta.env.DEV;

    // If going online, require selfie check first (once per session)
    if (online && !pendingOnlineAfterSelfie && !skipVerification) {
      const lastSelfie = sessionStorage.getItem('pickme-selfie-verified');
      if (!lastSelfie) {
        setSelfieCheckOpen(true);
        return;
      }
    }
    setPendingOnlineAfterSelfie(false);

    setTogglingOnline(true);
    try {
      if (online && !skipVerification) {
        const canOperate = await canCurrentDriverOperate();
        if (!canOperate) {
          toast.error("Cannot go online", {
            description: "Your trial has ended or your wallet balance is too low. Please deposit to continue.",
            duration: 8000,
          });
          setTogglingOnline(false);
          return;
        }
      }

      await setDriverOnline(online, driverCoords);

      setIsOnline(online);
      setProfile({ ...profile, is_online: online });
      void refreshDriverProfile();

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

      // Fetch active trip (accepted/in_progress) assigned to this driver.
      // `ride_status` isn't a real column on `rides` (only `status` is) —
      // the old two-column .or() silently 400'd on every call since only
      // `data` was destructured, so this always looked like "no active
      // trip" even when one existed.
      const { data: activeTripData, error: activeTripErr } = await supabase
        .from("rides")
        .select("*")
        .or(`driver_id.eq.${p.id},driver_id.eq.${user?.id}`)
        .in("status", ["accepted", "enroute", "enroute_pickup", "in_progress", "arrived"])
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (activeTripErr) console.warn("[DriverDashboard] active trip query failed:", activeTripErr.message);
      
      if (activeTripData) {
        const activeTripRow = activeTripData as unknown as Record<string, unknown>;
        const normalizedTrip = normalizeRideRow(activeTripRow);
        const prevStatus = activeTrip?.status;
        const newStatus = normalizedTrip.status;

        setActiveTrip({
          id: String(activeTripRow.id),
          pickup_address: String(activeTripRow.pickup_address ?? activeTripRow.pickup_location ?? ''),
          dropoff_address: String(activeTripRow.dropoff_address ?? activeTripRow.dropoff_location ?? ''),
          fare: Number(activeTripRow.fare ?? activeTripRow.estimated_fare ?? 0),
          user_id: String(activeTripRow.user_id ?? activeTripRow.rider_id ?? ''),
          status: newStatus,
          pickup_lat: Number(activeTripRow.pickup_lat ?? 0),
          pickup_lon: Number(activeTripRow.pickup_lon ?? 0),
          dropoff_lat: Number(activeTripRow.dropoff_lat ?? 0),
          dropoff_lon: Number(activeTripRow.dropoff_lon ?? 0),
          payment_method: String(activeTripRow.payment_method || 'cash'),
          distance_km: activeTripRow.distance_km != null ? Number(activeTripRow.distance_km) : null,
          passenger_count: activeTripRow.passenger_count != null ? Number(activeTripRow.passenger_count) : null,
          passenger_name: null,
          passenger_phone: null,
        });

        // Rider's own profile (name/avatar/gender) + their completed-trip
        // count — real data for the connected-trip screen's rider card, not
        // the booking-contact override fetched separately below.
        void (async () => {
          const riderId = String(activeTripRow.user_id ?? activeTripRow.rider_id ?? '');
          if (!riderId) return;
          const [{ data: riderProfileRow }, { count }] = await Promise.all([
            supabase.from('profiles').select('full_name, avatar_url, gender').eq('user_id', riderId).maybeSingle(),
            supabase.from('rides').select('id', { count: 'exact', head: true }).eq('user_id', riderId).eq('status', 'completed'),
          ]);
          setRiderInfo({
            full_name: riderProfileRow?.full_name ?? null,
            avatar_url: riderProfileRow?.avatar_url ?? null,
            gender: riderProfileRow?.gender ?? null,
            completedTrips: count ?? null,
          });
        })();

        // Passenger contact details live in a protected table and are only
        // readable once this driver is actually assigned to the ride.
        void (async () => {
          const { data: contact } = await supabase
            .from('ride_passenger_contacts')
            .select('passenger_name, passenger_phone')
            .eq('ride_id', String(activeTripRow.id))
            .maybeSingle();
          if (contact) {
            setActiveTrip((prev) => (prev && prev.id === String(activeTripRow.id)
              ? { ...prev, passenger_name: contact.passenger_name, passenger_phone: contact.passenger_phone }
              : prev));
          }
        })();


        // Notify driver when rider accepts their offer
        if (newStatus === 'accepted' && prevStatus !== 'accepted') {
          playAcceptedSound();
          vibrateAlert();
          showBrowserNotification(
            "✅ Ride Accepted!",
            `Rider accepted your offer — ${fmtUSD(Number(activeTripRow.fare ?? activeTripRow.estimated_fare ?? 0))}. Head to pickup!`,
            "/driver"
          );
          toast.success("✅ Ride Accepted!", {
            description: `Rider accepted your offer — ${fmtUSD(Number(activeTripRow.fare ?? activeTripRow.estimated_fare ?? 0))}. Head to pickup now!`,
            duration: 10000,
          });
        }

        // Voice nav announcement on status transitions
        if (newStatus === 'enroute_pickup' || (newStatus === 'accepted' && prevStatus !== 'accepted')) {
          toast.info("Voice navigation active — follow in-app directions");
        } else if (newStatus === 'in_progress' && prevStatus !== 'in_progress') {
          toast.info("Navigating to drop-off — follow in-app directions");
        }
        // Fetch rider phone — fire-and-forget, only feeds the connected-trip
        // card and shouldn't hold up the rest of the dashboard.
        void supabase
          .from("profiles")
          .select("phone")
          .eq("user_id", String(activeTripRow.user_id ?? activeTripRow.rider_id ?? ''))
          .maybeSingle()
          .then(({ data: riderProfile }) => setRiderPhone(riderProfile?.phone ?? null));

        // Preferences are batch-fetched below with all ride IDs
      } else {
        setActiveTrip(null);
        setRiderPhone(null);
        setRiderInfo(null);
      }

      // Everything the dashboard shell needs to decide what to render
      // (profile, approval status, active trip) is in hand — unblock the
      // page now. Top-driver status, and the open-rides list below, are
      // non-critical/list-only and load in just after first paint instead
      // of gating "interactive" on them.
      setLoading(false);

      // Check if top driver for priority access — non-critical (only
      // affects priority-access UI), so a backend hiccup here shouldn't
      // take down the rest of the dashboard the way an unhandled throw
      // into this function's own catch block would.
      void (async () => {
        try {
          setIsTopDriver(await isCurrentDriverTopDriver());
        } catch {
          setIsTopDriver(false);
        }
      })();

      // Only fetch rides if driver is online
      if (p.is_online) {
        void (async () => {
          try {
            // Expire old rides server-side first
            await expireOldRides();
            const list = await fetchOpenRides(p.gender);
            const activeList = filterActiveRides(list);

            setRides(activeList as unknown as Ride[]);

            // Notify on new rides with LOUD sound and voice
            const currentIds = new Set<string>(list.map((r) => String(r.id)));
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
          } catch (e: unknown) {
            console.warn("[DriverDashboard] open rides fetch failed:", (e as Error).message);
          }
        })();
      } else {
        setRides([]);
      }
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

  // Trip status transitions (enroute/arrived/in_progress/complete) all now
  // happen inside FullScreenNavigation once the driver taps Navigate — it
  // owns those goBackend calls itself and reports back via onTripUpdate/
  // onTripComplete, so this page no longer needs its own copies.

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
            {error && (
              <Button variant="outline" onClick={() => { setLoading(true); refresh(); }} className="mt-4 mr-2">
                Retry
              </Button>
            )}
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

  // Full-screen navigation mode
  if (fullNavMode && activeTrip) {
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
        <FullScreenNavigation
          activeTrip={activeTrip}
          driverCoords={driverCoords}
          userId={user!.id}
          riderPhone={riderPhone}
          riderInfo={riderInfo}
          onTripUpdate={(trip) => {
            setActiveTrip(trip);
          }}
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
      </>
    );
  }

  // Connected trip, not yet navigating — full-screen map + bottom sheet
  // (matches the reference "trip accepted, ready to navigate" screen).
  // Everything from "Navigate" onward is FullScreenNavigation above, which
  // already owns arrived/in_progress/complete via its own status-aware
  // action button — so this screen only needs to get the driver there.
  if (activeTrip) {
    return (
      <>
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
        <DriverConnectedTrip
          activeTrip={activeTrip}
          riderInfo={riderInfo}
          riderPhone={riderPhone}
          driverCoords={driverCoords}
          userId={user!.id}
          onNavigate={() => setFullNavMode(true)}
          onOpenSettings={() => setSettingsOpen(true)}
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
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          hideTrigger
        />
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

      {/* ── New ride request — realtime Supabase INSERT on rides, not a poll ── */}
      <TopFlashBanner
        open={!!newRideAlert.incoming}
        onClose={newRideAlert.dismiss}
        durationMs={15_000}
        icon={<Car className="w-7 h-7" />}
        title="New ride request"
        subtitle={
          newRideAlert.incoming
            ? `${newRideAlert.incoming.pickup_address} → ${newRideAlert.incoming.dropoff_address}${newRideAlert.incoming.distance_km != null ? ` · ${newRideAlert.incoming.distance_km.toFixed(1)} km` : ""} · ${fmtUSD(newRideAlert.incoming.fare)}`
            : undefined
        }
        actionLabel="View request"
        onAction={() => { newRideAlert.clearBadge(); nav("/driver/requests"); }}
      />

      <div className="shrink-0 bg-background/95 backdrop-blur-lg border-b border-border/60 px-5 py-3 z-10">
        <div className="flex items-center justify-between max-w-lg mx-auto">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              aria-label="Menu"
              className="w-10 h-10 -ml-1.5 flex items-center justify-center rounded-2xl text-foreground active:scale-90 transition-transform"
            >
              <Menu className="h-5 w-5" />
            </button>
            <PickMeLogo size="sm" />
          </div>
          <div className="flex items-center gap-2">
            <NotificationBell />
            <button
              type="button"
              onClick={() => nav("/driver/profile")}
              aria-label="Profile"
              className="relative w-10 h-10 rounded-full overflow-hidden ring-2 ring-border/60 active:scale-90 transition-transform"
            >
              <img src={profile.avatar_url || defaultDriverAvatar} alt={fullName || "Driver"} className="w-full h-full object-cover" />
              <span
                className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-background ${isOnline ? "bg-emerald-500" : "bg-muted-foreground/50"}`}
              />
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain">
      <div className="max-w-lg mx-auto p-5 space-y-4 pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))]">

        {/* Greeting */}
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-foreground">
            {greeting}{fullName ? `, ${fullName.split(" ")[0]}` : ""} <span aria-hidden>👋</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Let's make it a great day!</p>
        </div>

        {/* Driver Status */}
        <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${isOnline ? "bg-emerald-500/10" : "bg-muted"}`}>
                <Radio className={`h-5 w-5 ${isOnline ? "text-emerald-600" : "text-muted-foreground"}`} />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Driver Status</p>
                <p className={`mt-0.5 text-base font-extrabold flex items-center gap-1.5 ${isOnline ? "text-emerald-600" : "text-foreground"}`}>
                  <span className={`w-2 h-2 rounded-full shrink-0 ${isOnline ? "bg-emerald-500" : "bg-muted-foreground/50"}`} />
                  {isOnline ? "Online" : "Offline"}
                </p>
              </div>
            </div>
            <Button
              size="sm"
              disabled={togglingOnline}
              onClick={() => toggleOnline(!isOnline)}
              className={isOnline ? "shrink-0 rounded-full border border-border bg-transparent text-foreground hover:bg-muted" : "shrink-0 rounded-full bg-primary text-primary-foreground hover:brightness-110"}
              variant={isOnline ? "outline" : "default"}
            >
              {togglingOnline ? "…" : isOnline ? "Go Offline" : "Go Online"}
            </Button>
          </div>
          <p className="mt-2.5 text-xs text-muted-foreground">
            {isOnline ? "You're ready to receive ride requests." : "Go online when you're ready to receive ride requests."}
          </p>
        </div>

        {/* New Ride Requests — the hero action, always in brand red */}
        <button
          type="button"
          onClick={() => { newRideAlert.clearBadge(); nav("/driver/requests"); }}
          className="relative w-full overflow-hidden rounded-2xl p-5 text-left active:scale-[0.98] transition-transform"
          style={{ background: "var(--gradient-primary)" }}
        >
          <div className="absolute -top-8 -right-8 w-36 h-36 rounded-full bg-white/10 blur-2xl pointer-events-none" />
          {isOnline && rides.length > 0 ? (
            <div className="relative flex items-center gap-4">
              <div className="relative shrink-0">
                <div className="w-14 h-14 rounded-full border border-white/30 flex items-center justify-center">
                  <Car className="w-6 h-6 text-white" />
                </div>
                <span
                  className="absolute -top-1.5 -right-1.5 min-w-[22px] h-[22px] px-1 rounded-full flex items-center justify-center text-[11px] font-black text-foreground"
                  style={{ background: "#FFDD00" }}
                >
                  {rides.length}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white font-black text-base tracking-tight">NEW RIDE REQUESTS</p>
                <p className="text-[13px] font-bold mt-0.5" style={{ color: "#FFDD00" }}>{rides.length} request{rides.length !== 1 ? "s" : ""} waiting</p>
                <p className="text-[12px] text-white/85 mt-0.5">Tap to view and accept rides</p>
              </div>
              <div className="w-8 h-8 rounded-full bg-white/95 flex items-center justify-center shrink-0">
                <ChevronRight className="w-4 h-4 text-primary" />
              </div>
            </div>
          ) : (
            <div className="relative flex items-center gap-4">
              <div className="w-14 h-14 rounded-full bg-white overflow-hidden shrink-0">
                <img src={searchCarImage} alt="" className="w-full h-full object-cover" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white font-black text-sm tracking-tight">NO NEW RIDE REQUESTS</p>
                <p className="text-[12px] text-white/85 mt-0.5">
                  {isOnline ? "We'll notify you when a passenger requests a ride." : "Go online to start receiving requests."}
                </p>
              </div>
              <div className="w-8 h-8 rounded-full bg-white/95 flex items-center justify-center shrink-0">
                <ChevronRight className="w-4 h-4 text-primary" />
              </div>
            </div>
          )}
        </button>

        {/* Performance summary */}
        <div className="grid grid-cols-3 gap-2.5">
          <div className="rounded-2xl p-3 text-center" style={{ background: "#FFE8E6" }}>
            <Car className="mx-auto mb-1 h-4 w-4" style={{ color: "#B81104" }} />
            <p className="text-lg font-black tabular-nums text-foreground">{todayTrips}</p>
            <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Trips Today</p>
          </div>
          <div className="rounded-2xl bg-accent/15 p-3 text-center">
            <DollarSign className="mx-auto mb-1 h-4 w-4 text-accent-foreground" />
            <p className="text-lg font-black tabular-nums text-foreground">{todayEarnings !== null ? fmtUSD(todayEarnings) : "—"}</p>
            <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Earnings</p>
          </div>
          <div className="rounded-2xl bg-muted p-3 text-center">
            <Star className="mx-auto mb-1 h-4 w-4 fill-accent text-accent" />
            <p className="text-lg font-black tabular-nums text-foreground">{profile?.rating_avg ? profile.rating_avg.toFixed(1) : "New"}</p>
            <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Rating</p>
          </div>
        </div>

        {/* Today's Earnings + Wallet */}
        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => setEarningsOpen(true)}
            className="rounded-2xl border border-border/60 bg-card p-3.5 text-left active:bg-muted/40 transition-colors"
          >
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Today's Earnings</p>
            <p className="text-lg font-black text-foreground mt-1">{todayEarnings !== null ? fmtUSD(todayEarnings) : "—"}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {todayTrips} trip{todayTrips !== 1 ? "s" : ""}
              {todayEarnings !== null && yesterdayEarnings !== null && yesterdayEarnings > 0 && (
                <span className={todayEarnings >= yesterdayEarnings ? "text-emerald-600 font-semibold" : "text-destructive font-semibold"}>
                  {" "}· {todayEarnings >= yesterdayEarnings ? "↑" : "↓"} {Math.abs(Math.round(((todayEarnings - yesterdayEarnings) / yesterdayEarnings) * 100))}% vs yesterday
                </span>
              )}
            </p>
            <p className="text-[12px] font-bold text-primary mt-2 flex items-center gap-1">View earnings <ChevronRight className="w-3 h-3" /></p>
          </button>

          <button
            type="button"
            onClick={() => nav("/driver/wallet")}
            className="rounded-2xl border border-border/60 bg-card p-3.5 text-left active:bg-muted/40 transition-colors"
          >
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Wallet</p>
            <p className="text-lg font-black text-foreground mt-1">{fmtUSD(driverBalance)}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">Available balance</p>
            <p className="text-[12px] font-bold text-primary mt-2 flex items-center gap-1">Open wallet <ChevronRight className="w-3 h-3" /></p>
          </button>
        </div>

        {/* Today's Shift */}
        {(onlineMinutesToday !== null || todayTrips > 0 || todayDistanceKm > 0) && (
          <div className="rounded-2xl border border-border/60 bg-card p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground mb-3">Today's Shift</p>
            <div className="grid grid-cols-3 gap-2 text-center">
              {onlineMinutesToday !== null && (
                <div>
                  <p className="text-sm font-extrabold text-foreground tabular-nums">{Math.floor(onlineMinutesToday / 60)}h {onlineMinutesToday % 60}m</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Online time</p>
                </div>
              )}
              <div>
                <p className="text-sm font-extrabold text-foreground tabular-nums">{todayTrips}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">Trips</p>
              </div>
              <div>
                <p className="text-sm font-extrabold text-foreground tabular-nums">{todayDistanceKm.toFixed(1)} km</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">Distance</p>
              </div>
            </div>
          </div>
        )}

        {/* Quick Actions */}
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground mb-2">Quick Actions</p>
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: "Earnings", icon: TrendingUp, bg: "#FFE8E6", fg: "#B81104", onClick: () => setEarningsOpen(true) },
              { label: "Trips", icon: Clock, bg: "#FFF6D9", fg: "#8A6D00", onClick: () => nav("/driver/trips") },
              { label: "Wallet", icon: Wallet, bg: "#E4F7EC", fg: "#0F9D58", onClick: () => nav("/driver/wallet") },
              { label: "Vehicle", icon: Car, bg: "#E8F0FE", fg: "#1A56DB", onClick: () => nav("/driver/profile") },
            ].map((action) => (
              <button
                key={action.label}
                type="button"
                onClick={action.onClick}
                className="flex flex-col items-center gap-1.5 rounded-2xl py-3 active:scale-95 transition-transform"
              >
                <div className="w-11 h-11 rounded-2xl flex items-center justify-center" style={{ background: action.bg }}>
                  <action.icon className="w-4.5 h-4.5" style={{ color: action.fg }} />
                </div>
                <span className="text-[11px] font-semibold text-foreground">{action.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Earnings Dashboard (toggled via quick action / bottom-nav Earnings tab) */}
        {earningsOpen && (
          <DriverEarningsDashboard />
        )}

        {/* Free Trial — secondary, compact */}
        {profile && trialActive && (
          <button
            type="button"
            onClick={() => nav("/driver/wallet")}
            className="w-full flex items-center gap-3 rounded-2xl border border-accent/30 bg-accent/8 p-3.5 text-left active:opacity-80 transition-opacity"
          >
            <div className="w-9 h-9 rounded-xl bg-accent/20 flex items-center justify-center shrink-0">
              <Clock className="h-4.5 w-4.5 text-accent-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-sm text-foreground">Free Trial Active</p>
              <p className="text-xs text-muted-foreground">
                {trialDaysLeft} day{trialDaysLeft !== 1 ? "s" : ""} remaining · No platform fees
              </p>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
          </button>
        )}

        {error && <p className="text-sm text-destructive text-center">{error}</p>}
        </div>
      </div>

      <DriverSettingsSheet
        profile={profile}
        isOnline={isOnline}
        togglingOnline={togglingOnline}
        voiceEnabled={voiceEnabled}
        voiceSupported={voiceSupported}
        onToggleOnline={toggleOnline}
        onToggleVoice={setVoiceEnabled}
        onProfileUpdate={setProfile}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        hideTrigger
      />

      <DriverBottomNav requestBadgeCount={newRideAlert.badgeCount} />
    </div>
  );
}
