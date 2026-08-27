import { useState, useEffect } from 'react';
import { Save, Bell, Shield, Loader2, DollarSign } from 'lucide-react';
import AdminLayout from '@/components/admin/AdminLayout';
import AdminGuard from '@/components/admin/AdminGuard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { usePricingSettings, useUpdatePricingSettings } from '@/hooks/usePricingSettings';
import { Skeleton } from '@/components/ui/skeleton';

const AdminSettings = () => {
  const { data: pricingSettings, isLoading: pricingLoading } = usePricingSettings();
  const updatePricing = useUpdatePricingSettings();
  
  const [settings, setSettings] = useState({
    emailNotifications: true,
    pushNotifications: true,
    autoApproveDrivers: false,
    requireAllDocuments: true,
  });

  const [pricing, setPricing] = useState({
    base_fare: 20,
    per_km_rate: 10,
    min_fare: 25,
    max_town_fare: 50,
    fixed_town_fare: 50,
    town_radius_km: 5,
    peak_multiplier: 1.2,
    night_multiplier: 1.3,
  });

  // Sync pricing state with fetched data
  useEffect(() => {
    if (pricingSettings) {
      setPricing({
        base_fare: pricingSettings.base_fare,
        per_km_rate: pricingSettings.per_km_rate,
        min_fare: pricingSettings.min_fare,
        max_town_fare: pricingSettings.max_town_fare,
        fixed_town_fare: pricingSettings.fixed_town_fare,
        town_radius_km: pricingSettings.town_radius_km,
        peak_multiplier: pricingSettings.peak_multiplier,
        night_multiplier: pricingSettings.night_multiplier,
      });
    }
  }, [pricingSettings]);

  const handleSave = async () => {
    await updatePricing.mutateAsync(pricing);
  };

  return (
    <AdminGuard>
      <AdminLayout>
        <div className="max-w-2xl space-y-6">
          {/* Header */}
          <div>
            <h1 className="text-2xl font-bold text-foreground">Settings</h1>
            <p className="text-muted-foreground">Configure admin dashboard preferences</p>
          </div>

          {/* Notifications */}
          <div className="bg-card rounded-xl border border-border p-6 space-y-4">
            <div className="flex items-center gap-3">
              <Bell className="w-5 h-5 text-muted-foreground" />
              <h2 className="font-semibold">Notifications</h2>
            </div>
            <Separator />
            
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Email Notifications</p>
                <p className="text-sm text-muted-foreground">
                  Receive email alerts for important events
                </p>
              </div>
              <Switch
                checked={settings.emailNotifications}
                onCheckedChange={(checked) => 
                  setSettings({ ...settings, emailNotifications: checked })
                }
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Push Notifications</p>
                <p className="text-sm text-muted-foreground">
                  Browser push notifications for real-time alerts
                </p>
              </div>
              <Switch
                checked={settings.pushNotifications}
                onCheckedChange={(checked) => 
                  setSettings({ ...settings, pushNotifications: checked })
                }
              />
            </div>
          </div>

          {/* Driver Verification */}
          <div className="bg-card rounded-xl border border-border p-6 space-y-4">
            <div className="flex items-center gap-3">
              <Shield className="w-5 h-5 text-muted-foreground" />
              <h2 className="font-semibold">Driver Verification</h2>
            </div>
            <Separator />
            
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Auto-Approve Drivers</p>
                <p className="text-sm text-muted-foreground">
                  Automatically approve drivers when all documents are verified
                </p>
              </div>
              <Switch
                checked={settings.autoApproveDrivers}
                onCheckedChange={(checked) => 
                  setSettings({ ...settings, autoApproveDrivers: checked })
                }
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Require All Documents</p>
                <p className="text-sm text-muted-foreground">
                  Drivers must upload all required documents before approval
                </p>
              </div>
              <Switch
                checked={settings.requireAllDocuments}
                onCheckedChange={(checked) => 
                  setSettings({ ...settings, requireAllDocuments: checked })
                }
              />
            </div>
          </div>

          {/* Pricing */}
          <div className="bg-card rounded-xl border border-border p-6 space-y-4">
            <div className="flex items-center gap-3">
              <DollarSign className="w-5 h-5 text-muted-foreground" />
              <h2 className="font-semibold">CruiXe Pricing (USD)</h2>
            </div>
            <Separator />
            
            {pricingLoading ? (
              <div className="grid sm:grid-cols-2 gap-4">
                {[...Array(5)].map((_, i) => (
                  <div key={i}>
                    <Skeleton className="h-4 w-20 mb-2" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <Label>Base Fare</Label>
                  <Input
                    type="number"
                    value={pricing.base_fare}
                    onChange={(e) => 
                      setPricing({ ...pricing, base_fare: Number(e.target.value) })
                    }
                  />
                </div>
                <div>
                  <Label>Per KM Rate</Label>
                  <Input
                    type="number"
                    value={pricing.per_km_rate}
                    onChange={(e) => 
                      setPricing({ ...pricing, per_km_rate: Number(e.target.value) })
                    }
                  />
                </div>
                <div>
                  <Label>Minimum Fare</Label>
                  <Input
                    type="number"
                    value={pricing.min_fare}
                    onChange={(e) => 
                      setPricing({ ...pricing, min_fare: Number(e.target.value) })
                    }
                  />
                </div>
                <div>
                  <Label>Max Town Fare</Label>
                  <Input
                    type="number"
                    value={pricing.max_town_fare}
                    onChange={(e) => 
                      setPricing({ ...pricing, max_town_fare: Number(e.target.value) })
                    }
                  />
                </div>
                <div>
                  <Label>Fixed Fare (outside {pricing.town_radius_km}km)</Label>
                  <Input
                    type="number"
                    value={pricing.fixed_town_fare}
                    onChange={(e) => 
                      setPricing({ ...pricing, fixed_town_fare: Number(e.target.value) })
                    }
                  />
                </div>
                <div>
                  <Label>Town Radius (km)</Label>
                  <Input
                    type="number"
                    value={pricing.town_radius_km}
                    onChange={(e) => 
                      setPricing({ ...pricing, town_radius_km: Number(e.target.value) })
                    }
                  />
                </div>
              </div>
            )}

            <Separator />
            <p className="text-sm font-medium text-muted-foreground">Time Multipliers</p>
            
            {pricingLoading ? (
              <div className="grid sm:grid-cols-2 gap-4">
                {[...Array(2)].map((_, i) => (
                  <div key={i}>
                    <Skeleton className="h-4 w-32 mb-2" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <Label>Peak Hours (06:30-09:00, 16:00-18:30)</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={pricing.peak_multiplier}
                    onChange={(e) => 
                      setPricing({ ...pricing, peak_multiplier: Number(e.target.value) })
                    }
                  />
                </div>
                <div>
                  <Label>Night Hours (19:00-05:59)</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={pricing.night_multiplier}
                    onChange={(e) => 
                      setPricing({ ...pricing, night_multiplier: Number(e.target.value) })
                    }
                  />
                </div>
              </div>
            )}
          </div>

          {/* Save Button */}
          <Button 
            onClick={handleSave} 
            disabled={updatePricing.isPending || pricingLoading} 
            className="w-full sm:w-auto"
          >
            {updatePricing.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Save className="w-4 h-4 mr-2" />
            )}
            Save Settings
          </Button>
        </div>
      </AdminLayout>
    </AdminGuard>
  );
};

export default AdminSettings;
