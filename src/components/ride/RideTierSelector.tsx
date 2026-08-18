import { useState } from 'react';
import { Users, Package, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import carFrontEconomy from '@/assets/cars/car-front-economy.png';
import carSlantShare from '@/assets/cars/car-slant-share.png';
import carParcel from '@/assets/cars/car-parcel.png';
import PassengerRow from './PassengerRow';

const TIER_THUMBNAILS: Partial<Record<RideTierId, string>> = {
  economy: carFrontEconomy,
  share: carSlantShare,
  parcel: carParcel,
};

export type RideTierId = 'economy' | 'share' | 'parcel';

export interface RideTierOption {
  id: RideTierId;
  name: string;
  capacity: number;
  etaMinutes: number;
  price: number;
  badge: string;
  badgeVariant: 'primary' | 'accent';
}

interface RideTierSelectorProps {
  options: RideTierOption[];
  selected: RideTierId;
  onSelect: (id: RideTierId) => void;
  currencySymbol: string;
  passengerCount: number;
  onPassengerCountChange: (count: number) => void;
  className?: string;
}

export default function RideTierSelector({
  options,
  selected,
  onSelect,
  currencySymbol,
  passengerCount,
  onPassengerCountChange,
  className,
}: RideTierSelectorProps) {
  // Once the rider taps a tier, collapse the list down to just that row so
  // the sheet reads as "here's what you picked" — tapping the collapsed row
  // re-opens the full list to change it.
  const [expanded, setExpanded] = useState(true);

  const handleChoose = (id: RideTierId) => {
    onSelect(id);
    setExpanded(false);
  };

  const visibleOptions = expanded ? options : options.filter((o) => o.id === selected);

  return (
    <div className={cn('rounded-[20px] border border-border/60 bg-card overflow-hidden', className)}>
      {visibleOptions.map((option) => {
        const isSelected = selected === option.id;
        const isParcel = option.id === 'parcel';
        const collapsedRow = !expanded && isSelected;

        const rowContent = (
          <>
            <div className="w-14 h-11 rounded-xl bg-muted/70 flex items-center justify-center shrink-0 overflow-hidden">
              <img src={TIER_THUMBNAILS[option.id]} alt="" className="w-full h-full object-contain p-0.5" />
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-[15px] font-bold text-foreground leading-tight">{option.name}</p>
              <div className="flex items-center gap-1.5 mt-0.5 text-[12px] text-muted-foreground">
                {isParcel ? (
                  <span className="flex items-center gap-1"><Package className="w-3.5 h-3.5" />Delivery</span>
                ) : (
                  <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />{option.capacity}</span>
                )}
                <span>&bull;</span>
                <span>{option.etaMinutes} min</span>
              </div>
              <span
                className={cn(
                  'inline-block mt-1 px-2 py-0.5 rounded-md text-[10px] font-bold',
                  option.badgeVariant === 'primary' ? 'bg-primary text-primary-foreground' : 'bg-accent text-accent-foreground'
                )}
              >
                {option.badge}
              </span>
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              <span className="text-[15px] font-bold text-foreground tabular-nums">
                {currencySymbol}{option.price.toFixed(2)}
              </span>
              {collapsedRow ? (
                <span className="w-5 h-5 rounded-full bg-muted flex items-center justify-center shrink-0">
                  <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                </span>
              ) : (
                <span
                  className={cn(
                    'w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0',
                    isSelected ? 'border-primary' : 'border-border'
                  )}
                >
                  {isSelected && <span className="w-2.5 h-2.5 rounded-full bg-primary" />}
                </span>
              )}
            </div>
          </>
        );

        if (collapsedRow) {
          // The passenger picker has real interactive buttons, so it can't
          // live inside the row's own <button> — it sits below it instead,
          // inside the same card, right under the price.
          return (
            <div key={option.id} className="border-b border-border/40 last:border-b-0">
              <button
                type="button"
                onClick={() => setExpanded(true)}
                aria-label={`${option.name} selected, tap to change`}
                className="w-full flex items-center gap-3 px-3.5 py-2 text-left bg-primary/[0.04]"
              >
                {rowContent}
              </button>
              {!isParcel && (
                <div className="px-3.5 pb-2 pt-1 border-t border-border/40">
                  <PassengerRow count={passengerCount} onChange={onPassengerCountChange} />
                </div>
              )}
            </div>
          );
        }

        return (
          <button
            key={option.id}
            type="button"
            onClick={() => handleChoose(option.id)}
            aria-pressed={isSelected}
            className={cn(
              'w-full flex items-center gap-3 px-3.5 py-3 text-left transition-colors border-b border-border/40 last:border-b-0',
              isSelected ? 'bg-primary/[0.04]' : 'active:bg-muted/40'
            )}
          >
            {rowContent}
          </button>
        );
      })}
    </div>
  );
}
