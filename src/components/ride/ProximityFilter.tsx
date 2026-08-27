import { cn } from '@/lib/utils';

interface ProximityFilterProps {
  selected: number | null;
  onSelect: (radius: number | null) => void;
  className?: string;
}

const RADIUS_OPTIONS = [
  { value: 1, label: '1km' },
  { value: 5, label: '5km' },
  { value: 20, label: '20km' },
];

export default function ProximityFilter({ selected, onSelect, className }: ProximityFilterProps) {
  return (
    <div className={cn('flex gap-2', className)}>
      <button
        type="button"
        onClick={() => onSelect(null)}
        className={cn(
          'px-3 py-1.5 rounded-full text-xs font-medium transition-all',
          selected === null
            ? 'bg-primary text-primary-foreground'
            : 'bg-cruixe-gray-100 text-muted-foreground hover:bg-cruixe-gray-200'
        )}
      >
        All
      </button>
      {RADIUS_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onSelect(option.value)}
          className={cn(
            'px-3 py-1.5 rounded-full text-xs font-medium transition-all',
            selected === option.value
              ? 'bg-primary text-primary-foreground'
              : 'bg-cruixe-gray-100 text-muted-foreground hover:bg-cruixe-gray-200'
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}