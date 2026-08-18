import { motion, AnimatePresence } from 'framer-motion';
import { Car, Shield, Clock, Radio, Zap, Users } from 'lucide-react';
import { useEffect, useState } from 'react';

interface SearchingOverlayProps {
  secondsLeft: number;
  driversNearby?: number;
  offersCount?: number;
  /** Live count of drivers currently viewing this specific request (Supabase
   * Realtime Presence, see useRideViewerCount) — distinct from driversNearby,
   * which is just geographic proximity. Drives the searching → viewing →
   * accepted status progression. */
  viewingCount?: number;
  onCancel?: () => void;
}

const SEARCHING_MESSAGES = [
  { text: "Searching for nearby drivers…", icon: Radio },
  { text: "Checking driver availability…", icon: Car },
  { text: "All drivers are verified ✓", icon: Shield },
  { text: "Finding the best match…", icon: Zap },
  { text: "Your safety is our priority", icon: Shield },
];

export default function SearchingOverlay({ secondsLeft, driversNearby = 0, offersCount = 0, viewingCount = 0, onCancel }: SearchingOverlayProps) {
  const [msgIndex, setMsgIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setMsgIndex(prev => (prev + 1) % SEARCHING_MESSAGES.length);
    }, 3500);
    return () => clearInterval(interval);
  }, []);

  const current = SEARCHING_MESSAGES[msgIndex];
  // Once a driver is actually looking at this request, that's more useful
  // than the generic rotating copy — searching → X viewing → accepted.
  const statusText = viewingCount > 0
    ? `${viewingCount} driver${viewingCount > 1 ? 's' : ''} viewing your request`
    : current.text;
  const StatusIcon = viewingCount > 0 ? Users : current.icon;
  const progress = Math.min(100, (secondsLeft / 300) * 100);

  return (
    <div className="space-y-3">
      {/* Radar card */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-card rounded-2xl p-5 border border-border/40 shadow-sm"
      >
        {/* Pulsing radar */}
        <div className="flex items-center justify-center mb-4">
          <div className="relative w-20 h-20">
            {[0, 1, 2].map(i => (
              <motion.div
                key={i}
                className="absolute inset-0 rounded-full border-2 border-primary/15"
                initial={{ scale: 0.4, opacity: 0.8 }}
                animate={{ scale: 1.6, opacity: 0 }}
                transition={{ repeat: Infinity, duration: 2.2, delay: i * 0.7, ease: 'easeOut' }}
              />
            ))}
            <motion.div
              className="absolute inset-0 flex items-center justify-center"
              animate={{ scale: [1, 1.06, 1] }}
              transition={{ repeat: Infinity, duration: 1.8, ease: 'easeInOut' }}
            >
              <div className="w-14 h-14 rounded-full flex items-center justify-center shadow-lg" style={{ background: 'var(--gradient-primary)' }}>
                <Car className="w-7 h-7 text-primary-foreground" />
              </div>
            </motion.div>
          </div>
        </div>

        {/* Dynamic message */}
        <AnimatePresence mode="wait">
          <motion.div
            key={viewingCount > 0 ? 'viewing' : msgIndex}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25 }}
            className="text-center"
          >
            <div className="flex items-center justify-center gap-2">
              <StatusIcon className="w-4 h-4 text-primary" />
              <p className="text-sm font-semibold text-foreground">{statusText}</p>
            </div>
          </motion.div>
        </AnimatePresence>

        {/* Stats */}
        <div className="flex items-center justify-center gap-5 mt-3 text-xs text-muted-foreground">
          {driversNearby > 0 && (
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-center gap-1"
            >
              <Car className="w-3.5 h-3.5" />
              {driversNearby} nearby
            </motion.span>
          )}
          <span className="flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" />
            {Math.ceil(secondsLeft / 60)} min left
          </span>
        </div>

        {/* Progress */}
        <div className="mt-4 w-full h-1.5 bg-muted rounded-full overflow-hidden">
          <motion.div
            className="h-full rounded-full bg-primary"
            initial={{ width: '100%' }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.5 }}
          />
        </div>
      </motion.div>

      {/* Offers badge */}
      {offersCount > 0 && (
        <motion.div
          initial={{ scale: 0.85, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
          className="bg-primary/8 border border-primary/20 rounded-2xl p-3 text-center"
        >
          <p className="text-sm font-bold text-primary">
            🎉 {offersCount} driver{offersCount > 1 ? 's' : ''} responded!
          </p>
        </motion.div>
      )}
    </div>
  );
}
