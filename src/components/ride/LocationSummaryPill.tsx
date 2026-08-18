import { MapPin, ArrowRight, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LocationSummaryPillProps {
  pickupName: string;
  dropoffName: string;
  onPickupClick: () => void;
  onDropoffClick: () => void;
  onAddStop?: () => void;
  canAddStop?: boolean;
  className?: string;
}

export default function LocationSummaryPill({
  pickupName,
  dropoffName,
  onPickupClick,
  onDropoffClick,
  onAddStop,
  canAddStop = true,
  className,
}: LocationSummaryPillProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 bg-card rounded-full shadow-md border border-border/50 pl-3 pr-1.5 py-2',
        className
      )}
    >
      <button type="button" onClick={onPickupClick} className="flex items-center gap-1.5 min-w-0 shrink-[2] active:opacity-70 transition-opacity">
        <MapPin className="w-4 h-4 text-primary shrink-0" fill="currentColor" />
        <span className="text-[13px] font-semibold text-primary truncate">{pickupName || 'Pickup'}</span>
      </button>

      <ArrowRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />

      <button type="button" onClick={onDropoffClick} className="flex items-center gap-1.5 min-w-0 shrink active:opacity-70 transition-opacity">
        <span className="w-2.5 h-2.5 rounded-full bg-accent shrink-0" />
        <span className="text-[13px] font-semibold text-foreground truncate">{dropoffName || 'Drop-off'}</span>
      </button>

      {onAddStop && (
        <button
          type="button"
          onClick={onAddStop}
          disabled={!canAddStop}
          aria-label="Add stop"
          className="w-7 h-7 rounded-full bg-muted flex items-center justify-center shrink-0 active:scale-90 transition-transform disabled:opacity-40"
        >
          <Plus className="w-4 h-4 text-foreground" />
        </button>
      )}
    </div>
  );
}
