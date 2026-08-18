interface StickyRideActionsProps {
  onDecline: () => void;
  onAccept: () => void;
  acceptLabel?: string;
  acceptSubLabel?: string;
  submitting?: boolean;
}

export default function StickyRideActions({
  onDecline,
  onAccept,
  acceptLabel = 'Accept Request',
  acceptSubLabel,
  submitting,
}: StickyRideActionsProps) {
  return (
    <div
      className="sticky bottom-0 left-0 right-0 bg-background/95 backdrop-blur-xl border-t border-border/60 px-4 pt-3 flex items-center gap-3"
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}
    >
      <button
        type="button"
        onClick={onDecline}
        disabled={submitting}
        className="h-13 flex-1 rounded-2xl border-2 border-border text-foreground font-bold text-[14px] py-3.5 active:scale-[0.97] transition-transform disabled:opacity-50"
      >
        Decline
      </button>
      <button
        type="button"
        onClick={onAccept}
        disabled={submitting}
        className="flex-[1.4] rounded-2xl bg-primary text-primary-foreground py-3 active:scale-[0.97] transition-transform disabled:opacity-60 shadow-[0_4px_16px_hsl(4_96%_37%/0.35)]"
      >
        <span className="block font-bold text-[14px]">{submitting ? 'Sending…' : acceptLabel}</span>
        {acceptSubLabel && !submitting && (
          <span className="block text-[10px] font-medium text-primary-foreground/80 mt-0.5">{acceptSubLabel}</span>
        )}
      </button>
    </div>
  );
}
