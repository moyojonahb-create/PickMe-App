import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Wallet, User, MapPin, X } from 'lucide-react';
import { toast } from 'sonner';
import LazyMapboxMap from '@/components/map/LazyMapboxMap';
import { supabase } from '@/lib/supabaseClient';
import { getDriverProfile, submitOffer, defaultNightMultiplier } from '@/lib/offerHelpers';
import { fetchEnrichedOpenRides, type EnrichedRideRequest } from '@/lib/driverRideRequests';
import { expireOldRides } from '@/lib/rideExpiry';
import { playNewRequestSound } from '@/lib/notificationSounds';
import { vibrateAlert, showBrowserNotification } from '@/lib/alerts';
import RideGlassPanel from '@/components/ride/RideGlassPanel';
import SwipeDismissCard from '@/components/driver/SwipeDismissCard';
import DriverBottomNav from '@/components/driver/DriverBottomNav';
import { RIDE_RED, RIDE_TEXT, RIDE_TEXT_2, glassSurface } from '@/components/ride/rideGlass';

function fmtUSD(n: number): string {
  return n % 1 === 0 ? `$${n}` : `$${n.toFixed(2)}`;
}

const panelStyle = {
  background: 'rgba(255,255,255,.9)',
  backdropFilter: 'blur(28px) saturate(190%)',
  WebkitBackdropFilter: 'blur(28px) saturate(190%)',
};

const AUTO_ACCEPT_KEY = 'pickme-driver-auto-accept';

export default function DriverRideRequests() {
  const navigate = useNavigate();
  const [rides, setRides] = useState<EnrichedRideRequest[]>([]);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [driverCoords, setDriverCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [isOnline, setIsOnline] = useState(false);
  const [balance, setBalance] = useState(0);
  const [autoAccept] = useState(() => localStorage.getItem(AUTO_ACCEPT_KEY) === '1');
  const autoAcceptedIds = useRef<Set<string>>(new Set());
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [undoRide, setUndoRide] = useState<EnrichedRideRequest | null>(null);
  const lastRideIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    navigator.geolocation?.getCurrentPosition(
      (pos) => setDriverCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { enableHighAccuracy: false, timeout: 5000 }
    );
  }, []);

  const [driverRowId, setDriverRowId] = useState<string | null>(null);
  useEffect(() => {
    getDriverProfile().then((p) => { setIsOnline(p?.is_online ?? false); setDriverRowId(p?.id ?? null); }).catch(() => {});
  }, []);

  // If a rider accepts this driver's offer while they're sitting on this
  // screen (or the app relaunches mid-trip — force-quit recovery), bounce
  // straight to /driver/dashboard, which owns rendering FullScreenNavigation
  // for an active trip. Without this, an accepted ride only showed up if the
  // driver happened to already be on the dashboard route.
  useEffect(() => {
    if (!driverRowId) return;
    let cancelled = false;
    const checkActiveTrip = async () => {
      const { data } = await supabase
        .from('rides')
        .select('id')
        .eq('driver_id', driverRowId)
        .in('status', ['accepted', 'arrived', 'in_progress'])
        .limit(1)
        .maybeSingle();
      if (!cancelled && data) navigate('/driver/dashboard', { replace: true });
    };
    checkActiveTrip();
    const channel = supabase
      .channel(`driver-active-trip-${driverRowId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rides', filter: `driver_id=eq.${driverRowId}` }, () => { checkActiveTrip(); })
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [driverRowId, navigate]);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getUser().then(({ data }) => {
      const uid = data.user?.id;
      if (!uid) return;
      supabase.from('wallets').select('balance').eq('user_id', uid).maybeSingle()
        .then(({ data: w }) => { if (!cancelled && w) setBalance(Number(w.balance)); });
    });
    return () => { cancelled = true; };
  }, []);

  const refresh = useCallback(async () => {
    try {
      await expireOldRides();
      const profile = await getDriverProfile();
      const online = profile?.is_online ?? false;
      setIsOnline(online);
      if (!online) {
        setRides([]);
        lastRideIds.current = new Set();
        return;
      }
      const list = await fetchEnrichedOpenRides(profile?.gender);
      setRides(list);

      const currentIds = new Set(list.map((r) => r.id));
      let hasNewRide = false;
      for (const id of currentIds) {
        if (!lastRideIds.current.has(id)) { hasNewRide = true; break; }
      }
      if (hasNewRide) {
        playNewRequestSound();
        vibrateAlert();
        showBrowserNotification('🚗 New Ride Request', 'A rider is looking for a driver near you', '/driver/requests');
      }
      lastRideIds.current = currentIds;

      if (autoAccept) {
        for (const ride of list) {
          if (autoAcceptedIds.current.has(ride.id)) continue;
          autoAcceptedIds.current.add(ride.id);
          const mult = defaultNightMultiplier();
          const price = Math.max(0.5, Math.round(ride.fare * mult * 2) / 2);
          submitOffer({ ride_id: ride.id, price, eta_minutes: 10 })
            .then(() => toast.success('Auto-accepted a ride', { description: `${fmtUSD(price)} offer sent` }))
            .catch(() => {});
        }
      }
    } catch (e) {
      toast.error('Could not load ride requests', { description: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, [autoAccept]);

  useEffect(() => {
    refresh();
    const channel = supabase
      .channel('driver-open-rides-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rides' }, () => { refresh(); })
      .subscribe();
    const id = setInterval(refresh, 45000);
    return () => { supabase.removeChannel(channel); clearInterval(id); };
  }, [refresh]);

  const minutesAwayFor = (ride: EnrichedRideRequest): number | null => {
    if (!driverCoords || ride.pickup_lat == null || ride.pickup_lon == null) return null;
    const dLat = (ride.pickup_lat - driverCoords.lat) * 111;
    const dLng = (ride.pickup_lon - driverCoords.lng) * 111 * Math.cos((driverCoords.lat * Math.PI) / 180);
    const km = Math.sqrt(dLat * dLat + dLng * dLng);
    return Math.max(1, Math.round((km / 25) * 60));
  };

  const distanceKmFor = (ride: EnrichedRideRequest): number | null => {
    if (!driverCoords || ride.pickup_lat == null || ride.pickup_lon == null) return null;
    const dLat = (ride.pickup_lat - driverCoords.lat) * 111;
    const dLng = (ride.pickup_lon - driverCoords.lng) * 111 * Math.cos((driverCoords.lat * Math.PI) / 180);
    return Math.sqrt(dLat * dLat + dLng * dLng);
  };

  const visibleRides = useMemo(() => {
    return rides
      .filter((r) => !dismissedIds.has(r.id))
      .map((r) => ({ ride: r, minutes: minutesAwayFor(r), km: distanceKmFor(r) }))
      .sort((a, b) => (a.minutes ?? 999) - (b.minutes ?? 999));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rides, dismissedIds, driverCoords]);

  const handleDismiss = (ride: EnrichedRideRequest) => {
    setDismissedIds((prev) => new Set(prev).add(ride.id));
    setUndoRide(ride);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    undoTimerRef.current = setTimeout(() => setUndoRide((cur) => (cur?.id === ride.id ? null : cur)), 4000);
  };

  const handleUndo = () => {
    if (!undoRide) return;
    setDismissedIds((prev) => { const next = new Set(prev); next.delete(undoRide.id); return next; });
    setUndoRide(null);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
  };

  return (
    <div className="relative w-full h-[100dvh] overflow-hidden" style={{ background: '#F2F4F7' }}>
      <div className="absolute inset-0">
        <LazyMapboxMap defaultCenter={driverCoords ?? undefined} driverLocation={driverCoords} className="w-full h-full" height="100%" />
      </div>
      <div className="absolute inset-0 pointer-events-none" style={{ background: 'rgba(17,17,17,.12)' }} />

      {/* Floating top chrome */}
      <div className="absolute inset-x-0 z-20 flex items-center" style={{ top: 59, left: 16, right: 16, gap: 10 }}>
        <span className="inline-flex items-center shrink-0" style={{ height: 44, padding: '0 14px', borderRadius: 999, gap: 7, ...glassSurface }}>
          <span className="rounded-full" style={{ width: 7, height: 7, background: isOnline ? '#22A447' : '#9AA1AD' }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: RIDE_TEXT }}>{isOnline ? 'Online' : 'Offline'}</span>
        </span>
        <button
          type="button"
          onClick={() => navigate('/driver/wallet')}
          className="ml-auto inline-flex items-center shrink-0 active:scale-95 transition-transform"
          style={{ height: 44, padding: '0 14px', borderRadius: 999, gap: 7, ...glassSurface }}
        >
          <Wallet style={{ width: 15, height: 15, color: RIDE_RED }} />
          <span className="tabular-nums" style={{ fontSize: 13, fontWeight: 700, color: RIDE_TEXT }}>{fmtUSD(balance)}</span>
        </button>
      </div>

      {/* Sheet */}
      <div className="absolute left-0 right-0 bottom-0 z-10" style={{ top: 170, maxWidth: 480, margin: '0 auto', width: '100%' }}>
        <RideGlassPanel panelStyle={panelStyle} style={{ height: '100%', paddingBottom: 'env(safe-area-inset-bottom)' }}>
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain" style={{ paddingBottom: 100 }}>
            <div className="p-4" style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
              <div className="flex items-center justify-between">
                <span style={{ fontSize: 11, fontWeight: 700, color: RIDE_TEXT_2, textTransform: 'uppercase', letterSpacing: '.1em' }}>Requests</span>
                {visibleRides.length > 0 && (
                  <span className="inline-flex items-center" style={{ height: 22, padding: '0 9px', borderRadius: 999, gap: 5, background: 'rgba(184,17,4,.1)' }}>
                    <span className="rounded-full" style={{ width: 6, height: 6, background: RIDE_RED }} />
                    <span style={{ fontSize: 11, fontWeight: 700, color: RIDE_RED }}>{visibleRides.length} new</span>
                  </span>
                )}
              </div>
              {visibleRides.length > 0 && (
                <span style={{ fontSize: 11, fontWeight: 500, color: '#9AA1AD', marginTop: -6 }}>Swipe a card left to dismiss</span>
              )}

              {loading ? (
                <div className="space-y-3">
                  {Array.from({ length: 2 }).map((_, i) => <div key={i} className="h-24 rounded-2xl bg-muted animate-pulse" />)}
                </div>
              ) : visibleRides.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border py-14 text-center">
                  <p className="text-sm text-muted-foreground">No open ride requests right now.</p>
                </div>
              ) : (
                visibleRides.map(({ ride, km }) => (
                  <SwipeDismissCard key={ride.id} onDismiss={() => handleDismiss(ride)}>
                    <RequestCard ride={ride} km={km} onView={() => navigate(`/driver/ride/${ride.id}`)} onDismiss={() => handleDismiss(ride)} />
                  </SwipeDismissCard>
                ))
              )}
            </div>
          </div>
        </RideGlassPanel>
      </div>

      {undoRide && (
        <div className="absolute left-0 right-0 z-30 flex justify-center" style={{ bottom: 100 }}>
          <div className="flex items-center" style={{ gap: 12, padding: '10px 16px', borderRadius: 999, background: '#1F1F1F', boxShadow: '0 10px 24px rgba(0,0,0,.3)' }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: '#fff' }}>Request dismissed</span>
            <button type="button" onClick={handleUndo} style={{ fontSize: 12.5, fontWeight: 700, color: '#FFDD00' }}>Undo</button>
          </div>
        </div>
      )}

      <DriverBottomNav />
    </div>
  );
}

function RequestCard({
  ride, km, onView, onDismiss,
}: {
  ride: EnrichedRideRequest;
  km: number | null;
  onView: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      className="flex items-center"
      style={{ borderRadius: 18, background: '#fff', boxShadow: '0 10px 24px rgba(17,17,17,.1), inset 0 0 0 .5px rgba(17,17,17,.06)', padding: '13px 14px', gap: 12 }}
    >
      <span className="shrink-0 flex items-center justify-center rounded-full overflow-hidden" style={{ width: 52, height: 52, background: 'linear-gradient(135deg,#C6CBD4,#868E9B)', boxShadow: '0 0 0 2px rgba(255,255,255,.95)' }}>
        {ride.passenger_avatar_url ? (
          <img src={ride.passenger_avatar_url} alt="" className="w-full h-full object-cover" />
        ) : (
          <User style={{ width: 24, height: 24, color: '#fff' }} strokeWidth={2} />
        )}
      </span>
      <div className="min-w-0" style={{ flex: 1 }}>
        <p className="truncate" style={{ fontSize: 15, fontWeight: 700, color: RIDE_TEXT }}>{ride.passenger_display_name ?? 'Rider'}</p>
        <p className="flex items-center truncate" style={{ gap: 3, fontSize: 12, fontWeight: 600, color: RIDE_TEXT_2, marginTop: 2 }}>
          <MapPin style={{ width: 12, height: 12, color: '#1A73E8', flexShrink: 0 }} />
          {km != null ? `${km.toFixed(1)} km to pickup` : 'Nearby'}
        </p>
        <p className="truncate" style={{ fontSize: 11, fontWeight: 500, color: '#9AA1AD', marginTop: 1 }}>{ride.pickup_address}</p>
      </div>
      <div className="flex flex-col items-end shrink-0" style={{ gap: 6 }}>
        <span className="tabular-nums" style={{ fontSize: 18, fontWeight: 700, color: RIDE_RED }}>{fmtUSD(ride.fare)}</span>
        <button type="button" onClick={onView} className="flex items-center justify-center active:scale-95 transition-transform" style={{ height: 30, padding: '0 14px', borderRadius: 999, background: 'linear-gradient(135deg, #E01B00, #B81104)' }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: '#fff' }}>View</span>
        </button>
      </div>
      <button type="button" onClick={onDismiss} aria-label="Dismiss" className="shrink-0 flex items-center justify-center rounded-full active:scale-90 transition-transform" style={{ width: 22, height: 22, background: 'rgba(17,17,17,.06)', alignSelf: 'flex-start' }}>
        <X style={{ width: 12, height: 12, color: RIDE_TEXT_2 }} strokeWidth={2.4} />
      </button>
    </div>
  );
}
