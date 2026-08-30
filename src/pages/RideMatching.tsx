import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, CheckCheck, ChevronRight, Locate, MapPin, MessageCircle, Minus, Phone, Plus, Radar, ShieldAlert, ShieldCheck, Star, User, X } from 'lucide-react';
import LazyMapboxMap from '@/components/map/LazyMapboxMap';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/hooks/use-toast';
import { haptic } from '@/lib/haptics';
import { playNewRequestSound } from '@/lib/notificationSounds';
import { fetchPendingOffers, acceptOffer, declineOffer, fetchDriversByIds, type Offer, type DriverProfile } from '@/lib/offerHelpers';
import { useTownPricing, calculateRecommendedFare, getFareStep } from '@/hooks/useTownPricing';
import {
  cancelRideRequest,
  fetchAssignedDriver,
  fetchDriverLocation,
  fetchRideById,
  updateRideFare,
  type MatchedDriver,
  type MatchingRide,
} from '@/lib/rideMatching';
import { useRideViewerCount } from '@/lib/rideViewerPresence';
import { useNearbyDrivers } from '@/hooks/useNearbyDrivers';
import { decodePolyline, trimRouteAhead } from '@/lib/routeProgress';
import { submitDriverRating, createTip } from '@/lib/businessApi';
import carSearchSide from '@/assets/cars/car-search-side.png';
import carFrontEconomy from '@/assets/cars/car-front-economy.png';
import carSlantShare from '@/assets/cars/car-slant-share.png';
import carParcel from '@/assets/cars/car-parcel.png';
import CancelReasonSheet from '@/components/ride/CancelReasonSheet';
import RideGlassPanel from '@/components/ride/RideGlassPanel';
import NoteToDriverSheet from '@/components/ride/NoteToDriverSheet';
import SafetySheet from '@/components/ride/SafetySheet';
import ShareTripButton from '@/components/ride/ShareTripButton';
import { openTripReceipt } from '@/components/ride/TripReceiptButton';
import DriverMessageSheet from '@/components/driver/DriverMessageSheet';
import EcoCashPaymentModal from '@/components/wallet/EcoCashPaymentModal';
import IncomingCallModal from '@/components/ride/IncomingCallModal';
import ActiveCallOverlay from '@/components/ride/ActiveCallOverlay';
import { useAgoraCall } from '@/hooks/useAgoraCall';
import { useUnreadRideMessages } from '@/hooks/useUnreadRideMessages';

import { glassSurface, redCta, tintBlue, tintRed, RIDE_RED, RIDE_TEXT, RIDE_TEXT_2, RIDE_TEXT_3, RIDE_YELLOW } from '@/components/ride/rideGlass';
import type { CSSProperties } from 'react';

/** Pickup-note row glass (4c) — its own blur value, distinct from the shared
 * glassSurface/glassPanel tokens, so kept local rather than added to those. */
const noteRowGlass: CSSProperties = {
  background: 'rgba(255,255,255,.55)',
  backdropFilter: 'blur(20px) saturate(180%)',
  WebkitBackdropFilter: 'blur(20px) saturate(180%)',
  boxShadow: 'inset 0 .5px 0 rgba(255,255,255,.9), inset 0 0 0 .5px rgba(17,17,17,.07), 0 6px 14px rgba(0,0,0,.05)',
};

/** In-trip (4f) map chrome glass — status pill + recentre button. Its own
 * gradient/blur, distinct from the other glass tokens in this file. */
const chromeGlass: CSSProperties = {
  background: 'linear-gradient(160deg, rgba(255,255,255,.82), rgba(255,255,255,.5))',
  backdropFilter: 'blur(26px) saturate(200%)',
  WebkitBackdropFilter: 'blur(26px) saturate(200%)',
  boxShadow: 'inset 0 .75px 0 rgba(255,255,255,.98), inset 0 0 0 .5px rgba(255,255,255,.62), 0 8px 20px rgba(17,17,17,.09)',
};

/** In-trip (4f) Share trip / message-icon-button glass. */
const shareGlass: CSSProperties = {
  background: 'linear-gradient(160deg, rgba(255,255,255,.8), rgba(255,255,255,.48))',
  backdropFilter: 'blur(26px) saturate(200%)',
  WebkitBackdropFilter: 'blur(26px) saturate(200%)',
  boxShadow: 'inset 0 .75px 0 rgba(255,255,255,.98), inset 0 0 0 1px rgba(17,17,17,.09), 0 8px 18px rgba(17,17,17,.06)',
};
const messageIconGlass: CSSProperties = {
  background: 'linear-gradient(160deg, rgba(255,255,255,.8), rgba(255,255,255,.48))',
  boxShadow: 'inset 0 .75px 0 rgba(255,255,255,.98), inset 0 0 0 1px rgba(184,17,4,.2), 0 6px 14px rgba(17,17,17,.06)',
};

/** 4g rating card / Receipt button glass — same recipe, reused for both. */
const softGlass: CSSProperties = {
  background: 'linear-gradient(160deg, rgba(255,255,255,.8), rgba(255,255,255,.48))',
  backdropFilter: 'blur(26px) saturate(200%)',
  WebkitBackdropFilter: 'blur(26px) saturate(200%)',
  boxShadow: 'inset 0 .75px 0 rgba(255,255,255,.98), inset 0 0 0 .5px rgba(255,255,255,.62), 0 8px 18px rgba(17,17,17,.06)',
};
const receiptGlass: CSSProperties = {
  ...softGlass,
  boxShadow: 'inset 0 .75px 0 rgba(255,255,255,.98), inset 0 0 0 1px rgba(17,17,17,.09), 0 8px 18px rgba(17,17,17,.06)',
};
const tipChipUnselected: CSSProperties = {
  background: 'linear-gradient(160deg, rgba(255,255,255,.8), rgba(255,255,255,.48))',
  boxShadow: 'inset 0 .75px 0 rgba(255,255,255,.98), inset 0 0 0 .5px rgba(17,17,17,.09)',
};
const tipChipSelected: CSSProperties = {
  background: 'linear-gradient(135deg, rgba(255,250,205,.9), rgba(255,221,0,.16))',
  boxShadow: 'inset 0 .5px 0 rgba(255,255,255,.85), inset 0 0 0 .5px rgba(255,221,0,.45)',
};

const SEARCH_TIMEOUT_MS = 60_000;
// 5 steps × 60s = 5 minutes total search time before we give up and show
// "No drivers available" — each step also widens the search radius.
const RADIUS_STEPS_KM = [1, 3, 6, 10, 15];
// Same $0.50 increment the fare-offer logic uses elsewhere (useTownPricing) —
// the stepper here just calls into the existing offer-adjustment flow.
const FARE_STEP = getFareStep();
// Elapsed-time display caps at 5:00 regardless of how the underlying search
// (radius widening / timeout) is progressing — purely a reassurance timer.
const ELAPSED_CAP_SECONDS = 300;
// Matches the backend's DISPATCH_OFFER_TTL_SECONDS default (backend/internal/
// config/config.go). That TTL governs the separate dispatch-wave table
// (public.ride_offers) though — the rider-facing public.offers row a bid
// card is built from has no expires_at of its own, so this countdown is a
// client-side-only visual cue, not something the server enforces or sweeps.
// Accept still race-checks against the real row (offer.status==='pending')
// server-side, so a card that lingers past its ring never accepts silently.
const OFFER_TTL_SECONDS = 30;

const TIER_LABELS: Record<string, string> = { economy: 'Economy', share: 'Share Ride', parcel: 'Parcel' };
const TIER_ASSETS: Record<string, string> = { economy: carFrontEconomy, share: carSlantShare, parcel: carParcel };

const ACCEPTED_STATUSES = ['accepted', 'enroute', 'enroute_pickup', 'arrived', 'in_progress'];

export default function RideMatching() {
  const { rideId } = useParams<{ rideId: string }>();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  const [ride, setRide] = useState<MatchingRide | null>(null);
  const [driver, setDriver] = useState<MatchedDriver | null>(null);
  const [driverLocation, setDriverLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [remaining, setRemaining] = useState(60);
  const [radiusIndex, setRadiusIndex] = useState(0);
  const [timedOut, setTimedOut] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelSheetOpen, setCancelSheetOpen] = useState(false);
  const [accepting, setAccepting] = useState<string | null>(null);
  const [fareBumping, setFareBumping] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteValue, setNoteValue] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteReuseEveryTrip, setNoteReuseEveryTrip] = useState(false);
  const [preferredCenter, setPreferredCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [driverProfiles, setDriverProfiles] = useState<Record<string, DriverProfile & { full_name?: string | null }>>({});
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const [bidsNow, setBidsNow] = useState(() => Date.now());
  const [sheetTop, setSheetTop] = useState(0);
  const [safetyOpen, setSafetyOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [tipAmount, setTipAmount] = useState<number | null>(null);
  const [confirmingPayment, setConfirmingPayment] = useState(false);
  const [messageOpen, setMessageOpen] = useState(false);
  const [showEcoCashPay, setShowEcoCashPay] = useState(false);
  const [driverEcocash, setDriverEcocash] = useState<string | null>(null);
  // Rider wallet removed — direct payment to driver (mirrors RiderRideDetail).
  const walletPin: string | null = null;
  const unreadMessages = useUnreadRideMessages(ride?.id, user?.id, messageOpen);


  // In-app voice calling (Agora) — tel: is only a fallback.
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
    rideId: ride?.id ?? null,
    currentUserId: user?.id ?? "",
    otherUserId: driver?.user_id ?? null,
  });

  const sheetWrapRef = useRef<HTMLDivElement>(null);
  const noteLoadedForRide = useRef<string | null>(null);
  const waitStartedAt = useRef(Date.now());
  const searchStartedAt = useRef(Date.now());
  const announced = useRef(false);
  const parcelMatchAnnounced = useRef(false);
  const passengerMatchAnnounced = useRef(false);
  const [notifyBookerPref, setNotifyBookerPref] = useState(true);
  const [thirdPartyPassengerName, setThirdPartyPassengerName] = useState<string | null>(null);
  const prevOfferIds = useRef<Set<string>>(new Set());
  // ids we've already looked up, resolved or not. Without this, an id that
  // never resolves keeps `missing` non-empty forever and the effect re-runs
  // on its own state update — an endless query loop.
  const attemptedDriverIdsRef = useRef<Set<string>>(new Set());

  const isMatched = !!ride && ACCEPTED_STATUSES.includes(ride.status);

  // 'in_progress' is its own screen (4f, pickup already happened) — every
  // other accepted status still reads as "driver on the way to pickup" (4c).
  const inTrip = ride?.status === 'in_progress';
  // 4g — the driver ended the trip. Not in ACCEPTED_STATUSES, so isMatched
  // is already false here; this just names the state for the render branch.
  const isComplete = ride?.status === 'completed';
  const viewerCount = useRideViewerCount(!isMatched && !isComplete ? rideId : null);
  const { pricing: townPricing } = useTownPricing(ride?.town_id ?? null);

  /* ── Load ride ─────────────────────────────────────────────── */
  const loadRide = useCallback(async () => {
    if (!rideId) return;
    try {
      const row = await fetchRideById(rideId);
      if (!row) {
        toast({ title: 'Ride not found', variant: 'destructive' });
        navigate('/ride', { replace: true });
        return;
      }
      setRide(row);
      if (row.status === 'cancelled' || row.status === 'expired') {
        navigate('/ride', { replace: true });
      }
    } catch (e) {
      toast({ title: 'Could not load ride', description: (e as Error).message, variant: 'destructive' });
    }
  }, [rideId, navigate]);

  useEffect(() => {
    if (!authLoading && !user) navigate('/auth', { replace: true });
  }, [authLoading, user, navigate]);

  useEffect(() => { loadRide(); }, [loadRide]);

  /* ── Realtime: ride row + incoming offers ──────────────────── */
  useEffect(() => {
    if (!rideId) return;
    const channel = supabase
      .channel(`ride-matching-${rideId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rides', filter: `id=eq.${rideId}` }, () => loadRide())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'offers', filter: `ride_id=eq.${rideId}` }, () => {
        fetchPendingOffers(rideId).then(setOffers).catch(() => {});
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [rideId, loadRide]);

  /* ── Safety-net poll (weak networks / realtime drop-outs) ──── */
  useEffect(() => {
    if (isMatched || isComplete || !rideId) return;
    const id = setInterval(() => {
      loadRide();
      fetchPendingOffers(rideId).then(setOffers).catch(() => {});
    }, 5000);
    return () => clearInterval(id);
  }, [rideId, isMatched, isComplete, loadRide]);

  /* ── 60s countdown (widens search radius each cycle) + elapsed M:SS
     display + bid-card countdown rings — one shared 1s ticker instead of
     three separate intervals each forcing their own re-render of this whole
     screen, so a searching rider only re-renders once per second, not up
     to three times. ──────────────────────────────────────────────────── */
  useEffect(() => {
    if (isMatched || isComplete) return;
    const id = setInterval(() => {
      const left = Math.max(0, Math.ceil((SEARCH_TIMEOUT_MS - (Date.now() - waitStartedAt.current)) / 1000));
      setRemaining(left);
      if (left === 0) {
        setRadiusIndex((prev) => {
          if (prev >= RADIUS_STEPS_KM.length - 1) {
            setTimedOut(true);
            return prev;
          }
          waitStartedAt.current = Date.now();
          setRemaining(60);
          return prev + 1;
        });
      }
      setElapsedSeconds(Math.min(ELAPSED_CAP_SECONDS, Math.floor((Date.now() - searchStartedAt.current) / 1000)));
      setBidsNow(Date.now());
    }, 1000);
    return () => clearInterval(id);
  }, [isMatched, isComplete]);

  /* ── Measure the sheet's real rendered height so the floating bid stack
     can anchor 8px above its top edge instead of a hardcoded bottom value —
     the sheet's height changes with content (matched/timeout/searching). */
  useLayoutEffect(() => {
    const el = sheetWrapRef.current;
    if (!el) return;
    setSheetTop(el.getBoundingClientRect().height);
    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height;
      if (h != null) setSheetTop(h);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ── Load the note already sent with the request (the last rider_note
     trip_event for this ride) so the 4c pickup-note row shows what the
     driver actually sees, instead of starting blank every visit. Only
     loads once per ride — a save in this session should win locally. ── */
  useEffect(() => {
    if (!rideId || noteLoadedForRide.current === rideId) return;
    noteLoadedForRide.current = rideId;
    supabase
      .from('trip_events')
      .select('payload')
      .eq('ride_id', rideId)
      .eq('event_type', 'rider_note')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        const note = (data?.payload as Record<string, unknown> | null)?.note;
        if (typeof note === 'string') setNoteValue(note);
      });
  }, [rideId]);

  // So the reuse toggle reflects an already-saved default rather than
  // always starting off, if the rider set one from RideView earlier.
  useEffect(() => {
    if (!user?.id) return;
    (supabase as any).from('profiles').select('default_ride_note').eq('user_id', user.id).maybeSingle()
      .then(({ data }) => { if (data?.default_ride_note) setNoteReuseEveryTrip(true); });
  }, [user?.id]);

  /* ── Enrich raw offer rows with driver name/rating/vehicle for the bid
     cards — `offers` only carries driver_id, so batch-fetch any driver
     profiles we don't already have cached. ─────────────────────────── */
  useEffect(() => {
    const missing = Array.from(new Set(offers.map((o) => o.driver_id))).filter((id) => !driverProfiles[id]);
    const toFetch = missing.filter((id) => !attemptedDriverIdsRef.current.has(id));
    if (toFetch.length === 0) return;
    toFetch.forEach((id) => attemptedDriverIdsRef.current.add(id));
    let cancelled = false;
    fetchDriversByIds(toFetch).then((map) => {
      if (!cancelled) setDriverProfiles((prev) => ({ ...prev, ...map }));
    }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offers]);


  /* ── Chime + haptic on a genuinely new bid (not the initial load) ─── */
  useEffect(() => {
    const ids = new Set(offers.map((o) => o.id));
    if (prevOfferIds.current.size > 0 && offers.some((o) => !prevOfferIds.current.has(o.id))) {
      playNewRequestSound();
      haptic('light');
    }
    prevOfferIds.current = ids;
  }, [offers]);

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  const elapsedSecs = elapsedSeconds % 60;
  const countdownText = `${elapsedMinutes}:${elapsedSecs < 10 ? '0' : ''}${elapsedSecs}`;
  const showKeepSearchingPrompt = elapsedSeconds >= ELAPSED_CAP_SECONDS;

  // The rider can raise the fare to reach more drivers but never drag it
  // below what the app itself recommended for this trip — `recommended`,
  // not the town's absolute `floor`, is the effective minimum here.
  const { recommended: fareFloor, ceiling: fareCeiling } = useMemo(
    () => calculateRecommendedFare(townPricing, ride?.distance_km ?? 0, ride?.duration_minutes ?? 0),
    [townPricing, ride?.distance_km, ride?.duration_minutes]
  );

  const searchRadiusKm = RADIUS_STEPS_KM[radiusIndex];
  // Real online drivers within the current search radius — this used to be
  // a generator that scattered 2-10 fake car markers around the rider with
  // no real driver behind any of them. A rider watching cars circle for
  // minutes and then reading "no drivers available" is exactly the phantom-
  // car pattern Uber was litigated over; show only what's actually there.
  const nearbyDrivers = useNearbyDrivers(
    !isMatched && !isComplete,
    ride ? { lat: ride.pickup_lat, lng: ride.pickup_lon } : null,
    searchRadiusKm
  );

  /* ── Bid stack: enrich each pending offer with its driver's profile and
     its own 30s countdown, dropping any that have aged out. Oldest first,
     so the newest lands last in the DOM — nearest the sheet, per spec. ── */
  const visibleOffers = useMemo(() => {
    return offers
      .map((offer) => {
        const profile = driverProfiles[offer.driver_id];
        const createdMs = new Date(offer.created_at).getTime();
        const secondsLeft = Math.max(0, OFFER_TTL_SECONDS - Math.floor((bidsNow - createdMs) / 1000));
        return { offer, profile, secondsLeft };
      })
      .filter((b) => b.secondsLeft > 0);
  }, [offers, driverProfiles, bidsNow]);

  /* ── "Also keep me updated" preference — fetched once per ride so the
     match celebration below can respect it. Defaults true (self-bookings,
     where this row never exists, always notify as before). ──────────── */
  useEffect(() => {
    if (!rideId) return;
    let cancelled = false;
    (supabase as any).from('ride_passenger_contacts').select('notify_booker, passenger_name').eq('ride_id', rideId).maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setNotifyBookerPref(data?.notify_booker ?? true);
        setThirdPartyPassengerName(data?.passenger_name || null);
      });
    return () => { cancelled = true; };
  }, [rideId]);

  /* ── Driver details + live position once matched ───────────── */
  useEffect(() => {
    // isComplete included: 'completed' isn't in ACCEPTED_STATUSES, so
    // isMatched alone would leave `driver` unfetched (and 4g's payment
    // headline/rating card blank) on a fresh load that lands directly on a
    // finished trip — e.g. reopening the app after the driver ended it.
    if ((!isMatched && !isComplete) || !ride?.driver_id) return;
    // Skip the celebration on a fresh load that lands directly on a
    // finished trip (it's for the moment of matching, not reopening an
    // already-completed one), and skip it entirely when the booker asked
    // not to be updated on a ride they booked for someone else.
    if (!announced.current && !isComplete && notifyBookerPref) {
      announced.current = true;
      haptic('medium');
      // Connection sound plays on the driver's side only, not the rider's —
      // haptic + toast still confirm the match here.
      toast({ title: '🎉 Driver found!', description: 'Your driver is on the way.' });
    }
    fetchAssignedDriver(ride.driver_id).then(setDriver).catch(() => {});
  }, [isMatched, isComplete, ride?.driver_id, notifyBookerPref]);

  // Driver's EcoCash number for the in-place payment modal — MatchedDriver
  // (rideMatching.ts) doesn't select it, so fetch it here from the same
  // `drivers.ecocash_number` column RiderRideDetail reads. When the column
  // is empty the EcoCash button stays hidden rather than failing silently.
  useEffect(() => {
    if (!driver?.id) { setDriverEcocash(null); return; }
    let cancelled = false;
    supabase
      .from('drivers')
      .select('ecocash_number')
      .eq('id', driver.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setDriverEcocash(((data as { ecocash_number?: string | null } | null)?.ecocash_number) ?? null);
      });
    return () => { cancelled = true; };
  }, [driver?.id]);

  // Declared here (not down near the rest of the 4f live-progress block)
  // because the parcel/passenger-match SMS effects below read it in their
  // dependency arrays — a `const` referenced before its declaration line
  // throws a ReferenceError ("Cannot access 'etaMinutes' before
  // initialization") even though it's the same component scope.
  const etaMinutes = useMemo(() => {
    if (!driverLocation || !ride) return null;
    const dLat = (ride.pickup_lat - driverLocation.lat) * 111;
    const dLng = (ride.pickup_lon - driverLocation.lng) * 111 * Math.cos((ride.pickup_lat * Math.PI) / 180);
    const km = Math.sqrt(dLat * dLat + dLng * dLng);
    return Math.max(1, Math.round((km / 25) * 60));
  }, [driverLocation, ride]);

  /* ── Parcel-match SMS: the recipient isn't an app user, so this is the
     only way they learn a driver is actually on the way. Fires once, best
     effort — never blocks or surfaces an error into the rider's UI. ───── */
  useEffect(() => {
    if (!isMatched || ride?.vehicle_type !== 'parcel' || !driver || !rideId || parcelMatchAnnounced.current) return;
    parcelMatchAnnounced.current = true;
    (async () => {
      try {
        const [{ data: contact }, { data: authData }, { data: sessionData }] = await Promise.all([
          (supabase as any).from('ride_parcel_contacts').select('recipient_phone').eq('ride_id', rideId).maybeSingle(),
          supabase.auth.getUser(),
          supabase.auth.getSession(),
        ]);
        const token = sessionData.session?.access_token;
        if (!contact?.recipient_phone || !token) return;
        const senderName = authData?.user?.user_metadata?.full_name || authData?.user?.email?.split('@')[0] || 'Someone';
        await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sms-invite`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            phone: contact.recipient_phone,
            messageType: 'parcel_matched',
            bookerName: senderName,
            driverName: driver.full_name || 'Your driver',
            plate: driver.plate_number || '',
            etaMinutes: etaMinutes != null ? String(etaMinutes) : '',
          }),
        });
      } catch {
        // best-effort — never surface an SMS failure to the rider
      }
    })();
  }, [isMatched, ride?.vehicle_type, driver, rideId, etaMinutes]);

  /* ── Booking-for-someone-else match SMS — same reasoning as the parcel
     one above: the passenger isn't the app user, so this is their only way
     to learn a driver is actually coming. Fires once, best effort. Reads
     ride_passenger_contacts itself (rather than trusting a prop) so it
     naturally no-ops for a self-booking, where that row never exists. ── */
  useEffect(() => {
    if (!isMatched || ride?.vehicle_type === 'parcel' || !driver || !rideId || passengerMatchAnnounced.current) return;
    passengerMatchAnnounced.current = true;
    (async () => {
      try {
        const [{ data: contact }, { data: authData }, { data: sessionData }] = await Promise.all([
          supabase.from('ride_passenger_contacts').select('passenger_phone').eq('ride_id', rideId).maybeSingle(),
          supabase.auth.getUser(),
          supabase.auth.getSession(),
        ]);
        const token = sessionData.session?.access_token;
        if (!contact?.passenger_phone || !token) return;
        const bookerName = authData?.user?.user_metadata?.full_name || authData?.user?.email?.split('@')[0] || 'Someone';
        await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sms-invite`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            phone: contact.passenger_phone,
            messageType: 'third_party_matched',
            bookerName,
            driverName: driver.full_name || 'Your driver',
            plate: driver.plate_number || '',
            etaMinutes: etaMinutes != null ? String(etaMinutes) : '',
          }),
        });
      } catch {
        // best-effort — never surface an SMS failure to the rider
      }
    })();
  }, [isMatched, ride?.vehicle_type, driver, rideId, etaMinutes]);

  useEffect(() => {
    if (!driver?.user_id) return;
    let active = true;
    const pull = () => fetchDriverLocation(driver.user_id).then((loc) => { if (active && loc) setDriverLocation(loc); }).catch(() => {});
    pull();
    const channel = supabase
      .channel(`driver-loc-${driver.user_id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'live_locations', filter: `user_id=eq.${driver.user_id}` }, (payload) => {
        const row = payload.new as Record<string, unknown>;
        if (row?.latitude && row?.longitude) setDriverLocation({ lat: Number(row.latitude), lng: Number(row.longitude) });
      })
      .subscribe();
    const poll = setInterval(pull, 15000);
    return () => { active = false; clearInterval(poll); supabase.removeChannel(channel); };
  }, [driver?.user_id]);

  /* ── Actions ───────────────────────────────────────────────── */
  const handleCancel = async (reason?: string) => {
    if (!rideId) return;
    setCancelling(true);
    try {
      await cancelRideRequest(rideId, reason);
      haptic('light');
      toast({ title: 'Request cancelled' });
      navigate('/ride', { replace: true });
    } catch (e) {
      toast({ title: 'Could not cancel', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setCancelling(false);
      setCancelSheetOpen(false);
    }
  };

  const handleKeepWaiting = () => {
    waitStartedAt.current = Date.now();
    searchStartedAt.current = Date.now();
    setRemaining(60);
    setRadiusIndex(0);
    setTimedOut(false);
    setElapsedSeconds(0);
  };

  const handleAcceptOffer = useCallback(async (offer: Offer) => {
    if (!rideId) return;
    setAccepting(offer.id);
    try {
      await acceptOffer(rideId, offer.id);
      haptic('medium');
      await loadRide();
    } catch (e) {
      const err = e as Error & { status?: number };
      // The offer can go stale between render and tap — already accepted by
      // another rider action, rejected, or its ride moved on. The backend's
      // only real signal for that is a 404/409 (or the Supabase RPC's
      // "not pending" reason string); read it as "just expired" rather than
      // a hard error, and drop the stale card instead of letting it linger.
      const wentStale = err.status === 404 || err.status === 409 || /not pending|not found|already/i.test(err.message || '');
      if (wentStale) {
        toast({ title: 'That offer just expired', description: 'Pick another driver, or wait for new bids.' });
        setOffers((prev) => prev.filter((o) => o.id !== offer.id));
      } else {
        toast({ title: 'Could not accept offer', description: err.message, variant: 'destructive' });
      }
    } finally {
      setAccepting(null);
    }
  }, [rideId, loadRide]);

  const handleDeclineOffer = useCallback(async (offer: Offer) => {
    if (!rideId) return;
    setDecliningId(offer.id);
    haptic('light');
    // Drop it locally right away — waiting on the network round trip here
    // would leave a declined card sitting on screen looking still-live.
    setOffers((prev) => prev.filter((o) => o.id !== offer.id));
    try {
      await declineOffer(offer.id, rideId);
    } catch (e) {
      toast({ title: 'Could not decline offer', description: (e as Error).message, variant: 'destructive' });
      setOffers((prev) => (prev.some((o) => o.id === offer.id)
        ? prev
        : [...prev, offer].sort((a, b) => a.created_at.localeCompare(b.created_at))));
    } finally {
      setDecliningId(null);
    }
  }, [rideId]);

  const handleFareChange = async (delta: number) => {
    if (!rideId || !ride || fareBumping) return;
    // Clamp to the town's real offer_floor/offer_ceiling (same bounds the
    // ride-selection screen's recommended-fare calc uses) rather than just
    // floor-ing at one fare step, so the stepper can't be walked down to a
    // fare that's actually below what the town allows.
    const raw = Math.round((Number(ride.fare) + delta) * 100) / 100;
    const nextFare = Math.min(fareCeiling, Math.max(fareFloor, raw));
    if (nextFare === Number(ride.fare)) return;
    setFareBumping(true);
    setRide((prev) => (prev ? { ...prev, fare: nextFare } : prev));
    haptic('light');
    try {
      await updateRideFare(rideId, nextFare);
    } catch (e) {
      setRide((prev) => (prev ? { ...prev, fare: Number(ride.fare) } : prev));
      toast({ title: 'Could not update fare', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setFareBumping(false);
    }
  };

  const handleSaveNote = async (note: string, reuseEveryTrip: boolean) => {
    if (!rideId) return;
    setNoteSaving(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const { error } = await supabase
        .from('trip_events')
        .insert([{ ride_id: rideId, actor_id: auth?.user?.id ?? null, event_type: 'rider_note', payload: { note } }] as never);
      if (error) throw new Error(error.message);
      setNoteValue(note);
      setNoteReuseEveryTrip(reuseEveryTrip);
      if (user?.id) {
        supabase.from('profiles').update({ default_ride_note: reuseEveryTrip ? (note || null) : null } as never).eq('user_id', user.id).then(({ error: profileError }) => {
          if (profileError) console.error('Saving default note failed:', profileError.message);
        });
      }
      haptic('light');
      toast({ title: 'Note sent to drivers' });
      setNoteOpen(false);
    } catch (e) {
      toast({ title: 'Could not save note', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setNoteSaving(false);
    }
  };

  /* ── 4f live progress: remaining distance is read off the ride's real
     route polyline (pickup→dropoff) trimmed to the driver's current
     position via trimRouteAhead — the same helper LiveNavMap uses for
     turn-by-turn — rather than a second straight-line estimate. Minutes
     are derived proportionally from that one distance figure against the
     ride's own already-computed pace, instead of re-fetching OSRM on every
     GPS tick. */
  const tripProgress = useMemo(() => {
    if (!inTrip || !ride?.route_polyline) return null;
    const coords = decodePolyline(ride.route_polyline) as [number, number][];
    const { remainingMeters } = trimRouteAhead(coords, driverLocation);
    const remainingKm = remainingMeters / 1000;
    const minutes = ride.distance_km > 0
      ? Math.max(1, Math.round((remainingKm / ride.distance_km) * ride.duration_minutes))
      : null;
    return { remainingKm, minutes };
  }, [inTrip, ride?.route_polyline, ride?.distance_km, ride?.duration_minutes, driverLocation]);

  /* ── 4g fare breakdown — single source of truth is ride.fare (the exact
     total the rider's accepted offer already locked in). We don't add a
     second charge on top of it: we split that one total back into "Agreed
     fare" + "Extra passenger" using the same $0.50-per-extra-passenger-
     beyond-3 formula RideView's fareBreakdown uses, so Total due always
     equals ride.fare exactly — never a recalculated figure. */
  const completedBreakdown = useMemo(() => {
    if (!ride) return null;
    const extraPassengers = Math.max((ride.passenger_count ?? 1) - 3, 0);
    const extraPassengerFee = extraPassengers * 0.5;
    const totalDue = Number(ride.fare);
    const agreedFare = Math.max(0, totalDue - extraPassengerFee);
    return { agreedFare, extraPassengerFee, totalDue };
  }, [ride]);

  const isCashPayment = (ride?.payment_method || 'cash').toLowerCase() === 'cash';
  const paymentMethodLabel = (ride?.payment_method || 'cash').toLowerCase() === 'ecocash' ? 'EcoCash' : (ride?.payment_method || 'cash');

  const handleConfirmPayment = async () => {
    setConfirmingPayment(true);
    const tasks: Promise<unknown>[] = [];
    if (rating > 0 && rideId && driver?.id) {
      tasks.push(
        submitDriverRating({ ride_id: rideId, driver_id: driver.id, rating, comment: null })
          .catch((e) => console.error('Rating submission failed:', e))
      );
    }
    if (tipAmount && tipAmount > 0 && rideId && driver?.id) {
      tasks.push(
        createTip({ ride_id: rideId, driver_id: driver.id, amount: tipAmount })
          .catch((e) => console.error('Tip submission failed:', e))
      );
    }
    await Promise.all(tasks);
    setConfirmingPayment(false);
    haptic('light');
    navigate('/ride', { replace: true });
  };

  // Stable references so the memo()-wrapped MapboxMap doesn't re-render on
  // every tick of the 1s ticker above just because a new object literal was
  // passed down with the same coordinates.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const pickup = useMemo(() => (ride ? { lat: ride.pickup_lat, lng: ride.pickup_lon } : null), [ride?.pickup_lat, ride?.pickup_lon]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const dropoff = useMemo(() => (ride ? { lat: ride.dropoff_lat, lng: ride.dropoff_lon } : null), [ride?.dropoff_lat, ride?.dropoff_lon]);
  const tierKey = ride?.vehicle_type && TIER_LABELS[ride.vehicle_type] ? ride.vehicle_type : 'economy';

  return (
    <div className="relative w-full h-[100dvh] overflow-hidden bg-background">
      {/* Map */}
      <div className="absolute inset-0">
        <LazyMapboxMap
          pickup={pickup}
          dropoff={dropoff}
          // 4g: the map is inert once the trip is complete — no live driver
          // marker, just the completed route rendered statically.
          driverLocation={isComplete ? null : driverLocation}
          drivers={isMatched ? undefined : nearbyDrivers}
          routeGeometry={ride?.route_polyline ?? null}
          preferredCenter={preferredCenter}
          className="w-full h-full"
          height="100%"
          bottomInset={sheetTop + 24}
        />
      </div>

      {/* Small blue pickup marker while searching — no large radar rings, per spec */}
      {!isMatched && !isComplete && (
        <div className="absolute inset-x-0 top-[26%] flex justify-center pointer-events-none">
          <span
            className="block rounded-full"
            style={{ width: 22, height: 22, background: '#1A73E8', border: '3.5px solid #fff', boxShadow: '0 2px 6px rgba(0,0,0,.25)' }}
          />
        </div>
      )}

      {/* Map chrome. 4g (complete): one centered pill, nothing else — the
          trip is finished, there's nothing to navigate to. 4f (in trip): a
          single row, no back button — the rider is in the car. 4c (en route
          to pickup): back (never silently cancels) + a safety/locate stack.
          Searching: back + locate. */}
      {isComplete ? (
        <div
          className="absolute z-20 flex justify-center"
          style={{ top: 'calc(env(safe-area-inset-top) + 7px)', left: 16, right: 16 }}
        >
          <span
            className="inline-flex items-center shrink-0"
            style={{ height: 44, padding: '0 16px', borderRadius: 999, gap: 8, ...chromeGlass }}
          >
            <CheckCheck style={{ width: 17, height: 17, color: RIDE_RED }} strokeWidth={2.4} />
            <span style={{ fontSize: 13, fontWeight: 700, color: RIDE_TEXT }}>You've arrived</span>
          </span>
        </div>
      ) : inTrip ? (
        <div
          className="absolute z-20 flex items-center"
          style={{ top: 'calc(env(safe-area-inset-top) + 7px)', left: 16, right: 16, gap: 10 }}
        >
          <span
            className="inline-flex items-center shrink-0"
            style={{ height: 44, padding: '0 14px', borderRadius: 999, gap: 8, ...chromeGlass }}
          >
            <span className="rounded-full shrink-0" style={{ width: 7, height: 7, background: RIDE_RED }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: RIDE_TEXT }}>In trip</span>
          </span>
          <button
            onClick={() => driverLocation && setPreferredCenter({ ...driverLocation })}
            aria-label="Recentre"
            className="ml-auto shrink-0 flex items-center justify-center rounded-full active:scale-90 transition-transform"
            style={{ width: 44, height: 44, ...chromeGlass }}
          >
            <Locate style={{ width: 19, height: 19, color: RIDE_TEXT }} strokeWidth={2} />
          </button>
        </div>
      ) : (
        <>
          <button
            onClick={() => {
              // Matched: go home to the rider dashboard; the ride keeps
              // running in the background and can be re-entered via history.
              // Still searching: the ride is still `pending` on the server —
              // navigating away used to abandon it silently, so drivers kept
              // receiving a request the rider had already walked away from.
              // Route through the same cancel confirmation the explicit
              // Cancel action uses instead.
              if (isMatched) navigate('/app');
              else setCancelSheetOpen(true);
            }}
            aria-label="Back"
            className="absolute left-3 z-20 flex items-center justify-center rounded-full active:scale-90 transition-transform"
            style={{ top: 'calc(env(safe-area-inset-top) + 7px)', width: 52, height: 52, ...glassSurface }}
          >
            <ArrowLeft className="w-5 h-5" style={{ color: RIDE_TEXT }} />
          </button>
          {isMatched ? (
            <div
              className="absolute right-3 z-20 flex flex-col"
              style={{ top: 'calc(env(safe-area-inset-top) + 7px)', gap: 12 }}
            >
              <button
                onClick={() => setSafetyOpen(true)}
                aria-label="Safety"
                className="flex items-center justify-center rounded-full active:scale-90 transition-transform"
                style={{ width: 52, height: 52, ...glassSurface }}
              >
                <ShieldCheck className="w-5 h-5" style={{ color: RIDE_TEXT }} />
              </button>
              <button
                onClick={() => pickup && setPreferredCenter({ ...pickup })}
                aria-label="Recentre"
                className="flex items-center justify-center rounded-full active:scale-90 transition-transform"
                style={{ width: 52, height: 52, ...glassSurface }}
              >
                <Locate className="w-5 h-5" style={{ color: RIDE_TEXT }} />
              </button>
            </div>
          ) : (
            <button
              onClick={() => pickup && setPreferredCenter({ ...pickup })}
              aria-label="Use my location"
              className="absolute right-3 z-20 flex items-center justify-center rounded-full active:scale-90 transition-transform"
              style={{ top: 'calc(env(safe-area-inset-top) + 7px)', width: 52, height: 52, ...glassSurface }}
            >
              <Locate className="w-5 h-5" style={{ color: RIDE_TEXT }} />
            </button>
          )}
        </>
      )}
      <SafetySheet
        open={safetyOpen}
        onClose={() => setSafetyOpen(false)}
        rideId={rideId ?? ''}
        counterpartName={driver?.full_name || 'Your driver'}
        counterpartAvatarUrl={driver?.avatar_url}
        counterpartMeta={[driver?.vehicle_color, driver?.vehicle_make, driver?.vehicle_model].filter(Boolean).join(' ') || 'Vehicle details pending'}
        plateNumber={driver?.plate_number ?? null}
        startedAt={ride?.created_at ?? null}
        pickupAddress={ride?.pickup_address ?? ''}
        dropoffAddress={ride?.dropoff_address ?? ''}
        role="rider"
      />

      {/* Bid stack — right-aligned, content-width pop-ups over the map, anchored
          8px above the sheet's real (measured) top edge so it tracks the sheet
          growing/shrinking rather than a guessed bottom offset. */}
      {!isMatched && !timedOut && !isComplete && (
        <div
          className="absolute left-4 right-4 z-30 flex flex-col items-end pointer-events-none"
          style={{ bottom: sheetTop + 8, gap: 8 }}
        >
          <AnimatePresence initial={false}>
            {visibleOffers.map(({ offer, profile, secondsLeft }) => (
              <BidCard
                key={offer.id}
                offer={offer}
                profile={profile}
                secondsLeft={secondsLeft}
                busy={accepting === offer.id || decliningId === offer.id}
                onAccept={handleAcceptOffer}
                onDecline={handleDeclineOffer}
              />
            ))}
          </AnimatePresence>
          {visibleOffers.length > 0 && (
            <p
              className="pointer-events-none"
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: RIDE_TEXT,
                letterSpacing: '.02em',
                textShadow: '0 1px 3px rgba(255,255,255,.9)',
              }}
            >
              {visibleOffers.length} driver{visibleOffers.length > 1 ? 's' : ''} bid · tap to accept
            </p>
          )}
        </div>
      )}

      {/* Bottom sheet — same glass ribbon treatment as the ride-selection screen */}
      <div ref={sheetWrapRef} className="absolute left-0 right-0 z-20" style={{ bottom: 0 }}>
      <RideGlassPanel
        style={{ maxHeight: '82vh', paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
          <AnimatePresence mode="wait">
            {isComplete ? (
              /* ───────── 4g: Trip complete — pay and rate ───────── */
              <motion.div
                key="complete"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.28, ease: 'easeOut' }}
                className="p-4"
                style={{ display: 'flex', flexDirection: 'column', gap: 13 }}
              >
                {/* Section 1 — amount headline: the largest thing on the screen */}
                <div className="flex items-end justify-between" style={{ gap: 12 }}>
                  <div>
                    <p style={{ fontSize: 11.5, fontWeight: 700, color: RIDE_TEXT_2, textTransform: 'uppercase', letterSpacing: '.06em' }}>
                      {isCashPayment ? `Pay ${(driver?.full_name || 'driver').split(' ')[0]} in cash` : `Paid via ${paymentMethodLabel}`}
                    </p>
                    <p className="tabular-nums" style={{ marginTop: 4, fontSize: 36, fontWeight: 700, letterSpacing: '-.04em', lineHeight: 1, color: RIDE_TEXT }}>
                      ${completedBreakdown ? completedBreakdown.totalDue.toFixed(2) : '0.00'}
                    </p>
                  </div>
                  <div className="flex flex-col items-end shrink-0" style={{ gap: 2 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: RIDE_TEXT }}>
                      {ride ? `${Math.round(ride.duration_minutes)} min` : ''}
                    </span>
                    <span style={{ fontSize: 11, fontWeight: 500, color: RIDE_TEXT_2 }}>
                      {ride ? `${Number(ride.distance_km).toFixed(1)} km trip` : ''}
                    </span>
                  </div>
                </div>

                {/* Section 2 — fare breakdown card. A visible $0.00 row proves
                    nothing was added, rather than hiding a charge that didn't apply. */}
                <div style={{ ...tintBlue, borderRadius: 16, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                  <div className="flex items-center justify-between" style={{ padding: '9px 13px', gap: 8 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 500, color: RIDE_TEXT_2 }}>Agreed fare</span>
                    <span className="tabular-nums" style={{ fontSize: 12.5, fontWeight: 600, color: RIDE_TEXT }}>
                      ${completedBreakdown ? completedBreakdown.agreedFare.toFixed(2) : '0.00'}
                    </span>
                  </div>
                  <span style={{ height: 0.5, background: 'rgba(17,17,17,.08)' }} />
                  <div className="flex items-center justify-between" style={{ padding: '9px 13px', gap: 8 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 500, color: RIDE_TEXT_2 }}>Extra passenger</span>
                    <span className="tabular-nums" style={{ fontSize: 12.5, fontWeight: 600, color: RIDE_TEXT }}>
                      ${completedBreakdown ? completedBreakdown.extraPassengerFee.toFixed(2) : '0.00'}
                    </span>
                  </div>
                  <span style={{ height: 0.5, background: 'rgba(17,17,17,.08)' }} />
                  <div className="flex items-center justify-between" style={{ padding: '10px 13px', gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: RIDE_TEXT }}>Total due</span>
                    <span className="tabular-nums" style={{ fontSize: 14, fontWeight: 700, color: RIDE_RED }}>
                      ${completedBreakdown ? completedBreakdown.totalDue.toFixed(2) : '0.00'}
                    </span>
                  </div>
                </div>

                {/* Section 3 — rating card, tap a star to set it */}
                <div className="flex flex-col items-center" style={{ ...softGlass, borderRadius: 16, padding: '12px 12px 13px', gap: 9 }}>
                  <div className="flex items-center" style={{ gap: 9 }}>
                    <span
                      className="flex items-center justify-center rounded-full shrink-0"
                      style={{ width: 34, height: 34, background: 'linear-gradient(135deg,#C6CBD4,#868E9B)', boxShadow: '0 0 0 2px rgba(255,255,255,.95)' }}
                    >
                      {driver?.avatar_url ? (
                        <img src={driver.avatar_url} alt="" className="w-full h-full object-cover rounded-full" />
                      ) : (
                        <User style={{ width: 17, height: 17 }} className="text-white" strokeWidth={2.2} />
                      )}
                    </span>
                    <span style={{ fontSize: 14.5, fontWeight: 700, letterSpacing: '-.015em', color: RIDE_TEXT }}>
                      How was {(driver?.full_name || 'your driver').split(' ')[0]}?
                    </span>
                  </div>
                  <div className="flex items-center" style={{ gap: 8 }}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => { setRating(n); haptic('light'); }}
                        aria-label={`Rate ${n} star${n > 1 ? 's' : ''}`}
                        className="active:scale-90 transition-transform"
                      >
                        <Star
                          style={{ width: 30, height: 30 }}
                          strokeWidth={1.8}
                          fill={n <= rating ? '#FFDD00' : 'none'}
                          color={n <= rating ? '#FFDD00' : '#C7C9CC'}
                        />
                      </button>
                    ))}
                  </div>
                </div>

                {/* Section 4 — tip row, none preselected */}
                <div className="flex items-center" style={{ gap: 8 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: RIDE_TEXT_2 }}>Add a tip</span>
                  <div className="flex items-center ml-auto" style={{ gap: 7 }}>
                    {[0.5, 1, 2].map((amt) => {
                      const selected = tipAmount === amt;
                      return (
                        <button
                          key={amt}
                          type="button"
                          onClick={() => { setTipAmount(selected ? null : amt); haptic('light'); }}
                          className="tabular-nums active:scale-95 transition-transform"
                          style={{
                            height: 32, padding: '0 13px', borderRadius: 999, fontSize: 12.5, fontWeight: 700, color: RIDE_TEXT,
                            ...(selected ? tipChipSelected : tipChipUnselected),
                          }}
                        >
                          ${amt.toFixed(2)}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Section 5 — action row: Receipt + Confirm payment */}
                <div className="flex items-center" style={{ gap: 12 }}>
                  <button
                    type="button"
                    onClick={() => ride && void openTripReceipt({
                      rideId: ride.id,
                      pickupAddress: ride.pickup_address,
                      dropoffAddress: ride.dropoff_address,
                      fare: ride.fare,
                      distanceKm: ride.distance_km,
                      durationMinutes: ride.duration_minutes,
                      driverName: driver?.full_name ?? undefined,
                      vehicleInfo: driver ? `${driver.vehicle_make || ''} ${driver.vehicle_model || ''}`.trim() || undefined : undefined,
                      plateNumber: driver?.plate_number || undefined,
                      paymentMethod: ride.payment_method,
                    })}
                    className="shrink-0 flex items-center justify-center active:scale-[0.97] transition-transform"
                    style={{ width: 110, height: 48, borderRadius: 15, ...receiptGlass }}
                  >
                    <span style={{ fontSize: 14.5, fontWeight: 700, color: RIDE_TEXT }}>Receipt</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmPayment}
                    disabled={confirmingPayment}
                    className="flex items-center justify-center active:scale-[0.97] transition-transform relative overflow-hidden disabled:opacity-70"
                    style={{ flex: 1, height: 48, borderRadius: 15, ...redCta, boxShadow: '0 10px 20px rgba(184,17,4,.36), inset 0 1px 0 rgba(255,255,255,.3)' }}
                  >
                    <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2" style={{ background: 'linear-gradient(180deg, rgba(255,255,255,.2), rgba(255,255,255,0))' }} />
                    <span className="relative" style={{ fontSize: 15.5, fontWeight: 700 }}>
                      {confirmingPayment ? '…' : isCashPayment ? 'Confirm payment' : 'Done'}
                    </span>
                  </button>
                </div>

                {/* Section 6 — iOS home indicator */}
                <div style={{ padding: '6px 0 10px' }} className="flex justify-center">
                  <span className="rounded-full" style={{ width: 140, height: 5, background: RIDE_TEXT }} />
                </div>
              </motion.div>
            ) : inTrip ? (
              /* ───────── 4f: In trip — on the way to the drop-off ───────── */
              <motion.div
                key="intrip"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.28, ease: 'easeOut' }}
                className="p-4"
                style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
              >
                {/* Section 1 — arrival headline: the largest thing on the screen */}
                <div className="flex items-end justify-between" style={{ gap: 12 }}>
                  <div>
                    <p style={{ fontSize: 11.5, fontWeight: 700, color: RIDE_TEXT_2, textTransform: 'uppercase', letterSpacing: '.06em' }}>
                      Arriving in
                    </p>
                    <div className="flex items-baseline" style={{ marginTop: 3, gap: 5 }}>
                      <span className="tabular-nums" style={{ fontSize: 32, fontWeight: 700, letterSpacing: '-.035em', lineHeight: 1, color: RIDE_TEXT }}>
                        {tripProgress?.minutes ?? '–'}
                      </span>
                      <span style={{ fontSize: 14, fontWeight: 600, color: RIDE_TEXT_2 }}>
                        min{tripProgress ? ` · ${tripProgress.remainingKm.toFixed(1)} km left` : ''}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end shrink-0">
                    <span className="tabular-nums" style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-.02em', color: RIDE_RED }}>
                      ${ride ? Number(ride.fare).toFixed(2) : '0.00'}
                    </span>
                    <span style={{ fontSize: 10.5, fontWeight: 600, color: RIDE_TEXT_2 }}>
                      {ride?.payment_method || 'cash'} on arrival
                    </span>
                  </div>
                </div>

                {/* Section 2 — route card: origin secondary, destination bold */}
                <div className="flex items-start" style={{ ...tintBlue, borderRadius: 16, gap: 10, padding: '9px 12px' }}>
                  <div className="flex flex-col items-center shrink-0" style={{ gap: 3, paddingTop: 2 }}>
                    <span className="rounded-full shrink-0" style={{ width: 9, height: 9, background: '#1A73E8', boxShadow: '0 0 0 2px rgba(255,255,255,.9)' }} />
                    <span className="shrink-0" style={{ width: 1.5, height: 16, background: 'rgba(17,17,17,.16)' }} />
                    <span className="rounded-full shrink-0" style={{ width: 9, height: 9, background: RIDE_RED, boxShadow: '0 0 0 2px rgba(255,255,255,.9)' }} />
                  </div>
                  <div className="min-w-0" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 9 }}>
                    <p className="truncate" style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.15, color: RIDE_TEXT_2 }}>
                      {ride?.pickup_address ?? ''}
                    </p>
                    <p className="truncate" style={{ fontSize: 13.5, fontWeight: 700, lineHeight: 1.15, color: RIDE_TEXT }}>
                      {ride?.dropoff_address ?? ''}
                    </p>
                  </div>
                </div>

                {/* Section 3 — driver strip: identity shrunk to a strip, no hero block */}
                <div className="flex items-center" style={{ gap: 11 }}>
                  <span
                    className="shrink-0 flex items-center justify-center rounded-full"
                    style={{ width: 40, height: 40, background: 'linear-gradient(135deg,#C6CBD4,#868E9B)', boxShadow: '0 0 0 2px rgba(255,255,255,.95)' }}
                  >
                    {driver?.avatar_url ? (
                      <img src={driver.avatar_url} alt="" className="w-full h-full object-cover rounded-full" />
                    ) : (
                      <User style={{ width: 20, height: 20 }} className="text-white" strokeWidth={2.2} />
                    )}
                  </span>
                  <div className="min-w-0" style={{ flex: 1 }}>
                    <p className="truncate" style={{ fontSize: 14.5, fontWeight: 700, letterSpacing: '-.015em', lineHeight: 1.15, color: RIDE_TEXT }}>
                      {driver?.full_name || 'Your driver'}
                    </p>
                    <div className="flex items-center" style={{ marginTop: 2, gap: 5, fontSize: 11.5, fontWeight: 500, color: RIDE_TEXT_2, lineHeight: 1.15 }}>
                      {driver?.rating_avg != null && (
                        <>
                          <span className="flex items-center" style={{ gap: 2 }}>
                            <Star style={{ width: 11, height: 11, fill: '#FFDD00', color: '#FFDD00' }} />
                            <span style={{ fontWeight: 700, color: RIDE_TEXT }}>{Number(driver.rating_avg).toFixed(1)}</span>
                          </span>
                          <Dot />
                        </>
                      )}
                      <span className="whitespace-nowrap truncate">
                        {[driver?.vehicle_make, driver?.vehicle_model].filter(Boolean).join(' ') || 'Vehicle'}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center shrink-0" style={{ gap: 8 }}>
                    {driver?.plate_number && (
                      <span
                        className="tabular-nums"
                        style={{ padding: '3px 9px', borderRadius: 7, background: RIDE_TEXT, color: '#FFFFFF', fontSize: 12, fontWeight: 700, letterSpacing: '.04em' }}
                      >
                        {driver.plate_number}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => setMessageOpen(true)}
                      aria-label="Message driver"
                      className="relative shrink-0 flex items-center justify-center rounded-full active:scale-90 transition-transform"
                      style={{ width: 36, height: 36, ...messageIconGlass }}
                    >
                      <MessageCircle style={{ width: 17, height: 17, color: RIDE_RED }} />
                      {unreadMessages > 0 && (
                        <span
                          className="absolute flex items-center justify-center rounded-full"
                          style={{ top: -2, right: -2, minWidth: 16, height: 16, padding: '0 3px', background: RIDE_RED, color: '#fff', fontSize: 9.5, fontWeight: 800, boxShadow: '0 0 0 2px rgba(255,255,255,.95)' }}
                        >
                          {unreadMessages > 9 ? '9+' : unreadMessages}
                        </span>
                      )}
                    </button>

                  </div>
                </div>

                {/* Section 4 — action row: Share trip + Emergency, equal width */}
                <div className="flex items-center" style={{ gap: 12 }}>
                  <ShareTripButton
                    rideId={rideId || ''}
                    pickupAddress={ride?.pickup_address ?? ''}
                    dropoffAddress={ride?.dropoff_address ?? ''}
                    driverName={driver?.full_name ?? undefined}
                    variant="glass"
                    style={{ flex: 1, height: 48, borderRadius: 15, gap: 8, color: RIDE_TEXT, ...shareGlass }}
                  />
                  <button
                    type="button"
                    onClick={() => setSafetyOpen(true)}
                    className="flex items-center justify-center active:scale-[0.97] transition-transform relative overflow-hidden"
                    style={{ flex: 1, height: 48, borderRadius: 15, gap: 8, ...redCta, boxShadow: '0 10px 20px rgba(184,17,4,.36), inset 0 1px 0 rgba(255,255,255,.3)' }}
                  >
                    <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2" style={{ background: 'linear-gradient(180deg, rgba(255,255,255,.2), rgba(255,255,255,0))' }} />
                    <ShieldAlert className="relative" style={{ width: 18, height: 18 }} />
                    <span className="relative" style={{ fontSize: 14.5, fontWeight: 700 }}>Emergency</span>
                  </button>
                </div>

                {/* Section 5 — iOS home indicator */}
                <div style={{ padding: '6px 0 10px' }} className="flex justify-center">
                  <span className="rounded-full" style={{ width: 140, height: 5, background: RIDE_TEXT }} />
                </div>
              </motion.div>
            ) : isMatched ? (
              /* ───────── 4c: Driver found — matched, en route to pickup ───────── */
              <motion.div
                key="matched"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.28, ease: 'easeOut' }}
                className="p-4"
                style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
              >
                {/* Section 1 — status row */}
                <div className="flex items-center" style={{ gap: 8 }}>
                  <span
                    className="inline-flex items-center shrink-0"
                    style={{ height: 26, padding: '0 10px', borderRadius: 999, gap: 6, ...tintRed }}
                  >
                    <span className="rounded-full shrink-0" style={{ width: 7, height: 7, background: RIDE_RED }} />
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: RIDE_RED }}>
                      {thirdPartyPassengerName ? `${thirdPartyPassengerName.split(' ')[0]}'s ride` : 'Driver on the way'}
                    </span>
                  </span>
                  <span className="flex items-baseline ml-auto" style={{ gap: 4 }}>
                    <span className="tabular-nums" style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-.02em', color: RIDE_TEXT }}>
                      {etaMinutes ?? '–'}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: RIDE_TEXT_2 }}>min away</span>
                  </span>
                </div>

                {/* Section 2 — driver identity row */}
                <div className="flex items-center" style={{ gap: 12 }}>
                  <span
                    className="shrink-0 flex items-center justify-center rounded-full"
                    style={{ width: 52, height: 52, background: 'linear-gradient(135deg,#C6CBD4,#868E9B)', boxShadow: '0 0 0 2px rgba(255,255,255,.95), 0 4px 12px rgba(17,17,17,.12)' }}
                  >
                    {driver?.avatar_url ? (
                      <img src={driver.avatar_url} alt="" className="w-full h-full object-cover rounded-full" />
                    ) : (
                      <User style={{ width: 26, height: 26 }} className="text-white" strokeWidth={2.2} />
                    )}
                  </span>
                  <div className="min-w-0" style={{ flex: 1 }}>
                    <p className="truncate" style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-.02em', lineHeight: 1.15, color: RIDE_TEXT }}>
                      {driver?.full_name || 'Your driver'}
                    </p>
                    <div className="flex items-center" style={{ marginTop: 3, gap: 5, fontSize: 12.5, fontWeight: 500, color: RIDE_TEXT_2, lineHeight: 1.15 }}>
                      {driver?.rating_avg != null && (
                        <>
                          <span className="flex items-center" style={{ gap: 2 }}>
                            <Star style={{ width: 12, height: 12, fill: '#FFDD00', color: '#FFDD00' }} />
                            <span style={{ fontWeight: 700, color: RIDE_TEXT }}>{Number(driver.rating_avg).toFixed(1)}</span>
                          </span>
                          <Dot />
                        </>
                      )}
                      <span className="whitespace-nowrap">{driver?.total_trips ?? 0} trips</span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end shrink-0" style={{ gap: 3 }}>
                    {driver?.plate_number && (
                      <span
                        className="tabular-nums"
                        style={{ padding: '3px 9px', borderRadius: 7, background: RIDE_TEXT, color: '#FFFFFF', fontSize: 12.5, fontWeight: 700, letterSpacing: '.04em' }}
                      >
                        {driver.plate_number}
                      </span>
                    )}
                    <span className="whitespace-nowrap" style={{ fontSize: 11, fontWeight: 500, color: RIDE_TEXT_2 }}>
                      {[driver?.vehicle_color, driver?.vehicle_make, driver?.vehicle_model].filter(Boolean).join(' ') || 'Vehicle details pending'}
                    </span>
                  </div>
                </div>

                {/* Section 3 — ride summary card ("agreed" ties this back to the offer the rider accepted) */}
                <div className="flex items-center" style={{ ...tintBlue, borderRadius: 16, gap: 12, padding: '7px 11px 7px 3px' }}>
                  <img src={TIER_ASSETS[tierKey]} alt="" style={{ width: 78, height: 56 }} className="object-contain shrink-0" />
                  <div className="min-w-0" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <p className="truncate" style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-.02em', lineHeight: 1.15, color: RIDE_TEXT }}>{TIER_LABELS[tierKey]}</p>
                    <p className="truncate" style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.25, color: RIDE_TEXT_3 }}>
                      {ride?.pickup_address ?? ''} → {ride?.dropoff_address ?? ''}
                    </p>
                  </div>
                  <div className="flex flex-col items-end shrink-0" style={{ gap: 3 }}>
                    <span className="tabular-nums" style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-.02em', color: RIDE_RED }}>
                      ${ride ? Number(ride.fare).toFixed(2) : '0.00'}
                    </span>
                    <span style={{ fontSize: 10, fontWeight: 600, color: RIDE_TEXT_2 }}>
                      agreed · {ride?.payment_method || 'cash'}
                    </span>
                  </div>
                </div>

                {/* Section 4 — pickup note row */}
                <button
                  type="button"
                  onClick={() => setNoteOpen(true)}
                  className="flex items-center w-full text-left active:scale-[0.98] transition-transform"
                  style={{ height: 44, padding: '0 14px', borderRadius: 15, gap: 10, ...noteRowGlass }}
                >
                  <MapPin style={{ width: 18, height: 18, color: RIDE_RED }} fill={RIDE_RED} strokeWidth={1.9} />
                  <span className="truncate" style={{ flex: 1, fontSize: 14.5, fontWeight: 500, color: RIDE_TEXT }}>
                    {noteValue || 'Add a note for your driver'}
                  </span>
                  <ChevronRight style={{ width: 17, height: 17, color: RIDE_TEXT_2 }} className="shrink-0" />
                </button>

                {/* EcoCash payment — same flow as RiderRideDetail, shown for
                    non-wallet rides directly above the Message + Call row. */}
                {ride.payment_method !== 'wallet' && driverEcocash && (
                  <button
                    type="button"
                    onClick={() => setShowEcoCashPay(true)}
                    className="w-full flex items-center justify-center active:scale-[0.97] transition-transform"
                    style={{ height: 48, borderRadius: 15, marginBottom: 12, gap: 8, ...redCta }}
                  >
                    <span style={{ fontSize: 15.5, fontWeight: 700 }} className="text-white">
                      💰 Pay ${Number(ride.fare).toFixed(2)} with EcoCash
                    </span>
                  </button>
                )}

                {/* Section 5 — action row: Message + Call are the only two primary actions */}
                <div className="flex items-center" style={{ gap: 12 }}>
                  <button
                    type="button"
                    onClick={() => setMessageOpen(true)}
                    className="relative shrink-0 flex items-center justify-center active:scale-[0.97] transition-transform"
                    style={{ width: 132, height: 48, borderRadius: 15, gap: 8, ...glassSurface, boxShadow: 'inset 0 .5px 0 rgba(255,255,255,.9), inset 0 0 0 1px rgba(184,17,4,.22), 0 6px 14px rgba(0,0,0,.05)' }}
                  >
                    <MessageCircle style={{ width: 18, height: 18, color: RIDE_RED }} />
                    <span style={{ fontSize: 14.5, fontWeight: 700, color: RIDE_RED }}>Message</span>
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
                    disabled={callStatus !== 'idle'}
                    onClick={async () => {
                      if (callStatus !== 'idle') return;
                      try {
                        await startCall();
                      } catch {
                        if (driver?.phone) window.location.href = `tel:${driver.phone}`;
                      }
                    }}
                    className="flex items-center justify-center active:scale-[0.97] transition-transform disabled:opacity-60"
                    style={{ flex: 1, height: 48, borderRadius: 15, gap: 9, ...redCta }}
                  >
                    <Phone style={{ width: 18, height: 18 }} className="text-white" />
                    <span style={{ fontSize: 15.5, fontWeight: 700 }} className="text-white truncate">
                      {callStatus !== 'idle' ? 'Calling…' : `Call ${(driver?.full_name || 'driver').split(' ')[0]}`}
                    </span>
                  </button>
                </div>

                {/* Section 6 — iOS home indicator */}
                <div style={{ padding: '8px 0 10px' }} className="flex justify-center">
                  <span className="rounded-full" style={{ width: 140, height: 5, background: RIDE_TEXT }} />
                </div>
              </motion.div>
            ) : timedOut ? (
              /* ───────── No drivers found ───────── */
              <motion.div key="timeout" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-4 space-y-3">
                <h2 className="text-lg font-extrabold text-foreground">No drivers available right now</h2>
                <p className="text-sm text-muted-foreground">
                  We couldn't match you in the last minute. A higher fare reaches more drivers — or you can keep waiting at the same price, or cancel.
                </p>
                <TripSummary ride={ride} />

                {/* Raise fare — same stepper/bounds as the searching screen,
                    not a second fare model. */}
                <div className="flex items-center justify-center gap-3.5 py-1">
                  <button
                    type="button"
                    onClick={() => handleFareChange(-FARE_STEP)}
                    disabled={fareBumping || !ride || Number(ride.fare) <= fareFloor}
                    aria-label="Decrease fare"
                    className="shrink-0 flex items-center justify-center rounded-full active:scale-90 transition-transform disabled:opacity-40"
                    style={{ width: 38, height: 38, background: RIDE_YELLOW }}
                  >
                    <Minus className="w-[17px] h-[17px]" style={{ color: RIDE_TEXT }} />
                  </button>
                  <div className="flex flex-col items-center justify-center" style={{ minWidth: 72 }}>
                    <span className="text-[9.5px] font-bold uppercase tracking-wide leading-none" style={{ color: RIDE_TEXT_2 }}>
                      Trip Fare
                    </span>
                    <span className="text-center text-[17px] font-bold tabular-nums leading-tight" style={{ color: RIDE_RED }}>
                      ${ride ? Number(ride.fare).toFixed(2) : '0.00'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleFareChange(FARE_STEP)}
                    disabled={fareBumping || !ride || Number(ride.fare) >= fareCeiling}
                    aria-label="Increase fare"
                    className="shrink-0 flex items-center justify-center rounded-full active:scale-90 transition-transform disabled:opacity-40"
                    style={{ width: 38, height: 38, ...redCta }}
                  >
                    <Plus className="w-[17px] h-[17px] text-white" />
                  </button>
                </div>

                <button onClick={handleKeepWaiting} className="w-full py-3 rounded-2xl bg-primary text-primary-foreground font-bold">
                  Keep searching
                </button>
                <button
                  onClick={() => setCancelSheetOpen(true)}
                  disabled={cancelling}
                  className="w-full py-2.5 rounded-2xl border border-border text-sm font-semibold text-foreground disabled:opacity-50"
                >
                  Cancel request
                </button>
              </motion.div>
            ) : (
              /* ───────── Searching ───────── */
              <motion.div key="searching" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-4 space-y-3.5">
                {/* Status row: radar badge + title + elapsed M:SS countdown */}
                <div className="flex items-center gap-3">
                  <span className="relative shrink-0 flex items-center justify-center rounded-full" style={{ width: 42, height: 42, ...glassSurface }}>
                    <Radar className="w-5 h-5" style={{ color: RIDE_RED }} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-[14px] font-bold" style={{ color: RIDE_TEXT }}>Finding drivers near you</p>
                      <span className="ml-auto text-[12.5px] font-bold tabular-nums shrink-0" style={{ color: RIDE_RED }}>{countdownText}</span>
                    </div>
                    {viewerCount > 0 ? (
                      <div className="flex items-center gap-2 mt-1">
                        <span className="flex items-center shrink-0">
                          {Array.from({ length: Math.min(viewerCount, 3) }).map((_, i) => (
                            <span
                              key={i}
                              className="flex items-center justify-center rounded-full"
                              style={{
                                width: 22,
                                height: 22,
                                marginLeft: i === 0 ? 0 : -7,
                                background: i % 2 === 0 ? 'linear-gradient(135deg,#C6CBD4,#9AA1AD)' : 'linear-gradient(135deg,#B0B7C2,#868E9B)',
                                boxShadow: '0 0 0 1.5px rgba(255,255,255,.95)',
                              }}
                            >
                              <User className="w-3 h-3 text-white" strokeWidth={2.4} />
                            </span>
                          ))}
                          {viewerCount > 3 && (
                            <span
                              className="flex items-center justify-center rounded-full text-[9.5px] font-bold text-white"
                              style={{ width: 22, height: 22, marginLeft: -7, background: RIDE_RED, boxShadow: '0 0 0 1.5px rgba(255,255,255,.95)' }}
                            >
                              +{viewerCount - 3}
                            </span>
                          )}
                        </span>
                        <p className="text-[12.5px] font-medium truncate" style={{ color: RIDE_TEXT_2 }}>Drivers are viewing your request…</p>
                      </div>
                    ) : (
                      <p className="text-[12.5px] font-medium mt-1" style={{ color: RIDE_TEXT_2 }}>Searching for nearby drivers…</p>
                    )}
                    {showKeepSearchingPrompt && (
                      <p className="text-[12px] font-bold mt-1.5" style={{ color: RIDE_RED }}>
                        Still no ride? Keep searching, or try again with a higher fare.
                      </p>
                    )}
                  </div>
                </div>

                {/* Continuous 60s car/progress trail — remounts each radius cycle so it
                    keeps looping in sync with the search, per spec (not per-second steps). */}
                <div className="relative" style={{ height: 26 }}>
                  <span className="absolute left-0 right-0 rounded-full" style={{ top: 11, height: 4, background: 'rgba(17,17,17,.08)' }} />
                  <motion.span
                    key={`trail-${radiusIndex}`}
                    className="absolute left-0 rounded-full"
                    style={{ top: 11, height: 4, background: 'linear-gradient(90deg, #FFDD00, #B81104)' }}
                    initial={{ width: '0%' }}
                    animate={{ width: '100%' }}
                    transition={{ duration: 60, ease: 'linear' }}
                  />
                  <motion.img
                    key={`car-${radiusIndex}`}
                    src={carSearchSide}
                    alt=""
                    className="absolute top-0 object-contain"
                    style={{ width: 38, height: 15, filter: 'drop-shadow(0 2px 3px rgba(17,17,17,.28))' }}
                    initial={{ left: '0%' }}
                    animate={{ left: 'calc(100% - 38px)' }}
                    transition={{ duration: 60, ease: 'linear' }}
                  />
                </div>

                {/* Fare stepper — bare controls, no card, wired to the same
                    updateRideFare offer logic and $0.50 step as elsewhere. */}
                <div className="flex items-center justify-center gap-3.5">
                  <button
                    type="button"
                    onClick={() => handleFareChange(-FARE_STEP)}
                    disabled={fareBumping || !ride || Number(ride.fare) <= fareFloor}
                    aria-label="Decrease fare"
                    className="shrink-0 flex items-center justify-center rounded-full active:scale-90 transition-transform disabled:opacity-40"
                    style={{ width: 38, height: 38, background: RIDE_YELLOW }}
                  >
                    <Minus className="w-[17px] h-[17px]" style={{ color: RIDE_TEXT }} />
                  </button>
                  <div className="flex flex-col items-center justify-center" style={{ minWidth: 72 }}>
                    <span className="text-[9.5px] font-bold uppercase tracking-wide leading-none" style={{ color: RIDE_TEXT_2 }}>
                      Trip Fare
                    </span>
                    <span className="text-center text-[17px] font-bold tabular-nums leading-tight" style={{ color: RIDE_RED }}>
                      ${ride ? Number(ride.fare).toFixed(2) : '0.00'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleFareChange(FARE_STEP)}
                    disabled={fareBumping || !ride || Number(ride.fare) >= fareCeiling}
                    aria-label="Increase fare"
                    className="shrink-0 flex items-center justify-center rounded-full active:scale-90 transition-transform disabled:opacity-40"
                    style={{ width: 38, height: 38, ...redCta }}
                  >
                    <Plus className="w-[17px] h-[17px] text-white" />
                  </button>
                </div>

                {/* Chosen-ride summary card */}
                <div className="flex items-center" style={{ ...tintBlue, borderRadius: 16, gap: 12, padding: '7px 11px 7px 3px' }}>
                  <img src={TIER_ASSETS[tierKey]} alt="" style={{ width: 78, height: 56 }} className="object-contain shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[16px] font-bold leading-tight" style={{ color: RIDE_TEXT }}>{TIER_LABELS[tierKey]}</p>
                    <p className="text-[12.5px] font-semibold truncate" style={{ color: RIDE_TEXT_3 }}>
                      {ride?.pickup_address ?? ''} → {ride?.dropoff_address ?? ''}
                    </p>
                  </div>
                  <span className="text-[16px] font-bold shrink-0 tabular-nums" style={{ color: RIDE_RED }}>
                    ${ride ? Number(ride.fare).toFixed(2) : '0.00'}
                  </span>
                </div>

                {/* Cancel / Note row */}
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setCancelSheetOpen(true)}
                    disabled={cancelling}
                    className="flex-1 flex items-center justify-center active:scale-[0.97] transition-transform disabled:opacity-60"
                    style={{
                      height: 48,
                      borderRadius: 15,
                      background: 'rgba(255,255,255,.55)',
                      backdropFilter: 'blur(20px) saturate(180%)',
                      WebkitBackdropFilter: 'blur(20px) saturate(180%)',
                      boxShadow: 'inset 0 .5px 0 rgba(255,255,255,.9), inset 0 0 0 1px rgba(184,17,4,.22), 0 6px 14px rgba(0,0,0,.05)',
                    }}
                  >
                    <span className="text-[14.5px] font-bold" style={{ color: RIDE_RED }}>Cancel</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setNoteOpen(true)}
                    className="shrink-0 flex items-center justify-center gap-2 active:scale-[0.97] transition-transform"
                    style={{ width: 132, height: 48, borderRadius: 15, ...redCta }}
                  >
                    <MessageCircle className="w-[18px] h-[18px] text-white" />
                    <span className="text-[14.5px] font-bold text-white">Note</span>
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </RideGlassPanel>
      </div>

      <CancelReasonSheet
        open={cancelSheetOpen}
        onClose={() => setCancelSheetOpen(false)}
        onConfirm={handleCancel}
        cancelling={cancelling}
      />
      <NoteToDriverSheet
        open={noteOpen}
        onClose={() => setNoteOpen(false)}
        note={noteValue}
        onNoteChange={setNoteValue}
        reuseEveryTrip={noteReuseEveryTrip}
        onReuseEveryTripChange={setNoteReuseEveryTrip}
        onSave={handleSaveNote}
      />
      {ride && user && driver && (
        <DriverMessageSheet
          open={messageOpen}
          onClose={() => setMessageOpen(false)}
          rideId={ride.id}
          currentUserId={user.id}
          viewerRole="rider"
          driverUserId={driver.user_id}
          passengerName={driver.full_name || 'Your Driver'}
          passengerPhone={driver.phone ?? null}
        />
      )}
      {ride && driver && driverEcocash && ride.payment_method !== 'wallet' && (
        <EcoCashPaymentModal
          isOpen={showEcoCashPay}
          onClose={() => setShowEcoCashPay(false)}
          amount={Number(ride.fare)}
          currency="$"
          driverName={driver.vehicle_make ? `${driver.vehicle_make} Driver` : 'Driver'}
          driverEcoCash={driverEcocash}
          walletPin={walletPin}
          onVerifyPin={async (pin) => pin === walletPin}
          onSetPin={async () => false}
          onPaymentComplete={() => toast({ title: 'Payment sent to driver!' })}
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
          otherUserName={driver?.full_name || 'Driver'}
        />
      )}
      {incomingCall && (
        <IncomingCallModal
          callerId={incomingCall.callerId}
          onAnswer={answerCall}
          onDecline={declineIncomingCall}
        />
      )}
    </div>
  );
}

/** A 2.5px grey dot separating meta fields on the bid card's second line. */
function Dot() {
  return <span className="shrink-0 rounded-full" style={{ width: 2.5, height: 2.5, background: '#C7C9CC' }} />;
}

/** memo()-wrapped so the 1s ticker driving the countdown ring only
 * re-renders the one card whose secondsLeft actually changed meaningfully
 * (rounding keeps most ticks a no-op prop-wise for the other cards), not
 * every bid card in the stack. */
const BidCard = memo(function BidCard({
  offer,
  profile,
  secondsLeft,
  busy,
  onAccept,
  onDecline,
}: {
  offer: Offer;
  profile?: DriverProfile & { full_name?: string | null };
  secondsLeft: number;
  busy: boolean;
  onAccept: (offer: Offer) => void;
  onDecline: (offer: Offer) => void;
}) {
  const name = profile?.full_name || 'Driver';
  const vehicle = profile?.vehicle_model || profile?.vehicle_make || 'Car';
  const pct = Math.max(0, Math.min(100, (secondsLeft / OFFER_TTL_SECONDS) * 100));
  const rating = profile?.rating_avg;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 14, scale: 0.94 }}
      animate={{ opacity: 1, y: [14, -2, 0], scale: [0.94, 1.01, 1] }}
      exit={{ opacity: 0, scale: 0.92, transition: { duration: 0.18 } }}
      transition={{ duration: 0.32, times: [0, 0.6, 1], ease: 'easeOut' }}
      className="pointer-events-auto flex items-center"
      style={{
        padding: '7px 8px 8px 7px',
        borderRadius: 15,
        gap: 9,
        overflow: 'hidden',
        background: 'rgba(255,255,255,.82)',
        backdropFilter: 'blur(24px) saturate(190%)',
        WebkitBackdropFilter: 'blur(24px) saturate(190%)',
        boxShadow: 'inset 0 .5px 0 rgba(255,255,255,.95), inset 0 0 0 .5px rgba(255,255,255,.6), 0 10px 26px rgba(17,17,17,.18)',
      }}
    >
      {/* Avatar + countdown ring — the ring IS the countdown, no numeric seconds. */}
      <span
        className="relative shrink-0 flex items-center justify-center rounded-full"
        style={{ width: 40, height: 40, background: `conic-gradient(#B81104 ${pct}%, rgba(17,17,17,.1) 0)` }}
      >
        <span
          className="flex items-center justify-center rounded-full"
          style={{ width: 33, height: 33, background: 'linear-gradient(135deg,#C6CBD4,#868E9B)', boxShadow: '0 0 0 2px rgba(255,255,255,.95)' }}
        >
          <User style={{ width: 17, height: 17 }} className="text-white" strokeWidth={2.2} />
        </span>
      </span>

      {/* Name + price, then rating · trips · vehicle/ETA */}
      <div className="min-w-0" style={{ flex: 1 }}>
        <div className="flex items-baseline justify-center" style={{ gap: 6 }}>
          <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-.015em', color: RIDE_TEXT }} className="truncate">{name}</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: RIDE_TEXT }} className="tabular-nums shrink-0">${Number(offer.price).toFixed(2)}</span>
        </div>
        <div className="flex items-center justify-center" style={{ marginTop: 2, gap: 4, fontSize: 10.5, fontWeight: 500, color: '#666666' }}>
          {rating != null && rating > 0 && (
            <>
              <span className="flex items-center" style={{ gap: 2 }}>
                <Star style={{ width: 10, height: 10, fill: '#FFDD00', color: '#FFDD00' }} />
                <span style={{ fontWeight: 700, color: RIDE_TEXT }}>{Number(rating).toFixed(1)}</span>
              </span>
              <Dot />
            </>
          )}
          <span className="whitespace-nowrap">{profile?.total_trips ?? 0} trips</span>
          <Dot />
          <span className="whitespace-nowrap">{vehicle}{offer.eta_minutes ? ` · ${offer.eta_minutes} min` : ''}</span>
        </div>
      </div>

      {/* Decline / Accept */}
      <div className="flex items-center shrink-0" style={{ gap: 6 }}>
        <button
          type="button"
          onClick={() => onDecline(offer)}
          disabled={busy}
          aria-label={`Decline ${name}'s offer`}
          className="flex items-center justify-center rounded-full active:scale-90 transition-transform disabled:opacity-50"
          style={{ width: 32, height: 32, background: 'rgba(17,17,17,.06)', boxShadow: 'inset 0 0 0 1px rgba(17,17,17,.08)' }}
        >
          <X style={{ width: 15, height: 15, color: '#666666' }} strokeWidth={2.6} />
        </button>
        <button
          type="button"
          onClick={() => onAccept(offer)}
          disabled={busy}
          aria-label={`Accept ${name}'s offer`}
          className="flex items-center justify-center active:scale-95 transition-transform disabled:opacity-60"
          style={{
            height: 32,
            padding: '0 14px',
            borderRadius: 999,
            background: 'linear-gradient(135deg,#E01B00,#B81104)',
            boxShadow: '0 6px 14px rgba(184,17,4,.34), inset 0 1px 0 rgba(255,255,255,.28)',
          }}
        >
          <span style={{ fontSize: 12.5, fontWeight: 700, color: '#FFFFFF' }}>{busy ? '…' : 'Accept'}</span>
        </button>
      </div>
    </motion.div>
  );
});

function TripSummary({ ride }: { ride: MatchingRide | null }) {
  if (!ride) return null;
  return (
    <div className="rounded-2xl bg-muted/50 p-2.5 space-y-1.5">
      <Row icon={<span className="w-2.5 h-2.5 rounded-full bg-accent block" />} label={ride.pickup_address} />
      <Row icon={<span className="w-2.5 h-2.5 rounded-sm bg-primary block" />} label={ride.dropoff_address} />
      <div className="flex items-center justify-between pt-1 border-t border-border/60 text-xs">
        <span className="flex items-center gap-1 text-muted-foreground">
          <MapPin className="w-3.5 h-3.5" />
          {Number(ride.distance_km).toFixed(1)} km · {Math.round(ride.duration_minutes)} min
        </span>
        <span className="font-extrabold text-foreground">${Number(ride.fare).toFixed(2)}</span>
      </div>
    </div>
  );
}

function Row({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      {icon}
      <p className="text-xs font-medium text-foreground truncate">{label}</p>
    </div>
  );
}
