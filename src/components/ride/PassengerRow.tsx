import { Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { haptic } from '@/lib/haptics';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface PassengerRowProps {
  count: number;
  onChange: (count: number) => void;
  max?: number;
  className?: string;
}

const DIRECT_NUMBERS = [1, 2, 3, 4];

/** Passenger picker — 1-4 are one-tap pills, 5+ opens upward (it sits low in
 * the sheet, so a downward dropdown would run off-screen). */
export default function PassengerRow({ count, onChange, max = 8, className }: PassengerRowProps) {
  const higherNumbers = Array.from({ length: Math.max(0, max - 4) }, (_, i) => i + 5);
  const isHigherSelected = count >= 5;

  const select = (n: number) => {
    onChange(n);
    haptic('light');
  };

  return (
    <div className={cn('flex items-center justify-between px-1', className)}>
      <span className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
        <Users className="w-4 h-4 text-muted-foreground" />
        Passengers
      </span>

      <div className="flex items-center gap-1.5">
        {DIRECT_NUMBERS.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => select(n)}
            aria-pressed={count === n}
            className={cn(
              'w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-bold transition-all active:scale-90',
              count === n ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground hover:bg-muted/70'
            )}
          >
            {n}
          </button>
        ))}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Choose 5 or more passengers"
              className={cn(
                'w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-bold transition-all active:scale-90',
                isHigherSelected ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground hover:bg-muted/70'
              )}
            >
              {isHigherSelected ? count : '5+'}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="end" className="min-w-[100px]">
            {higherNumbers.map((n) => (
              <DropdownMenuItem
                key={n}
                onClick={() => select(n)}
                className={cn('justify-center font-semibold', count === n && 'text-primary')}
              >
                {n} passengers
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
