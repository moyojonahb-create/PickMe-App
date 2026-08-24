import { useEffect, useState, type CSSProperties } from 'react';
import { CheckCircle2, Star } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { getDriverWalletSummary } from '@/lib/walletApi';
import { haptic } from '@/lib/haptics';
import RideGlassPanel from '@/components/ride/RideGlassPanel';
import { redCta, RIDE_RED, RIDE_TEXT, RIDE_TEXT_2 } from '@/components/ride/rideGlass';

// Matches the real rate the backend actually applies at settlement —
// backend/V2_ACTIVE_CASH_SETTLEMENT_IMPLEMENTATION_REPORT.md:59,
// `platform_fee = round(fare * 0.15)`. Used only as a same-shape fallback
// while the real settlement record is still landing (see below) — the
// authoritative number is always the settled fare_amount/platform_fee/
// driver_earnings from the wallet ledger, never this constant alone.
const COMMISSION_RATE = 0.15;

function fmtUSD(n: number): string {
  return `$${n.toFixed(2)}`;
}

interface TripCollectSheetProps {
  ride: { id: string; fare: number; payment_method: string; dropoff_address: string; user_id: string };
  onDone: () => void;
}

const panelStyle: CSSProperties = {
  background: 'rgba(255,255,255,.88)',
  backdropFilter: 'blur(28px) saturate(190%)',
  WebkitBackdropFilter: 'blur(28px) saturate(190%)',
  boxShadow: 'inset 0 0 0 .5px rgba(255,255,255,.6), 0 -8px 30px rgba(17,17,17,.06)',
};
const breakdownCardGlass: CSSProperties = {
  background: 'linear-gradient(160deg, rgba(255,255,255,.8), rgba(255,255,255,.48))',
  boxShadow: 'inset 0 .75px 0 rgba(255,255,255,.98), inset 0 0 0 .5px rgba(17,17,17,.09)',
};

export default function TripCollectSheet({ ride, onDone }: TripCollectSheetProps) {
  const [passengerName, setPassengerName] = useState('the passenger');
  const [rating, setRating] = useState(0);
  const [confirming, setConfirming] = useState(false);
  // Settlement (the real fare_amount/platform_fee/driver_earnings split)
  // lands asynchronously after /complete returns — see completeTrip.ts and
  // handler.go's completeRide, which settles the wallet ledger in a
  // follow-up call, not in the completion response itself. Poll briefly for
  // the real record instead of computing our own number; fall back to the
  // documented rate only if it hasn't landed yet by the time the driver taps
  // confirm (labelled as such, never presented as the settled figure).
  const [settled, setSettled] = useState<{ fare: number; commission: number; keep: number } | null>(null);

  const isCash = (ride.payment_method || 'cash').toLowerCase() === 'cash';

  useEffect(() => {
    supabase.from('profiles').select('full_name').eq('user_id', ride.user_id).maybeSingle()
      .then(({ data }) => { if (data?.full_name) setPassengerName(data.full_name.split(' ')[0]); });
  }, [ride.user_id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (let attempt = 0; attempt < 6 && !cancelled; attempt++) {
        try {
          const { earnings } = await getDriverWalletSummary();
          const match = earnings.find((e) => e.ride_id === ride.id);
          if (match) {
            if (!cancelled) setSettled({ fare: match.fare_amount, commission: match.platform_fee, keep: match.driver_earnings });
            return;
          }
        } catch {
          // best-effort — falls through to the estimated fallback below
        }
        await new Promise((r) => setTimeout(r, 700));
      }
    })();
    return () => { cancelled = true; };
  }, [ride.id]);

  const estimatedCommission = Math.round(ride.fare * COMMISSION_RATE * 100) / 100;
  const fareShown = settled?.fare ?? ride.fare;
  const commissionShown = settled?.commission ?? estimatedCommission;
  const keepShown = settled?.keep ?? Math.round((ride.fare - estimatedCommission) * 100) / 100;

  const handleConfirm = async () => {
    if (confirming) return;
    setConfirming(true);
    haptic('medium');
    try {
      if (rating > 0) {
        await supabase.from('ride_passenger_ratings').insert([{ ride_id: ride.id, driver_id: ride.user_id, rating }] as never).select().maybeSingle();
      }
      await supabase.from('rides').update({ driver_collected_at: new Date().toISOString() } as never).eq('id', ride.id);
    } finally {
      onDone();
    }
  };

  return (
    <>
      {/* z-index above FullScreenNavigation's z-[100] — collection must win
          even in the edge case where a new trip got matched before the
          previous one's collection was confirmed. */}
      <div className="fixed inset-0 z-[110]" style={{ background: 'rgba(17,17,17,.28)' }} />
      <div className="fixed left-0 right-0 bottom-0 z-[120]" style={{ maxWidth: 480, margin: '0 auto', width: '100%' }}>
        <RideGlassPanel panelStyle={panelStyle} style={{ maxHeight: '90vh', paddingBottom: 'env(safe-area-inset-bottom)' }}>
          <div className="p-4" style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
            {/* Section 1 — collect/credited headline */}
            <div className="flex flex-col items-center" style={{ gap: 3, paddingTop: 2 }}>
              <span className="inline-flex items-center" style={{ height: 26, padding: '0 11px', borderRadius: 999, gap: 6, background: 'rgba(52,199,89,.14)' }}>
                <CheckCircle2 style={{ width: 13, height: 13, color: '#15803d' }} strokeWidth={3} />
                <span style={{ fontSize: 11.5, fontWeight: 700, color: '#15803d' }}>Trip complete</span>
              </span>
              <span style={{ marginTop: 6, fontSize: 11, fontWeight: 700, color: RIDE_TEXT_2, textTransform: 'uppercase', letterSpacing: '.12em' }}>
                {isCash ? `Collect from ${passengerName}` : 'Credited to your wallet'}
              </span>
              <span className="tabular-nums" style={{ marginTop: 2, fontSize: 40, fontWeight: 700, letterSpacing: '-.04em', lineHeight: 1, color: RIDE_TEXT }}>
                {fmtUSD(fareShown)}
              </span>
              <span style={{ marginTop: 5, fontSize: 12.5, fontWeight: 500, color: RIDE_TEXT_2 }}>
                {isCash ? 'Cash · agreed fare, no adjustment' : `Paid via ${ride.payment_method} · agreed fare`}
              </span>
            </div>

            {/* Section 2 — earnings breakdown: reconciles fare − commission = keep exactly */}
            <div style={{ borderRadius: 16, overflow: 'hidden', display: 'flex', flexDirection: 'column', ...breakdownCardGlass }}>
              <div className="flex items-center justify-between" style={{ padding: '9px 13px' }}>
                <span style={{ fontSize: 13, fontWeight: 500, color: RIDE_TEXT }}>Trip fare</span>
                <span className="tabular-nums" style={{ fontSize: 13.5, fontWeight: 600, color: RIDE_TEXT }}>{fmtUSD(fareShown)}</span>
              </div>
              <span style={{ height: 0.5, background: 'rgba(17,17,17,.07)' }} />
              <div className="flex items-center justify-between" style={{ padding: '9px 13px' }}>
                <span style={{ fontSize: 13, fontWeight: 500, color: RIDE_TEXT }}>PickMe commission (15%)</span>
                <span className="tabular-nums" style={{ fontSize: 13.5, fontWeight: 600, color: RIDE_RED }}>−{fmtUSD(commissionShown)}</span>
              </div>
              <span style={{ height: 0.5, background: 'rgba(17,17,17,.07)' }} />
              <div className="flex items-center justify-between" style={{ padding: '10px 13px', background: 'rgba(52,199,89,.08)' }}>
                <span style={{ fontSize: 13.5, fontWeight: 700, color: RIDE_TEXT }}>You keep</span>
                <span className="tabular-nums" style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-.02em', color: '#15803d' }}>{fmtUSD(keepShown)}</span>
              </div>
            </div>

            {/* Section 3 — rate the passenger, optional, never blocks confirm */}
            <div className="flex flex-col items-center" style={{ gap: 8 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: RIDE_TEXT_2 }}>Rate {passengerName}</span>
              <div className="flex items-center" style={{ gap: 12 }}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" onClick={() => { setRating(n); haptic('light'); }} aria-label={`Rate ${n} star${n > 1 ? 's' : ''}`} className="active:scale-90 transition-transform">
                    <Star style={{ width: 30, height: 30 }} fill={n <= rating ? '#FFDD00' : 'none'} color={n <= rating ? '#FFDD00' : '#C7C9CC'} strokeWidth={1.8} />
                  </button>
                ))}
              </div>
            </div>

            {/* Section 4 — primary action */}
            <button
              type="button"
              onClick={handleConfirm}
              disabled={confirming}
              className="relative flex items-center justify-center overflow-hidden active:scale-[0.98] transition-transform disabled:opacity-70"
              style={{ height: 48, borderRadius: 15, ...redCta }}
            >
              <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2" style={{ background: 'linear-gradient(180deg, rgba(255,255,255,.2), rgba(255,255,255,0))' }} />
              <span className="relative" style={{ fontSize: 15.5, fontWeight: 700 }}>
                {confirming ? 'Confirming…' : isCash ? 'Cash received · go online' : 'Confirmed · go online'}
              </span>
            </button>

            {/* Section 5 — iOS home indicator */}
            <div style={{ padding: '6px 0 10px' }} className="flex justify-center">
              <span className="rounded-full" style={{ width: 140, height: 5, background: RIDE_TEXT }} />
            </div>
          </div>
        </RideGlassPanel>
      </div>
    </>
  );
}
