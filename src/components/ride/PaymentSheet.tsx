import { useEffect, useRef, useState, useCallback } from 'react';
import { X, Banknote, Wallet } from 'lucide-react';
import { hapticSync } from '@/lib/haptics';
import { useToast } from '@/hooks/use-toast';

interface PaymentSheetProps {
  open: boolean;
  fare: number;
  walletBalance: number;
  onClose: () => void;
  onSelect: (method: 'cash' | 'wallet', fare: number) => void;
}

const CLOSE_THRESHOLD = 60;

function prefersReducedMotion() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export default function PaymentSheet({
  open,
  fare,
  walletBalance,
  onClose,
  onSelect,
}: PaymentSheetProps) {
  const { toast } = useToast();
  const sheetRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLSpanElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const [dragging, setDragging] = useState(false);
  const [dragY, setDragY] = useState(0);
  const startYRef = useRef(0);
  const thresholdHapticFiredRef = useRef(false);

  const reduceMotion = prefersReducedMotion();

  // Save trigger and restore focus on close
  useEffect(() => {
    if (open) {
      previousFocusRef.current = (document.activeElement as HTMLElement) || null;
      // Focus the close button so keyboard users can dismiss easily
      window.setTimeout(() => closeBtnRef.current?.focus(), 50);
    } else if (previousFocusRef.current) {
      try { previousFocusRef.current.focus(); } catch { /* noop */ }
      previousFocusRef.current = null;
    }
  }, [open]);

  // Escape to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const handleSelect = useCallback(
    (method: 'cash' | 'wallet') => {
      if (method === 'wallet' && walletBalance < fare) {
        hapticSync('error');
        toast({
          title: 'Insufficient wallet',
          description: `Need $${fare.toFixed(2)}, have $${walletBalance.toFixed(2)}.`,
          variant: 'destructive',
        });
        return;
      }
      hapticSync('success');
      onSelect(method, fare);
    },
    [fare, walletBalance, onSelect, toast]
  );

  // Touch handlers — swipe down to dismiss
  const onTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    startYRef.current = e.touches[0].clientY;
    thresholdHapticFiredRef.current = false;
    setDragging(true);
  };
  const onTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    const dy = Math.max(0, e.touches[0].clientY - startYRef.current);
    setDragY(dy);
    if (!thresholdHapticFiredRef.current && dy > CLOSE_THRESHOLD) {
      thresholdHapticFiredRef.current = true;
      hapticSync('medium');
    } else if (thresholdHapticFiredRef.current && dy <= CLOSE_THRESHOLD) {
      thresholdHapticFiredRef.current = false;
    }
  };
  const onTouchEnd = () => {
    setDragging(false);
    if (dragY > CLOSE_THRESHOLD) {
      onClose();
    }
    setDragY(0);
  };

  if (!open) return null;

  const dragProgress = Math.min(1, dragY / CLOSE_THRESHOLD);
  const overlayOpacity = 1 - dragProgress * 0.5;

  const sheetTransition = dragging
    ? 'none'
    : reduceMotion
      ? 'transform 120ms linear, opacity 120ms linear'
      : 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1), opacity 200ms ease-out';

  return (
    <div
      className={`fixed inset-0 z-[80] bg-black/45 backdrop-blur-md flex items-end justify-center ${
        reduceMotion ? '' : 'animate-in fade-in duration-200'
      }`}
      style={{ opacity: overlayOpacity }}
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={sheetRef}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-sheet-title"
        aria-describedby="payment-sheet-desc"
        style={{
          transform: `translateY(${dragY}px)`,
          transition: sheetTransition,
          willChange: 'transform',
        }}
        className={`w-[calc(100%-56px)] max-w-[290px] mb-[calc(env(safe-area-inset-bottom)+8px)] bg-background rounded-2xl shadow-xl border border-border/60 overflow-hidden ${
          reduceMotion ? '' : 'animate-in slide-in-from-bottom-6 fade-in duration-300 ease-out'
        }`}
      >
        {/* Drag handle */}
        <div
          className="flex justify-center pt-1.5 pb-0.5 cursor-grab active:cursor-grabbing select-none"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Drag handle — swipe down to close"
        >
          <span
            ref={handleRef}
            className="block h-1 rounded-full transition-all duration-150"
            style={{
              width: dragProgress > 0 ? `${36 + dragProgress * 12}px` : '36px',
              backgroundColor:
                dragProgress >= 1
                  ? 'hsl(var(--primary))'
                  : `hsl(var(--muted-foreground) / ${0.3 + dragProgress * 0.5})`,
            }}
          />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-3 pt-1 pb-2 gap-3">
          <div className="min-w-0">
            <h3
              id="payment-sheet-title"
              className="text-[13px] font-semibold text-foreground leading-tight"
            >
              Choose payment
            </h3>
            <p
              id="payment-sheet-desc"
              className="text-[10px] text-muted-foreground mt-0"
            >
              Fare ${fare.toFixed(2)}
            </p>
          </div>
          <button
            ref={closeBtnRef}
            onClick={onClose}
            aria-label="Close payment options"
            type="button"
            className="shrink-0 ml-2 w-7 h-7 flex items-center justify-center rounded-full bg-muted text-muted-foreground hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-90 transition-all"
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>

        {/* Options */}
        <div
          className="px-2 pb-2 pt-1 grid grid-cols-2 gap-1.5"
          role="group"
          aria-label="Payment method"
        >
          <button
            type="button"
            onClick={() => handleSelect('cash')}
            aria-label={`Pay with cash, fare $${fare.toFixed(2)}`}
            className="group flex flex-col items-center justify-center gap-1 py-2 px-2 rounded-lg bg-primary text-primary-foreground shadow-sm hover:brightness-105 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.96] active:brightness-95 transition-[transform,filter,box-shadow] duration-150 ease-out motion-reduce:transition-none motion-reduce:active:scale-100"
          >
            <span
              aria-hidden="true"
              className="w-6 h-6 flex items-center justify-center rounded-full bg-white/20 group-active:bg-white/30 transition-colors"
            >
              <Banknote className="w-3 h-3" strokeWidth={2.2} />
            </span>
            <div className="text-center">
              <div className="text-[11px] font-semibold leading-tight">Cash</div>
              <div className="text-[9px] opacity-80 mt-0">Pay driver</div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => handleSelect('wallet')}
            aria-label={`Pay with wallet, balance $${walletBalance.toFixed(2)}${walletBalance < fare ? ' (insufficient)' : ''}`}
            aria-disabled={walletBalance < fare}
            className="group flex flex-col items-center justify-center gap-1 py-2 px-2 rounded-lg bg-accent text-accent-foreground shadow-sm hover:brightness-105 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.96] active:brightness-95 transition-[transform,filter,box-shadow] duration-150 ease-out motion-reduce:transition-none motion-reduce:active:scale-100"
          >
            <span
              aria-hidden="true"
              className="w-6 h-6 flex items-center justify-center rounded-full bg-black/10 group-active:bg-black/20 transition-colors"
            >
              <Wallet className="w-3 h-3" strokeWidth={2.2} />
            </span>
            <div className="text-center">
              <div className="text-[11px] font-semibold leading-tight">Wallet</div>
              <div className="text-[9px] opacity-80 mt-0">
                Balance ${walletBalance.toFixed(2)}
              </div>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
