interface RouteIndicatorProps {
  pickupLabel?: string;
  dropoffLabel?: string;
  pickupAddress: string;
  dropoffAddress: string;
  className?: string;
}

/** Pickup/drop-off pair with the thin connecting line — the shared route
 * visualization used on ride request cards and the ride details screen. */
export default function RouteIndicator({
  pickupLabel = 'Pick up',
  dropoffLabel = 'Drop off',
  pickupAddress,
  dropoffAddress,
  className,
}: RouteIndicatorProps) {
  return (
    <div className={`flex items-start gap-3 ${className ?? ''}`}>
      <div className="flex flex-col items-center pt-1 shrink-0">
        <span className="w-2.5 h-2.5 rounded-full shrink-0 bg-blue-600" />
        <span className="w-px flex-1 min-h-[28px] bg-border my-1" />
        <span className="w-2.5 h-2.5 rounded-full shrink-0 bg-primary" />
      </div>
      <div className="flex-1 min-w-0 space-y-3.5">
        <div>
          <p className="text-[11px] font-semibold text-muted-foreground">{pickupLabel}</p>
          <p className="text-[13px] font-semibold text-foreground leading-snug">{pickupAddress}</p>
        </div>
        <div>
          <p className="text-[11px] font-semibold text-muted-foreground">{dropoffLabel}</p>
          <p className="text-[13px] font-semibold text-foreground leading-snug">{dropoffAddress}</p>
        </div>
      </div>
    </div>
  );
}
