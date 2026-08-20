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
      className="flex-1 min-w-0 h-full flex items-center gap-1 px-2 rounded-2xl active:scale-[0.98] transition-transform text-left"
      style={{
        ...tintBlue,
        boxShadow: 'inset 0 0 0 .5px rgba(26,115,232,.18), 0 6px 14px rgba(0,0,0,.05)',
      }}
    >
      <img src={pickMeCarIcon} alt="" className="h-10 w-auto shrink-0 object-contain" />
      {/* min-w-0 lets this shrink inside the flex row; no truncate on the
          greeting — the rider's name always renders in full, wrapping to a
          second line rather than being cut off if it's ever long. */}
      <div className="flex-1 min-w-0">
        <p className="text-[10.5px] font-medium leading-[1.2]" style={{ color: RIDE_TEXT_2 }}>
          {timeGreeting()}{name ? `, ${name}` : ''}
        </p>
        <p className="text-[15px] font-bold leading-[1.2]" style={{ color: RIDE_TEXT, letterSpacing: '-.01em' }}>
          Where to?
        </p>
      </div>
      <span
        className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center"
        style={{ background: 'rgba(26,115,232,.1)' }}
      >
        <Search className="w-3.5 h-3.5" style={{ color: RIDE_TEXT_3 }} />
      </span>
    </motion.button>
  );
}
