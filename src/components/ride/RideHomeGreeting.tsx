import { motion } from 'framer-motion';
import { Search } from 'lucide-react';

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

export default function RideHomeGreeting({ name, onSearchClick }: RideHomeGreetingProps) {
  return (
    <div className="space-y-3">
      <motion.p
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-lg font-bold text-foreground px-1"
      >
        {timeGreeting()}{name ? `, ${name}` : ''}
      </motion.p>
      <motion.button
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        onClick={onSearchClick}
        className="w-full flex items-center gap-3 px-4 py-4 rounded-2xl glass-card-heavy active:scale-[0.98] transition-transform text-left"
      >
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'var(--gradient-primary)' }}>
          <Search className="w-5 h-5 text-primary-foreground" />
        </div>
        <div>
          <p className="text-base font-semibold text-foreground">Where to?</p>
          <p className="text-xs text-muted-foreground">Search destination or pick a saved place</p>
        </div>
      </motion.button>
    </div>
  );
}
