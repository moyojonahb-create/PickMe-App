import { useNavigate, useLocation } from 'react-router-dom';
import { Home, TrendingUp, Clock, User } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { haptic } from '@/lib/haptics';

const tabs = [
  { label: 'Home', icon: Home, path: '/driver/dashboard' },
  { label: 'Earnings', icon: TrendingUp, path: '/driver/dashboard', state: { openEarnings: true } },
  { label: 'Trips', icon: Clock, path: '/driver/trips' },
  { label: 'Profile', icon: User, path: '/driver/profile' },
];

interface DriverBottomNavProps {
  /** Unseen new-ride-request count — there's no dedicated Requests tab, so
   * this surfaces on Home, where the request feed actually lives. */
  requestBadgeCount?: number;
}

/** Driver-mode bottom nav — separate from the rider-facing BottomNavBar
 * (Home/Trips/Drive/Profile), since driver mode needs its own Earnings tab
 * and none of these existed as a persistent nav on driver screens before. */
export default function DriverBottomNav({ requestBadgeCount = 0 }: DriverBottomNavProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const isActive = (tab: (typeof tabs)[number]) => {
    if (tab.label === 'Earnings') return false;
    return location.pathname === tab.path;
  };

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-xl border-t border-border/50" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="flex items-center justify-around h-16 max-w-lg mx-auto px-2">
        {tabs.map((tab) => {
          const active = isActive(tab);
          return (
            <button
              key={tab.label}
              onClick={() => {
                haptic('light');
                navigate(tab.path, tab.state ? { state: tab.state } : undefined);
              }}
              className={cn(
                'flex flex-col items-center justify-center gap-0.5 w-16 h-14 rounded-xl transition-all relative',
                active ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {active && (
                <motion.div
                  layoutId="driverBottomNav"
                  className="absolute inset-0 bg-primary/10 rounded-xl"
                  transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                />
              )}
              <span className="relative">
                <tab.icon className={cn('h-5 w-5 relative z-10', active && 'stroke-[2.5px]')} />
                {tab.label === 'Home' && requestBadgeCount > 0 && (
                  <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-primary text-primary-foreground text-[9px] font-black flex items-center justify-center z-10">
                    {requestBadgeCount > 9 ? '9+' : requestBadgeCount}
                  </span>
                )}
              </span>
              <span className={cn('text-[10px] font-medium relative z-10', active && 'font-bold')}>{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
