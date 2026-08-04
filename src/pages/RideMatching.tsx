import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Car, Clock, MapPin, MessageCircle, Phone, Star, X } from 'lucide-react';
import LazyMapboxMap from '@/components/map/LazyMapboxMap';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/hooks/use-toast';
import { haptic } from '@/lib/haptics';
import { playAcceptedSound } from '@/lib/notificationSounds';
import { fetchPendingOffers, acceptOffer, type Offer } from '@/lib/offerHelpers';
import {
  cancelRideRequest,
  fetchAssignedDriver,
  fetchDriverLocation,
  fetchRideById,
  type MatchedDriver,
  type MatchingRide,
} from '@/lib/rideMatching';

const SEARCH_TIMEOUT_MS = 60_000;
const RADIUS_STEPS_KM = [1, 3, 6, 10];

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
  const [accepting, setAccepting] = useState<string | null>(null);
  const waitStartedAt = useRef(Date.now());
  const announced = useRef(false);

  const isMatched = !!ride && ACCEPTED_STATUSES.includes(ride.status);

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
  const handleCancel = async () => {
    if (!rideId) return;
    setCancelling(true);
    try {
      await cancelRideRequest(rideId);
      haptic('light');
      toast({ title: 'Request cancelled' });
      navigate('/ride', { replace: true });
    } catch (e) {
      toast({ title: 'Could not cancel', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setCancelling(false);
    }
  };

  const handleKeepWaiting = () => {
    waitStartedAt.current = Date.now();
    setRemaining(60);
    setTimedOut(false);
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

  const etaMinutes = useMemo(() => {
    if (!driverLocation || !ride) return null;
    const dLat = (ride.pickup_lat - driverLocation.lat) * 111;
    const dLng = (ride.pickup_lon - driverLocation.lng) * 111 * Math.cos((ride.pickup_lat * Math.PI) / 180);
    const km = Math.sqrt(dLat * dLat + dLng * dLng);
    return Math.max(1, Math.round((km / 25) * 60));
  }, [driverLocation, ride]);

  const pickup = ride ? { lat: ride.pickup_lat, lng: ride.pickup_lon } : null;
  const dropoff = ride ? { lat: ride.dropoff_lat, lng: ride.dropoff_lon } : null;

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
          className="w-full h-full"
          height="100%"
        />
      </div>

      {/* Radar pulse over the pickup area while searching */}
      {!isMatched && (
        <div className="absolute inset-x-0 top-[26%] flex justify-center pointer-events-none">
          <div className="relative w-32 h-32">
            {[0, 1, 2].map((i) => (
              <motion.span
                key={i}
                className="absolute inset-0 rounded-full border-2 border-primary/40"
                initial={{ scale: 0.3, opacity: 0.7 }}
                animate={{ scale: 1.5, opacity: 0 }}
                transition={{ repeat: Infinity, duration: 2.4, delay: i * 0.8, ease: 'easeOut' }}
              />
            ))}
            <motion.span
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-primary ring-4 ring-accent/60"
              animate={{ scale: [1, 1.25, 1] }}
              transition={{ repeat: Infinity, duration: 1.6 }}
            />
          </div>
        </div>
      )}

      {/* Back */}
      <button
        onClick={() => navigate('/ride')}
        aria-label="Back"
        className="absolute top-4 left-4 z-20 w-10 h-10 rounded-full bg-card/90 backdrop-blur shadow-md flex items-center justify-center"
      >
        <ArrowLeft className="w-5 h-5 text-foreground" />
      </button>

      {/* Bottom card */}
      <div className="absolute inset-x-0 bottom-0 z-20 p-3" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}>
        <motion.div
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="mx-auto max-w-md bg-card rounded-[24px] shadow-[0_-4px_28px_rgba(0,0,0,0.14)] overflow-hidden"
        >
          {/* Blue ribbon with yellow drag handle */}
          <div className="bg-[#1B3FA0] rounded-t-[24px] pt-2.5 pb-2.5 flex items-center justify-center">
            <div className="h-1.5 w-12 rounded-full bg-[#FFC107]" />
          </div>

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
                  onClick={handleCancel}
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
                  onClick={handleCancel}
                  disabled={cancelling}
                  className="w-full py-2.5 rounded-2xl border border-border text-sm font-semibold text-foreground disabled:opacity-50"
                >
                  Cancel request
                </button>
              </motion.div>
            ) : (
              /* ───────── Searching ───────── */
              <motion.div key="searching" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-extrabold text-foreground">Finding your driver</h2>
                  <span className="relative flex-1 h-6 overflow-hidden">
                    <motion.span
                      className="absolute top-1/2 -translate-y-1/2 flex items-center justify-center w-6 h-6 rounded-full bg-[#1B3FA0]"
                      initial={{ x: '-120%' }}
                      animate={{ x: ['-120%', '420%'] }}
                      transition={{ repeat: Infinity, duration: 2.2, ease: 'linear' }}
                    >
                      <Car className="w-3.5 h-3.5 text-white" />
                    </motion.span>
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Searching within {searchRadiusKm} km · <span className="font-bold text-[#1B3FA0]">{remaining}s</span>
                </p>

                <TripSummary ride={ride} />

                {offers.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-primary">
                      {offers.length} driver{offers.length > 1 ? 's' : ''} responded
                    </p>
                    {offers.slice(0, 3).map((offer) => (
                      <div key={offer.id} className="flex items-center justify-between gap-2 p-2.5 rounded-2xl border border-border">
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

                <button
                  onClick={handleCancel}
                  disabled={cancelling}
                  className="w-full py-2.5 rounded-2xl border border-border text-sm font-semibold text-foreground flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <X className="w-4 h-4" /> Cancel request
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </div>
  );
}

function TripSummary({ ride }: { ride: MatchingRide | null }) {
  if (!ride) return null;
  return (
    <div className="rounded-2xl bg-muted/50 p-3 space-y-2">
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
