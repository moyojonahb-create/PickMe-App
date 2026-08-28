import { useEffect, useState } from 'react';

/** Minutes elapsed since `isoTimestamp`, ticking once a minute — not once a
 * second, since nothing here needs second-level precision and a screen-wide
 * 1s re-render for a "waiting Xm" label is exactly the kind of unnecessary
 * render this app has been getting rid of elsewhere. Returns null until a
 * timestamp exists (kept local to whichever small leaf component renders
 * the label, not the whole screen, so the 60s tick only re-renders that). */
export function useMinutesSince(isoTimestamp: string | null | undefined): number | null {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!isoTimestamp) return;
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, [isoTimestamp]);

  if (!isoTimestamp) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(isoTimestamp).getTime()) / 60_000));
}

/** Under a minute reads as "Just arrived" — never "0 min". No fee or
 * countdown framing; this product has no waiting-fee policy. */
export function formatWaitingLabel(minutes: number | null): string {
  if (minutes === null) return '';
  return minutes < 1 ? 'Just arrived' : `Waiting ${minutes} min`;
}
