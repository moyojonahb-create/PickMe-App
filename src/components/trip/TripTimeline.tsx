import { motion } from 'framer-motion';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export type TimelinePhase = 'en_route' | 'arriving' | 'picked_up' | 'dropped_off' | 'completed';

const STEPS: { id: TimelinePhase; label: string }[] = [
  { id: 'en_route', label: 'En route' },
  { id: 'arriving', label: 'Arriving' },
  { id: 'picked_up', label: 'Picked up' },
  { id: 'dropped_off', label: 'Dropped off' },
  { id: 'completed', label: 'Done' },
];

/** Map a Supabase `rides.status` value to a timeline phase. */
export function statusToPhase(status?: string | null): TimelinePhase {
  switch (status) {
    case 'accepted':
    case 'enroute':
    case 'enroute_pickup':
    case 'driver_arriving':
      return 'en_route';
    case 'arrived':
    case 'driver_arrived':
      return 'arriving';
    case 'in_progress':
      return 'picked_up';
    case 'near_destination':
      return 'dropped_off';
    case 'completed':
      return 'completed';
    default:
      return 'en_route';
  }
}

interface Props {
  phase: TimelinePhase;
  className?: string;
  compact?: boolean;
}

/**
 * Compact 5-step timeline (En route → Arriving → Picked up → Dropped off → Done).
 * Stays under one line on phones; scales gracefully up to tablet widths.
 */
export default function TripTimeline({ phase, className, compact = false }: Props) {
  const activeIdx = STEPS.findIndex((s) => s.id === phase);

  return (
    <div
      className={cn(
        'flex items-center w-full max-w-md mx-auto',
        compact ? 'gap-1' : 'gap-1.5',
        className,
      )}
      aria-label="Trip progress"
    >
      {STEPS.map((step, i) => {
        const done = i < activeIdx;
        const active = i === activeIdx;
        return (
          <div key={step.id} className="flex items-center flex-1 min-w-0">
            <div className="flex flex-col items-center flex-1 min-w-0">
              <motion.div
                initial={false}
                animate={{
                  scale: active ? 1.15 : 1,
                  backgroundColor: done || active ? 'hsl(var(--primary))' : 'hsl(var(--muted))',
                }}
                transition={{ type: 'spring', stiffness: 320, damping: 22 }}
                className={cn(
                  'rounded-full flex items-center justify-center shrink-0 shadow-sm',
                  compact ? 'h-5 w-5' : 'h-6 w-6',
                )}
              >
                {done ? (
                  <Check className={cn('text-primary-foreground', compact ? 'h-3 w-3' : 'h-3.5 w-3.5')} />
                ) : (
                  <span
                    className={cn(
                      'rounded-full',
                      compact ? 'h-1.5 w-1.5' : 'h-2 w-2',
                      active ? 'bg-primary-foreground' : 'bg-foreground/40',
                    )}
                  />
                )}
              </motion.div>
              <span
                className={cn(
                  'mt-1 font-semibold leading-tight tracking-tight truncate w-full text-center',
                  compact ? 'text-[9px]' : 'text-[10px]',
                  done || active ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {step.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={cn(
                  'flex-1 mx-1 h-[2px] rounded-full overflow-hidden',
                  done ? 'bg-primary' : 'bg-muted',
                )}
              >
                {active && (
                  <motion.div
                    initial={{ x: '-100%' }}
                    animate={{ x: '0%' }}
                    transition={{ duration: 1.2, ease: 'easeInOut', repeat: Infinity }}
                    className="h-full w-full bg-primary"
                  />
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
