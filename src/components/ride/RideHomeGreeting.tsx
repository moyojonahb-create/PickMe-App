import { motion } from 'framer-motion';
import { Search, ChevronRight } from 'lucide-react';
import TownSelectorSheet from './TownSelectorSheet';
import { type TownConfig } from '@/lib/towns';
import { RIDE_RED, RIDE_TEXT, RIDE_TEXT_2, tintBlue } from './rideGlass';

interface RideHomeGreetingProps {
  name: string;
  town: TownConfig;
  onTownSelect: (town: TownConfig) => void;
  onSearchClick: () => void;
}

function timeGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function RideHomeGreeting({ name, town, onTownSelect, onSearchClick }: RideHomeGreetingProps) {
  return (
    <div className="space-y-2.5">
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between gap-2 px-1"
      >
        <p className="text-[19px] font-bold truncate" style={{ color: RIDE_TEXT, letterSpacing: '-.02em' }}>
          {timeGreeting()}{name ? `, ${name}` : ''}
        </p>
        <TownSelectorSheet currentTown={town} onSelect={onTownSelect} />
      </motion.div>
      <motion.button
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        onClick={onSearchClick}
        className="w-full flex items-center gap-3 px-4 active:scale-[0.98] transition-transform text-left"
        style={{
          height: 56,
          borderRadius: 16,
          ...tintBlue,
          boxShadow: 'inset 0 0 0 .5px rgba(26,115,232,.18), 0 6px 14px rgba(0,0,0,.05)',
        }}
      >
        <div className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center" style={{ background: 'rgba(184,17,4,.1)' }}>
          <Search className="w-4 h-4" style={{ color: RIDE_RED }} />
        </div>
        <span className="flex-1 text-[16px] font-medium" style={{ color: RIDE_TEXT }}>Where to?</span>
        <ChevronRight className="w-[18px] h-[18px]" style={{ color: RIDE_TEXT_2 }} />
      </motion.button>
    </div>
  );
}
