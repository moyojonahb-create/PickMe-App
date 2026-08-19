import { Users, Package, Clock } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import carFrontEconomy from '@/assets/cars/car-front-economy.png';
import carSlantShare from '@/assets/cars/car-slant-share.png';
import carParcel from '@/assets/cars/car-parcel.png';
import { tintBlue, tintYellow, RIDE_RED, RIDE_TEXT, RIDE_TEXT_2 } from './rideGlass';

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
  passengerCount?: number;
  onPassengerCountChange?: (count: number) => void;
  className?: string;
}

function tintFor(id: RideTierId) {
  return id === 'share' ? tintYellow : tintBlue;
}

export default function RideTierSelector({
  options,
  selected,
  onSelect,
  currencySymbol,
  className,
}: RideTierSelectorProps) {
  const hero = options.find((o) => o.id === 'economy') ?? options[0];
  const rest = options.filter((o) => o.id !== hero?.id);

  if (!hero) return null;

  const renderBadge = (option: RideTierOption) => (
    <span
      className="inline-flex items-center rounded-full px-2 py-[3px] text-[10px] font-bold tracking-wide"
      style={
        option.badgeVariant === 'primary'
          ? { background: 'rgba(26,115,232,.12)', color: '#1A73E8' }
          : { background: 'rgba(255,221,0,.28)', color: '#8A6A00' }
      }
    >
      {option.badge}
    </span>
  );

  const selectionRing = (isSelected: boolean) =>
    isSelected
      ? {
          boxShadow: `inset 0 0 0 2px ${RIDE_RED}, 0 8px 20px rgba(184,17,4,.14)`,
        }
      : undefined;

  return (
    <div className={cn('space-y-2', className)}>
      {/* ── Hero card (Economy) ── */}
      <motion.button
        type="button"
        whileTap={{ scale: 0.985 }}
        onClick={() => onSelect(hero.id)}
        aria-pressed={selected === hero.id}
        className="w-full flex items-center gap-3 rounded-3xl px-3.5 py-3 text-left"
        style={{ ...tintFor(hero.id), ...selectionRing(selected === hero.id) }}
      >
        <div className="w-[68px] h-[52px] shrink-0 flex items-center justify-center">
          <img src={TIER_THUMBNAILS[hero.id]} alt="" className="w-full h-full object-contain" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-[16px] font-bold leading-tight" style={{ color: RIDE_TEXT }}>
              {hero.name}
            </p>
            {renderBadge(hero)}
          </div>
          <div
            className="mt-1 flex items-center gap-2 text-[12px] font-medium"
            style={{ color: RIDE_TEXT_2 }}
          >
            <span className="inline-flex items-center gap-1">
              <Users className="w-3.5 h-3.5" />
              {hero.capacity}
            </span>
            <span>·</span>
            <span className="inline-flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              {hero.etaMinutes} min
            </span>
          </div>
        </div>

        <p className="text-[18px] font-extrabold tabular-nums shrink-0" style={{ color: RIDE_TEXT }}>
          {currencySymbol}
          {hero.price.toFixed(2)}
        </p>
      </motion.button>

      {/* ── Secondary grid (Share / Parcel) ── */}
      {rest.length > 0 && (
        <div className={cn('grid gap-2', rest.length > 1 ? 'grid-cols-2' : 'grid-cols-1')}>
          {rest.map((option) => {
            const isSelected = selected === option.id;
            const isParcel = option.id === 'parcel';
            return (
              <motion.button
                key={option.id}
                type="button"
                whileTap={{ scale: 0.985 }}
                onClick={() => onSelect(option.id)}
                aria-pressed={isSelected}
                className="rounded-3xl px-3 py-2.5 text-left"
                style={{ ...tintFor(option.id), ...selectionRing(isSelected) }}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="w-11 h-8 shrink-0">
                    <img
                      src={TIER_THUMBNAILS[option.id]}
                      alt=""
                      className="w-full h-full object-contain"
                    />
                  </div>
                  {renderBadge(option)}
                </div>
                <p className="mt-1.5 text-[14px] font-bold leading-tight" style={{ color: RIDE_TEXT }}>
                  {option.name}
                </p>
                <div
                  className="mt-0.5 flex items-center gap-1.5 text-[11px] font-medium"
                  style={{ color: RIDE_TEXT_2 }}
                >
                  {isParcel ? (
                    <span className="inline-flex items-center gap-1">
                      <Package className="w-3 h-3" />
                      Delivery
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1">
                      <Users className="w-3 h-3" />
                      {option.capacity}
                    </span>
                  )}
                  <span>·</span>
                  <span>{option.etaMinutes} min</span>
                </div>
                <p
                  className="mt-1 text-[15px] font-extrabold tabular-nums"
                  style={{ color: RIDE_TEXT }}
                >
                  {currencySymbol}
                  {option.price.toFixed(2)}
                </p>
              </motion.button>
            );
          })}
        </div>
      )}
    </div>
  );
}
