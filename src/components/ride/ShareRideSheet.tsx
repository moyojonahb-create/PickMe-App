import { type CSSProperties } from 'react';
import { Info, User, UserPlus, Users } from 'lucide-react';
import { haptic } from '@/lib/haptics';
import RideGlassPanel from './RideGlassPanel';
import { redCta, RIDE_RED, RIDE_RED_GRADIENT, RIDE_TEXT, RIDE_TEXT_2, RIDE_TEXT_3 } from './rideGlass';

// No real multi-passenger pooling/dispatch exists yet (see the report at the
// end of this session) — this is a stated policy ceiling a future matching
// window would respect, not a number derived from an actual detour
// calculation over other riders' routes. This sheet used to run a fake 40s
// "still matching" countdown here before the real driver search even
// started — a second, non-functional "finding drivers" screen stacked in
// front of the real one, which is what made the flow feel broken. It's a
// plain confirm now: tapping Share goes straight into the real search, same
// as every other tier.
const DETOUR_CEILING_MINUTES = 6;

function fmtUSD(n: number): string {
  return `$${n.toFixed(2)}`;
}

interface ShareRideSheetProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onRideAlone: () => void;
  submitting: boolean;
  shareFare: number;
  soloFare: number;
  dropoffTown: string;
  riderFirstName: string;
}

const panelStyle: CSSProperties = {
  background: 'rgba(255,255,255,.86)',
  backdropFilter: 'blur(28px) saturate(190%)',
  WebkitBackdropFilter: 'blur(28px) saturate(190%)',
  boxShadow: 'inset 0 0 0 .5px rgba(255,255,255,.6), 0 -8px 30px rgba(17,17,17,.06)',
};
const iconTileGlass: CSSProperties = {
  background: 'linear-gradient(135deg, rgba(255,250,205,.95), rgba(255,221,0,.24))',
  boxShadow: 'inset 0 0 0 .5px rgba(255,221,0,.55)',
};
const dealCardGlass: CSSProperties = {
  background: 'linear-gradient(135deg, rgba(255,250,205,.95), rgba(255,221,0,.2))',
  boxShadow: 'inset 0 .5px 0 rgba(255,255,255,.9), inset 0 0 0 .5px rgba(255,221,0,.5)',
};
const noteCardTint: CSSProperties = {
  background: 'linear-gradient(135deg, rgba(255,248,247,.9), rgba(184,17,4,.05))',
  boxShadow: 'inset 0 .5px 0 rgba(255,255,255,.9), inset 0 0 0 .5px rgba(184,17,4,.14)',
};
const chipGlass: CSSProperties = {
  background: 'linear-gradient(160deg, rgba(255,255,255,.8), rgba(255,255,255,.48))',
  boxShadow: 'inset 0 .75px 0 rgba(255,255,255,.98), inset 0 0 0 .5px rgba(17,17,17,.09)',
};

export default function ShareRideSheet({
  open, onClose, onConfirm, onRideAlone, submitting, shareFare, soloFare, dropoffTown, riderFirstName,
}: ShareRideSheetProps) {
  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-[60]" style={{ background: 'rgba(17,17,17,.28)' }} onClick={onClose} />
      <div className="fixed left-0 right-0 bottom-0 z-[70]" style={{ maxWidth: 480, margin: '0 auto', width: '100%' }}>
        <RideGlassPanel panelStyle={panelStyle} style={{ maxHeight: '90vh', paddingBottom: 'env(safe-area-inset-bottom)' }} onRibbonClick={onClose}>
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
            <div className="p-4" style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
              {/* Section 1 — header */}
              <div className="flex items-center" style={{ gap: 11 }}>
                <span className="shrink-0 flex items-center justify-center" style={{ width: 40, height: 40, borderRadius: 14, ...iconTileGlass }}>
                  <Users style={{ width: 19, height: 19, color: RIDE_TEXT }} />
                </span>
                <div className="min-w-0">
                  <p style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-.02em', lineHeight: 1.2, color: RIDE_TEXT }}>
                    Share this ride and save
                  </p>
                  <p style={{ marginTop: 3, fontSize: 12, fontWeight: 500, lineHeight: 1.2, color: RIDE_TEXT_2 }}>
                    Up to 2 more riders may join along the way
                  </p>
                </div>
              </div>

              {/* Section 2 — the deal card */}
              <div className="flex items-center justify-between" style={{ ...dealCardGlass, borderRadius: 16, padding: '11px 13px', gap: 12 }}>
                <div>
                  <p style={{ fontSize: 10.5, fontWeight: 700, color: RIDE_TEXT_2, textTransform: 'uppercase', letterSpacing: '.06em' }}>You save</p>
                  <div className="flex items-baseline" style={{ gap: 8 }}>
                    <span className="tabular-nums" style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-.03em', lineHeight: 1, color: RIDE_TEXT }}>{fmtUSD(shareFare)}</span>
                    <span className="tabular-nums" style={{ fontSize: 13, fontWeight: 600, color: RIDE_TEXT_2, textDecoration: 'line-through' }}>{fmtUSD(soloFare)}</span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="tabular-nums" style={{ fontSize: 13, fontWeight: 700, color: RIDE_TEXT }}>+{DETOUR_CEILING_MINUTES} min</p>
                  <p style={{ fontSize: 10.5, fontWeight: 500, color: RIDE_TEXT_2 }}>longest detour</p>
                </div>
              </div>

              {/* Section 3 — aboard list. Honest about what actually exists:
                  just the rider, plus an open seat — no invented co-passenger. */}
              <div className="flex flex-col" style={{ gap: 7 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: RIDE_TEXT_2, textTransform: 'uppercase', letterSpacing: '.12em' }}>Aboard</span>
                <div className="flex items-center" style={{ ...chipGlass, borderRadius: 16, padding: '10px 12px', gap: 11 }}>
                  <span className="shrink-0 flex items-center justify-center rounded-full" style={{ width: 34, height: 34, background: RIDE_RED_GRADIENT }}>
                    <User style={{ width: 17, height: 17, color: '#fff' }} strokeWidth={2.2} />
                  </span>
                  <div className="min-w-0" style={{ flex: 1 }}>
                    <p className="truncate" style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.2, color: RIDE_TEXT }}>{riderFirstName || 'You'}</p>
                    <p className="truncate" style={{ marginTop: 2, fontSize: 11.5, fontWeight: 500, lineHeight: 1.2, color: RIDE_TEXT_2 }}>Drop-off · {dropoffTown}</p>
                  </div>
                  <span className="shrink-0" style={{ padding: '3px 9px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: 'rgba(184,17,4,.1)', color: RIDE_RED }}>Your stop</span>
                </div>
                <div className="flex items-center" style={{ background: 'rgba(17,17,17,.03)', boxShadow: 'inset 0 0 0 .5px rgba(17,17,17,.07)', borderRadius: 16, padding: '10px 12px', gap: 11 }}>
                  <span className="shrink-0 flex items-center justify-center rounded-full" style={{ width: 34, height: 34, background: 'rgba(17,17,17,.06)' }}>
                    <UserPlus style={{ width: 16, height: 16, color: '#9AA1AD' }} strokeWidth={2} />
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 500, color: '#9AA1AD' }}>
                    Two seats open
                  </span>
                </div>
              </div>

              {/* Section 4 — fixed-fare note, the load-bearing promise */}
              <div className="flex items-start" style={{ ...noteCardTint, borderRadius: 16, padding: '10px 12px', gap: 9 }}>
                <Info style={{ width: 16, height: 16, color: RIDE_RED, marginTop: 1 }} strokeWidth={2} className="shrink-0" />
                <p style={{ fontSize: 12, fontWeight: 500, lineHeight: 1.4, color: RIDE_TEXT_3 }}>
                  Your {fmtUSD(shareFare)} is fixed. It doesn't change if nobody else joins, or if the driver picks up two.
                </p>
              </div>

              {/* Section 5 — action row */}
              <div className="flex items-center" style={{ gap: 12 }}>
                <button
                  type="button"
                  onClick={() => { haptic('light'); onRideAlone(); }}
                  className="shrink-0 flex items-center justify-center active:scale-[0.97] transition-transform"
                  style={{ width: 120, height: 48, borderRadius: 15, ...chipGlass }}
                >
                  <span style={{ fontSize: 14, fontWeight: 700, color: RIDE_TEXT }}>Ride alone</span>
                </button>
                <button
                  type="button"
                  onClick={() => { haptic('medium'); onConfirm(); }}
                  disabled={submitting}
                  className="flex items-center justify-center active:scale-[0.97] transition-transform disabled:opacity-70"
                  style={{ flex: 1, height: 48, borderRadius: 15, ...redCta }}
                >
                  <span style={{ fontSize: 15.5, fontWeight: 700 }}>
                    {submitting ? 'Finding a driver…' : `Share · ${fmtUSD(shareFare)}`}
                  </span>
                </button>
              </div>

              {/* Section 6 — iOS home indicator */}
              <div style={{ padding: '6px 0 10px' }} className="flex justify-center">
                <span className="rounded-full" style={{ width: 140, height: 5, background: RIDE_TEXT }} />
              </div>
            </div>
          </div>
        </RideGlassPanel>
      </div>
    </>
  );
}
