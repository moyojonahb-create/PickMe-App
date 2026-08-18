import { Minus, Plus } from 'lucide-react';

interface FareEditorProps {
  baseFare: number;
  value: number;
  onInc: () => void;
  onDec: () => void;
  fmtUSD: (n: number) => string;
}

/** Base-fare label + stepper, with a plain-language explanation of how the
 * driver's chosen fare compares to the base — matches the existing
 * $0.50-step / $0.50-min rule already enforced in DriverDashboard.tsx. */
export default function FareEditor({ baseFare, value, onInc, onDec, fmtUSD }: FareEditorProps) {
  const diffPct = baseFare > 0 ? Math.round(((value - baseFare) / baseFare) * 100) : 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[13px] font-bold text-foreground">Adjust Your Fare</p>
        <p className="text-[11px] text-muted-foreground">
          Base fare: <span className="font-semibold text-foreground">{fmtUSD(baseFare)}</span>
        </p>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3">
        <button
          type="button"
          onClick={onDec}
          aria-label="Decrease fare"
          className="w-9 h-9 rounded-full border border-border flex items-center justify-center text-foreground active:scale-90 transition-transform shrink-0"
        >
          <Minus className="w-4 h-4" />
        </button>
        <span className="text-xl font-black tabular-nums text-foreground">{fmtUSD(value)}</span>
        <button
          type="button"
          onClick={onInc}
          aria-label="Increase fare"
          className="w-9 h-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center active:scale-90 transition-transform shrink-0"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {diffPct !== 0 && (
        <div className="mt-2.5 rounded-xl px-3 py-2.5" style={{ background: '#FFE6E6' }}>
          <p className="text-[12px] text-foreground leading-snug">
            <span className="font-bold">Note:</span> Your fare is {Math.abs(diffPct)}% {diffPct > 0 ? 'higher' : 'lower'} than the base fare.
            Passenger will see the final price before confirming.
          </p>
        </div>
      )}
    </div>
  );
}
