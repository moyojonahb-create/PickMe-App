import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Briefcase, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { updateRideFare } from '@/lib/backendClient';

interface FareAdjustment {
  id: string;
  ride_id: string;
  driver_id: string;
  old_price: number;
  new_price: number;
  reason: string | null;
  status: string;
}

interface FareAdjustmentModalProps {
  rideId: string;
  onAccepted?: (newFare: number) => void;
}

export default function FareAdjustmentModal({ rideId, onAccepted }: FareAdjustmentModalProps) {
  const [adjustment, setAdjustment] = useState<FareAdjustment | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!rideId) return;
    let mounted = true;

    // Fetch any pending adjustment on mount
    supabase
      .from('fare_adjustments')
      .select('*')
      .eq('ride_id', rideId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => { if (mounted && data) setAdjustment(data as FareAdjustment); });

    const ch = supabase
      .channel(`fare-adj-${rideId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'fare_adjustments',
        filter: `ride_id=eq.${rideId}`,
      }, (payload) => {
        const row = payload.new as FareAdjustment;
        if (row.status === 'pending') setAdjustment(row);
      })
      .subscribe();

    return () => { mounted = false; supabase.removeChannel(ch); };
  }, [rideId]);

  const respond = async (accept: boolean) => {
    if (!adjustment) return;
    setBusy(true);
    const { error: updErr } = await supabase
      .from('fare_adjustments')
      .update({ status: accept ? 'accepted' : 'declined' } as never)
      .eq('id', adjustment.id);

    if (!updErr && accept) {
      await updateRideFare(rideId, adjustment.new_price);
      onAccepted?.(adjustment.new_price);
      toast({ title: 'Fare updated', description: `New fare $${adjustment.new_price.toFixed(2)}` });
    } else if (!accept) {
      toast({ title: 'Adjustment declined' });
    }
    setBusy(false);
    setAdjustment(null);
  };

  return (
    <AnimatePresence>
      {adjustment && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 z-[90]"
          />
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
            className="fixed inset-0 z-[91] flex items-center justify-center p-4"
          >
            <div className="bg-background rounded-3xl max-w-sm w-full p-6 shadow-2xl">
              <div className="flex justify-center mb-3">
                <div className="w-14 h-14 rounded-full bg-yellow-400 flex items-center justify-center">
                  <Briefcase className="w-7 h-7 text-black" />
                </div>
              </div>
              <h3 className="text-center text-lg font-bold text-foreground mb-1">
                Driver adjusted fare
              </h3>
              <p className="text-center text-sm text-muted-foreground mb-4">
                due to luggage size
              </p>

              <div className="flex items-center justify-center gap-3 mb-2">
                <span className="text-xl text-muted-foreground line-through">${adjustment.old_price.toFixed(2)}</span>
                <span className="text-3xl font-bold text-yellow-500">${adjustment.new_price.toFixed(2)}</span>
              </div>

              {adjustment.reason && (
                <p className="text-center text-sm text-foreground bg-muted rounded-xl p-3 mb-4">
                  "{adjustment.reason}"
                </p>
              )}

              <div className="grid grid-cols-2 gap-2 mt-4">
                <Button variant="outline" onClick={() => respond(false)} disabled={busy}>
                  <X className="w-4 h-4 mr-1" /> Decline
                </Button>
                <Button onClick={() => respond(true)} disabled={busy} className="bg-yellow-400 hover:bg-yellow-300 text-black font-bold">
                  <Check className="w-4 h-4 mr-1" /> Accept
                </Button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
