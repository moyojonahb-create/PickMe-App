import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate, useLocation, Navigate } from "react-router-dom";
import DriverBottomNav from "@/components/driver/DriverBottomNav";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/hooks/useAuth";
import { useFemaleTheme } from "@/hooks/useFemaleTheme";
import { useOpenRidesRealtime } from "@/hooks/useRideRealtime";
import { requestNativeLocationPermission } from "@/lib/nativeBridge";
import { getDriverProfile, type DriverProfile } from "@/lib/offerHelpers";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { vibrateAlert, showBrowserNotification } from "@/lib/alerts";
import { playAcceptedSound } from "@/lib/notificationSounds";
import { updateDriverLocation } from "@/lib/driverLocation";
import { useVoiceNavigation } from "@/hooks/useVoiceNavigation";
import { normalizeRideRow } from "@/lib/rideContract";
import { preloadAllTownPricing } from "@/hooks/useTownPricing";
import { RIDE_RED, RIDE_TEXT } from "@/components/ride/rideGlass";

import { canCurrentDriverOperate } from "@/lib/businessApi";

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

import { subscribeRiderComing } from "@/lib/rideSignals";
import { setDriverOnline, sendPresenceHeartbeat } from "@/lib/driverPresence";
import { useDriverRideAlerts, type DriverServiceArea } from "@/hooks/useDriverRideAlerts";
import { useAppBootstrap } from "@/hooks/useAppBootstrap";

// Smart USD format: $4 for whole, $4.50 for halves
function fmtUSD(n: number): string {
  return n % 1 === 0 ? `$${n}` : `$${n.toFixed(2)}`;
}

export default function DriverDashboard() {
  const nav = useNavigate();
  const location = useLocation();
  const { user, loading: authLoading } = useAuth();
  const { setFemaleMode } = useFemaleTheme();
  const { driverProfile: cachedDriverProfile, refreshDriverProfile } = useAppBootstrap();

  // Seeded from the splash-time cache (see useAppBootstrap) so a returning
  // driver gets a fully-rendered dashboard on the very first frame instead
  // of a skeleton — refresh() below still re-fetches for freshness, but
  // never flips `loading` back to true, so there's no flash once seeded.
  const [profile, setProfile] = useState<DriverProfile | null>((cachedDriverProfile as unknown as DriverProfile) ?? null);
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
  const [activeTrip, setActiveTrip] = useState<{ id: string; pickup_address: string; dropoff_address: string; fare: number; user_id: string; status: string; pickup_lat: number; pickup_lon: number; dropoff_lat: number; dropoff_lon: number; payment_method: string; distance_km?: number | null; passenger_count?: number | null; passenger_name?: string | null; passenger_phone?: string | null; driver_arrived_at?: string | null } | null>(null);
  const [riderInfo, setRiderInfo] = useState<RiderInfo | null>(null);
  const [earningsOpen, setEarningsOpen] = useState(Boolean((location.state as { openEarnings?: boolean } | null)?.openEarnings));
  const [driverCoords, setDriverCoords] = useState<Coordinates | null>(null);
  const [riderPhone, setRiderPhone] = useState<string | null>(null);
  const [selfieCheckOpen, setSelfieCheckOpen] = useState(false);
  const [pendingOnlineAfterSelfie, setPendingOnlineAfterSelfie] = useState(false);
  // Availability is three-valued, not two: offline (isOnline=false),
  // online-but-not-accepting (isOnline=true, acceptingRides=false — right
  // after a drop-off, before the driver taps "Take rides"), and
  // online-and-available (both true). Only the third should ever surface
  // new-request alerts.
  const [acceptingRides, setAcceptingRides] = useState(true);
  // Set from refresh()'s driver_collected_at check, so it also fires on a
  // fresh page load, not just right after this session's own completeTrip().
  const [uncollectedRide, setUncollectedRide] = useState<{ id: string; fare: number; payment_method: string; dropoff_address: string; user_id: string } | null>(null);

  const locationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const presenceIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const latestCoordsRef = useRef<{ lat: number; lng: number } | null>(null);
  const presenceFailuresRef = useRef(0);
  const { speak, isSupported: voiceSupported } = useVoiceNavigation({ enabled: voiceEnabled });
  // Warms the shared town-pricing cache useTownPricing() reads from
  // elsewhere — the result itself isn't needed locally on this screen.
  useEffect(() => { void preloadAllTownPricing(); }, []);

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

  // ── Listen for "rider is on the way" broadcast from rider ──
  useEffect(() => {
    if (!activeTrip?.id) return;
    const tripId = activeTrip.id;
    const unsub = subscribeRiderComing(tripId, async () => {
      const { shouldFireOnce } = await import("@/lib/notifyThrottle");
      if (!shouldFireOnce(`ride:${tripId}`, "rider_coming", 30_000)) return;
      // Sound + vibrate — FullScreenNavigation's own UI is what shows the
      // "rider coming" state; this effect only exists for the audio/haptic
      // cue, which needs to fire regardless of which part of the nav screen
      // is currently visible.
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

  // Location tracking for admin monitoring
  const prevLocationRef = useRef<{ lat: number; lng: number; time: number } | null>(null);

  const startLocationTracking = async () => {
    stopLocationTracking();
    if (!navigator.geolocation) return;
    // A driver believing they're online while dispatch can't actually reach
    // them (no runtime location permission granted) is the worst failure
    // mode here — this is what makes Android's permission dialog actually
    // appear, instead of getCurrentPosition below failing silently.
    await requestNativeLocationPermission();
    const handlePos = (pos: GeolocationPosition) => {
      const { latitude, longitude } = pos.coords;
      updateDriverLocation(latitude, longitude);
      const coords = { lat: latitude, lng: longitude };
      setDriverCoords(coords);
      latestCoordsRef.current = coords;

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

    // Presence heartbeat: the backend expires the Redis presence key after
    // 90s and it is only written by this endpoint, so an online driver must
    // re-post it periodically. A 30s interval gives us two chances to miss
    // before dispatch stops considering them even though the UI still says
    // Online. Heartbeat failures are counted but never take the driver offline.
    const sendHeartbeat = async () => {
      const ok = await sendPresenceHeartbeat(latestCoordsRef.current);
      if (ok) {
        presenceFailuresRef.current = 0;
      } else {
        presenceFailuresRef.current += 1;
      }
    };
    void sendHeartbeat();
    presenceIntervalRef.current = setInterval(() => {
      void sendHeartbeat();
    }, 30000);
  };

  const stopLocationTracking = () => {
    if (locationIntervalRef.current) {
      clearInterval(locationIntervalRef.current);
      locationIntervalRef.current = null;
    }
    if (presenceIntervalRef.current) {
      clearInterval(presenceIntervalRef.current);
      presenceIntervalRef.current = null;
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
          driver_arrived_at: activeTripRow.driver_arrived_at != null ? String(activeTripRow.driver_arrived_at) : null,
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
      // (profile, approval status, active trip) is in hand.
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
            setAcceptingRides(false);
            setActiveTrip(null);
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

  // Idle (no active trip): this used to be its own "YOUR TAKE TODAY" home
  // screen. /driver/requests (4B) now owns that role — online status,
  // wallet balance, and the request list all live there in the current
  // design. This screen stays mounted only to run the overlays that must
  // survive regardless of which driver screen is showing (selfie gate,
  // fatigue alert, in-app calls, uncollected-cash recovery) and to host the
  // Earnings tab's nav-state deep link; otherwise it hands off immediately.
  return (
    <>
      <DriverSelfieCheck
        open={selfieCheckOpen}
        onVerified={() => {
          setSelfieCheckOpen(false);
          sessionStorage.setItem('pickme-selfie-verified', Date.now().toString());
          if (pendingOnlineAfterSelfie) { setPendingOnlineAfterSelfie(false); toggleOnline(true); }
        }}
        onSkip={() => {
          setSelfieCheckOpen(false);
          sessionStorage.setItem('pickme-selfie-verified', Date.now().toString());
          setPendingOnlineAfterSelfie(true);
          toggleOnline(true);
        }}
      />

      {fatigueState.isFatigued && (
        <FatigueAlert breakTimeRemaining={fatigueState.breakTimeRemaining} totalHours={fatigueState.totalOnlineHours} />
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

      {/* Edge case: a ride completed and hasn't been collected/confirmed yet
          — takes priority over handing off to the request list. */}
      {uncollectedRide && (
        <TripCollectSheet
          ride={uncollectedRide}
          onDone={() => { setUncollectedRide(null); refresh(); }}
        />
      )}

      {earningsOpen ? (
        <div className="min-h-[100dvh] pb-24" style={{ background: "#F2F4F7" }}>
          <div
            className="sticky top-0 z-20 flex items-center justify-between px-4 py-3.5"
            style={{ paddingTop: "calc(env(safe-area-inset-top) + 14px)", background: "rgba(255,255,255,.94)", backdropFilter: "blur(20px) saturate(190%)", WebkitBackdropFilter: "blur(20px) saturate(190%)" }}
          >
            <span className="text-[16px] font-bold" style={{ color: RIDE_TEXT }}>Earnings</span>
            <button type="button" onClick={() => setEarningsOpen(false)} className="text-[13px] font-bold" style={{ color: RIDE_RED }}>Close</button>
          </div>
          <div className="max-w-lg mx-auto p-4">
            <DriverEarningsDashboard />
          </div>
          <DriverBottomNav requestBadgeCount={newRideAlert.badgeCount} />
        </div>
      ) : !uncollectedRide ? (
        <Navigate to="/driver/requests" replace />
      ) : null}
    </>
  );
}
