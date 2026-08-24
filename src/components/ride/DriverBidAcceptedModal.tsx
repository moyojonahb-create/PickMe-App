import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Star } from 'lucide-react';
import { haptic } from '@/lib/haptics';

const POPUP_SECONDS = 50;
const RING_RADIUS = 42;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export interface AcceptedDriverInfo {
  name: string;
  avatarUrl: string | null;
  gender: string | null;
  ratingAvg: number | null;
  vehicleMake: string | null;
  vehicleModel: string | null;
  vehicleColor: string | null;
  plateNumber: string | null;
}

interface DriverBidAcceptedModalProps {
  open: boolean;
  driver: AcceptedDriverInfo | null;
  fare: number;
  etaMinutes: number | null;
  /** Rider keeps this driver — just closes the popup, the ride is already
   * accepted server-side. */
  onConfirm: () => void;
  /** Rider rejects this driver (or the 50s ran out) — releases the ride
   * back to the open pool for other drivers to bid on. */
  onDecline: () => void;
}

/**
 * Slides up over the map the moment a driver accepts the rider's ride.
 * Auto-dismisses (via onDecline) if the rider doesn't respond in 50s.
 */
export default function DriverBidAcceptedModal({ open, driver, fare, etaMinutes, onConfirm, onDecline }: DriverBidAcceptedModalProps) {
  const [secondsLeft, setSecondsLeft] = useState(POPUP_SECONDS);

  useEffect(() => {
    if (!open) return;
    setSecondsLeft(POPUP_SECONDS);
    void haptic('heavy');
    const id = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(id);
          onDecline();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
    // onDecline intentionally excluded — re-subscribing on every parent
    // render would reset the countdown; only `open` flipping should restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const progress = secondsLeft / POPUP_SECONDS;
  const dashoffset = RING_CIRCUMFERENCE * (1 - progress);

  return (
    <AnimatePresence>
      {open && driver && (
        <motion.div
          key="bid-accepted-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center"
        >
          <motion.div
            key="bid-accepted-card"
            initial={{ y: '100%', opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '100%', opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="w-full sm:max-w-sm bg-card rounded-t-3xl sm:rounded-3xl p-6 pb-[calc(env(safe-area-inset-bottom,0px)+24px)] sm:pb-6 shadow-2xl"
          >
            <p className="text-center text-xs font-bold uppercase tracking-widest text-primary mb-1">Driver accepted your ride</p>
            <p className="text-center text-lg font-black text-foreground mb-5">Confirm your driver</p>

            {/* Countdown ring around the driver's photo */}
            <div className="relative w-28 h-28 mx-auto mb-4">
              <svg className="absolute inset-0 -rotate-90" viewBox="0 0 96 96">
                <circle cx="48" cy="48" r={RING_RADIUS} fill="none" stroke="hsl(var(--muted))" strokeWidth="5" />
                <motion.circle
                  cx="48" cy="48" r={RING_RADIUS} fill="none" stroke="#B81104" strokeWidth="5" strokeLinecap="round"
                  strokeDasharray={RING_CIRCUMFERENCE}
                  animate={{ strokeDashoffset: dashoffset }}
                  transition={{ duration: 0.9, ease: 'linear' }}
                />
              </svg>
              <div className="absolute inset-[7px] rounded-full overflow-hidden bg-muted flex items-center justify-center ring-2 ring-background">
                {driver.avatarUrl ? (
                  <img src={driver.avatarUrl} alt={driver.name} className="w-full h-full object-cover" />
                ) : (
                  <span className={`text-2xl font-bold ${driver.gender === 'female' ? 'text-pink-600' : 'text-primary'}`}>
                    {driver.gender === 'female' ? '♀' : '♂'}
                  </span>
                )}
              </div>
              <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 min-w-[30px] h-[22px] px-1.5 rounded-full bg-primary text-primary-foreground text-[11px] font-black flex items-center justify-center shadow-md tabular-nums">
                {secondsLeft}s
              </div>
            </div>

            <div className="text-center mb-4">
              <div className="flex items-center justify-center gap-1.5">
                <p className="font-bold text-foreground text-lg">{driver.name}</p>
                {driver.ratingAvg != null && driver.ratingAvg > 0 && (
                  <span className="flex items-center gap-0.5 text-sm font-semibold text-muted-foreground">
                    <Star className="h-3.5 w-3.5 fill-accent text-accent" />
                    {driver.ratingAvg.toFixed(1)}
                  </span>
                )}
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">
                {[driver.vehicleColor, driver.vehicleMake, driver.vehicleModel].filter(Boolean).join(' ') || 'Vehicle details unavailable'}
              </p>
              {driver.plateNumber && (
                <span className="inline-block mt-1.5 bg-muted rounded-lg px-2.5 py-1 text-xs font-bold text-foreground">
                  {driver.plateNumber}
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 mb-5">
              <div className="rounded-2xl bg-muted/50 px-3 py-2.5 text-center">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Agreed fare</p>
                <p className="text-lg font-black text-primary">${fare.toFixed(2)}</p>
              </div>
              <div className="rounded-2xl bg-muted/50 px-3 py-2.5 text-center">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">ETA to pickup</p>
                <p className="text-lg font-black text-foreground">{etaMinutes != null ? `${etaMinutes} min` : '—'}</p>
              </div>
            </div>

            <button
              type="button"
              onClick={onConfirm}
              className="w-full h-13 rounded-2xl font-bold text-base text-primary-foreground active:scale-[0.98] transition-transform"
              style={{ background: 'var(--gradient-primary)' }}
            >
              Confirm
            </button>
            <button
              type="button"
              onClick={onDecline}
              className="w-full mt-2 h-11 rounded-2xl font-semibold text-sm text-muted-foreground active:scale-[0.98] transition-transform"
            >
              Decline
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
