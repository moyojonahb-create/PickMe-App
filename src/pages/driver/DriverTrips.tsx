import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, MapPin, Navigation } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/hooks/useAuth';
import { getDriverProfile } from '@/lib/offerHelpers';
import DriverBottomNav from '@/components/driver/DriverBottomNav';
import { format } from 'date-fns';

interface TripRow {
  id: string;
  pickup_address: string;
  dropoff_address: string;
  fare: number;
  status: string;
  created_at: string;
}

function fmtUSD(n: number): string {
  return n % 1 === 0 ? `$${n}` : `$${n.toFixed(2)}`;
}

export default function DriverTrips() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [trips, setTrips] = useState<TripRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      try {
        const profile = await getDriverProfile();
        if (!profile) { setLoading(false); return; }
        const { data } = await supabase
          .from('rides')
          .select('id, pickup_address, dropoff_address, fare, status, created_at')
          .eq('driver_id', profile.id)
          .order('created_at', { ascending: false })
          .limit(50);
        setTrips((data ?? []) as TripRow[]);
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  return (
    <div className="min-h-[100dvh] bg-background pb-24">
      <div className="sticky top-0 z-20 bg-background/95 backdrop-blur-lg border-b border-border/50 px-4 py-3.5" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 14px)' }}>
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <button onClick={() => navigate(-1)} aria-label="Back" className="w-9 h-9 flex items-center justify-center rounded-full active:scale-90 transition-transform">
            <ArrowLeft className="w-5 h-5 text-foreground" />
          </button>
          <h1 className="text-[16px] font-bold text-foreground">Trips</h1>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-2.5">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 rounded-2xl bg-muted animate-pulse" />)
        ) : trips.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border py-14 text-center">
            <p className="text-sm text-muted-foreground">No trips yet.</p>
          </div>
        ) : (
          trips.map((trip) => (
            <div key={trip.id} className="rounded-2xl border border-border bg-card p-3.5">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] font-semibold text-muted-foreground">{format(new Date(trip.created_at), 'MMM d, HH:mm')}</p>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-primary/10 text-primary capitalize">{trip.status}</span>
              </div>
              <div className="space-y-1">
                <p className="flex items-center gap-1.5 text-[13px] text-foreground truncate"><MapPin className="w-3.5 h-3.5 text-blue-600 shrink-0" />{trip.pickup_address}</p>
                <p className="flex items-center gap-1.5 text-[13px] text-foreground truncate"><Navigation className="w-3.5 h-3.5 text-primary shrink-0" />{trip.dropoff_address}</p>
              </div>
              <p className="text-right font-black text-foreground mt-2">{fmtUSD(Number(trip.fare))}</p>
            </div>
          ))
        )}
      </div>

      <DriverBottomNav />
    </div>
  );
}
