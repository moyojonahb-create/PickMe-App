import { Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { haptic } from '@/lib/haptics';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface PassengerCountCardProps {
  count: number;
  onChange: (count: number) => void;
  max?: number;
}

const DIRECT_NUMBERS = [1, 2, 3, 4];

/**
 * Square black-glass tile — pairs with BookingForSomeoneElse in a 2-col row.
 * 1-4 are one-tap buttons; 5 doubles as a dropdown for larger groups.
 */
export default function PassengerCountCard({ count, onChange, max = 10 }: PassengerCountCardProps) {
  const higherNumbers = Array.from({ length: max - 4 }, (_, i) => i + 5);
  const isHigherSelected = count >= 5;

  const select = (n: number) => {
    onChange(n);
    haptic('light');
  };

  return (
    <div className="w-full aspect-square rounded-2xl bg-foreground/85 backdrop-blur-xl border border-white/10 flex flex-col items-center justify-center gap-2.5 p-3">
      <div className="flex items-center gap-1.5">
        <Users className="w-3.5 h-3.5 text-background/80" />
        <span className="text-[12px] font-semibold text-background">Passengers</span>
      </div>

      <div className="flex items-center gap-1.5">
        {DIRECT_NUMBERS.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => select(n)}
            aria-pressed={count === n}
            className={cn(
              'w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-bold transition-all active:scale-90',
              count === n ? 'bg-background text-foreground' : 'bg-background/10 text-background hover:bg-background/20'
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
                'w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-bold transition-all active:scale-90',
                isHigherSelected ? 'bg-background text-foreground' : 'bg-background/10 text-background hover:bg-background/20'
              )}
            >
              {isHigherSelected ? count : '5'}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" className="min-w-[88px]">
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
