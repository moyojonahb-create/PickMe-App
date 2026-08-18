import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, ContactRound, UserPlus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { haptic } from '@/lib/haptics';

interface BookingForSomeoneElseProps {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  name: string;
  phone: string;
  onNameChange: (value: string) => void;
  onPhoneChange: (value: string) => void;
  onOpenContacts: () => void;
}

/**
 * Square black-glass tile that expands downward (spanning full width) into a
 * "Rider details" card with name + phone inputs and a Contacts picker.
 * Pairs with PassengerCountCard in a 2-col row when collapsed.
 */
export default function BookingForSomeoneElse({
  enabled,
  onEnabledChange,
  name,
  phone,
  onNameChange,
  onPhoneChange,
  onOpenContacts,
}: BookingForSomeoneElseProps) {
  const [open, setOpen] = useState(enabled);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    onEnabledChange(next);
    haptic('light');
  };

  return (
    <div className={cn('w-full', open && 'col-span-2')}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className={cn(
          'flex rounded-2xl bg-foreground/85 backdrop-blur-xl border border-white/10 active:scale-[0.98] transition-all',
          open
            ? 'w-full items-center gap-2.5 px-3.5 py-3'
            : 'w-full aspect-square flex-col items-center justify-center gap-2 p-3 text-center'
        )}
      >
        <UserPlus className={cn('text-background shrink-0', open ? 'w-4 h-4' : 'w-5 h-5')} />
        <span className={cn('font-semibold text-background', open ? 'flex-1 text-left text-[13px]' : 'text-[12px] leading-tight')}>
          {open ? 'Booking for someone else' : <>Booking for<br />someone else</>}
        </span>
        <ChevronDown
          className={cn('text-background/70 transition-transform duration-300', open ? 'w-4 h-4' : 'w-3.5 h-3.5', open && 'rotate-180')}
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="rider-details"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
            className="overflow-hidden"
          >
            <div className="mt-2 rounded-2xl border border-primary/40 bg-card p-3 space-y-2.5">
              <p className="text-[11px] font-bold uppercase tracking-widest text-primary">Rider details</p>

              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground" htmlFor="rider-full-name">
                  Full name
                </label>
                <input
                  id="rider-full-name"
                  value={name}
                  onChange={(e) => onNameChange(e.target.value)}
                  placeholder="Rider's full name"
                  className="w-full h-11 px-3 rounded-xl border border-border bg-background text-[15px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/25"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground" htmlFor="rider-phone">
                  Phone number
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="rider-phone"
                    value={phone}
                    onChange={(e) => onPhoneChange(e.target.value)}
                    inputMode="tel"
                    placeholder="+263 7…"
                    className="flex-1 min-w-0 h-11 px-3 rounded-xl border border-border bg-background text-[15px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/25"
                  />
                  <button
                    type="button"
                    onClick={onOpenContacts}
                    className="shrink-0 h-11 px-3 rounded-xl border border-primary/40 bg-primary/10 text-primary text-[12px] font-semibold flex items-center gap-1.5 active:scale-95 transition-all"
                  >
                    <ContactRound className="w-4 h-4" />
                    Contacts
                  </button>
                </div>
              </div>

              <p className="text-[10px] text-muted-foreground">The driver will contact this rider.</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
