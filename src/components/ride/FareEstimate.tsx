import { cn } from '@/lib/utils';
import { Car, Clock, Route } from 'lucide-react';
import { motion } from 'framer-motion';
import SurgePricingBadge from './SurgePricingBadge';

interface FareEstimateProps {
  fareR: number;
  distanceKm: number;
  durationMinutes: number;
  vehicleType?: string;
  className?: string;
  demandMultiplier?: number;
  isNight?: boolean;
  baseFareBeforeSurge?: number;
}

export default function FareEstimate({
  fareR,
  distanceKm,
  durationMinutes,
  vehicleType = 'Standard',
  className,
  demandMultiplier = 1.0,
  isNight = false,
  baseFareBeforeSurge,
}: FareEstimateProps) {
  const hasSurge = demandMultiplier > 1.0 || isNight;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn('bg-secondary/50 rounded-2xl overflow-hidden', className)}
    >
      {/* Blue top bar */}
      <div className="px-4 py-1.5 text-center text-[10px] font-bold tracking-wider uppercase bg-primary/10 text-primary">
        Fare Estimate
      </div>
      <div className="p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-primary rounded-2xl flex items-center justify-center shadow-sm">
            <Car className="w-6 h-6 text-primary-foreground" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <p className="font-bold text-foreground text-lg">{vehicleType}</p>
              <SurgePricingBadge demandMultiplier={demandMultiplier} isNight={isNight} />
            </div>
            <div className="flex items-center gap-3 text-sm text-muted-foreground mt-0.5">
              <span className="flex items-center gap-1">
                <Route className="w-3.5 h-3.5" />
                {distanceKm.toFixed(1)} km
              </span>
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                {durationMinutes} min
              </span>
            </div>
          </div>
        </div>
        <div className="text-right">
          <motion.p
            key={fareR}
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="text-2xl font-black text-primary tabular-nums"
          >
            ${fareR.toFixed(2)}
          </motion.p>
          {hasSurge && baseFareBeforeSurge != null && baseFareBeforeSurge !== fareR && (
            <p className="text-xs text-muted-foreground line-through">
              ${baseFareBeforeSurge.toFixed(2)}
            </p>
          )}
        </div>
      </div>
      </div>
    </motion.div>
  );
}
