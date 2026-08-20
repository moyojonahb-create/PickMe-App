import { motion } from 'framer-motion';
import { Zap } from 'lucide-react';
import { RIDE_RED, RIDE_TEXT_2 } from './rideGlass';

interface NearbyDriversSummaryProps {
  driverCount: number;
  closestEtaMinutes: number | null;
  demandHint?: string | null;
  onSchedule?: () => void;
}

export default function NearbyDriversSummary({ driverCount, closestEtaMinutes, demandHint, onSchedule }: NearbyDriversSummaryProps) {
  const hasDrivers = driverCount > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center justify-between gap-2 px-1 py-1"
    >
      {hasDrivers ? (
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: '#22A447' }} />
          <span className="text-[13px] font-semibold truncate" style={{ color: '#15803d' }}>
            {driverCount} driver{driverCount === 1 ? '' : 's'} nearby
          </span>
          {closestEtaMinutes != null && (
            <span className="text-[13px] font-medium shrink-0" style={{ color: RIDE_TEXT_2 }}>
              · closest {closestEtaMinutes} min
            </span>
          )}
        </div>
      ) : (
        <span className="text-[13px] font-medium" style={{ color: RIDE_TEXT_2 }}>
          No drivers online right now
        </span>
      )}
      {hasDrivers && demandHint ? (
        <span className="flex items-center gap-1 text-[11px] font-semibold shrink-0" style={{ color: RIDE_TEXT_2 }}>
          <Zap className="w-3 h-3" /> {demandHint}
        </span>
      ) : !hasDrivers && onSchedule ? (
        <button
          onClick={onSchedule}
          className="text-[12px] font-bold shrink-0 active:opacity-70 transition-opacity"
          style={{ color: RIDE_RED }}
        >
          Schedule instead
        </button>
      ) : null}
    </motion.div>
  );
}
