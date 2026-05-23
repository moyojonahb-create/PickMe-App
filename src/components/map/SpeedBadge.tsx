import { motion } from 'framer-motion';
import { Gauge } from 'lucide-react';

interface SpeedBadgeProps {
  kmh: number;
  className?: string;
}

/** Floating glass speed pill (km/h) for live-tracking UIs. */
export default function SpeedBadge({ kmh, className = '' }: SpeedBadgeProps) {
  const v = Math.max(0, Math.round(kmh));
  return (
    <motion.div
      initial={{ opacity: 0, y: -8, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 320, damping: 26 }}
      className={`pointer-events-none flex items-center gap-2 rounded-2xl bg-white/30 backdrop-blur-xl border border-white/40 px-3 py-2 shadow-[0_10px_30px_rgba(0,0,0,0.18)] ${className}`}
    >
      <div className="w-7 h-7 rounded-full bg-primary/15 flex items-center justify-center">
        <Gauge className="w-4 h-4 text-primary" />
      </div>
      <div className="flex flex-col leading-none">
        <span className="text-[10px] font-semibold tracking-wider text-foreground/60 uppercase">Speed</span>
        <span className="text-base font-black tabular-nums text-foreground">
          {v}<span className="text-[10px] font-bold text-foreground/60 ml-0.5">KM/H</span>
        </span>
      </div>
    </motion.div>
  );
}
