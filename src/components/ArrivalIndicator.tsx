import { MapPin, Car, CheckCircle2, Navigation } from 'lucide-react';
import { formatArrivalDistance } from '@/hooks/useArrivalDetection';
import { cn } from '@/lib/utils';

interface ArrivalIndicatorProps {
  isArrived: boolean;
  arrivalType: 'pickup' | 'dropoff' | null;
  distanceToPickup: number | null;
  distanceToDropoff: number | null;
  className?: string;
}

export function ArrivalIndicator({
  isArrived,
  arrivalType,
  distanceToPickup,
  distanceToDropoff,
  className,
}: ArrivalIndicatorProps) {
  if (!distanceToPickup && !distanceToDropoff && !isArrived) {
    return null;
  }

  if (isArrived && arrivalType === 'pickup') {
    return (
      <div className={cn(
        "flex items-center gap-3 p-4 rounded-xl bg-emerald-50 border border-emerald-200",
        className
      )}>
        <div className="w-12 h-12 rounded-full bg-emerald-500 flex items-center justify-center shrink-0">
          <CheckCircle2 className="w-6 h-6 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-emerald-800">
            🚗 Your CruiXe ride has arrived!
          </p>
          <p className="text-sm text-emerald-600 mt-0.5">
            Your driver is at the pickup location
          </p>
        </div>
      </div>
    );
  }

  if (isArrived && arrivalType === 'dropoff') {
    return (
      <div className={cn(
        "flex items-center gap-3 p-4 rounded-xl bg-primary/10 border border-primary/20",
        className
      )}>
        <div className="w-12 h-12 rounded-full bg-primary flex items-center justify-center shrink-0">
          <MapPin className="w-6 h-6 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-primary">
            🎉 You have arrived!
          </p>
          <p className="text-sm text-primary/80 mt-0.5">
            You have reached your destination
          </p>
        </div>
      </div>
    );
  }

  // Show distance indicator when driver is approaching
  const distance = distanceToPickup ?? distanceToDropoff;
  const isToPickup = distanceToPickup !== null;

  if (distance !== null && distance <= 500) {
    const progress = Math.max(0, Math.min(100, ((500 - distance) / 500) * 100));

    return (
      <div className={cn(
        "flex items-center gap-3 p-3 rounded-xl bg-secondary border border-border",
        className
      )}>
        <div className="relative w-10 h-10 shrink-0">
          <div className="absolute inset-0 rounded-full border-2 border-muted" />
          <svg className="absolute inset-0 w-10 h-10 -rotate-90">
            <circle
              cx="20"
              cy="20"
              r="18"
              fill="none"
              stroke="hsl(var(--accent))"
              strokeWidth="2"
              strokeDasharray={`${progress * 1.13} 113`}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            {isToPickup ? (
              <Car className="w-4 h-4 text-accent" />
            ) : (
              <Navigation className="w-4 h-4 text-accent" />
            )}
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-foreground text-sm">
            {isToPickup ? 'Driver approaching' : 'Almost there'}
          </p>
          <p className="text-xs text-muted-foreground">
            {formatArrivalDistance(distance)}
          </p>
        </div>
      </div>
    );
  }

  return null;
}

export default ArrivalIndicator;
