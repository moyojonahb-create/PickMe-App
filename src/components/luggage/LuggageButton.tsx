import { Briefcase } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LuggageButtonProps {
  count?: number;
  onClick: () => void;
  className?: string;
}

export default function LuggageButton({ count = 0, onClick, className }: LuggageButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-2 px-4 py-2.5 rounded-full font-bold text-sm transition-all active:scale-95 shadow-sm',
        'bg-yellow-400 text-black hover:bg-yellow-300',
        className
      )}
    >
      <Briefcase className="w-4 h-4" />
      <span>Luggage{count > 0 ? ` (${count})` : ''}</span>
    </button>
  );
}
