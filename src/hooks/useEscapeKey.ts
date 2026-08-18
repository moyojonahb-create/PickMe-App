import { useEffect } from 'react';

/** Closes a custom (non-Radix) modal/sheet on Escape — the plain div-based
 * bottom sheets used across the driver screens declare role="dialog" but
 * don't get Radix's built-in Escape handling for free. */
export function useEscapeKey(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);
}
