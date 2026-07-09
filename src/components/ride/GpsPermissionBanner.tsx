import { motion } from 'framer-motion';
import { MapPinOff, RefreshCw, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type Status = 'idle' | 'loading' | 'success' | 'denied' | 'unavailable';

interface Props {
  status: Status;
  error?: string | null;
  onRetry: () => void;
  className?: string;
}

/**
 * Inline banner explaining GPS state with a single-tap retry.
 * Renders nothing when GPS is healthy ('idle' or 'success').
 */
export default function GpsPermissionBanner({ status, error, onRetry, className }: Props) {
  if (status === 'success' || status === 'idle') return null;

  const isLoading = status === 'loading';
  const denied = status === 'denied';

  const title = isLoading
    ? 'Finding your location…'
    : denied
      ? 'Location access blocked'
      : 'Location unavailable';

  const body = isLoading
    ? 'Hold tight — getting an accurate GPS fix.'
    : denied
      ? "Enable location in your browser or device settings, then tap retry. You can still pick a landmark manually."
      : (error || "We couldn't read your GPS. Check signal and try again, or pick a landmark below.");

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      role="alert"
      className={cn(
        'mx-auto max-w-md flex items-start gap-3 rounded-2xl border px-3.5 py-3 shadow-sm',
        isLoading
          ? 'bg-primary/5 border-primary/20'
          : 'bg-amber-50 border-amber-200 dark:bg-amber-950/40 dark:border-amber-800/60',
        className,
      )}
    >
      <div
        className={cn(
          'h-9 w-9 shrink-0 rounded-xl flex items-center justify-center',
          isLoading ? 'bg-primary/15 text-primary' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-300',
        )}
      >
        {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPinOff className="h-4 w-4" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-bold leading-tight text-foreground">{title}</p>
        <p className="text-[12px] text-foreground/70 leading-snug mt-0.5">{body}</p>
      </div>
      {!isLoading && (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-foreground text-background px-3 py-1.5 text-[12px] font-semibold active:scale-95 transition"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Retry
        </button>
      )}
    </motion.div>
  );
}
