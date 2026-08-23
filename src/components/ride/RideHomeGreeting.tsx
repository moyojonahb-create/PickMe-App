import { motion } from 'framer-motion';
import { Search } from 'lucide-react';
import pickMeCarIcon from '@/assets/pickme-car-icon.png';
import { RIDE_TEXT, RIDE_TEXT_2, RIDE_TEXT_3, tintBlue } from './rideGlass';

interface RideHomeGreetingProps {
  name: string;
  onSearchClick: () => void;
}

function timeGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/** The "Where to?" card — row 2's wide tile, alongside the Home/Work
 * squares from QuickShortcutsRow. Fixed height so all three tiles align. */
export default function RideHomeGreeting({ name, onSearchClick }: RideHomeGreetingProps) {
  return (
    <motion.button
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={onSearchClick}
      className="flex-1 min-w-0 flex items-center gap-1 rounded-2xl active:scale-[0.98] transition-transform text-left"
      style={{
        height: 62,
        padding: '8px 12px 8px 6px',
        ...tintBlue,
        boxShadow: 'inset 0 0 0 .5px rgba(26,115,232,.18), 0 6px 14px rgba(0,0,0,.05)',
      }}
    >
      {/* Sized to fill the card edge-to-edge vertically — deliberately taller
          than the padded content area, matching the mockup's car photo bleed. */}
      <img
        src={pickMeCarIcon}
        alt=""
        className="shrink-0 object-contain"
        style={{ width: 62, height: 62 }}
      />
      {/* min-w-0 lets this shrink inside the flex row; no truncate on the
          greeting — the rider's name always renders in full, wrapping to a
          second line rather than being cut off if it's ever long. */}
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium leading-[1.2]" style={{ color: RIDE_TEXT_2 }}>
          {timeGreeting()}{name ? `, ${name}` : ''}
        </p>
        <p className="text-[19px] font-bold leading-[1.2]" style={{ color: RIDE_TEXT, letterSpacing: '-.01em' }}>
          Where to?
        </p>
      </div>
      <span
        className="shrink-0 rounded-full flex items-center justify-center"
        style={{ width: 32, height: 32, background: 'rgba(26,115,232,.1)' }}
      >
        <Search className="w-4 h-4" style={{ color: RIDE_TEXT_3 }} />
      </span>
    </motion.button>
  );
}
