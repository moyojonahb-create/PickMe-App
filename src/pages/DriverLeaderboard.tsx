import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient';
import { ArrowLeft, Trophy, Star, Car, Medal, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';
import CruiXeLogo from '@/components/CruiXeLogo';
import BottomNavBar from '@/components/BottomNavBar';

interface LeaderDriver {
  id: string;
  vehicle_type: string;
  vehicle_make: string | null;
  vehicle_model: string | null;
  rating_avg: number | null;
  total_trips: number | null;
  avatar_url: string | null;
  plate_number: string | null;
}

const TIER_STYLES = [
  { bg: 'bg-yellow-500/10', border: 'border-yellow-500/30', icon: '🥇', text: 'text-yellow-600' },
  { bg: 'bg-gray-300/10', border: 'border-gray-400/30', icon: '🥈', text: 'text-gray-500' },
  { bg: 'bg-amber-700/10', border: 'border-amber-700/30', icon: '🥉', text: 'text-amber-700' },
];

export default function DriverLeaderboard() {
  const navigate = useNavigate();
  const [drivers, setDrivers] = useState<LeaderDriver[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('drivers')
        .select('id, vehicle_type, vehicle_make, vehicle_model, rating_avg, total_trips, avatar_url, plate_number')
        .eq('status', 'approved')
        .order('rating_avg', { ascending: false, nullsFirst: false })
        .order('total_trips', { ascending: false, nullsFirst: false })
        .limit(20);

      setDrivers((data || []) as LeaderDriver[]);
      setLoading(false);
    })();
  }, []);

  return (
    <div className="min-h-[100dvh] bg-background">
      {/* Header */}
      <div className="sticky top-0 z-30 glass-card-heavy border-b border-border/30">
        <div className="flex items-center justify-between px-4 h-14" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
          <button onClick={() => navigate(-1)} className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-secondary transition-colors">
            <ArrowLeft className="w-5 h-5 text-foreground" />
          </button>
          <h1 className="text-lg font-bold font-display text-foreground flex items-center gap-2">
            <Trophy className="w-5 h-5 text-primary" />
            Top Drivers
          </h1>
          <CruiXeLogo size="sm" />
        </div>
      </div>

      <div className="px-4 py-4 pb-28 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : drivers.length === 0 ? (
          <div className="text-center py-20">
            <Trophy className="w-12 h-12 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-muted-foreground font-medium">No drivers yet</p>
          </div>
        ) : (
          drivers.map((driver, i) => {
            const tier = i < 3 ? TIER_STYLES[i] : null;
            const rating = Number(driver.rating_avg || 0).toFixed(1);
            const trips = driver.total_trips || 0;

            return (
              <motion.div
                key={driver.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.04 }}
                className={`glass-card p-4 flex items-center gap-3 ${tier ? `${tier.bg} border ${tier.border}` : ''}`}
                style={{ borderRadius: 16 }}
              >
                {/* Rank */}
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${tier ? tier.text : 'text-muted-foreground bg-muted'}`}>
                  {tier ? tier.icon : i + 1}
                </div>

                {/* Avatar */}
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0 overflow-hidden">
                  {driver.avatar_url ? (
                    <img src={driver.avatar_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <Car className="w-5 h-5 text-primary" />
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate">
                    {driver.vehicle_make || ''} {driver.vehicle_model || driver.vehicle_type}
                  </p>
                  {driver.plate_number && (
                    <p className="text-[10px] text-muted-foreground font-mono">{driver.plate_number}</p>
                  )}
                </div>

                {/* Stats */}
                <div className="text-right shrink-0">
                  <div className="flex items-center gap-1 justify-end">
                    <Star className="w-3.5 h-3.5 text-yellow-500 fill-yellow-500" />
                    <span className="text-sm font-bold text-foreground">{rating}</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">{trips} trips</p>
                </div>
              </motion.div>
            );
          })
        )}
      </div>

      <BottomNavBar />
    </div>
  );
}
