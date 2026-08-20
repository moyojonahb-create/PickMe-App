import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Car, Clock, Locate, MapPin, MessageCircle, Minus, Phone, Plus, Radar, Star, User } from 'lucide-react';
import LazyMapboxMap from '@/components/map/LazyMapboxMap';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/hooks/use-toast';
import { haptic } from '@/lib/haptics';
import { playAcceptedSound } from '@/lib/notificationSounds';
import { fetchPendingOffers, acceptOffer, type Offer } from '@/lib/offerHelpers';
import { getFareStep } from '@/hooks/useTownPricing';
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
import carSearchSide from '@/assets/cars/car-search-side.png';
import carFrontEconomy from '@/assets/cars/car-front-economy.png';
import carSlantShare from '@/assets/cars/car-slant-share.png';
import carParcel from '@/assets/cars/car-parcel.png';
import CancelReasonSheet from '@/components/ride/CancelReasonSheet';
import RideGlassPanel from '@/components/ride/RideGlassPanel';
import RideNoteSheet from '@/components/ride/RideNoteSheet';
import { glassSurface, redCta, tintBlue, RIDE_RED, RIDE_TEXT, RIDE_TEXT_2, RIDE_TEXT_3, RIDE_YELLOW } from '@/components/ride/rideGlass';

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

const TIER_LABELS: Record<string, string> = { economy: 'Economy', share: 'Share Ride', parcel: 'Parcel' };
const TIER_ASSETS: Record<string, string> = { economy: carFrontEconomy, share: carSlantShare, parcel: carParcel };

/** Placeholder cars scattered inside the current search radius (not real data). */
function makePlaceholderCars(center: { lat: number; lng: number } | null, radiusKm: number, count: number) {
  if (!center) return [];
  const cars: Array<{ id: string; lat: number; lng: number; white: boolean }> = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + (i * 1.7);
    const dist = radiusKm * (0.45 + ((i * 37) % 55) / 100);
    const dLat = (dist * Math.cos(angle)) / 111;
    const dLng = (dist * Math.sin(angle)) / (111 * Math.cos((center.lat * Math.PI) / 180));
    cars.push({ id: `ph-${radiusKm}-${i}`, lat: center.lat + dLat, lng: center.lng + dLng, white: true });
  }
  return cars;
}
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
  const [preferredCenter, setPreferredCenter] = useState<{ lat: number; lng: number } | null>(null);
  const waitStartedAt = useRef(Date.now());
  const searchStartedAt = useRef(Date.now());
  const announced = useRef(false);

  const isMatched = !!ride && ACCEPTED_STATUSES.includes(ride.status);
  const viewerCount = useRideViewerCount(!isMatched ? rideId : null);

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
    if (isMatched || !rideId) return;
    const id = setInterval(() => {
      loadRide();
      fetchPendingOffers(rideId).then(setOffers).catch(() => {});
    }, 5000);
    return () => clearInterval(id);
  }, [rideId, isMatched, loadRide]);

  /* ── 60s countdown; each cycle widens the search radius ────── */
  useEffect(() => {
    if (isMatched) return;
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
    }, 1000);
    return () => clearInterval(id);
  }, [isMatched]);

  /* ── Elapsed M:SS display — counts up, caps at 5:00, independent of the
     radius-widening cycle above (purely a reassurance timer). ─────────── */
  useEffect(() => {
    if (isMatched) return;
    const id = setInterval(() => {
      setElapsedSeconds(Math.min(ELAPSED_CAP_SECONDS, Math.floor((Date.now() - searchStartedAt.current) / 1000)));
    }, 1000);
    return () => clearInterval(id);
  }, [isMatched]);

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  const elapsedSecs = elapsedSeconds % 60;
  const countdownText = `${elapsedMinutes}:${elapsedSecs < 10 ? '0' : ''}${elapsedSecs}`;
  const showKeepSearchingPrompt = elapsedSeconds >= ELAPSED_CAP_SECONDS;

  const searchRadiusKm = RADIUS_STEPS_KM[radiusIndex];
  const placeholderCars = useMemo(
    () => makePlaceholderCars(ride ? { lat: ride.pickup_lat, lng: ride.pickup_lon } : null, searchRadiusKm, 2 + radiusIndex * 2),
    [ride?.pickup_lat, ride?.pickup_lon, searchRadiusKm, radiusIndex]
  );

  /* ── Driver details + live position once matched ───────────── */
  useEffect(() => {
    if (!isMatched || !ride?.driver_id) return;
    if (!announced.current) {
      announced.current = true;
      haptic('medium');
      playAcceptedSound();
      toast({ title: '🎉 Driver found!', description: 'Your driver is on the way.' });
    }
    fetchAssignedDriver(ride.driver_id).then(setDriver).catch(() => {});
  }, [isMatched, ride?.driver_id]);

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

  const handleAcceptOffer = async (offer: Offer) => {
    if (!rideId) return;
    setAccepting(offer.id);
    try {
      await acceptOffer(rideId, offer.id);
      await loadRide();
    } catch (e) {
      toast({ title: 'Could not accept offer', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setAccepting(null);
    }
  };

  const handleFareChange = async (delta: number) => {
    if (!rideId || !ride || fareBumping) return;
    const nextFare = Math.max(FARE_STEP, Math.round((Number(ride.fare) + delta) * 100) / 100);
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

  const handleSaveNote = async (note: string) => {
    if (!rideId) return;
    setNoteSaving(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const { error } = await supabase
        .from('trip_events')
        .insert([{ ride_id: rideId, actor_id: auth?.user?.id ?? null, event_type: 'rider_note', payload: { note } }] as never);
      if (error) throw new Error(error.message);
      setNoteValue(note);
      haptic('light');
      toast({ title: 'Note sent to drivers' });
      setNoteOpen(false);
    } catch (e) {
      toast({ title: 'Could not save note', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setNoteSaving(false);
    }
  };

  const etaMinutes = useMemo(() => {
    if (!driverLocation || !ride) return null;
    const dLat = (ride.pickup_lat - driverLocation.lat) * 111;
    const dLng = (ride.pickup_lon - driverLocation.lng) * 111 * Math.cos((ride.pickup_lat * Math.PI) / 180);
    const km = Math.sqrt(dLat * dLat + dLng * dLng);
    return Math.max(1, Math.round((km / 25) * 60));
  }, [driverLocation, ride]);

  const pickup = ride ? { lat: ride.pickup_lat, lng: ride.pickup_lon } : null;
  const dropoff = ride ? { lat: ride.dropoff_lat, lng: ride.dropoff_lon } : null;
  const tierKey = ride?.vehicle_type && TIER_LABELS[ride.vehicle_type] ? ride.vehicle_type : 'economy';

  return (
    <div className="relative w-full h-[100dvh] overflow-hidden bg-background">
      {/* Map */}
      <div className="absolute inset-0">
        <LazyMapboxMap
          pickup={pickup}
          dropoff={dropoff}
          driverLocation={driverLocation}
          drivers={isMatched ? undefined : placeholderCars}
          routeGeometry={ride?.route_polyline ?? null}
          preferredCenter={preferredCenter}
          className="w-full h-full"
          height="100%"
        />
      </div>

      {/* Small blue pickup marker while searching — no large radar rings, per spec */}
      {!isMatched && (
        <div className="absolute inset-x-0 top-[26%] flex justify-center pointer-events-none">
          <span
            className="block rounded-full"
            style={{ width: 22, height: 22, background: '#1A73E8', border: '3.5px solid #fff', boxShadow: '0 2px 6px rgba(0,0,0,.25)' }}
          />
        </div>
      )}

      {/* Map chrome — back (top-left) + locate (top-right) only, per the reference */}
      <button
        onClick={() => navigate('/ride')}
        aria-label="Back"
        className="absolute left-3 z-20 flex items-center justify-center rounded-full active:scale-90 transition-transform"
        style={{ top: 'calc(env(safe-area-inset-top) + 7px)', width: 52, height: 52, ...glassSurface }}
      >
        <ArrowLeft className="w-5 h-5" style={{ color: RIDE_TEXT }} />
      </button>
      <button
        onClick={() => pickup && setPreferredCenter({ ...pickup })}
        aria-label="Use my location"
        className="absolute right-3 z-20 flex items-center justify-center rounded-full active:scale-90 transition-transform"
        style={{ top: 'calc(env(safe-area-inset-top) + 7px)', width: 52, height: 52, ...glassSurface }}
      >
        <Locate className="w-5 h-5" style={{ color: RIDE_TEXT }} />
      </button>

      {/* Bottom sheet — same glass ribbon treatment as the ride-selection screen */}
      <RideGlassPanel
        className="absolute left-0 right-0 z-20"
        style={{ bottom: 0, maxHeight: '82vh', paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
          <AnimatePresence mode="wait">
            {isMatched ? (
              /* ───────── Driver on the way ───────── */
              <motion.div key="matched" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-extrabold text-foreground">Driver on the way</h2>
                  {etaMinutes !== null && (
                    <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary text-primary-foreground text-xs font-bold">
                      <Clock className="w-3.5 h-3.5" /> {etaMinutes} min
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <div className="w-14 h-14 rounded-2xl overflow-hidden bg-muted flex items-center justify-center shrink-0">
                    {driver?.avatar_url ? (
                      <img src={driver.avatar_url} alt={driver.full_name || 'Driver'} className="w-full h-full object-cover" />
                    ) : (
                      <Car className="w-6 h-6 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-foreground truncate">{driver?.full_name || 'Your driver'}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {[driver?.vehicle_color, driver?.vehicle_make, driver?.vehicle_model].filter(Boolean).join(' ') || 'Vehicle details pending'}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      {driver?.plate_number && (
                        <span className="px-2 py-0.5 rounded-md bg-accent text-accent-foreground text-[11px] font-extrabold tracking-wider">
                          {driver.plate_number}
                        </span>
                      )}
                      <span className="flex items-center gap-0.5 text-[11px] font-semibold text-foreground">
                        <Star className="w-3 h-3 fill-accent text-accent" />
                        {driver?.rating_avg ? Number(driver.rating_avg).toFixed(1) : 'New'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <a
                    href={driver?.phone ? `tel:${driver.phone}` : undefined}
                    className={`flex items-center justify-center gap-2 py-2.5 rounded-2xl font-semibold text-sm ${driver?.phone ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground pointer-events-none'}`}
                  >
                    <Phone className="w-4 h-4" /> Call
                  </a>
                  <button
                    onClick={() => navigate(`/ride/${rideId}`)}
                    className="flex items-center justify-center gap-2 py-2.5 rounded-2xl bg-accent text-accent-foreground font-semibold text-sm"
                  >
                    <MessageCircle className="w-4 h-4" /> Message
                  </button>
                </div>

                <button
                  onClick={() => navigate(`/ride/${rideId}`)}
                  className="w-full py-2.5 rounded-2xl border border-border text-sm font-semibold text-foreground"
                >
                  Open full trip view
                </button>
                <button
                  onClick={() => setCancelSheetOpen(true)}
                  disabled={cancelling}
                  className="w-full py-2 text-xs font-semibold text-destructive disabled:opacity-50"
                >
                  Cancel trip
                </button>
              </motion.div>
            ) : timedOut ? (
              /* ───────── No drivers found ───────── */
              <motion.div key="timeout" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-4 space-y-3">
                <h2 className="text-lg font-extrabold text-foreground">No drivers available right now</h2>
                <p className="text-sm text-muted-foreground">
                  We couldn't match you in the last minute. You can keep waiting — we'll keep broadcasting your request — or cancel and try again shortly.
                </p>
                <TripSummary ride={ride} />
                <button onClick={handleKeepWaiting} className="w-full py-3 rounded-2xl bg-primary text-primary-foreground font-bold">
                  Keep waiting
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
                    disabled={fareBumping || !ride || Number(ride.fare) <= FARE_STEP}
                    aria-label="Decrease fare"
                    className="shrink-0 flex items-center justify-center rounded-full active:scale-90 transition-transform disabled:opacity-40"
                    style={{ width: 38, height: 38, background: RIDE_YELLOW }}
                  >
                    <Minus className="w-[17px] h-[17px]" style={{ color: RIDE_TEXT }} />
                  </button>
                  <span className="text-center text-[17px] font-bold tabular-nums" style={{ color: RIDE_RED }}>
                    ${ride ? Number(ride.fare).toFixed(2) : '0.00'}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleFareChange(FARE_STEP)}
                    disabled={fareBumping}
                    aria-label="Increase fare"
                    className="shrink-0 flex items-center justify-center rounded-full active:scale-90 transition-transform disabled:opacity-40"
                    style={{ width: 38, height: 38, ...redCta }}
                  >
                    <Plus className="w-[17px] h-[17px] text-white" />
                  </button>
                </div>

                {/* Chosen-ride summary card */}
                <div className="flex items-center gap-3 px-3.5 py-2" style={{ ...tintBlue, borderRadius: 16 }}>
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

                {offers.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: RIDE_RED }}>
                      {offers.length} driver{offers.length > 1 ? 's' : ''} responded
                    </p>
                    {offers.slice(0, 3).map((offer) => (
                      <div key={offer.id} className="flex items-center justify-between gap-2 p-2.5 rounded-2xl border border-border/60 bg-white/40">
                        <div>
                          <p className="text-sm font-bold text-foreground">${Number(offer.price).toFixed(2)}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {offer.eta_minutes ? `${offer.eta_minutes} min away` : 'ETA unavailable'}
                          </p>
                        </div>
                        <button
                          onClick={() => handleAcceptOffer(offer)}
                          disabled={accepting === offer.id}
                          className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-bold disabled:opacity-60"
                        >
                          {accepting === offer.id ? 'Accepting…' : 'Accept'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}

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

      <CancelReasonSheet
        open={cancelSheetOpen}
        onClose={() => setCancelSheetOpen(false)}
        onConfirm={handleCancel}
        cancelling={cancelling}
      />
      <RideNoteSheet
        open={noteOpen}
        initial={noteValue}
        saving={noteSaving}
        onClose={() => setNoteOpen(false)}
        onSave={handleSaveNote}
      />
    </div>
  );
}

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
