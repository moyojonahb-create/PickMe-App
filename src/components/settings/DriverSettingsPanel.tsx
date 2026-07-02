import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MapPin, BellRing, Phone } from 'lucide-react';
import { toast } from 'sonner';
import { updateMyDriver } from '@/lib/businessApi';

type DriverSettings = {
  preferred_service_area: string;
  earning_notifications: boolean;
};

interface Props {
  driverId: string;
  initialArea?: string;
  initialEarningNotif?: boolean;
  initialEcocash?: string;
}

export default function DriverSettingsPanel({ driverId, initialArea = 'both', initialEarningNotif = true, initialEcocash = '' }: Props) {
  const { user } = useAuth();
  const [area, setArea] = useState(initialArea);
  const [earningNotif, setEarningNotif] = useState(initialEarningNotif);
  const [ecocash, setEcocash] = useState(initialEcocash);

  const updateField = async (field: string, value: unknown) => {
    if (!user) return;
    try {
      await updateMyDriver({ [field]: value });
    } catch {
      toast.error('Failed to save setting');
    }
  };

  const handleAreaChange = (val: string) => {
    setArea(val);
    updateField('preferred_service_area', val);
  };

  const handleEarningNotif = (val: boolean) => {
    setEarningNotif(val);
    updateField('earning_notifications', val);
  };

  return (
    <Card>
      <CardContent className="pt-4 space-y-5">
        {/* Preferred service area */}
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <MapPin className="w-5 h-5 text-muted-foreground shrink-0" />
            <div>
              <p className="text-sm font-medium text-foreground">Service Area</p>
              <p className="text-xs text-muted-foreground">Where you want to receive ride requests</p>
            </div>
          </div>
          <Select value={area} onValueChange={handleAreaChange}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="both">Gwanda & Beitbridge</SelectItem>
              <SelectItem value="gwanda">Gwanda only</SelectItem>
              <SelectItem value="beitbridge">Beitbridge only</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Earning notifications */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <BellRing className="w-5 h-5 text-muted-foreground shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">Earning Notifications</p>
              <p className="text-xs text-muted-foreground">Get notified after each trip with earnings summary</p>
            </div>
          </div>
          <Switch checked={earningNotif} onCheckedChange={handleEarningNotif} />
        </div>

        {/* EcoCash Number */}
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <Phone className="w-5 h-5 text-muted-foreground shrink-0" />
            <div>
              <p className="text-sm font-medium text-foreground">EcoCash Number</p>
              <p className="text-xs text-muted-foreground">Riders can pay you directly to this number</p>
            </div>
          </div>
          <Input
            value={ecocash}
            onChange={(e) => setEcocash(e.target.value)}
            onBlur={() => updateField('ecocash_number', ecocash.trim() || null)}
            placeholder="e.g. 0771234567"
          />
        </div>
      </CardContent>
    </Card>
  );
}
