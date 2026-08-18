import { Shield, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useFemaleTheme } from '@/hooks/useFemaleTheme';

export type GenderPreference = 'any' | 'female_only';

interface GenderPreferenceToggleProps {
  value: GenderPreference;
  onChange: (value: GenderPreference) => void;
}

export default function GenderPreferenceToggle({ value, onChange }: GenderPreferenceToggleProps) {
  const isFemaleOnly = value === 'female_only';
  const { setFemaleMode } = useFemaleTheme();

  const handleToggle = () => {
    const next = isFemaleOnly ? 'any' : 'female_only';
    onChange(next);
    setFemaleMode(next === 'female_only');
  };

  return (
    <button
      type="button"
      onClick={handleToggle}
      className={cn(
        "flex items-center gap-2 px-3 py-2 rounded-xl border transition-all text-left w-full",
        isFemaleOnly
          ? "border-primary bg-primary/10 dark:bg-primary/15"
          : "border-border hover:border-muted-foreground/30"
      )}
    >
      <div className={cn(
        "w-7 h-7 rounded-lg flex items-center justify-center shrink-0",
        isFemaleOnly ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"
      )}>
        {isFemaleOnly ? <ShieldCheck className="w-4 h-4" /> : <Shield className="w-4 h-4" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className={cn(
          "text-xs font-semibold leading-tight",
          isFemaleOnly ? "text-primary" : "text-foreground"
        )}>
          {isFemaleOnly ? 'Women-Only Ride' : 'Any Driver'}
        </p>
        <p className="text-[10px] text-muted-foreground leading-tight">
          {isFemaleOnly ? 'Only matched with female drivers' : 'Match preference'}
        </p>
      </div>
      <div className={cn(
        "w-9 h-5 rounded-full transition-colors relative shrink-0",
        isFemaleOnly ? "bg-primary" : "bg-muted"
      )}>
        <div className={cn(
          "absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform",
          isFemaleOnly ? "translate-x-[16px]" : "translate-x-0.5"
        )} />
      </div>
    </button>
  );
}
