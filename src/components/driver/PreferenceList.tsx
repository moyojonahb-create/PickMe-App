import { Briefcase, Wind, Volume2, Accessibility, Ear, Package } from 'lucide-react';

export interface PreferenceItem {
  key: string;
  label: string;
  icon: typeof Briefcase;
}

interface PreferenceListProps {
  noLuggage?: boolean;
  hasLuggage?: boolean;
  coolTemperature?: boolean;
  quietRide?: boolean;
  wavRequired?: boolean;
  hearingImpaired?: boolean;
  className?: string;
}

/** Small icon + label rows — only ever renders preferences that are
 * actually true on the ride, per real ride_preferences/luggage_requests
 * data. Returns null when there's nothing to show. */
export default function PreferenceList({
  noLuggage,
  hasLuggage,
  coolTemperature,
  quietRide,
  wavRequired,
  hearingImpaired,
  className,
}: PreferenceListProps) {
  const items: PreferenceItem[] = [];
  if (noLuggage) items.push({ key: 'no-luggage', label: 'No luggage', icon: Briefcase });
  if (hasLuggage) items.push({ key: 'luggage', label: 'Has luggage', icon: Package });
  if (coolTemperature) items.push({ key: 'cool', label: 'Air Con preferred', icon: Wind });
  if (quietRide) items.push({ key: 'quiet', label: 'Quiet ride', icon: Volume2 });
  if (wavRequired) items.push({ key: 'wav', label: 'Wheelchair access', icon: Accessibility });
  if (hearingImpaired) items.push({ key: 'hearing', label: 'Hearing impaired', icon: Ear });

  if (items.length === 0) return null;

  return (
    <div className={className}>
      <p className="text-[11px] font-semibold text-muted-foreground mb-1.5">Preferences</p>
      <div className="space-y-1.5">
        {items.map((item) => (
          <div key={item.key} className="flex items-center gap-2">
            <item.icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <span className="text-[13px] font-medium text-foreground">{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
