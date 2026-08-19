import { ReactNode, CSSProperties } from 'react';
import { cn } from '@/lib/utils';
import { glassPanel, RIDE_RED_GRADIENT, RIDE_YELLOW, RIDE_FONT } from './rideGlass';

interface RideGlassPanelProps {
  children: ReactNode;
  /** Tapping the ribbon toggles the sheet height. */
  onRibbonClick?: () => void;
  className?: string;
  style?: CSSProperties;
}

/**
 * Frosted glass sheet with the branded red ribbon + yellow grab handle on top.
 * Shared by the ride-selection sheet and the finding-drivers card so both
 * screens read as one surface.
 */
export default function RideGlassPanel({
  children,
  onRibbonClick,
  className,
  style,
}: RideGlassPanelProps) {
  return (
    <div
      className={cn('flex flex-col overflow-hidden', className)}
      style={{
        ...glassPanel,
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        fontFamily: RIDE_FONT,
        ...style,
      }}
    >
      <button
        type="button"
        onClick={onRibbonClick}
        aria-label="Toggle sheet"
        className="w-full shrink-0 flex items-center justify-center py-2 active:opacity-90 transition-opacity"
        style={{
          background: RIDE_RED_GRADIENT,
          borderTopLeftRadius: 28,
          borderTopRightRadius: 28,
        }}
      >
        <span
          className="block rounded-full"
          style={{ width: 46, height: 5, background: RIDE_YELLOW }}
        />
      </button>
      {children}
    </div>
  );
}
