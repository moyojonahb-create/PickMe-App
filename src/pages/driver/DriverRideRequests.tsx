import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Bell, X, SlidersHorizontal, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/lib/supabaseClient';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { getDriverProfile, submitOffer, defaultNightMultiplier } from '@/lib/offerHelpers';
import { fetchEnrichedOpenRides, type EnrichedRideRequest } from '@/lib/driverRideRequests';
import RideRequestListCard from '@/components/driver/RideRequestListCard';
import DriverBottomNav from '@/components/driver/DriverBottomNav';

function fmtUSD(n: number): string {
  return n % 1 === 0 ? `$${n}` : `$${n.toFixed(2)}`;
}

const AUTO_ACCEPT_KEY = 'pickme-driver-auto-accept';

type SortMode = 'nearest' | 'fare';

export default function DriverRideRequests() {
  const navigate = useNavigate();
  const [rides, setRides] = useState<EnrichedRideRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [driverCoords, setDriverCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [vehicleFilter, setVehicleFilter] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>('nearest');
  const [autoAccept, setAutoAccept] = useState(() => localStorage.getItem(AUTO_ACCEPT_KEY) === '1');
  const autoAcceptedIds = useRef<Set<string>>(new Set());
  useEscapeKey(filterOpen, () => setFilterOpen(false));

  useEffect(() => {
    navigator.geolocation?.getCurrentPosition(
      (pos) => setDriverCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { enableHighAccuracy: false, timeout: 5000 }
    );
  }, []);

  const refresh = useCallback(async () => {
    try {
      const profile = await getDriverProfile();
      const list = await fetchEnrichedOpenRides(profile?.gender);
      setRides(list);

      if (autoAccept) {
        for (const ride of list) {
          if (autoAcceptedIds.current.has(ride.id)) continue;
          autoAcceptedIds.current.add(ride.id);
          const mult = defaultNightMultiplier();
          const price = Math.max(0.5, Math.round(ride.fare * mult * 2) / 2);
          submitOffer({ ride_id: ride.id, price, eta_minutes: 10 })
            .then(() => toast.success('Auto-accepted a ride', { description: `${fmtUSD(price)} offer sent` }))
            .catch(() => { /* silently skip — driver can still accept manually */ });
        }
      }
    } catch (e) {
      toast.error('Could not load ride requests', { description: (e as Error).message });
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAccept]);

  useEffect(() => {
    refresh();
    // Realtime-driven, not polling: any insert/update/delete on rides
    // (a new request, one getting claimed, one expiring) refreshes the
    // list immediately. A long safety-net poll stays as a fallback only in
    // case the realtime channel silently drops.
    const channel = supabase
      .channel('driver-open-rides-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rides' }, () => { refresh(); })
      .subscribe();
    const id = setInterval(refresh, 45000);
    return () => { supabase.removeChannel(channel); clearInterval(id); };
  }, [refresh]);

  const toggleAutoAccept = (checked: boolean) => {
    setAutoAccept(checked);
    localStorage.setItem(AUTO_ACCEPT_KEY, checked ? '1' : '0');
    toast.success(checked ? 'Auto-accept turned on' : 'Auto-accept turned off');
  };

  const minutesAwayFor = (ride: EnrichedRideRequest): number | null => {
    if (!driverCoords || ride.pickup_lat == null || ride.pickup_lon == null) return null;
    const dLat = (ride.pickup_lat - driverCoords.lat) * 111;
    const dLng = (ride.pickup_lon - driverCoords.lng) * 111 * Math.cos((driverCoords.lat * Math.PI) / 180);
    const km = Math.sqrt(dLat * dLat + dLng * dLng);
    return Math.max(1, Math.round((km / 25) * 60));
  };

  const visibleRides = useMemo(() => {
    let list = rides;
    if (vehicleFilter) list = list.filter((r) => (r.vehicle_type || 'economy') === vehicleFilter);
    const withMinutes = list.map((r) => ({ ride: r, minutes: minutesAwayFor(r) }));
    withMinutes.sort((a, b) => {
      if (sortMode === 'fare') return b.ride.fare - a.ride.fare;
      return (a.minutes ?? 999) - (b.minutes ?? 999);
    });
    return withMinutes;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rides, vehicleFilter, sortMode, driverCoords]);

  return (
    <div className="min-h-[100dvh] bg-background pb-24">
      <div className="sticky top-0 z-20 bg-background/95 backdrop-blur-lg border-b border-border/50 px-4 py-3.5" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 14px)' }}>
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <button onClick={() => navigate(-1)} aria-label="Back" className="w-9 h-9 flex items-center justify-center rounded-full active:scale-90 transition-transform">
            <ArrowLeft className="w-5 h-5 text-foreground" />
          </button>
          <h1 className="text-[16px] font-bold text-foreground">Ride Requests</h1>
          <button onClick={() => setFilterOpen(true)} aria-label="Filter requests" className="w-9 h-9 flex items-center justify-center rounded-full active:scale-90 transition-transform">
            <SlidersHorizontal className="w-5 h-5 text-foreground" />
          </button>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-3">
        {!bannerDismissed && rides.length > 0 && (
          <div className="flex items-center gap-3 rounded-2xl px-3.5 py-3" style={{ background: '#FFF8DB' }}>
            <span className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: '#FFDD00' }}>
              <Bell className="w-4.5 h-4.5" style={{ color: '#111111' }} />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-bold text-foreground">You have {rides.length} new request{rides.length !== 1 ? 's' : ''}</p>
              <p className="text-[11px] text-muted-foreground">Choose a request to accept</p>
            </div>
            <button onClick={() => setBannerDismissed(true)} aria-label="Dismiss" className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-black/5 shrink-0">
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>
        )}

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 2 }).map((_, i) => <div key={i} className="h-64 rounded-2xl bg-muted animate-pulse" />)}
          </div>
        ) : visibleRides.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border py-14 text-center">
            <p className="text-sm text-muted-foreground">No open ride requests right now.</p>
          </div>
        ) : (
          visibleRides.map(({ ride, minutes }) => (
            <RideRequestListCard
              key={ride.id}
              ride={ride}
              minutesAway={minutes}
              fmtUSD={fmtUSD}
              onClick={() => navigate(`/driver/ride/${ride.id}`)}
              onAccept={() => navigate(`/driver/ride/${ride.id}`)}
              onEditFare={() => navigate(`/driver/ride/${ride.id}`)}
            />
          ))
        )}

        {/* Auto-accept */}
        <div className="flex items-center gap-3 rounded-2xl border border-border p-3.5 mt-2">
          <span className="w-9 h-9 rounded-full bg-muted flex items-center justify-center shrink-0">
            <ShieldCheck className="w-4.5 h-4.5 text-muted-foreground" />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-bold text-foreground">Auto-accept is {autoAccept ? 'ON' : 'OFF'}</p>
            <p className="text-[11px] text-muted-foreground">
              {autoAccept ? 'New requests are offered automatically at the listed fare.' : 'You need to accept requests manually.'}
            </p>
          </div>
          <Switch checked={autoAccept} onCheckedChange={toggleAutoAccept} />
        </div>
      </div>

      {filterOpen && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-foreground/30 backdrop-blur-sm" onClick={() => setFilterOpen(false)} />
          <div className="relative w-full max-w-lg bg-background rounded-t-3xl p-5 space-y-4" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 20px)' }}>
            <div className="flex items-center justify-between">
              <p className="font-bold text-foreground">Filter requests</p>
              <button onClick={() => setFilterOpen(false)} aria-label="Close" className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-muted">
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>

            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Vehicle type</p>
              <div className="flex gap-2 flex-wrap">
                {[{ key: null, label: 'All' }, { key: 'economy', label: 'Economy' }, { key: 'share', label: 'Comfort' }, { key: 'parcel', label: 'Parcel' }].map((opt) => (
                  <button
                    key={opt.label}
                    onClick={() => setVehicleFilter(opt.key)}
                    className={`px-3.5 py-2 rounded-full text-[12px] font-bold border ${vehicleFilter === opt.key ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-foreground'}`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Sort by</p>
              <div className="flex gap-2">
                {[{ key: 'nearest' as SortMode, label: 'Nearest' }, { key: 'fare' as SortMode, label: 'Highest fare' }].map((opt) => (
                  <button
                    key={opt.key}
                    onClick={() => setSortMode(opt.key)}
                    className={`px-3.5 py-2 rounded-full text-[12px] font-bold border ${sortMode === opt.key ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-foreground'}`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <button onClick={() => setFilterOpen(false)} className="w-full py-3 rounded-2xl bg-primary text-primary-foreground font-bold text-sm">
              Apply
            </button>
          </div>
        </div>
      )}

      <DriverBottomNav />
    </div>
  );
}
