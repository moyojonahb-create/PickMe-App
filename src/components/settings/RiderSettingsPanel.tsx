import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/hooks/useAuth';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent } from '@/components/ui/card';
import { Bell, BellOff, Megaphone, Navigation2 } from 'lucide-react';
import { toast } from 'sonner';
import { upsertUserSettings } from '@/lib/businessApi';

type UserSettings = {
  notifications_enabled: boolean;
  promo_notifications: boolean;
  ride_update_notifications: boolean;
};

const defaults: UserSettings = {
  notifications_enabled: true,
  promo_notifications: true,
  ride_update_notifications: true,
};

export default function RiderSettingsPanel() {
  const { user } = useAuth();
  const [settings, setSettings] = useState<UserSettings>(defaults);
  const [loaded, setLoaded] = useState(false);

  const fetchSettings = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('user_settings')
      .select('notifications_enabled, promo_notifications, ride_update_notifications')
      .eq('user_id', user.id)
      .maybeSingle();

    if (data) {
      setSettings(data as UserSettings);
    }
    setLoaded(true);
  }, [user]);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  const update = async (field: keyof UserSettings, value: boolean) => {
    if (!user) return;
    const next = { ...settings, [field]: value };
    setSettings(next);

    try {
      await upsertUserSettings(next);
    } catch {
      toast.error('Failed to save setting');
      setSettings(settings); // revert
    }
  };

  if (!loaded) return null;

  const items = [
    {
      key: 'notifications_enabled' as const,
      label: 'Push Notifications',
      desc: 'Receive ride updates and driver alerts',
      icon: settings.notifications_enabled ? Bell : BellOff,
    },
    {
      key: 'ride_update_notifications' as const,
      label: 'Ride Updates',
      desc: 'Driver accepted, arrived, trip started',
      icon: Navigation2,
    },
    {
      key: 'promo_notifications' as const,
      label: 'Promos & Offers',
      desc: 'Discounts and special offers from CruiXe',
      icon: Megaphone,
    },
  ];

  return (
    <Card>
      <CardContent className="pt-4 space-y-4">
        {items.map(({ key, label, desc, icon: Icon }) => (
          <div key={key} className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <Icon className="w-5 h-5 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{label}</p>
                <p className="text-xs text-muted-foreground">{desc}</p>
              </div>
            </div>
            <Switch
              checked={settings[key]}
              onCheckedChange={(v) => update(key, v)}
              disabled={key !== 'notifications_enabled' && !settings.notifications_enabled}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
