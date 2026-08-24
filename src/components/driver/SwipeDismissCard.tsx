import { type ReactNode } from 'react';
import { motion, useMotionValue, useTransform, type PanInfo } from 'framer-motion';
import { X } from 'lucide-react';
import { haptic } from '@/lib/haptics';
import { RIDE_RED } from '@/components/ride/rideGlass';

const DISMISS_THRESHOLD_PX = -84;

interface SwipeDismissCardProps {
  children: ReactNode;
  onDismiss: () => void;
}

/** Wraps a request card so it can be swiped left to dismiss, matching the
 * red "Dismiss" backdrop that shows through as the card translates. The
 * corner X button (rendered by the caller, inside `children`) offers the
 * same action for anyone who doesn't swipe. */
export default function SwipeDismissCard({ children, onDismiss }: SwipeDismissCardProps) {
  const x = useMotionValue(0);
  const dismissOpacity = useTransform(x, [DISMISS_THRESHOLD_PX, 0], [1, 0]);

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x < DISMISS_THRESHOLD_PX || info.velocity.x < -500) {
      haptic('light');
      onDismiss();
    }
  };

  return (
    <div className="relative overflow-hidden" style={{ borderRadius: 18 }}>
      <motion.div
        className="absolute inset-0 flex items-center justify-end"
        style={{ background: RIDE_RED, opacity: dismissOpacity, paddingRight: 24, gap: 8 }}
      >
        <X style={{ width: 18, height: 18, color: '#fff' }} strokeWidth={2.4} />
        <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>Dismiss</span>
      </motion.div>
      <motion.div
        drag="x"
        dragConstraints={{ left: DISMISS_THRESHOLD_PX * 1.4, right: 0 }}
        dragElastic={{ left: 0.15, right: 0 }}
        onDragEnd={handleDragEnd}
        style={{ x, touchAction: 'pan-y' }}
        className="relative"
      >
        {children}
      </motion.div>
    </div>
  );
}
