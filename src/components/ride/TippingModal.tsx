import { useState } from 'react';
import { X, Heart, DollarSign } from 'lucide-react';
import { createTip } from '@/lib/businessApi';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

interface TippingModalProps {
  rideId: string;
  riderId: string;
  driverId: string;
  fare: number;
  driverName?: string;
  driverAvatar?: string;
  onClose: () => void;
}

const TIP_PRESETS = [
  { label: '10%', multiplier: 0.1 },
  { label: '15%', multiplier: 0.15 },
  { label: '20%', multiplier: 0.2 },
];

export default function TippingModal({ rideId, riderId, driverId, fare, driverName, driverAvatar, onClose }: TippingModalProps) {
  const [selectedPreset, setSelectedPreset] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState('');
  const [isCustom, setIsCustom] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showCelebration, setShowCelebration] = useState(false);

  const tipAmount = isCustom
    ? parseFloat(customAmount) || 0
    : selectedPreset !== null
    ? Math.round(fare * TIP_PRESETS[selectedPreset].multiplier * 100) / 100
    : 0;

  const handleSubmit = async () => {
    if (tipAmount <= 0) { onClose(); return; }
    setSubmitting(true);
    try {
      await createTip({
        ride_id: rideId,
        driver_id: driverId,
        amount: tipAmount,
      });
      setShowCelebration(true);
      setTimeout(() => { toast.success(`$${tipAmount.toFixed(2)} tip sent!`); onClose(); }, 1500);
    } catch {
      toast.error('Failed to send tip');
    } finally {
      setSubmitting(false);
    }
  };

  const initials = (driverName || 'D').split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);

  return (
    <div className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center">
      <AnimatePresence>
        {showCelebration && (
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            className="absolute inset-0 flex items-center justify-center z-10"
          >
            <div className="text-center">
              <motion.div
                animate={{ scale: [1, 1.3, 1], rotate: [0, 15, -15, 0] }}
                transition={{ duration: 0.6, repeat: 2 }}
                className="text-6xl mb-3"
              >
                🎉
              </motion.div>
              <p className="text-2xl font-black text-white">Tip Sent!</p>
              <p className="text-primary-foreground/70 text-lg">${tipAmount.toFixed(2)}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className={cn('w-full max-w-sm bg-background rounded-t-3xl sm:rounded-3xl p-6 space-y-5 transition-opacity', showCelebration && 'opacity-20')}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-black text-foreground">Thank Your Driver</h2>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-muted transition-colors">
            <X className="h-5 w-5 text-muted-foreground" />
          </button>
        </div>

        {/* Driver info */}
        <div className="flex flex-col items-center gap-2">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center overflow-hidden ring-2 ring-primary/20">
            {driverAvatar ? (
              <img src={driverAvatar} alt="" className="w-full h-full object-cover" />
            ) : (
              <span className="text-xl font-bold text-primary">{initials}</span>
            )}
          </div>
          {driverName && <p className="text-sm font-semibold text-foreground">{driverName}</p>}
          <div className="flex items-center gap-1 text-muted-foreground">
            <Heart className="w-4 h-4 text-destructive fill-destructive" />
            <span className="text-xs">Great driving deserves a tip!</span>
          </div>
        </div>

        {/* Preset tips */}
        <div className="grid grid-cols-4 gap-2">
          {TIP_PRESETS.map((preset, i) => {
            const amount = Math.round(fare * preset.multiplier * 100) / 100;
            return (
              <button
                key={preset.label}
                onClick={() => { setSelectedPreset(i); setIsCustom(false); }}
                className={cn(
                  'flex flex-col items-center gap-0.5 p-3 rounded-2xl transition-all active:scale-95',
                  selectedPreset === i && !isCustom ? 'bg-primary text-primary-foreground ring-2 ring-primary' : 'bg-muted text-foreground'
                )}
              >
                <span className="text-sm font-bold">{preset.label}</span>
                <span className="text-[10px] opacity-70">${amount.toFixed(2)}</span>
              </button>
            );
          })}
          <button
            onClick={() => { setIsCustom(true); setSelectedPreset(null); }}
            className={cn(
              'flex flex-col items-center gap-0.5 p-3 rounded-2xl transition-all active:scale-95',
              isCustom ? 'bg-primary text-primary-foreground ring-2 ring-primary' : 'bg-muted text-foreground'
            )}
          >
            <DollarSign className="w-4 h-4" />
            <span className="text-[10px] opacity-70">Custom</span>
          </button>
        </div>

        {isCustom && (
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-lg font-bold text-muted-foreground">$</span>
            <input
              type="number"
              placeholder="0.00"
              value={customAmount}
              onChange={(e) => setCustomAmount(e.target.value)}
              className="w-full pl-8 pr-4 py-3 text-lg font-bold rounded-2xl bg-muted border-0 text-foreground focus:ring-2 focus:ring-primary outline-none"
              min="0"
              step="0.50"
              autoFocus
            />
          </div>
        )}

        {/* Buttons */}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-3 rounded-2xl bg-muted text-foreground font-semibold text-sm active:scale-95 transition-all">
            Skip
          </button>
          <button
            onClick={handleSubmit}
            disabled={tipAmount <= 0 || submitting}
            className="flex-1 py-3 rounded-2xl bg-primary text-primary-foreground font-semibold text-sm active:scale-95 transition-all disabled:opacity-50"
          >
            {submitting ? 'Sending…' : tipAmount > 0 ? `Tip $${tipAmount.toFixed(2)}` : 'Tip'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
