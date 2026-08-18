import { motion } from 'framer-motion';
import { MapPin, Navigation, Clock, Route, DollarSign, Star, RotateCcw, BookmarkPlus, ChevronRight, MessageCircle, Share2 } from 'lucide-react';
import { PrimaryButton } from '@/components/ui/primary-button';
import { SecondaryButton } from '@/components/ui/secondary-button';

interface RideCompleteSummaryProps {
  fare: number;
  distanceKm: number;
  durationMinutes: number;
  pickupAddress: string;
  dropoffAddress: string;
  driverName?: string;
  onRate: () => void;
  onBookAgain: () => void;
  onSaveLocation?: () => void;
  hasRated?: boolean;
}

export default function RideCompleteSummary({
  fare, distanceKm, durationMinutes, pickupAddress, dropoffAddress,
  driverName, onRate, onBookAgain, onSaveLocation, hasRated
}: RideCompleteSummaryProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="space-y-4"
    >
      {/* Success header */}
      <div className="text-center py-3">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20, delay: 0.2 }}
          className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3"
        >
          <span className="text-3xl">🏁</span>
        </motion.div>
        <motion.h2
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="text-lg font-bold text-foreground"
        >
          Trip Complete!
        </motion.h2>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="text-sm text-muted-foreground mt-1"
        >
          Thanks for riding with us
        </motion.p>
      </div>

      {/* Trip summary card */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35 }}
        className="bg-card rounded-2xl border border-border/40 shadow-sm overflow-hidden"
      >
        {/* Blue top bar */}
        <div className="px-4 py-1.5 text-center text-[10px] font-bold tracking-wider uppercase bg-primary/10 text-primary">
          Trip Summary
        </div>
        <div className="p-4">
        {/* Route */}
        <div className="flex items-start gap-3 mb-4">
          <div className="flex flex-col items-center mt-1">
            <div className="w-2.5 h-2.5 rounded-full bg-accent" />
            <div className="w-0.5 h-5 bg-border" />
            <div className="w-2.5 h-2.5 rounded-full bg-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{pickupAddress}</p>
            <p className="text-sm text-muted-foreground truncate mt-3">{dropoffAddress}</p>
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-3 gap-3 pt-3 border-t border-border/30">
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
              <DollarSign className="w-3.5 h-3.5" />
            </div>
            <p className="text-2xl font-black text-primary tabular-nums">${fare.toFixed(2)}</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Total Fare</p>
          </div>
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
              <Route className="w-3.5 h-3.5" />
            </div>
            <p className="text-lg font-bold text-foreground">{distanceKm.toFixed(1)}</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">km</p>
          </div>
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
              <Clock className="w-3.5 h-3.5" />
            </div>
            <p className="text-lg font-bold text-foreground">{durationMinutes}</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">min</p>
          </div>
        </div>
        </div>
      </motion.div>

      {/* Action buttons */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
        className="space-y-2"
      >
        {!hasRated && (
          <PrimaryButton onClick={onRate} className="w-full h-12 rounded-2xl text-[15px] font-semibold gap-2">
            <Star className="w-4 h-4" /> Rate Your Driver
          </PrimaryButton>
        )}

        <div className="grid grid-cols-2 gap-2">
          <SecondaryButton onClick={onBookAgain} className="rounded-2xl gap-2 text-sm font-medium">
            <RotateCcw className="w-4 h-4" /> Book Again
          </SecondaryButton>
          {onSaveLocation && (
            <SecondaryButton onClick={onSaveLocation} className="rounded-2xl gap-2 text-sm font-medium">
              <BookmarkPlus className="w-4 h-4" /> Save Place
            </SecondaryButton>
          )}
        </div>

        {/* Quick share row */}
        <div className="flex gap-2">
          <SecondaryButton
            onClick={() => {
              const msg = encodeURIComponent(`🚗 Just completed a PickMe ride!\nFrom: ${pickupAddress}\nTo: ${dropoffAddress}\nFare: $${fare.toFixed(2)}`);
              window.open(`https://wa.me/?text=${msg}`, '_blank');
            }}
            className="flex-1 rounded-2xl gap-1.5 text-xs font-medium"
          >
            <MessageCircle className="w-3.5 h-3.5" /> Share on WhatsApp
          </SecondaryButton>
          <SecondaryButton
            onClick={() => {
              const msg = encodeURIComponent(`PickMe ride: $${fare.toFixed(2)} from ${pickupAddress} to ${dropoffAddress}`);
              window.open(`sms:?body=${msg}`, '_self');
            }}
            className="rounded-2xl gap-1.5 text-xs font-medium px-4"
          >
            <Share2 className="w-3.5 h-3.5" /> SMS
          </SecondaryButton>
        </div>
      </motion.div>
    </motion.div>
  );
}
