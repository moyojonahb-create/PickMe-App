import { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppBootstrap } from '@/hooks/useAppBootstrap';
import { Clock } from 'lucide-react';
import { RIDE_TEXT, RIDE_TEXT_2 } from './rideGlass';

interface RecentDestination {
  name: string;
  secondary: string;
  lat: number;
  lng: number;
  count: number;
}

interface RecentDestinationsProps {
  onSelect: (dest: { name: string; lat: number; lng: number }) => void;
  field: 'pickup' | 'dropoff';
}

function splitAddress(full: string): { primary: string; secondary: string } {
  const idx = full.indexOf(',');
  if (idx === -1) return { primary: full, secondary: '' };
  return { primary: full.slice(0, idx).trim(), secondary: full.slice(idx + 1).trim() };
}

export default function RecentDestinations({ onSelect, field }: RecentDestinationsProps) {
  // Recent rides are preloaded into the splash-time cache (see useAppBootstrap)
  // — derive this screen's view from memory instead of re-querying Supabase.
  const { recentRides } = useAppBootstrap();

  const destinations = useMemo(() => {
    const map = new Map<string, RecentDestination>();
    for (const ride of recentRides) {
      const fullName = field === 'pickup' ? ride.pickup_address : ride.dropoff_address;
      const lat = field === 'pickup' ? ride.pickup_lat : ride.dropoff_lat;
      const lng = field === 'pickup' ? ride.pickup_lon : ride.dropoff_lon;
      if (!fullName) continue;
      const existing = map.get(fullName);
      if (existing) {
        existing.count++;
      } else {
        const { primary, secondary } = splitAddress(fullName);
        map.set(fullName, { name: primary, secondary, lat: Number(lat) || 0, lng: Number(lng) || 0, count: 1 });
      }
    }
    return Array.from(map.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 4);
  }, [recentRides, field]);

  if (destinations.length === 0) return null;

  return (
    <div>
      <p
        className="text-[11px] font-bold uppercase px-1 mb-1.5 flex items-center gap-1.5"
        style={{ color: RIDE_TEXT_2, letterSpacing: '.12em' }}
      >
        <Clock className="w-3 h-3" /> Recent
      </p>
      <AnimatePresence>
        {destinations.map((dest, i) => (
          <motion.button
            key={`${dest.name}-${i}`}
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.04 }}
            onClick={() => onSelect({ name: dest.name, lat: dest.lat, lng: dest.lng })}
            className="w-full flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-black/[0.03] active:scale-[0.98] transition-all text-left"
          >
            <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center shrink-0">
              <Clock className="w-4 h-4" style={{ color: RIDE_TEXT_2 }} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[15px] font-semibold truncate" style={{ color: RIDE_TEXT }}>{dest.name}</p>
              <p className="text-[12px] truncate" style={{ color: RIDE_TEXT_2 }}>
                {dest.secondary || 'Saved trip'}{dest.count > 1 ? ` · ${dest.count} trips` : ''}
              </p>
            </div>
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}
