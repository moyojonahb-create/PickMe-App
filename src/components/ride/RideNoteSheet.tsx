import { useEffect, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { redCta, RIDE_TEXT_2 } from './rideGlass';

interface RideNoteSheetProps {
  open: boolean;
  initial?: string;
  saving?: boolean;
  onClose: () => void;
  onSave: (note: string) => void;
}

/** Short note for the driver ("gate 3", "call on arrival") attached while the
 * request is still searching. */
export default function RideNoteSheet({ open, initial = '', saving, onClose, onSave }: RideNoteSheetProps) {
  const [value, setValue] = useState(initial);

  useEffect(() => {
    if (open) setValue(initial);
  }, [open, initial]);

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent
        side="bottom"
        className="rounded-t-3xl border-t border-border/40 p-4"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}
      >
        <SheetHeader className="mb-3">
          <SheetTitle>Note for the driver</SheetTitle>
        </SheetHeader>
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value.slice(0, 140))}
          rows={3}
          placeholder="e.g. I'm at the blue gate, please call on arrival"
          className="w-full resize-none rounded-2xl border border-border bg-background px-3.5 py-3 text-[14px] outline-none focus:border-primary"
        />
        <p className="mt-1 text-right text-[11px]" style={{ color: RIDE_TEXT_2 }}>
          {value.length}/140
        </p>
        <button
          type="button"
          onClick={() => onSave(value.trim())}
          disabled={saving}
          className="mt-2 w-full h-12 rounded-2xl text-[15px] font-bold active:scale-[0.98] transition-transform disabled:opacity-60"
          style={redCta}
        >
          {saving ? 'Saving…' : 'Send to drivers'}
        </button>
      </SheetContent>
    </Sheet>
  );
}
