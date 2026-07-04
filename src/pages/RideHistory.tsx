import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabaseClient';
import { ArrowLeft, MapPin, Navigation, Clock, Banknote, Car, ChevronRight, Loader2, AlertCircle, CircleDollarSign } from 'lucide-react';
import { format } from 'date-fns';
import PickMeLogo from '@/components/PickMeLogo';
import BottomNavBar from '@/components/BottomNavBar';
import RiderSpendingAnalytics from '@/components/ride/RiderSpendingAnalytics';
import PaymentStatusBadge from '@/components/ride/PaymentStatusBadge';


interface RideRecord {
  id: string;
  pickup_address: string;
  dropoff_address: string;
  fare: number;
  distance_km: number;
  duration_minutes: number;
  status: string;
  created_at: string;
  payment_method: string;
  vehicle_type: string;
  wallet_paid?: boolean | null;
  payment_failed?: boolean | null;
  payment_failure_reason?: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  completed: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20',
  cancelled: 'bg-destructive/10 text-destructive border-destructive/20',
  expired: 'bg-muted text-muted-foreground border-border',
  pending: 'bg-amber-500/10 text-amber-700 border-amber-500/20',
  in_progress: 'bg-primary/10 text-primary border-primary/20',
  accepted: 'bg-primary/10 text-primary border-primary/20',
};

const STATUS_LABELS: Record<string, string> = {
  completed: 'Completed',
  cancelled: 'Cancelled',
  expired: 'Expired',
  pending: 'Pending',
  in_progress: 'In progress',
  accepted: 'Accepted',
};

export default function RideHistory() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isMapp = location.pathname.startsWith('/mapp');
  const prefix = isMapp ? '/mapp' : '';
  const [rides, setRides] = useState<RideRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth');
      return;
    }
    if (user) fetchRides();
  }, [user, authLoading]);

  const fetchRides = async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    const { data, error: ridesError } = await supabase
      .from('rides')
      .select('id, pickup_address, dropoff_address, fare, distance_km, duration_minutes, status, created_at, payment_method, vehicle_type, wallet_paid, payment_failed, payment_failure_reason')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (ridesError) {
      setError(ridesError.message || 'We could not load your ride history.');
      setRides([]);
    } else if (data) {
      setRides(data as RideRecord[]);
    }
    setLoading(false);
  };

  const tripSummary = useMemo(() => ({
    totalTrips: rides.length,
    totalSpend: rides.reduce((sum, ride) => sum + Number(ride.fare || 0), 0),
    latestTrip: rides[0]?.created_at || null,
  }), [rides]);

  return (
    <div className="min-h-[100dvh] bg-background">
      {/* Header */}
      <div className="sticky top-0 z-30 glass-card-heavy border-b border-border/30">
        <div className="flex items-center justify-between px-4 h-14" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
          <button onClick={() => navigate(-1)} className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-secondary transition-colors">
            <ArrowLeft className="w-5 h-5 text-foreground" />
          </button>
          <h1 className="text-lg font-bold font-display text-foreground">My Trips</h1>
          <PickMeLogo size="sm" />
        </div>
      </div>

      <div className="px-4 py-4 pb-28 space-y-4">
        {!loading && rides.length > 0 && <RiderSpendingAnalytics rides={rides} />}

        {!loading && !error && rides.length > 0 && (
          <div className="rounded-[22px] border border-border/50 bg-card/80 p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">Trip overview</p>
                <p className="mt-1 text-base font-bold text-foreground">{tripSummary.totalTrips} completed journeys</p>
                <p className="text-sm text-muted-foreground">Total spend tracked across your recent trips.</p>
              </div>
              <div className="rounded-2xl bg-primary/10 p-3 text-primary">
                <CircleDollarSign className="h-5 w-5" />
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-2xl bg-muted/60 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Total spend</p>
                <p className="mt-1 text-base font-black text-foreground">${tripSummary.totalSpend.toFixed(2)}</p>
              </div>
              <div className="rounded-2xl bg-muted/60 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Latest trip</p>
                <p className="mt-1 text-sm font-semibold text-foreground">
                  {tripSummary.latestTrip ? format(new Date(tripSummary.latestTrip), 'MMM d') : '—'}
                </p>
              </div>
            </div>
          </div>
        )}

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="rounded-[22px] border border-border/40 bg-card/80 p-4 shadow-sm">
                <div className="flex items-start gap-3">
                  <div className="h-11 w-11 rounded-2xl bg-muted animate-pulse" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-24 rounded-full bg-muted animate-pulse" />
                    <div className="h-4 w-full rounded-full bg-muted animate-pulse" />
                    <div className="h-4 w-4/5 rounded-full bg-muted animate-pulse" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="rounded-[22px] border border-destructive/20 bg-destructive/5 p-6 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
              <AlertCircle className="h-6 w-6" />
            </div>
            <p className="mt-3 text-base font-semibold text-foreground">We hit a snag loading your history</p>
            <p className="mt-1 text-sm text-muted-foreground">{error}</p>
            <button onClick={() => fetchRides()} className="mt-4 h-10 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground">
              Try again
            </button>
          </div>
        ) : rides.length === 0 ? (
          <div className="rounded-[24px] border border-border/50 bg-card/80 px-5 py-12 text-center shadow-sm">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Car className="h-7 w-7" />
            </div>
            <p className="mt-3 text-base font-semibold text-foreground">No trips yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Your ride history will appear here as soon as you take your first trip.</p>
            <button onClick={() => navigate(`${prefix}/ride`)} className="mt-4 h-10 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground">
              Book your first ride
            </button>
          </div>
        ) : (
          rides.map((ride) => {
            const status = STATUS_LABELS[ride.status] || ride.status;
            const label = ride.pickup_address || 'Pickup location';
            const avatarLabel = label.charAt(0).toUpperCase();
            return (
              <button
                key={ride.id}
                onClick={() => navigate(`${prefix}/ride/${ride.id}`)}
                className="w-full rounded-[22px] border border-border/50 bg-card/90 p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md active:scale-[0.99]"
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-sm font-bold text-primary">
                    {avatarLabel}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.2em] ${STATUS_COLORS[ride.status] || STATUS_COLORS.pending}`}>
                        {status}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(ride.created_at), 'MMM d, yyyy · h:mm a')}
                      </span>
                    </div>

                    <div className="mt-3 space-y-2">
                      <div className="flex items-start gap-2">
                        <div className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-primary" />
                        <div className="min-w-0">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Pickup</p>
                          <p className="text-sm font-semibold text-foreground truncate">{ride.pickup_address}</p>
                        </div>
                      </div>
                      <div className="flex items-start gap-2">
                        <div className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-accent" />
                        <div className="min-w-0">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Dropoff</p>
                          <p className="text-sm font-semibold text-foreground truncate">{ride.dropoff_address}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                  <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2 rounded-2xl border border-border/40 bg-muted/40 p-2.5 text-xs text-muted-foreground">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em]">Fare</p>
                    <p className="mt-1 font-semibold text-foreground">${Number(ride.fare).toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em]">Distance</p>
                    <p className="mt-1 font-semibold text-foreground">{ride.distance_km.toFixed(1)} km</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em]">Time</p>
                    <p className="mt-1 font-semibold text-foreground">{ride.duration_minutes} min</p>
                  </div>
                </div>

                {(ride.status === 'completed' || ride.payment_failed) && (
                  <div className="mt-3">
                    <PaymentStatusBadge
                      status={ride.status}
                      paymentMethod={ride.payment_method}
                      walletPaid={ride.wallet_paid}
                      paymentFailed={ride.payment_failed}
                      paymentFailureReason={ride.payment_failure_reason}
                    />
                  </div>
                )}
              </button>
            );
          })
        )}
      </div>

      <BottomNavBar />
    </div>
  );
}
