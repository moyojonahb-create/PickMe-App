import { motion } from 'framer-motion';
import { Car, Clock } from 'lucide-react';

interface NearbyDriversSummaryProps {
  driverCount: number;
  avgWaitMinutes: number;
}

export default function NearbyDriversSummary({ driverCount, avgWaitMinutes }: NearbyDriversSummaryProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center justify-between glass-card rounded-2xl px-4 py-3"
    >
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-full bg-emerald-500/10 flex items-center justify-center">
          <Car className="w-4 h-4 text-emerald-600" />
        </div>
        <div>
          <p className="text-sm font-bold text-foreground tabular-nums leading-none">
            {driverCount > 0 ? `${driverCount} driver${driverCount === 1 ? '' : 's'} nearby` : 'Looking for drivers…'}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">Within 1km of you</p>
        </div>
      </div>
      {driverCount > 0 && (
        <div className="flex items-center gap-1.5 text-primary">
          <Clock className="w-3.5 h-3.5" />
          <span className="text-sm font-bold tabular-nums">~{avgWaitMinutes} min</span>
        </div>
      )}
    </motion.div>
  );
}
