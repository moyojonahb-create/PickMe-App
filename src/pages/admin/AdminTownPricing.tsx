import { useState, useEffect } from 'react';
import { Save, Loader2, Plus, DollarSign, MapPin } from 'lucide-react';
import AdminLayout from '@/components/admin/AdminLayout';
import AdminGuard from '@/components/admin/AdminGuard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { adminUpdateTownPricing } from '@/lib/businessApi';
import { toast } from 'sonner';
import type { TownPricingConfig } from '@/hooks/useTownPricing';

const AdminTownPricing = () => {
  const [towns, setTowns] = useState<TownPricingConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [editState, setEditState] = useState<Record<string, Partial<TownPricingConfig>>>({});

  useEffect(() => {
    fetchTowns();
  }, []);

  const fetchTowns = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('town_pricing')
      .select('*')
      .order('town_name');
    if (error) {
      toast.error('Failed to load town pricing');
    } else {
      setTowns((data as unknown as TownPricingConfig[]) || []);
    }
    setLoading(false);
  };

  const getEdit = (town: TownPricingConfig) => ({
    ...town,
    ...(editState[town.id] || {}),
  });

  const updateField = (townId: string, field: keyof TownPricingConfig, value: number | string | boolean) => {
    setEditState((prev) => ({
      ...prev,
      [townId]: { ...(prev[townId] || {}), [field]: value },
    }));
  };

  const handleSave = async (town: TownPricingConfig) => {
    const changes = editState[town.id];
    if (!changes || Object.keys(changes).length === 0) {
      toast.info('No changes to save');
      return;
    }
    setSaving(town.id);
    try {
      await adminUpdateTownPricing(town.id, changes as Record<string, unknown>);
      toast.success(`${town.town_name} pricing updated`);
      setEditState((prev) => {
        const next = { ...prev };
        delete next[town.id];
        return next;
      });
      await fetchTowns();
    } catch {
      toast.error(`Failed to save ${town.town_name}`);
    }
    setSaving(null);
  };

  const numField = (town: TownPricingConfig, field: keyof TownPricingConfig, label: string, step = '0.01') => {
    const edited = getEdit(town);
    return (
      <div>
        <Label className="text-xs text-muted-foreground">{label}</Label>
        <Input
          type="number"
          step={step}
          value={edited[field] as number}
          onChange={(e) => updateField(town.id, field, Number(e.target.value))}
          className="mt-1"
        />
      </div>
    );
  };

  return (
    <AdminGuard>
      <AdminLayout>
        <div className="space-y-6 max-w-5xl">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
                <MapPin className="h-6 w-6 text-primary" />
                Town Pricing
              </h1>
              <p className="text-muted-foreground text-sm">
                Manage per-town fare configurations and currency settings
              </p>
            </div>
          </div>

          {loading ? (
            <div className="grid gap-4">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-48 w-full rounded-xl" />
              ))}
            </div>
          ) : towns.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                No town pricing configs found. Seed the town_pricing table to get started.
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {towns.map((town) => {
                const edited = getEdit(town);
                const hasChanges = !!editState[town.id] && Object.keys(editState[town.id]).length > 0;

                return (
                  <Card key={town.id} className="border-border">
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-lg flex items-center gap-2">
                          {town.town_name}
                          <Badge variant="outline" className="text-xs font-mono">
                            {edited.currency_code} ({edited.currency_symbol})
                          </Badge>
                        </CardTitle>
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-2 text-sm">
                            <span className="text-muted-foreground">Negotiation</span>
                            <Switch
                              checked={edited.is_negotiation_enabled}
                              onCheckedChange={(v) => updateField(town.id, 'is_negotiation_enabled', v)}
                            />
                          </div>
                          <Button
                            size="sm"
                            disabled={!hasChanges || saving === town.id}
                            onClick={() => handleSave(town)}
                          >
                            {saving === town.id ? (
                              <Loader2 className="h-4 w-4 animate-spin mr-1" />
                            ) : (
                              <Save className="h-4 w-4 mr-1" />
                            )}
                            Save
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                        {numField(town, 'base_fare', 'Base Fare')}
                        {numField(town, 'per_km_rate', 'Per KM Rate')}
                        {numField(town, 'minimum_fare', 'Minimum Fare')}
                        {numField(town, 'short_trip_fare', 'Short Trip Fare')}
                        {numField(town, 'short_trip_km', 'Short Trip KM', '0.5')}
                        {numField(town, 'offer_floor', 'Offer Floor')}
                        {numField(town, 'offer_ceiling', 'Offer Ceiling')}
                        {numField(town, 'night_multiplier', 'Night Multiplier', '0.1')}
                        {numField(town, 'demand_multiplier', 'Demand Multiplier', '0.1')}
                      </div>
                      <Separator className="my-3" />
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        <div>
                          <Label className="text-xs text-muted-foreground">Currency Code</Label>
                          <Input
                            value={edited.currency_code}
                            onChange={(e) => updateField(town.id, 'currency_code', e.target.value.toUpperCase())}
                            className="mt-1 font-mono"
                            maxLength={3}
                          />
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">Currency Symbol</Label>
                          <Input
                            value={edited.currency_symbol}
                            onChange={(e) => updateField(town.id, 'currency_symbol', e.target.value)}
                            className="mt-1 font-mono"
                            maxLength={3}
                          />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </AdminLayout>
    </AdminGuard>
  );
};

export default AdminTownPricing;
