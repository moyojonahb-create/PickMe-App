import { useState, useRef, useEffect, useCallback, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type SheetState = 'collapsed' | 'half' | 'full';

interface RideBottomSheetProps {
  state: SheetState;
  onStateChange: (state: SheetState) => void;
  children: ReactNode;
  collapsedContent?: ReactNode;
  className?: string;
}

const SNAP_POINTS = {
  collapsed: 80,
  half: 0.35,
  full: 0.85,
};

export default function RideBottomSheet({
  state,
  onStateChange,
  children,
  collapsedContent,
  className,
}: RideBottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [currentY, setCurrentY] = useState(0);
  const [startY, setStartY] = useState(0);
  const [sheetHeight, setSheetHeight] = useState(0);

  const getHeightForState = useCallback((s: SheetState): number => {
    if (typeof window === 'undefined') return 0;
    const vh = window.innerHeight;
    switch (s) {
      case 'collapsed':
        return SNAP_POINTS.collapsed;
      case 'half':
        return vh * SNAP_POINTS.half;
      case 'full':
        return vh * SNAP_POINTS.full;
    }
  }, []);

  useEffect(() => {
    setSheetHeight(getHeightForState(state));
  }, [state, getHeightForState]);

  useEffect(() => {
    const handleResize = () => setSheetHeight(getHeightForState(state));
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [state, getHeightForState]);

  const snapToNearest = useCallback((height: number) => {
    const vh = window.innerHeight;
    const collapsedH = SNAP_POINTS.collapsed;
    const halfH = vh * SNAP_POINTS.half;
    const fullH = vh * SNAP_POINTS.full;

    const distToCollapsed = Math.abs(height - collapsedH);
    const distToHalf = Math.abs(height - halfH);
    const distToFull = Math.abs(height - fullH);

    if (distToCollapsed <= distToHalf && distToCollapsed <= distToFull) {
      onStateChange('collapsed');
    } else if (distToHalf <= distToFull) {
      onStateChange('half');
    } else {
      onStateChange('full');
    }
  }, [onStateChange]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    setIsDragging(true);
    setStartY(e.touches[0].clientY);
    setCurrentY(sheetHeight);
  }, [sheetHeight]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDragging) return;
    const deltaY = startY - e.touches[0].clientY;
    const newHeight = Math.max(SNAP_POINTS.collapsed, Math.min(window.innerHeight * 0.95, currentY + deltaY));
    setSheetHeight(newHeight);
  }, [isDragging, startY, currentY]);

  const handleTouchEnd = useCallback(() => {
    if (!isDragging) return;
    setIsDragging(false);
    snapToNearest(sheetHeight);
  }, [isDragging, sheetHeight, snapToNearest]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setIsDragging(true);
    setStartY(e.clientY);
    setCurrentY(sheetHeight);
  }, [sheetHeight]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = startY - e.clientY;
      const newHeight = Math.max(SNAP_POINTS.collapsed, Math.min(window.innerHeight * 0.95, currentY + deltaY));
      setSheetHeight(newHeight);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      snapToNearest(sheetHeight);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, startY, currentY, sheetHeight, snapToNearest]);

  const handleHandleClick = () => {
    if (isDragging) return;
    const nextState: SheetState = state === 'collapsed' ? 'half' : state === 'half' ? 'full' : 'collapsed';
    onStateChange(nextState);
  };

  return (
    <div
      ref={sheetRef}
      className={cn(
        'fixed bottom-0 left-0 right-0 bg-card rounded-t-3xl z-40 overflow-hidden',
        'transition-[height] shadow-[0_-2px_24px_rgba(0,0,0,0.08)]',
        isDragging ? 'duration-0' : 'duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]',
        className
      )}
      style={{ height: sheetHeight, paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {/* Drag Handle — PickMe red bar */}
      <div
        className="flex flex-col items-center py-2 cursor-grab active:cursor-grabbing touch-none select-none"
        style={{ background: 'var(--gradient-primary)' }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onMouseDown={handleMouseDown}
        onClick={handleHandleClick}
      >
        <div className="w-9 h-1 bg-white/90 rounded-full" />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {state === 'collapsed' && collapsedContent ? (
          <div className="px-5 pb-4">{collapsedContent}</div>
        ) : (
          <div className="h-full overflow-y-auto px-5 pb-8 overscroll-contain">
            {children}
          </div>
        )}
      </div>
    </div>
  );
}
