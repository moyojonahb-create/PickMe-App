import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Briefcase, DollarSign, Check, Ban, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { getLuggageSignedUrls } from '@/lib/luggageStorage';
import { toast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';

interface LuggageData {
  description: string | null;
  estimated_weight: string | null;
  item_count: number | null;
  image_paths: string[];
}

interface LuggagePreviewSheetProps {
  open: boolean;
  onClose: () => void;
  rideId: string;
  currentFare: number;
  onAccepted?: () => void;
  onDeclined?: () => void;
}

export default function LuggagePreviewSheet({
  open, onClose, rideId, currentFare, onAccepted, onDeclined,
}: LuggagePreviewSheetProps) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<LuggageData | null>(null);
  const [urls, setUrls] = useState<string[]>([]);
  const [zoomUrl, setZoomUrl] = useState<string | null>(null);
  const [mode, setMode] = useState<'view' | 'adjust'>('view');
  const [newPrice, setNewPrice] = useState(String(currentFare));
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setMode('view');
    setNewPrice(String(currentFare));
    setReason('');
    (async () => {
      const { data: row } = await supabase
        .from('luggage_requests')
        .select('description, estimated_weight, item_count, image_paths')
        .eq('ride_id', rideId)
        .maybeSingle();
      if (row) {
        setData(row as LuggageData);
        try {
          const signed = await getLuggageSignedUrls(row.image_paths || []);
          setUrls(signed);
        } catch { setUrls([]); }
      } else {
        setData(null);
      }
      setLoading(false);
    })();
  }, [open, rideId, currentFare]);

  const submitAdjustment = async () => {
    if (!user) return;
    const np = parseFloat(newPrice);
    if (!Number.isFinite(np) || np <= 0) {
      toast({ title: 'Invalid price', variant: 'destructive' });
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.from('fare_adjustments').insert({
      ride_id: rideId,
      driver_id: user.id,
      old_price: currentFare,
      new_price: Math.round(np * 2) / 2,
      reason: reason.trim() || null,
      status: 'pending',
    } as never);
    setSubmitting(false);
    if (error) {
      toast({ title: 'Failed', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Fare adjustment sent', description: 'Waiting for rider…' });
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 z-[80]"
            onClick={onClose}
          />
          <motion.div
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed bottom-0 inset-x-0 z-[81] bg-background rounded-t-3xl max-h-[90vh] flex flex-col"
          >
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-12 h-1.5 rounded-full bg-muted-foreground/30" />
            </div>
            <div className="flex items-center justify-between px-5 pb-3 border-b border-border">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-full bg-yellow-400 flex items-center justify-center">
                  <Briefcase className="w-5 h-5 text-black" />
                </div>
                <h2 className="text-lg font-bold">Luggage Details</h2>
              </div>
              <button onClick={onClose} className="p-2 rounded-full hover:bg-muted">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : !data ? (
                <p className="text-center text-muted-foreground py-12">No luggage details</p>
              ) : mode === 'view' ? (
                <>
                  {data.description && (
                    <div>
                      <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Description</p>
                      <p className="text-sm text-foreground">{data.description}</p>
                    </div>
                  )}
                  <div className="flex gap-2">
                    {data.estimated_weight && (
                      <div className="flex-1 bg-yellow-400/10 border border-yellow-400/30 rounded-xl p-3">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Size</p>
                        <p className="text-sm font-bold capitalize">{data.estimated_weight}</p>
                      </div>
                    )}
                    <div className="flex-1 bg-yellow-400/10 border border-yellow-400/30 rounded-xl p-3">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Items</p>
                      <p className="text-sm font-bold">{data.item_count || 1}</p>
                    </div>
                  </div>
                  {urls.length > 0 && (
                    <div>
                      <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Photos ({urls.length})</p>
                      <div className="grid grid-cols-3 gap-2">
                        {urls.map((u, i) => (
                          <button
                            key={i}
                            onClick={() => setZoomUrl(u)}
                            className="aspect-square rounded-xl overflow-hidden bg-muted"
                          >
                            <img src={u} alt="" className="w-full h-full object-cover" />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div>
                    <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Current fare</p>
                    <p className="text-2xl font-bold">${currentFare.toFixed(2)}</p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold">New fare (USD)</label>
                    <div className="relative">
                      <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        type="number" step="0.50" min="0.50"
                        value={newPrice} onChange={e => setNewPrice(e.target.value)}
                        className="pl-9 text-lg font-bold h-12"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold">Reason (optional)</label>
                    <Textarea
                      value={reason} onChange={e => setReason(e.target.value)}
                      placeholder="Large fridge and 4 bags need bigger vehicle"
                      maxLength={200} className="min-h-[70px] resize-none"
                    />
                  </div>
                </>
              )}
            </div>

            <div className="p-4 border-t border-border space-y-2 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
              {mode === 'view' ? (
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" onClick={() => { onDeclined?.(); onClose(); }}>
                    <Ban className="w-4 h-4 mr-2" /> Decline
                  </Button>
                  <Button onClick={() => setMode('adjust')} className="bg-yellow-400 hover:bg-yellow-300 text-black font-bold">
                    Adjust Fare
                  </Button>
                  <Button onClick={() => { onAccepted?.(); onClose(); }} className="col-span-2">
                    <Check className="w-4 h-4 mr-2" /> Accept ${currentFare.toFixed(2)}
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" onClick={() => setMode('view')}>Back</Button>
                  <Button onClick={submitAdjustment} disabled={submitting} className="bg-yellow-400 hover:bg-yellow-300 text-black font-bold">
                    {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Send to Rider'}
                  </Button>
                </div>
              )}
            </div>
          </motion.div>

          {zoomUrl && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="fixed inset-0 bg-black z-[90] flex items-center justify-center"
              onClick={() => setZoomUrl(null)}
            >
              <img src={zoomUrl} alt="" className="max-w-full max-h-full object-contain" />
              <button onClick={() => setZoomUrl(null)} className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
                <X className="w-5 h-5 text-white" />
              </button>
            </motion.div>
          )}
        </>
      )}
    </AnimatePresence>
  );
}
