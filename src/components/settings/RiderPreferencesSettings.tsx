import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/hooks/useAuth';
import { Switch } from '@/components/ui/switch';
import { Volume2, Thermometer, Accessibility, Ear, ShieldCheck, Bell, Play } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { updateRiderPreferences } from '@/lib/businessApi';
import {
  ARRIVED_SOUND_OPTIONS,
  getArrivedSound,
  setArrivedSound,
  previewArrivedSound,
  type ArrivedSoundChoice,
} from '@/lib/arrivedSoundPrefs';

export type RiderPreferences = {
  quiet_ride: boolean;
  cool_temperature: boolean;
  wav_required: boolean;
  hearing_impaired: boolean;
  gender_preference: string;
  gender: string | null;
};

const defaults: RiderPreferences = {
  quiet_ride: false,
  cool_temperature: false,
  wav_required: false,
  hearing_impaired: false,
  gender_preference: 'any',
  gender: null,
};

export function useRiderPreferences() {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<RiderPreferences>(defaults);
  const [loaded, setLoaded] = useState(false);

  const fetch = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('profiles')
      .select('quiet_ride, cool_temperature, wav_required, hearing_impaired, gender_preference, gender')
      .eq('user_id', user.id)
      .maybeSingle();
    if (data) setPrefs(data as RiderPreferences);
    setLoaded(true);
  }, [user]);

  useEffect(() => { fetch(); }, [fetch]);

  return { prefs, loaded, refetch: fetch };
}

export default function RiderPreferencesSettings() {
  const { user } = useAuth();
  const { prefs, loaded } = useRiderPreferences();
  const [local, setLocal] = useState<RiderPreferences>(defaults);

  useEffect(() => { if (loaded) setLocal(prefs); }, [prefs, loaded]);

  // Auto-reset gender_preference if non-female rider has it set
  useEffect(() => {
    if (loaded && local.gender !== 'female' && local.gender_preference !== 'any') {
      update('gender_preference', 'any');
    }
  }, [loaded, local.gender]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = async (field: keyof RiderPreferences, value: boolean | string) => {
    if (!user) return;
    const next = { ...local, [field]: value };
    setLocal(next);
    try {
      await updateRiderPreferences({
        quiet_ride: next.quiet_ride,
        cool_temperature: next.cool_temperature,
        wav_required: next.wav_required,
        hearing_impaired: next.hearing_impaired,
        gender_preference: next.gender_preference,
      });
    } catch {
      toast.error('Failed to save preference');
      setLocal(local);
    }
  };

  if (!loaded) return null;

  const ITEMS = [
    { key: 'quiet_ride' as const, icon: Volume2, label: 'Quiet Ride', desc: 'I prefer to ride in silence', color: 'text-primary' },
    { key: 'cool_temperature' as const, icon: Thermometer, label: 'Cool Temperature', desc: 'Keep the AC on please', color: 'text-sky-500' },
    { key: 'wav_required' as const, icon: Accessibility, label: 'Wheelchair Accessible', desc: 'Only WAV vehicles', color: 'text-amber-500' },
    { key: 'hearing_impaired' as const, icon: Ear, label: 'Hearing Impaired', desc: 'Visual notifications only', color: 'text-purple-500' },
  ];

  const isWomenOnly = local.gender_preference === 'female';
  const isFemaleRider = local.gender === 'female';

  return (
    <div className="space-y-1.5">
      {ITEMS.map(({ key, icon: Icon, label, desc, color }) => (
        <div key={key} className="w-full flex items-center gap-3 px-4 py-3 glass-card rounded-2xl">
          <Icon className={cn('w-4 h-4', color)} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground">{label}</p>
            <p className="text-[10px] text-muted-foreground">{desc}</p>
          </div>
          <Switch
            checked={local[key]}
            onCheckedChange={(v) => update(key, v)}
          />
        </div>
      ))}
      {/* Gender preference — only visible to female riders */}
      {isFemaleRider && (
        <div className="w-full flex items-center gap-3 px-4 py-3 glass-card rounded-2xl">
          <ShieldCheck className="w-4 h-4 text-pink-500" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground">Women Only Drivers</p>
            <p className="text-[10px] text-muted-foreground">Only matched with female drivers for added safety</p>
          </div>
          <Switch
            checked={isWomenOnly}
            onCheckedChange={(v) => update('gender_preference', v ? 'female' : 'any')}
          />
        </div>
      )}

      {/* Arrived notification sound */}
      <ArrivedSoundPicker />
    </div>
  );
}

function ArrivedSoundPicker() {
  const [choice, setChoice] = useState<ArrivedSoundChoice>(getArrivedSound());

  const handleChange = (value: ArrivedSoundChoice) => {
    setChoice(value);
    setArrivedSound(value);
    toast.success(`Arrived sound: ${ARRIVED_SOUND_OPTIONS.find((o) => o.value === value)?.label}`);
  };

  return (
    <div className="w-full px-4 py-3 glass-card rounded-2xl space-y-3">
      <div className="flex items-center gap-3">
        <Bell className="w-4 h-4 text-primary" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">Driver Arrived Sound</p>
          <p className="text-[10px] text-muted-foreground">Plays when your driver reaches the pickup point</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {ARRIVED_SOUND_OPTIONS.map((opt) => {
          const active = opt.value === choice;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => handleChange(opt.value)}
              className={cn(
                'flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border text-left transition-all active:scale-[0.97] min-h-[52px]',
                active
                  ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                  : 'bg-background border-border text-foreground'
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold truncate">{opt.label}</p>
                <p className={cn('text-[10px] truncate', active ? 'opacity-80' : 'text-muted-foreground')}>
                  {opt.description}
                </p>
              </div>
            </button>
          );
        })}
      </div>
      {/* Test currently selected sound */}
      <button
        type="button"
        onClick={() => {
          if (choice === 'off') {
            toast.info('Sound is off — pick a sound to test');
            return;
          }
          previewArrivedSound(choice);
          toast.success(`Playing: ${ARRIVED_SOUND_OPTIONS.find((o) => o.value === choice)?.label}`);
        }}
        className="w-full inline-flex items-center justify-center gap-2 h-11 rounded-xl bg-blue-600 text-white text-sm font-bold active:scale-[0.98] transition shadow-sm"
      >
        <Play className="w-4 h-4" />
        Test sound
      </button>
    </div>
  );
}
