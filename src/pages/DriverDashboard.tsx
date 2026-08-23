import { useEffect, useState, useCallback, useRef, useMemo } from "react";
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
import { toast } from "sonner";
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Star,
  Menu,
  ChevronRight,
  Car,
  Power,
  MapPin,
} from "lucide-react";
import { vibrateAlert, showBrowserNotification } from "@/lib/alerts";
import { playAcceptedSound, playNewRequestSound } from "@/lib/notificationSounds";
import { updateDriverLocation } from "@/lib/driverLocation";
import { useVoiceNavigation } from "@/hooks/useVoiceNavigation";
import { filterActiveRides, expireOldRides } from "@/lib/rideExpiry";
import { normalizeRideRow } from "@/lib/rideContract";
import { preloadAllTownPricing } from "@/hooks/useTownPricing";
import { useNearbyDrivers } from "@/hooks/useNearbyDrivers";
import { detectTown } from "@/lib/towns";
import LazyMapboxMap from "@/components/map/LazyMapboxMap";
import RideGlassPanel from "@/components/ride/RideGlassPanel";
import { glassSurface, redCta, RIDE_RED, RIDE_TEXT, RIDE_TEXT_2 } from "@/components/ride/rideGlass";

import { canCurrentDriverOperate, isCurrentDriverTopDriver } from "@/lib/businessApi";
import { NotificationBell } from "@/components/NotificationCenter";

import DriverSettingsSheet from "@/components/driver/DriverSettingsSheet";
import type { Coordinates } from "@/lib/osrm";
import { useAgoraCall } from "@/hooks/useAgoraCall";
import IncomingCallModal from "@/components/ride/IncomingCallModal";
import ActiveCallOverlay from "@/components/ride/ActiveCallOverlay";
import DriverEarningsDashboard from "@/components/driver/DriverEarningsDashboard";
import DriverSelfieCheck from "@/components/driver/DriverSelfieCheck";
import FullScreenNavigation, { type RiderInfo } from "@/components/driver/FullScreenNavigation";
import TripCollectSheet from "@/components/driver/TripCollectSheet";

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
  // Availability is three-valued, not two: offline (isOnline=false),
  // online-but-not-accepting (isOnline=true, acceptingRides=false — right
  // after a drop-off, before the driver taps "Take rides"), and
  // online-and-available (both true). Only the third should ever surface
  // new-request alerts.
  const [acceptingRides, setAcceptingRides] = useState(true);
  const [justCompletedTrip, setJustCompletedTrip] = useState<{ id: string; fare: number; dropoff_address: string; completedAt: string } | null>(null);
  // 4r — set from refresh()'s driver_collected_at check; independent of
  // justCompletedTrip so it also fires on a fresh page load, not just right
  // after this session's own completeTrip() call.
  const [uncollectedRide, setUncollectedRide] = useState<{ id: string; fare: number; payment_method: string; dropoff_address: string; user_id: string } | null>(null);
  const [locationDenied, setLocationDenied] = useState(false);
  const [todayFares, setTodayFares] = useState<number | null>(null);
  const [todayCommission, setTodayCommission] = useState<number | null>(null);
  const [weekEarnings, setWeekEarnings] = useState<number | null>(null);
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
    // Today's fares/commission are the SAME per-ride records split into
    // their two components (fare_amount, platform_fee) rather than a
    // separately-derived number, so "$X in fares · $Y commission" always
    // reconciles exactly to the net take above it.
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startOfYesterday = new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000);
    const startOfWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    let todaySum = 0;
    let yestSum = 0;
    let weekSum = 0;
    let todayFareSum = 0;
    let todayCommissionSum = 0;
    for (const e of data.earnings) {
      const t = new Date(e.created_at).getTime();
      if (t >= startOfToday.getTime()) {
        todaySum += Number(e.driver_earnings);
        todayFareSum += Number(e.fare_amount);
        todayCommissionSum += Number(e.platform_fee);
      } else if (t >= startOfYesterday.getTime()) {
        yestSum += Number(e.driver_earnings);
      }
      if (t >= startOfWeek.getTime()) weekSum += Number(e.driver_earnings);
    }
    setTodayEarnings(todaySum);
    setYesterdayEarnings(yestSum);
    setTodayFares(todayFareSum);
    setTodayCommission(todayCommissionSum);
    setWeekEarnings(weekSum);
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
  // Warms the shared town-pricing cache useTownPricing() reads from
  // elsewhere — the result itself isn't needed locally on this screen.
  useEffect(() => { void preloadAllTownPricing(); }, []);

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
  // Dispatch must only consider "online AND available" — a driver who just
  // dropped someone off (online, not yet accepting) shouldn't be alerted to
  // new requests until they tap "Take rides".
  const newRideAlert = useDriverRideAlerts(isOnline && acceptingRides, driverServiceArea, profile?.gender);

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

  // Area card — real nearby-driver count from live positions (same hook the
  // rider side uses), not an invented demand verdict. Only active while
  // online, and excludes this driver's own position from the count.
  const nearbyDrivers = useNearbyDrivers(isOnline, driverCoords, 2);
  const nearbyDriverCount = nearbyDrivers.filter((d) => d.id !== user?.id).length;
  const areaTown = driverCoords ? detectTown(driverCoords.lat, driverCoords.lng) : null;

  const handleTakeRides = () => {
    setAcceptingRides(true);
    setJustCompletedTrip(null);
  };

  // Location tracking for admin monitoring
  const prevLocationRef = useRef<{ lat: number; lng: number; time: number } | null>(null);

  const startLocationTracking = () => {
    stopLocationTracking();
    if (!navigator.geolocation) return;
    const handlePos = (pos: GeolocationPosition) => {
      const { latitude, longitude } = pos.coords;
      updateDriverLocation(latitude, longitude);
      setDriverCoords({ lat: latitude, lng: longitude });
      setLocationDenied(false);

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
    navigator.geolocation.getCurrentPosition(handlePos, () => setLocationDenied(true));
    // Update every 10 seconds
    locationIntervalRef.current = setInterval(() => {
      navigator.geolocation.getCurrentPosition(handlePos, () => setLocationDenied(true));
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
        setAcceptingRides(true);
      } else {
        setJustCompletedTrip(null);
      }

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

      // 4r force-quit recovery: a completed ride the driver never confirmed
      // collection for (driver_collected_at still null) must reopen the
      // collect screen on relaunch, independent of any in-memory state from
      // the session that completed it — "an uncollected cash trip cannot be
      // lost." Runs every refresh(), not just on mount, so it also catches
      // completion happening while this query was in flight.
      const { data: uncollectedRow } = await supabase
        .from('rides')
        .select('id, fare, payment_method, dropoff_address, user_id')
        .or(`driver_id.eq.${p.id},driver_id.eq.${user?.id}`)
        .eq('status', 'completed')
        .is('driver_collected_at', null)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      setUncollectedRide(uncollectedRow ?? null);

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

  // Active trip — 4p (en route to pickup) / 4q (in trip) live entirely in
  // FullScreenNavigation now; there's no more "trip connected, tap Navigate
  // to start turn-by-turn" middle screen. Both mockups show navigation
  // owning the screen from the moment a request is accepted.
  if (activeTrip) {
    return (
      <>
        {/* Edge case: a new ride got matched before the previous one's
            collection was confirmed (dispatch marks the driver available
            again immediately on completion) — collection still wins. */}
        {uncollectedRide && (
          <TripCollectSheet
            ride={uncollectedRide}
            onDone={() => { setUncollectedRide(null); refresh(); }}
          />
        )}
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
            setJustCompletedTrip({
              id: activeTrip.id,
              fare: activeTrip.fare,
              dropoff_address: activeTrip.dropoff_address,
              completedAt: new Date().toISOString(),
            });
            setAcceptingRides(false);
            setActiveTrip(null);
            fetchDriverBalance();
            refresh();
          }}
          onExit={() => {}}
          onStartCall={startCall}
          callStatus={callStatus}
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
    <div className="relative w-full h-[100dvh] overflow-hidden bg-background">
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

      {/* 4r — collect/rate screen for a completed ride the driver hasn't
          confirmed yet. Overlays the live map already rendered below (dim
          scrim + sheet, no map of its own) and takes priority over the rest
          of the idle screen until confirmed. */}
      {uncollectedRide && (
        <TripCollectSheet
          ride={uncollectedRide}
          onDone={() => { setUncollectedRide(null); refresh(); }}
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

      {/* Map — live, never dimmed, since the driver is looking at where
          they actually are and who else is around. Frame 2 gets a very
          slight scrim just to keep the taller sheet legible. */}
      <div className="absolute inset-0">
        <LazyMapboxMap
          pickup={null}
          dropoff={null}
          driverLocation={driverCoords}
          drivers={nearbyDrivers.filter((d) => d.id !== user?.id)}
          className="w-full h-full"
          height="100%"
        />
      </div>
      {justCompletedTrip && (
        <div className="absolute inset-0 pointer-events-none" style={{ background: "rgba(17,17,17,.06)" }} />
      )}

      {/* Floating map chrome — menu (settings/nav hub) + rating pill */}
      <div className="absolute z-20 flex items-center" style={{ top: "calc(env(safe-area-inset-top) + 7px)", left: 16, right: 16, gap: 10 }}>
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          aria-label="Menu"
          className="shrink-0 flex items-center justify-center rounded-full active:scale-90 transition-transform"
          style={{ width: 44, height: 44, ...glassSurface }}
        >
          <Menu style={{ width: 20, height: 20, color: RIDE_TEXT }} strokeWidth={2.2} />
        </button>
        <div className="shrink-0"><NotificationBell /></div>
        <span
          className="ml-auto inline-flex items-center shrink-0"
          style={{ height: 44, padding: "0 14px", borderRadius: 999, gap: 7, ...glassSurface }}
        >
          <Star style={{ width: 14, height: 14, fill: "#FFDD00", color: "#FFDD00" }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: RIDE_TEXT }}>
            {profile?.rating_avg ? profile.rating_avg.toFixed(1) : "New"}
          </span>
          <span className="rounded-full shrink-0" style={{ width: 2.5, height: 2.5, background: RIDE_TEXT_2 }} />
          <span className="whitespace-nowrap" style={{ fontSize: 12.5, fontWeight: 500, color: RIDE_TEXT_2 }}>
            {profile?.total_trips ?? 0} trips
          </span>
        </span>
      </div>

      {/* Bottom sheet — the shell used across the redesigned rider flow,
          anchored above DriverBottomNav rather than replacing it (that's the
          only way to reach Trips/Profile from anywhere in the driver app). */}
      <div className="absolute left-0 right-0 z-20" style={{ bottom: "calc(4rem + env(safe-area-inset-bottom, 0px))" }}>
        <RideGlassPanel
          panelStyle={{
            background: "rgba(255,255,255,.86)",
            backdropFilter: "blur(28px) saturate(190%)",
            WebkitBackdropFilter: "blur(28px) saturate(190%)",
            boxShadow: "inset 0 0 0 .5px rgba(255,255,255,.6), 0 -8px 30px rgba(17,17,17,.06)",
          }}
          style={{ maxHeight: "78vh" }}
        >
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
            <div className="p-4" style={{ display: "flex", flexDirection: "column", gap: 13 }}>
              {/* Section 1 — earnings header: the driver's own take, with the
                  arithmetic shown so it can be checked, not just trusted. */}
              <div className="flex items-end justify-between" style={{ gap: 12 }}>
                <div className="min-w-0">
                  <p style={{ fontSize: 11, fontWeight: 700, color: RIDE_TEXT_2, textTransform: "uppercase", letterSpacing: ".12em" }}>
                    Your take today
                  </p>
                  <p className="tabular-nums" style={{ marginTop: 4, fontSize: 34, fontWeight: 700, letterSpacing: "-.035em", lineHeight: 1, color: RIDE_TEXT }}>
                    {todayEarnings !== null ? fmtUSD(todayEarnings) : "—"}
                  </p>
                  {todayFares !== null && todayCommission !== null && (
                    <p style={{ marginTop: 5, fontSize: 11.5, fontWeight: 500, lineHeight: 1.2, color: RIDE_TEXT_2 }}>
                      {fmtUSD(todayFares)} in fares · {fmtUSD(todayCommission)} commission
                    </p>
                  )}
                </div>
                <span
                  className="inline-flex items-center shrink-0"
                  style={{ height: 28, padding: "0 11px", borderRadius: 999, gap: 5, background: "rgba(52,199,89,.14)" }}
                >
                  <CheckCircle2 style={{ width: 13, height: 13, color: "#15803d" }} strokeWidth={3} />
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: "#15803d" }}>
                    {todayTrips} trip{todayTrips !== 1 ? "s" : ""}
                  </span>
                </span>
              </div>

              {/* Section 2 — two stat tiles, both derivable from completed trips */}
              <div className="flex items-stretch" style={{ gap: 8 }}>
                <div
                  className="min-w-0"
                  style={{ flex: 1, padding: "10px 12px", borderRadius: 14, background: "linear-gradient(160deg, rgba(255,255,255,.8), rgba(255,255,255,.48))", boxShadow: "inset 0 .75px 0 rgba(255,255,255,.98), inset 0 0 0 .5px rgba(17,17,17,.09)" }}
                >
                  <p style={{ fontSize: 10.5, fontWeight: 600, color: RIDE_TEXT_2 }}>Online today</p>
                  <p className="tabular-nums" style={{ marginTop: 2, fontSize: 15, fontWeight: 700, color: RIDE_TEXT }}>
                    {onlineMinutesToday !== null ? `${Math.floor(onlineMinutesToday / 60)}h ${onlineMinutesToday % 60}m` : "—"}
                  </p>
                </div>
                <div
                  className="min-w-0"
                  style={{ flex: 1, padding: "10px 12px", borderRadius: 14, background: "linear-gradient(160deg, rgba(255,255,255,.8), rgba(255,255,255,.48))", boxShadow: "inset 0 .75px 0 rgba(255,255,255,.98), inset 0 0 0 .5px rgba(17,17,17,.09)" }}
                >
                  <p style={{ fontSize: 10.5, fontWeight: 600, color: RIDE_TEXT_2 }}>This week</p>
                  <p className="tabular-nums" style={{ marginTop: 2, fontSize: 15, fontWeight: 700, color: RIDE_TEXT }}>
                    {weekEarnings !== null ? fmtUSD(weekEarnings) : "—"}
                  </p>
                </div>
              </div>

              {/* Requests / Wallet — not in the mockup, but removing the
                  hero "New ride requests" card and the quick-actions grid
                  otherwise leaves no way to reach either from this screen
                  (DriverBottomNav only has Home/Earnings/Trips/Profile). Kept
                  low-key so the redesign's hierarchy still holds. */}
              <div className="flex items-center" style={{ gap: 8 }}>
                <button
                  type="button"
                  onClick={() => { newRideAlert.clearBadge(); nav("/driver/requests"); }}
                  className="relative flex items-center justify-center active:scale-95 transition-transform"
                  style={{ flex: 1, height: 36, borderRadius: 999, gap: 6, background: "linear-gradient(160deg, rgba(255,255,255,.8), rgba(255,255,255,.48))", boxShadow: "inset 0 .75px 0 rgba(255,255,255,.98), inset 0 0 0 .5px rgba(17,17,17,.09)" }}
                >
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: RIDE_TEXT }}>
                    Requests{rides.length > 0 ? ` · ${rides.length}` : ""}
                  </span>
                  {newRideAlert.badgeCount > 0 && (
                    <span className="rounded-full" style={{ width: 7, height: 7, background: RIDE_RED }} />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => nav("/driver/wallet")}
                  className="flex items-center justify-center active:scale-95 transition-transform"
                  style={{ flex: 1, height: 36, borderRadius: 999, background: "linear-gradient(160deg, rgba(255,255,255,.8), rgba(255,255,255,.48))", boxShadow: "inset 0 .75px 0 rgba(255,255,255,.98), inset 0 0 0 .5px rgba(17,17,17,.09)" }}
                >
                  <span className="tabular-nums" style={{ fontSize: 12.5, fontWeight: 700, color: RIDE_TEXT }}>
                    Wallet · {fmtUSD(driverBalance)}
                  </span>
                </button>
              </div>

              {/* Section 3 — trip completion card, frame 2 only */}
              {justCompletedTrip && (
                <div
                  className="flex items-center"
                  style={{ background: "linear-gradient(135deg, rgba(52,199,89,.14), rgba(52,199,89,.06))", boxShadow: "inset 0 .5px 0 rgba(255,255,255,.85), inset 0 0 0 .5px rgba(34,164,71,.24)", borderRadius: 16, padding: "11px 13px", gap: 11 }}
                >
                  <span className="shrink-0 flex items-center justify-center" style={{ width: 34, height: 34, borderRadius: 11, background: "rgba(255,255,255,.7)" }}>
                    <CheckCircle2 style={{ width: 17, height: 17, color: "#15803d" }} strokeWidth={3} />
                  </span>
                  <div className="min-w-0">
                    <p style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.2, color: RIDE_TEXT }}>
                      Trip completed · {fmtUSD(justCompletedTrip.fare)} added
                    </p>
                    <p className="truncate" style={{ marginTop: 2, fontSize: 11.5, fontWeight: 500, lineHeight: 1.2, color: RIDE_TEXT_2 }}>
                      {justCompletedTrip.dropoff_address} · {new Date(justCompletedTrip.completedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                </div>
              )}

              {/* Section 4 — area card: real nearby-driver count, no invented demand verdict */}
              <div
                className="flex items-center"
                style={{ background: "linear-gradient(135deg, rgba(238,243,252,.85), rgba(26,115,232,.07))", boxShadow: "inset 0 .5px 0 rgba(255,255,255,.85), inset 0 0 0 .5px rgba(26,115,232,.18)", borderRadius: 16, padding: "11px 13px", gap: 11 }}
              >
                <MapPin style={{ width: 17, height: 17, color: "#1A73E8" }} fill="#1A73E8" strokeWidth={1.9} className="shrink-0" />
                <div className="min-w-0">
                  <p style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.2, color: RIDE_TEXT }}>
                    {areaTown ? `Waiting near ${areaTown.name}` : "Locating…"}
                  </p>
                  <p style={{ marginTop: 2, fontSize: 11.5, fontWeight: 500, lineHeight: 1.2, color: RIDE_TEXT_2 }}>
                    {nearbyDriverCount} other driver{nearbyDriverCount !== 1 ? "s" : ""} online within 2 km
                  </p>
                </div>
              </div>

              {/* Section 5 — online block: the largest interactive element,
                  either frame. Three-valued: offline / online-not-accepting
                  (frame 2) / online-and-available (frame 1). */}
              {!isOnline ? (
                <div className="flex items-center" style={{ padding: "12px 14px", borderRadius: 16, gap: 12, background: "rgba(17,17,17,.06)" }}>
                  <span className="shrink-0 flex items-center justify-center rounded-full" style={{ width: 36, height: 36, background: "rgba(17,17,17,.08)" }}>
                    <Power style={{ width: 18, height: 18, color: RIDE_TEXT_2 }} strokeWidth={2.4} />
                  </span>
                  <div className="min-w-0" style={{ flex: 1 }}>
                    <p style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.2, color: RIDE_TEXT }}>You're offline</p>
                    <p style={{ marginTop: 2, fontSize: 11.5, fontWeight: 500, lineHeight: 1.2, color: RIDE_TEXT_2 }}>Not receiving requests</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleOnline(true)}
                    disabled={togglingOnline}
                    aria-label="Go online"
                    className="shrink-0 disabled:opacity-60"
                    style={{ width: 52, height: 30, borderRadius: 999, padding: "0 3px", display: "flex", alignItems: "center", justifyContent: "flex-start", background: "rgba(17,17,17,.15)" }}
                  >
                    <span className="rounded-full" style={{ width: 24, height: 24, background: "#fff", boxShadow: "0 1px 4px rgba(0,0,0,.28)" }} />
                  </button>
                </div>
              ) : justCompletedTrip ? (
                <div className="relative flex items-center" style={{ padding: "12px 14px", borderRadius: 16, gap: 12, overflow: "hidden", ...redCta }}>
                  <span className="pointer-events-none absolute inset-x-0 top-0" style={{ height: "50%", background: "linear-gradient(180deg, rgba(255,255,255,.18), rgba(255,255,255,0))" }} />
                  <span className="relative shrink-0 flex items-center justify-center rounded-full" style={{ width: 36, height: 36, background: "rgba(255,255,255,.2)", boxShadow: "inset 0 0 0 .5px rgba(255,255,255,.35)" }}>
                    <Power style={{ width: 18, height: 18, color: "#fff" }} strokeWidth={2.4} />
                  </span>
                  <div className="relative min-w-0" style={{ flex: 1 }}>
                    <p style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.2, color: "#fff" }}>You're online</p>
                    <p style={{ marginTop: 2, fontSize: 11.5, fontWeight: 500, lineHeight: 1.2, color: "rgba(255,255,255,.8)" }}>
                      Tap when you're ready for the next ride
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleTakeRides}
                    className="relative shrink-0 active:scale-95 transition-transform"
                    style={{ height: 36, padding: "0 16px", borderRadius: 999, background: "#FFDD00" }}
                  >
                    <span style={{ fontSize: 13.5, fontWeight: 700, color: "#1F1F1F" }}>Take rides</span>
                  </button>
                </div>
              ) : (
                <div className="flex items-center" style={{ padding: "12px 14px", borderRadius: 16, gap: 12, ...redCta }}>
                  <span className="shrink-0 flex items-center justify-center rounded-full" style={{ width: 36, height: 36, background: "rgba(255,255,255,.2)", boxShadow: "inset 0 0 0 .5px rgba(255,255,255,.35)" }}>
                    <Power style={{ width: 18, height: 18, color: "#fff" }} strokeWidth={2.4} />
                  </span>
                  <div className="min-w-0" style={{ flex: 1 }}>
                    <p style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.2, color: "#fff" }}>You're online</p>
                    {locationDenied ? (
                      <button
                        type="button"
                        onClick={startLocationTracking}
                        className="text-left underline"
                        style={{ marginTop: 2, fontSize: 11.5, fontWeight: 700, lineHeight: 1.2, color: "#fff" }}
                      >
                        Location off — requests can't reach you. Tap to retry.
                      </button>
                    ) : (
                      <p style={{ marginTop: 2, fontSize: 11.5, fontWeight: 500, lineHeight: 1.2, color: "rgba(255,255,255,.8)" }}>
                        Requests will reach you
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleOnline(false)}
                    disabled={togglingOnline}
                    aria-label="Go offline"
                    className="shrink-0 disabled:opacity-60"
                    style={{ width: 52, height: 30, borderRadius: 999, padding: "0 3px", display: "flex", alignItems: "center", justifyContent: "flex-end", background: "rgba(255,255,255,.28)", boxShadow: "inset 0 1px 2px rgba(0,0,0,.16)" }}
                  >
                    <span className="rounded-full" style={{ width: 24, height: 24, background: "#fff", boxShadow: "0 1px 4px rgba(0,0,0,.28)" }} />
                  </button>
                </div>
              )}

              {/* Earnings Dashboard — opened via the bottom-nav Earnings tab
                  (nav state); it has no close button of its own, so this is
                  the only way to dismiss it without navigating away. */}
              {earningsOpen && (
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => setEarningsOpen(false)}
                    className="text-[12px] font-bold"
                    style={{ color: RIDE_RED }}
                  >
                    Hide earnings
                  </button>
                  <DriverEarningsDashboard />
                </div>
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

              {/* Section 6 — iOS home indicator */}
              <div style={{ padding: "6px 0 10px" }} className="flex justify-center">
                <span className="rounded-full" style={{ width: 140, height: 5, background: RIDE_TEXT }} />
              </div>
            </div>
          </div>
        </RideGlassPanel>
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
