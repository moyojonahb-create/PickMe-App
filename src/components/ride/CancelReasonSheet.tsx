import { useState } from 'react';
import { Check } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

const CANCEL_REASONS = [
  'Driver is taking too long',
  'I no longer need this ride',
  'Found another way to get there',
];

interface CancelReasonSheetProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason?: string) => void;
  cancelling?: boolean;
}

export default function CancelReasonSheet({ open, onClose, onConfirm, cancelling }: CancelReasonSheetProps) {
  const [reason, setReason] = useState<string | null>(null);

  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) { setReason(null); onClose(); } }}>
      <SheetContent side="bottom" className="rounded-t-3xl border-t border-border/40 p-4" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}>
        <SheetHeader className="mb-3">
          <SheetTitle>Why are you cancelling?</SheetTitle>
        </SheetHeader>

        <div className="space-y-2">
          {CANCEL_REASONS.map((option) => {
            const selected = reason === option;
            return (
              <button
                key={option}
                type="button"
                onClick={() => setReason(option)}
                className={cn(
                  'w-full flex items-center justify-between gap-2 px-4 py-3 rounded-2xl border text-left text-sm font-medium transition-colors',
                  selected ? 'border-primary bg-primary/5 text-foreground' : 'border-border text-foreground active:bg-muted/50'
                )}
              >
                {option}
                <span className={cn(
                  'w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0',
                  selected ? 'border-primary bg-primary' : 'border-border'
                )}>
                  {selected && <Check className="w-3 h-3 text-primary-foreground" />}
                </span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => onConfirm(reason ?? undefined)}
          disabled={!reason || cancelling}
          className="mt-4 w-full py-3 rounded-2xl bg-destructive text-destructive-foreground font-bold text-sm disabled:opacity-40"
        >
          {cancelling ? 'Cancelling…' : 'Cancel ride'}
        </button>
        <button
          type="button"
          onClick={() => onConfirm(undefined)}
          disabled={cancelling}
          className="mt-2 w-full py-2.5 rounded-2xl text-sm font-semibold text-muted-foreground disabled:opacity-40"
        >
          Skip & cancel
        </button>
      </SheetContent>
    </Sheet>
  );
}
