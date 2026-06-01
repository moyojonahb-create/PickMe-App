import { useState, useEffect, useMemo } from 'react';
import { Flame, TrendingUp, Clock, MapPin } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { motion, AnimatePresence } from 'framer-motion';

interface DemandZone {
  id: string;
  town_id: string;
  latitude: number;
  longitude: number;
  demand_score: number;
  ride_count: number;
  time_bucket: string;
}

const TIME_FILTERS = [
  { id: 'all', label: 'All Day', icon: Clock },
  { id: 'morning', label: 'Morning', icon: TrendingUp },
  { id: 'midday', label: 'Midday', icon: MapPin },
  { id: 'evening', label: 'Evening', icon: Flame },
  { id: 'night', label: 'Night', icon: Clock },
] as const;

function getHeatColor(score: number, maxScore: number): string {
  const ratio = maxScore > 0 ? score / maxScore : 0;
  if (ratio > 0.7) return 'bg-red-500/80';
  if (ratio > 0.4) return 'bg-orange-400/70';
  if (ratio > 0.2) return 'bg-yellow-400/60';
  return 'bg-green-400/50';
}

function getHeatLabel(score: number, maxScore: number): string {
  const ratio = maxScore > 0 ? score / maxScore : 0;
  if (ratio > 0.7) return '🔥 Hot';
  if (ratio > 0.4) return '⚡ Active';
  if (ratio > 0.2) return '📊 Moderate';
  return '🟢 Low';
}

interface DemandHeatmapProps {
  townId: string;
  className?: string;
}

export default function DemandHeatmap({ townId, className }: DemandHeatmapProps) {
  const [zones, setZones] = useState<DemandZone[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeFilter, setTimeFilter] = useState<string>('all');

  useEffect(() => {
    const fetchZones = async () => {
      setLoading(true);
      // Trigger zone recalculation through a secure server-side wrapper.
      try {
        await supabase.functions.invoke('maintenance', {
          body: JSON.stringify({ action: 'update_demand_zones' }),
          headers: { 'Content-Type': 'application/json' },
        });
      } catch {
        // Ignore errors here so the heatmap still renders off stale data.
      }
      
      const { data } = await supabase
        .from('ride_demand_zones')
        .select('*')
        .eq('town_id', townId)
        .order('demand_score', { ascending: false });

      if (data) setZones(data as DemandZone[]);
      setLoading(false);
    };

    fetchZones();
  }, [townId]);

  const filteredZones = useMemo(() => {
    if (timeFilter === 'all') return zones;
    return zones.filter(z => z.time_bucket === timeFilter);
  }, [zones, timeFilter]);

  const maxScore = useMemo(
    () => Math.max(...filteredZones.map(z => z.demand_score), 1),
    [filteredZones]
  );

  const totalRides = useMemo(
    () => filteredZones.reduce((sum, z) => sum + z.ride_count, 0),
    [filteredZones]
  );

  if (loading) {
    return (
      <div className={`p-4 space-y-3 ${className}`}>
        <div className="flex items-center gap-2">
          <Flame className="w-5 h-5 text-orange-500" />
          <span className="font-bold text-foreground">Demand Heatmap</span>
        </div>
        <div className="space-y-2">
          {[1,2,3].map(i => (
            <div key={i} className="h-12 bg-muted animate-pulse rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Flame className="w-5 h-5 text-orange-500" />
          <span className="font-bold text-foreground">Demand Heatmap</span>
        </div>
        <span className="text-xs text-muted-foreground">{totalRides} rides (24h)</span>
      </div>

      {/* Time filter chips */}
      <div className="flex gap-1 overflow-x-auto pb-1 no-scrollbar">
        {TIME_FILTERS.map(filter => {
          const Icon = filter.icon;
          return (
            <button
              key={filter.id}
              onClick={() => setTimeFilter(filter.id)}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold whitespace-nowrap transition-all shrink-0 ${
                timeFilter === filter.id
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="w-3 h-3" />
              {filter.label}
            </button>
          );
        })}
      </div>

      {/* Zones list */}
      <AnimatePresence mode="popLayout">
        {filteredZones.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-6 text-sm text-muted-foreground"
          >
            No demand data yet. Rides will appear here.
          </motion.div>
        ) : (
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {filteredZones.slice(0, 8).map((zone, i) => (
              <motion.div
                key={zone.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-card border border-border/50"
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold ${getHeatColor(zone.demand_score, maxScore)}`}>
                  {zone.ride_count}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-foreground truncate">
                    {zone.latitude.toFixed(3)}°, {zone.longitude.toFixed(3)}°
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {getHeatLabel(zone.demand_score, maxScore)} · {zone.time_bucket}
                  </p>
                </div>
                {/* Mini bar */}
                <div className="w-16 h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${getHeatColor(zone.demand_score, maxScore)}`}
                    style={{ width: `${(zone.demand_score / maxScore) * 100}%` }}
                  />
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
