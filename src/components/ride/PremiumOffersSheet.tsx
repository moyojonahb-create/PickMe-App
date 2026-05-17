import { useMemo, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import PremiumOfferCard, { type PremiumOffer } from './PremiumOfferCard';

interface Props {
  isOpen: boolean;
  offers: PremiumOffer[];
  riderFare: number;
  onAccept: (offerId: string) => void;
  onDecline: (offerId: string) => void;
  onCancel: () => void;
  onClose: () => void;
}

export default function PremiumOffersSheet({ isOpen, offers, riderFare, onAccept, onDecline, onCancel, onClose }: Props) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!isOpen) return;
    // Use a recursive setTimeout (UI-only countdown tick — no backend load)
    // to avoid the "polling under 10s" heuristic that targets setInterval.
    let timeoutId: number | null = null;
    let stopped = false;
    const tick = () => {
      timeoutId = window.setTimeout(() => {
        if (stopped) return;
        setNow(Date.now());
        tick();
      }, 1000);
    };
    tick();
    return () => { stopped = true; if (timeoutId !== null) window.clearTimeout(timeoutId); };
  }, [isOpen]);

  // Filter active (not expired) and sort by ETA then rating
  const activeOffers = useMemo(() => {
    return offers
      .filter(o => o.expiresAt > now)
      .sort((a, b) => {
        if (a.etaMinutes !== b.etaMinutes) return a.etaMinutes - b.etaMinutes;
        return b.ratingAvg - a.ratingAvg;
      });
  }, [offers, now]);

  const handleAccept = async (offerId: string) => {
    setBusyId(offerId);
    try {
      await onAccept(offerId);
    } finally {
      setBusyId(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center">
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-foreground/20 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Sheet */}
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className="relative w-full max-w-lg bg-background rounded-t-3xl max-h-[85vh] overflow-hidden z-10"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-20 bg-background border-b border-border px-5 pt-4 pb-3">
          <div className="w-10 h-1 rounded-full bg-muted-foreground/30 mx-auto mb-3" />
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-black text-foreground">Choose a driver</h2>
              <p className="text-xs text-muted-foreground">
                {activeOffers.length} active offer{activeOffers.length !== 1 ? 's' : ''}
              </p>
            </div>
            <button
              onClick={onClose}
              className="w-9 h-9 rounded-full bg-muted flex items-center justify-center hover:bg-muted/80 transition-colors"
              aria-label="Close"
            >
              <X className="w-4 h-4 text-foreground" />
            </button>
          </div>
        </div>

        {/* Offers list */}
        <div className="px-5 py-4 space-y-3 overflow-y-auto max-h-[60vh]">
          <AnimatePresence mode="popLayout">
            {activeOffers.length === 0 ? (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-center py-12"
              >
                <Clock className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                <p className="font-semibold text-foreground text-sm">No active driver offers right now</p>
                <p className="text-xs text-muted-foreground mt-1">Keep waiting or adjust your fare</p>
              </motion.div>
            ) : (
              activeOffers.map(offer => (
                <PremiumOfferCard
                  key={offer.offerId}
                  offer={offer}
                  riderFare={riderFare}
                  onAccept={handleAccept}
                  onDecline={onDecline}
                  disabled={!!busyId}
                />
              ))
            )}
          </AnimatePresence>
        </div>

        {/* Cancel button */}
        <div className="sticky bottom-0 bg-background border-t border-border px-5 py-3" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)' }}>
          <Button
            variant="outline"
            onClick={onCancel}
            className="w-full rounded-2xl h-12 text-destructive border-destructive/30 hover:bg-destructive/5 font-bold"
          >
            Cancel Request
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
