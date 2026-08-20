import { Users, Clock, Zap } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import carFrontEconomy from '@/assets/cars/car-front-economy.png';
import carSlantShare from '@/assets/cars/car-slant-share.png';
import carParcel from '@/assets/cars/car-parcel.png';
import { tintBlue, tintYellow, RIDE_RED, RIDE_TEXT, RIDE_TEXT_2, RIDE_YELLOW } from './rideGlass';

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

const SECONDARY_CARD_HEIGHT = 52;

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

  const selectionRing = (isSelected: boolean) =>
    isSelected
      ? {
          boxShadow: `inset 0 0 0 2px ${RIDE_RED}, 0 8px 20px rgba(184,17,4,.14)`,
        }
      : undefined;

  const isHeroSelected = selected === hero.id;

  return (
    <div className={cn('space-y-2', className)}>
      {/* ── Hero card (Economy) ── */}
      <motion.button
        type="button"
        whileTap={{ scale: 0.985 }}
        onClick={() => onSelect(hero.id)}
        aria-pressed={isHeroSelected}
        className="w-full flex items-center gap-3 rounded-3xl px-3.5 py-3 text-left"
        style={{ ...tintFor(hero.id), ...selectionRing(isHeroSelected) }}
      >
        <div className="w-[68px] h-[52px] shrink-0 flex items-center justify-center">
          <img src={TIER_THUMBNAILS[hero.id]} alt="" className="w-full h-full object-contain" />
        </div>

        <div className="flex-1 min-w-0">
          {/* Row 1: name + tagline (left) / price + selected-radio (right) — price
              baseline-aligned with the name via items-start on the row. */}
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[16px] font-bold leading-tight" style={{ color: RIDE_TEXT }}>
                {hero.name}
              </p>
              <p className="mt-0.5 text-[11px] font-medium leading-tight" style={{ color: RIDE_TEXT_2 }}>
                Affordable rides, everyday
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <p className="text-[16px] font-bold tabular-nums leading-tight" style={{ color: RIDE_RED }}>
                {currencySymbol}
                {hero.price.toFixed(2)}
              </p>
              <span
                className="rounded-full flex items-center justify-center shrink-0"
                style={{ width: 17, height: 17, border: `2px solid ${RIDE_RED}` }}
              >
                {isHeroSelected && <span className="rounded-full" style={{ width: 8, height: 8, background: RIDE_RED }} />}
              </span>
            </div>
          </div>

          {/* Row 2: meta (left) / "Fast pickup" badge (right) */}
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-[11px] font-medium" style={{ color: RIDE_TEXT_2 }}>
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
            <span
              className="inline-flex items-center gap-1 rounded-full shrink-0"
              style={{ padding: '2px 7px', background: RIDE_YELLOW, color: RIDE_TEXT }}
            >
              <Zap className="w-2.5 h-2.5" fill="currentColor" />
              <span className="text-[10px] font-bold">{hero.badge}</span>
            </span>
          </div>
        </div>
      </motion.button>

      {/* ── Secondary grid (Share / Parcel) — identical structure + fixed height,
          so the two cards can never diverge based on content. ── */}
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
                className="flex items-center gap-2 rounded-3xl pl-1.5 pr-2.5 text-left"
                style={{ height: SECONDARY_CARD_HEIGHT, ...tintFor(option.id), ...selectionRing(isSelected) }}
              >
                <div className="shrink-0 flex items-center justify-center" style={{ width: 54, height: 40 }}>
                  <img
                    src={TIER_THUMBNAILS[option.id]}
                    alt=""
                    className="w-full h-full object-contain"
                  />
                </div>

                <div className="flex-1 min-w-0 flex flex-col justify-center gap-1">
                  {/* Row 1: name (left) + price (right) — single line, vertically
                      centered with each other. */}
                  <div className="flex items-center justify-between gap-1.5">
                    <p className="flex-1 min-w-0 truncate text-[13px] font-bold leading-none tracking-[-0.01em]" style={{ color: RIDE_TEXT }}>
                      {option.name}
                    </p>
                    <p className="shrink-0 text-[15px] font-bold tabular-nums leading-none tracking-[-0.01em]" style={{ color: RIDE_TEXT }}>
                      {currencySymbol}
                      {option.price.toFixed(2)}
                    </p>
                  </div>
                  {/* Row 2: meta (nowrap, can shrink) + badge (never shrinks),
                      same row — the badge can never force the meta text to wrap. */}
                  <div className="flex items-center gap-1.5">
                    <p className="min-w-0 flex-1 truncate text-[11px] font-medium leading-tight" style={{ color: RIDE_TEXT_2 }}>
                      {isParcel ? 'Delivery' : option.capacity} · {option.etaMinutes} min
                    </p>
                    {!isParcel && (
                      <span
                        className="shrink-0 inline-flex items-center rounded-full whitespace-nowrap"
                        style={{ padding: '1px 4px', background: RIDE_YELLOW, color: RIDE_TEXT, fontSize: 9, fontWeight: 700, lineHeight: 1.4 }}
                      >
                        {option.badge}
                      </span>
                    )}
                  </div>
                </div>
              </motion.button>
            );
          })}
        </div>
      )}
    </div>
  );
}
