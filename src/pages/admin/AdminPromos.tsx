import { useState, useEffect } from 'react';
import { Plus, Trash2, Edit2, Gift, Loader2, ToggleLeft, ToggleRight } from 'lucide-react';
import AdminLayout from '@/components/admin/AdminLayout';
import AdminGuard from '@/components/admin/AdminGuard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { adminCreatePromo, adminDeletePromo, adminUpdatePromo } from '@/lib/businessApi';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

interface PromoCode {
  id: string;
  code: string;
  discount_type: string;
  discount_value: number;
  max_uses: number | null;
  current_uses: number;
  min_fare: number | null;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
}

const defaultForm = {
  code: '',
  discount_type: 'percentage',
  discount_value: 10,
  max_uses: '',
  min_fare: '',
  expires_at: '',
};

const AdminPromos = () => {
  const [promos, setPromos] = useState<PromoCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(defaultForm);
  const [saving, setSaving] = useState(false);

  const loadPromos = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('promo_codes')
      .select('*')
      .order('created_at', { ascending: false });
    setPromos((data as PromoCode[]) || []);
    setLoading(false);
  };

  useEffect(() => { loadPromos(); }, []);

  const openCreate = () => {
    setEditingId(null);
    setForm(defaultForm);
    setDialogOpen(true);
  };

  const openEdit = (promo: PromoCode) => {
    setEditingId(promo.id);
    setForm({
      code: promo.code,
      discount_type: promo.discount_type,
      discount_value: promo.discount_value,
      max_uses: promo.max_uses?.toString() || '',
      min_fare: promo.min_fare?.toString() || '',
      expires_at: promo.expires_at ? promo.expires_at.substring(0, 16) : '',
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.code.trim()) { toast.error('Code is required'); return; }
    if (Number(form.discount_value) <= 0) { toast.error('Discount value must be positive'); return; }
    if (form.discount_type === 'percentage' && Number(form.discount_value) > 100) { toast.error('Percentage cannot exceed 100'); return; }
    setSaving(true);

    const payload = {
      code: form.code.toUpperCase().trim(),
      discount_type: form.discount_type,
      discount_value: Number(form.discount_value),
      max_uses: form.max_uses ? Number(form.max_uses) : null,
      min_fare: form.min_fare ? Number(form.min_fare) : null,
      expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : null,
    };

    if (editingId) {
      await adminUpdatePromo(editingId, payload);
      toast.success('Promo updated');
    } else {
      const userId = (await supabase.auth.getUser()).data.user?.id;
      await adminCreatePromo({ ...payload, created_by: userId });
      toast.success('Promo created');
    }

    setSaving(false);
    setDialogOpen(false);
    loadPromos();
  };

  const toggleActive = async (id: string, current: boolean) => {
    await adminUpdatePromo(id, { is_active: !current });
    setPromos(prev => prev.map(p => p.id === id ? { ...p, is_active: !current } : p));
  };

  const deletePromo = async (id: string) => {
    await adminDeletePromo(id);
    toast.success('Promo deleted');
    setPromos(prev => prev.filter(p => p.id !== id));
  };

  return (
    <AdminGuard>
      <AdminLayout>
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-black text-foreground">Promo Codes</h1>
              <p className="text-sm text-muted-foreground">Manage promotional discounts</p>
            </div>
            <Button onClick={openCreate} className="font-bold">
              <Plus className="w-4 h-4 mr-2" />
              New Promo
            </Button>
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : promos.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Gift className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <p className="font-bold text-foreground">No promo codes yet</p>
                <p className="text-sm text-muted-foreground mt-1">Create your first promotional code</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3">
              {promos.map((promo) => (
                <Card key={promo.id} className={cn(!promo.is_active && 'opacity-60')}>
                  <CardContent className="py-4">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-4 min-w-0">
                        <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                          <Gift className="w-5 h-5 text-primary" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-black text-foreground tracking-wider">{promo.code}</p>
                            <Badge variant="outline" className={cn(
                              'text-[10px]',
                              promo.is_active ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' : 'bg-muted text-muted-foreground'
                            )}>
                              {promo.is_active ? 'Active' : 'Inactive'}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {promo.discount_type === 'percentage' ? `${promo.discount_value}% off` : `$${promo.discount_value} off`}
                            {promo.min_fare ? ` · Min $${promo.min_fare}` : ''}
                            {promo.max_uses ? ` · ${promo.current_uses}/${promo.max_uses} used` : ` · ${promo.current_uses} used`}
                          </p>
                          {promo.expires_at && (
                            <p className="text-xs text-muted-foreground">
                              Expires {format(new Date(promo.expires_at), 'MMM d, yyyy')}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => toggleActive(promo.id, promo.is_active)}>
                          {promo.is_active ? <ToggleRight className="w-4 h-4 text-emerald-600" /> : <ToggleLeft className="w-4 h-4" />}
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(promo)}>
                          <Edit2 className="w-4 h-4" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => deletePromo(promo.id)}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Create/Edit Dialog */}
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>{editingId ? 'Edit Promo Code' : 'Create Promo Code'}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>Code</Label>
                  <Input
                    value={form.code}
                    onChange={(e) => setForm({ ...form, code: e.target.value })}
                    placeholder="e.g. WELCOME20"
                    className="font-mono uppercase"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Discount Type</Label>
                    <Select value={form.discount_type} onValueChange={(v) => setForm({ ...form, discount_type: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="percentage">Percentage</SelectItem>
                        <SelectItem value="fixed">Fixed Amount</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Value {form.discount_type === 'percentage' ? '(%)' : '($)'}</Label>
                    <Input
                      type="number"
                      value={form.discount_value}
                      onChange={(e) => setForm({ ...form, discount_value: Number(e.target.value) })}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Max Uses (optional)</Label>
                    <Input
                      type="number"
                      value={form.max_uses}
                      onChange={(e) => setForm({ ...form, max_uses: e.target.value })}
                      placeholder="Unlimited"
                    />
                  </div>
                  <div>
                    <Label>Min Fare (optional)</Label>
                    <Input
                      type="number"
                      value={form.min_fare}
                      onChange={(e) => setForm({ ...form, min_fare: e.target.value })}
                      placeholder="$0"
                    />
                  </div>
                </div>
                <div>
                  <Label>Expires At (optional)</Label>
                  <Input
                    type="datetime-local"
                    value={form.expires_at}
                    onChange={(e) => setForm({ ...form, expires_at: e.target.value })}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                <Button onClick={handleSave} disabled={saving} className="font-bold">
                  {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  {editingId ? 'Update' : 'Create'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </AdminLayout>
    </AdminGuard>
  );
};

export default AdminPromos;
