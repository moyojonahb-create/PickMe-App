// Driver-side card to respond to a rider's offer: Accept / Counter / Decline
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Minus, Plus, Check, X, ArrowLeftRight, MapPin, Navigation } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatFare, getFareStep } from '@/hooks/useTownPricing';

interface DriverOfferCardProps {
  rideId: string;
  pickup: string;
  dropoff: string;
  riderOffer: number;
  distanceKm: number;
  durationMinutes: number;
  currencySymbol: string;
  currencyCode: string;
  recommendedMin: number;
  recommendedMax: number;
  onAccept: (rideId: string) => void;
  onCounter: (rideId: string, counterFare: number) => void;
  onDecline: (rideId: string) => void;
  isSubmitting?: boolean;
}

export default function DriverOfferCard({
  rideId,
  pickup,
  dropoff,
  riderOffer,
  distanceKm,
  durationMinutes,
  currencySymbol,
  currencyCode,
  recommendedMin,
  recommendedMax,
  onAccept,
  onCounter,
  onDecline,
  isSubmitting,
}: DriverOfferCardProps) {
  const [showCounter, setShowCounter] = useState(false);
  const step = getFareStep(currencyCode);
  const [counterFare, setCounterFare] = useState(() => {
    // Start counter at rider offer + one step
    return riderOffer + step;
  });

  const inc = () => setCounterFare(prev => Math.min(prev + step, recommendedMax * 2));
  const dec = () => setCounterFare(prev => Math.max(prev - step, riderOffer));

  return (
    <div className="glass-card rounded-2xl space-y-3 glass-glow-brand overflow-hidden">
      {/* Blue top bar */}
      <div className="px-4 py-1.5 text-center text-[10px] font-bold tracking-wider uppercase bg-primary/10 text-primary">
        Rider Offer
      </div>
      {/* Route */}
      <div className="flex items-start gap-2 px-4">
        <div className="flex flex-col items-center mt-1">
          <MapPin className="h-3.5 w-3.5 text-accent" />
          <div className="w-0.5 h-4 bg-border" />
          <Navigation className="h-3.5 w-3.5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">{pickup}</p>
          <p className="text-xs text-muted-foreground truncate mt-1">{dropoff}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-xs text-muted-foreground">{distanceKm.toFixed(1)} km</p>
          <p className="text-xs text-muted-foreground">~{durationMinutes} min</p>
        </div>
      </div>

      {/* Rider's offer */}
      <div className="flex items-center justify-between mx-4 px-3 py-2.5 rounded-xl bg-accent/10">
        <span className="text-xs font-semibold text-foreground">Rider's Offer</span>
        <span className="text-lg font-black text-accent">
          {formatFare(riderOffer, currencySymbol, currencyCode)}
        </span>
      </div>

      {/* Recommended range */}
      <p className="text-[10px] text-muted-foreground text-center px-4">
        Suggested range: {formatFare(recommendedMin, currencySymbol, currencyCode)} – {formatFare(recommendedMax, currencySymbol, currencyCode)}
      </p>

      {/* Counter offer section */}
      {showCounter ? (
        <div className="space-y-3 px-4 pb-4">
          <div className="flex items-center justify-center gap-4">
            <button onClick={dec} disabled={counterFare <= riderOffer} className="w-10 h-10 rounded-full glass-card flex items-center justify-center active:scale-90 transition-all disabled:opacity-30">
              <Minus className="w-4 h-4" />
            </button>
            <div className="text-center min-w-[100px]">
              <p className="text-2xl font-black tabular-nums text-primary">
                {formatFare(counterFare, currencySymbol, currencyCode)}
              </p>
              <p className="text-[10px] text-muted-foreground">Your counter</p>
            </div>
            <button onClick={inc} className="w-10 h-10 rounded-full glass-card flex items-center justify-center active:scale-90 transition-all">
              <Plus className="w-4 h-4" />
            </button>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1 rounded-2xl"
              onClick={() => setShowCounter(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="flex-1 rounded-2xl bg-primary"
              onClick={() => onCounter(rideId, counterFare)}
              disabled={isSubmitting}
            >
              <ArrowLeftRight className="h-3.5 w-3.5 mr-1" />
              Send Counter
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2 px-4 pb-4">
          <Button
            onClick={() => onAccept(rideId)}
            disabled={isSubmitting}
            className="rounded-2xl bg-[hsl(142,70%,40%)] hover:bg-[hsl(142,70%,35%)] text-primary-foreground text-xs h-11"
          >
            <Check className="h-3.5 w-3.5 mr-1" /> Accept
          </Button>
          <Button
            variant="outline"
            onClick={() => setShowCounter(true)}
            className="rounded-2xl text-xs h-11"
          >
            <ArrowLeftRight className="h-3.5 w-3.5 mr-1" /> Counter
          </Button>
          <Button
            variant="outline"
            onClick={() => onDecline(rideId)}
            disabled={isSubmitting}
            className="rounded-2xl text-destructive border-destructive/30 text-xs h-11"
          >
            <X className="h-3.5 w-3.5 mr-1" /> Decline
          </Button>
        </div>
      )}
    </div>
  );
}
