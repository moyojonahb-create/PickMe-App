import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Star, Clock, Car, ShieldCheck, MapPin, Wallet, Banknote, GraduationCap, CheckCircle2 } from 'lucide-react';
import { PrimaryButton } from '@/components/ui/primary-button';
import { SecondaryButton } from '@/components/ui/secondary-button';

export interface PremiumOffer {
  offerId: string;
  driverId: string;
  driverName: string;
  avatarUrl?: string | null;
  ratingAvg: number;
  totalTrips: number;
  carModel: string;
  carColor?: string | null;
  plateNumber: string;
  etaMinutes: number;
  fare: number;
  gender?: string | null;
  acceptedAt: number;
  expiresAt: number;
  // Optional enrichment (non-breaking)
  distanceKm?: number;
  paymentMethod?: 'cash' | 'wallet' | string | null;
  studentEligible?: boolean;
}

interface Props {
  offer: PremiumOffer;
  riderFare: number;
  onAccept: (offerId: string) => void;
  onDecline: (offerId: string) => void;
  disabled?: boolean;
}

export default function PremiumOfferCard({ offer, riderFare, onAccept, onDecline, disabled }: Props) {
  const [secondsLeft, setSecondsLeft] = useState(() =>
    Math.max(0, Math.ceil((offer.expiresAt - Date.now()) / 1000)),
  );

  useEffect(() => {
    const t = setInterval(() => {
      setSecondsLeft(Math.max(0, Math.ceil((offer.expiresAt - Date.now()) / 1000)));
    }, 1000);
    return () => clearInterval(t);
  }, [offer.expiresAt]);

  const expired = secondsLeft <= 0;
  if (expired) return null;

  const urgencyPct = Math.min(100, (secondsLeft / 60) * 100);
  const isUrgent = secondsLeft <= 15;
  const isVerified = offer.totalTrips >= 50;
  const isCash = offer.paymentMethod === 'cash';
  const isWallet = offer.paymentMethod === 'wallet';

  return (
    <motion.div
      initial={{ opacity: 0, y: 24, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.92, y: -8 }}
      transition={{ type: 'spring', stiffness: 360, damping: 28 }}
      layout
      className="bg-white dark:bg-card rounded-3xl border border-primary/15 overflow-hidden
                 shadow-[0_10px_30px_-12px_hsl(var(--primary)/0.25),0_4px_12px_-4px_rgba(15,23,42,0.08)]"
    >
      {/* Glass Blue header */}
      <div className="relative px-4 pt-3 pb-2 text-white" style={{ background: 'var(--gradient-primary)' }}>
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 text-[10px] font-bold tracking-[0.14em] uppercase opacity-95">
            <ShieldCheck className="h-3 w-3" /> Driver Offer
          </span>
          <span
            className={`text-[11px] font-black tabular-nums px-2 py-0.5 rounded-full ${
              isUrgent ? 'bg-white text-destructive animate-pulse' : 'bg-white/20 text-white'
            }`}
          >
            {secondsLeft}s
          </span>
        </div>
        {/* Countdown */}
        <div className="mt-2 h-1 bg-white/25 rounded-full overflow-hidden">
          <motion.div
            className={`h-full rounded-full ${isUrgent ? 'bg-destructive' : 'bg-white'}`}
            animate={{ width: `${urgencyPct}%` }}
            transition={{ duration: 0.5, ease: 'linear' }}
          />
        </div>
      </div>

      <div className="p-4 space-y-3.5">
        {/* Driver + Fare hero row */}
        <div className="flex items-start gap-3">
          <div className="relative shrink-0">
            <Avatar className="h-16 w-16 border-2 border-primary/30 shadow-md">
              {offer.avatarUrl && (
                <AvatarImage
                  src={offer.avatarUrl}
                  alt={offer.driverName}
                  className="object-cover"
                  loading="eager"
                  decoding="async"
                />
              )}
              <AvatarFallback className="bg-primary/10 text-primary font-black text-lg">
                {offer.driverName?.charAt(0)?.toUpperCase() || '?'}
              </AvatarFallback>
            </Avatar>
            {isVerified && (
              <span className="absolute -bottom-1 -right-1 bg-white rounded-full p-0.5 shadow-sm">
                <CheckCircle2 className="w-4 h-4 text-primary fill-primary/15" />
              </span>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="font-bold text-foreground text-[15px] truncate leading-tight">
                {offer.driverName}
              </p>
              {isVerified && (
                <span className="text-[9px] font-bold tracking-wide px-1.5 py-0.5 rounded-full bg-primary/15 text-primary uppercase">
                  Verified
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-1 text-[12px]">
              <span className="inline-flex items-center gap-0.5 font-bold text-foreground">
                <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                {offer.ratingAvg > 0 ? offer.ratingAvg.toFixed(1) : 'New'}
              </span>
              <span className="text-border">•</span>
              <span className="text-muted-foreground">{offer.totalTrips} trips</span>
            </div>
          </div>

          {/* Dominant fare */}
          <div className="text-right shrink-0">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider leading-none">
              Offer
            </p>
            <motion.p
              key={offer.fare}
              initial={{ scale: 1.12 }}
              animate={{ scale: 1 }}
              className="text-[32px] font-black text-primary tabular-nums leading-none mt-1"
            >
              ${offer.fare.toFixed(2)}
            </motion.p>
          </div>
        </div>

        {/* Vehicle row */}
        <div className="flex items-center gap-2 rounded-2xl bg-primary/5 dark:bg-muted/40 px-3 py-2.5">
          <div className="w-8 h-8 rounded-xl bg-white dark:bg-card flex items-center justify-center shadow-sm shrink-0">
            <Car className="h-4 w-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground truncate">
              <span className="truncate">{offer.carModel}</span>
              {offer.carColor && (
                <>
                  <span className="text-border">•</span>
                  <span className="inline-flex items-center gap-1 capitalize text-muted-foreground font-medium">
                    <span
                      className="w-2.5 h-2.5 rounded-full border border-border/40 inline-block shrink-0"
                      style={{ backgroundColor: offer.carColor.toLowerCase() }}
                    />
                    {offer.carColor}
                  </span>
                </>
              )}
            </div>
          </div>
          <span className="font-mono text-[12px] font-black px-2 py-1 rounded-md bg-white dark:bg-card text-foreground border border-border/50 tracking-wider shrink-0">
            {offer.plateNumber}
          </span>
        </div>

        {/* ETA + Distance stats */}
        <div className="grid grid-cols-2 gap-2">
          <Stat
            icon={<Clock className="h-3.5 w-3.5" />}
            label="ETA"
            value={`${offer.etaMinutes} min`}
          />
          <Stat
            icon={<MapPin className="h-3.5 w-3.5" />}
            label="Distance"
            value={
              typeof offer.distanceKm === 'number' ? `${offer.distanceKm.toFixed(1)} km` : '—'
            }
          />
        </div>

        {/* Badges */}
        {(isWallet || isCash || offer.studentEligible) && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {isWallet && (
              <Badge tone="blue" icon={<Wallet className="h-3 w-3" />}>
                Wallet
              </Badge>
            )}
            {isCash && (
              <Badge tone="emerald" icon={<Banknote className="h-3 w-3" />}>
                Cash
              </Badge>
            )}
            {offer.studentEligible && (
              <Badge tone="violet" icon={<GraduationCap className="h-3 w-3" />}>
                Student Discount
              </Badge>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="grid grid-cols-[1fr_auto] gap-2 pt-0.5">
          <motion.div whileTap={{ scale: 0.97 }}>
            <PrimaryButton
              onClick={() => onAccept(offer.offerId)}
              disabled={disabled || expired}
              className="w-full h-12 text-[15px] font-bold rounded-2xl inline-flex items-center justify-center text-white"
            >
              Accept Offer
            </PrimaryButton>
          </motion.div>
          <motion.div whileTap={{ scale: 0.95 }}>
            <SecondaryButton
              onClick={() => onDecline(offer.offerId)}
              disabled={disabled}
              className="h-12 px-5 text-[14px] font-semibold rounded-2xl border-border/60"
            >
              Decline
            </SecondaryButton>
          </motion.div>
        </div>
      </div>
    </motion.div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border/50 bg-white dark:bg-card px-3 py-2">
      <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {icon} {label}
      </div>
      <p className="text-[15px] font-black text-foreground tabular-nums mt-0.5">{value}</p>
    </div>
  );
}

function Badge({
  icon,
  children,
  tone,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  tone: 'blue' | 'emerald' | 'violet';
}) {
  const tones = {
    blue: 'bg-primary/15 text-primary border-primary/20',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300',
    violet: 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-500/10 dark:text-violet-300',
  } as const;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold border ${tones[tone]}`}
    >
      {icon} {children}
    </span>
  );
}
