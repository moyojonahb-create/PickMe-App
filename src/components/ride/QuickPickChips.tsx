import { cn } from '@/lib/utils';
import { MapPin, Building2, Stethoscope, ShoppingBag, Shield, Fuel, School } from 'lucide-react';
import { DEFAULT_TOWN, detectTown, TownConfig } from '@/lib/towns';

const ICON_MAP = {
  rank: MapPin,
  cbd: Building2,
  hospital: Stethoscope,
  shopping: ShoppingBag,
  police: Shield,
  fuel: Fuel,
  school: School,
};

interface QuickPickChipsProps {
  onSelect: (pick: { name: string; lat: number; lng: number }) => void;
  selectedName?: string;
  className?: string;
  userLocation?: { lat: number; lng: number } | null;
}

const QuickPickChips = ({ onSelect, selectedName, className, userLocation }: QuickPickChipsProps) => {
  const town = userLocation ? detectTown(userLocation.lat, userLocation.lng) : DEFAULT_TOWN;
  const picks = town.quickPicks;

  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {picks.map((pick) => {
        const Icon = ICON_MAP[pick.icon];
        const isSelected = selectedName === pick.name;

        return (
          <button
            key={pick.id}
            type="button"
            onClick={() => onSelect({ name: pick.name, lat: pick.lat, lng: pick.lng })}
            className={cn(
              'inline-flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-medium transition-all',
              'min-h-[44px] active:scale-95',
              isSelected
                ? 'bg-accent text-accent-foreground shadow-cruixe-sm'
                : 'bg-cruixe-gray-100 text-foreground hover:bg-cruixe-gray-200'
            )}
          >
            <Icon className="w-4 h-4 shrink-0" />
            <span>{pick.name}</span>
          </button>
        );
      })}
    </div>
  );
};

export default QuickPickChips;