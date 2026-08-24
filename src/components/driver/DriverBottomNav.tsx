import { useNavigate, useLocation } from 'react-router-dom';
import { Home, TrendingUp, Clock, User } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { haptic } from '@/lib/haptics';
import { RIDE_RED } from '@/components/ride/rideGlass';

const tabs = [
  // /driver/dashboard is no longer a screen of its own — it's the traffic
  // controller that shows FullScreenNavigation during an active trip and
  // otherwise hands off to /driver/requests, which is the real "home" now
  // (online status, wallet, the request list).
  { label: 'Home', icon: Home, path: '/driver/requests' },
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
    <nav
      className="fixed bottom-0 left-0 right-0 z-50"
      style={{
        height: 88,
        paddingBottom: 'env(safe-area-inset-bottom)',
        background: 'rgba(255,255,255,.94)',
        backdropFilter: 'blur(26px) saturate(190%)',
        WebkitBackdropFilter: 'blur(26px) saturate(190%)',
        boxShadow: 'inset 0 .5px 0 rgba(255,255,255,.9), 0 -8px 24px rgba(17,17,17,.06)',
      }}
    >
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
              className="relative flex flex-col items-center justify-center gap-0.5 transition-transform active:scale-95"
              style={{ width: 70, height: 46 }}
            >
              {active && (
                <motion.div
                  layoutId="driverBottomNav"
                  className="absolute inset-0"
                  style={{ borderRadius: 14, background: 'rgba(184,17,4,.1)' }}
                  transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                />
              )}
              <span className="relative">
                <tab.icon
                  className="relative z-10 h-5 w-5"
                  style={{ color: active ? RIDE_RED : '#9AA1AD', strokeWidth: active ? 2.4 : 2 }}
                />
                {tab.label === 'Home' && requestBadgeCount > 0 && (
                  <span
                    className="absolute -top-1.5 -right-2 min-w-[16px] h-4 px-1 rounded-full text-[9px] font-black flex items-center justify-center z-10"
                    style={{ background: RIDE_RED, color: '#fff' }}
                  >
                    {requestBadgeCount > 9 ? '9+' : requestBadgeCount}
                  </span>
                )}
              </span>
              <span
                className={cn('relative z-10 text-[10px]', active ? 'font-bold' : 'font-medium')}
                style={{ color: active ? RIDE_RED : '#9AA1AD' }}
              >
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
