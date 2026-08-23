import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Bell, Calendar, Info, X } from 'lucide-react';
import { haptic } from '@/lib/haptics';
import RideGlassPanel from './RideGlassPanel';
import { redCta, tintBlue, RIDE_RED, RIDE_RED_GRADIENT, RIDE_TEXT, RIDE_TEXT_2, RIDE_TEXT_3 } from './rideGlass';

// Matches public.dispatch_scheduled_rides() (supabase/migrations/20260311202356…):
// `scheduled_at <= now() + interval '5 minutes'` is the real window the
// dispatcher promotes a scheduled ride out of — not a round number picked
// for the mockup. If that SQL ever changes, this constant needs to move
// with it or the note on this screen starts lying to riders.
const DISPATCH_LEAD_MINUTES = 5;
// A ride day never offers a slot past this local time.
const LAST_SLOT_HOUR = 23;
const LAST_SLOT_MINUTE = 45;

function roundUpToQuarterHour(d: Date): Date {
  const ms = 15 * 60 * 1000;
  return new Date(Math.ceil(d.getTime() / ms) * ms);
}

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

function formatTime24(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatDayLabel(d: Date, index: number): string {
  if (index === 0) return 'Today';
  if (index === 1) return 'Tomorrow';
  return d.toLocaleDateString('en-US', { weekday: 'long' });
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Built manually rather than via toLocaleDateString: en-US formats day+month
// as "Aug 20", but the mockup (and en-ZW/British convention this app uses
// elsewhere, e.g. TripReceiptButton) is day-first — "20 Aug".
function formatDateLabel(d: Date): string {
  return `${d.getDate()} ${SHORT_MONTHS[d.getMonth()]}`;
}

/** Glass tokens unique to this sheet — not reused elsewhere, kept local. */
const chipGlass: CSSProperties = {
  background: 'linear-gradient(160deg, rgba(255,255,255,.8), rgba(255,255,255,.48))',
  boxShadow: 'inset 0 .75px 0 rgba(255,255,255,.98), inset 0 0 0 .5px rgba(17,17,17,.09)',
};
const timeChipSelected: CSSProperties = {
  background: 'linear-gradient(135deg, rgba(255,250,205,.95), rgba(255,221,0,.22))',
  boxShadow: 'inset 0 .5px 0 rgba(255,255,255,.9), inset 0 0 0 1px rgba(255,221,0,.55)',
};
const daySelected: CSSProperties = {
  background: RIDE_RED_GRADIENT,
  boxShadow: '0 8px 18px rgba(184,17,4,.3)',
};
const iconTileGlass: CSSProperties = {
  background: 'linear-gradient(135deg, rgba(255,248,247,.95), rgba(184,17,4,.1))',
  boxShadow: 'inset 0 0 0 .5px rgba(184,17,4,.18)',
};
const panelStyle: CSSProperties = {
  background: 'rgba(255,255,255,.88)',
  backdropFilter: 'blur(28px) saturate(190%)',
  WebkitBackdropFilter: 'blur(28px) saturate(190%)',
  boxShadow: 'inset 0 0 0 .5px rgba(255,255,255,.6), 0 -8px 30px rgba(17,17,17,.06)',
};

interface DaySlot {
  date: Date;
  disabled: boolean;
}

function buildDays(now: Date): DaySlot[] {
  return [0, 1, 2].map((offset) => {
    const date = new Date(startOfDay(now).getTime() + offset * 24 * 60 * 60 * 1000);
    const earliestToday = offset === 0 ? roundUpToQuarterHour(new Date(now.getTime() + DISPATCH_LEAD_MINUTES * 60 * 1000)) : null;
    const disabled = offset === 0 && earliestToday !== null &&
      (earliestToday.getHours() > LAST_SLOT_HOUR || (earliestToday.getHours() === LAST_SLOT_HOUR && earliestToday.getMinutes() > LAST_SLOT_MINUTE));
    return { date, disabled };
  });
}

function buildTimes(day: Date, dayIndex: number, now: Date): Date[] {
  const dayStart = startOfDay(day);
  const earliest = dayIndex === 0
    ? roundUpToQuarterHour(new Date(now.getTime() + DISPATCH_LEAD_MINUTES * 60 * 1000))
    : new Date(dayStart);
  const lastSlot = new Date(dayStart);
  lastSlot.setHours(LAST_SLOT_HOUR, LAST_SLOT_MINUTE, 0, 0);
  if (earliest > lastSlot) return [];
  const slots: Date[] = [];
  for (let t = earliest.getTime(); t <= lastSlot.getTime(); t += 15 * 60 * 1000) {
    slots.push(new Date(t));
  }
  return slots;
}

interface ScheduleRideProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (date: Date, remindMe: boolean) => void;
  /** Already-scheduled ride for this booking, if any — shows a summary/
   * cancel view instead of the picker. */
  scheduledAt: Date | null;
  onCancelScheduled: () => void;
  destinationName: string;
  tierLabel: string;
  fareLabel: string;
}

export default function ScheduleRide({
  open, onClose, onConfirm, scheduledAt, onCancelScheduled, destinationName, tierLabel, fareLabel,
}: ScheduleRideProps) {
  const [dayIndex, setDayIndex] = useState(0);
  const [selectedTime, setSelectedTime] = useState<Date | null>(null);
  const [remindMe, setRemindMe] = useState(true);
  const timeRowRef = useRef<HTMLDivElement>(null);

  // Frozen at the moment the sheet opens, not recomputed every render —
  // otherwise the day/time lists would shift under the rider's thumb.
  const [now, setNow] = useState(() => new Date());
  const days = useMemo(() => buildDays(now), [now]);
  const times = useMemo(() => buildTimes(days[dayIndex].date, dayIndex, now), [days, dayIndex, now]);

  // Reset to a fresh, valid pick every time the sheet opens, and whenever
  // the day changes — carrying a stale selected time across days (or across
  // opens, minutes later) risks landing on a slot that's no longer valid.
  useEffect(() => {
    if (!open) return;
    setNow(new Date());
    setDayIndex(0);
    setRemindMe(true);
  }, [open]);

  useEffect(() => {
    setSelectedTime(times[0] ?? null);
    timeRowRef.current?.scrollTo({ left: 0 });
  }, [dayIndex, times]);

  const dispatchTime = selectedTime ? new Date(selectedTime.getTime() - DISPATCH_LEAD_MINUTES * 60 * 1000) : null;

  const handleConfirm = () => {
    if (!selectedTime) return;
    haptic('medium');
    onConfirm(selectedTime, remindMe);
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Dim scrim — signals the map/booking sheet behind is inert while this modal is open */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60]"
            style={{ background: 'rgba(17,17,17,.28)' }}
            onClick={onClose}
          />
          <motion.div
            initial={{ y: 60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 60, opacity: 0 }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
            className="fixed left-0 right-0 bottom-0 z-[70]"
            style={{ maxWidth: 480, margin: '0 auto', width: '100%' }}
          >
            <RideGlassPanel panelStyle={panelStyle} style={{ maxHeight: '86vh', paddingBottom: 'env(safe-area-inset-bottom)' }} onRibbonClick={onClose}>
          <div className="p-4" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {scheduledAt ? (
              /* Already scheduled — summary + cancel, not the mockup's fresh-pick flow */
              <>
                <div className="flex items-center" style={{ gap: 11 }}>
                  <span className="shrink-0 flex items-center justify-center" style={{ width: 40, height: 40, borderRadius: 14, ...iconTileGlass }}>
                    <Calendar style={{ width: 19, height: 19, color: RIDE_RED }} />
                  </span>
                  <div className="min-w-0" style={{ flex: 1 }}>
                    <p style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-.02em', lineHeight: 1.2, color: RIDE_TEXT }}>Ride scheduled</p>
                    <p className="truncate" style={{ marginTop: 3, fontSize: 12.5, fontWeight: 500, lineHeight: 1.2, color: RIDE_TEXT_2 }}>
                      {scheduledAt.toLocaleDateString('en-US', { weekday: 'short' })} {formatDateLabel(scheduledAt)} at {formatTime24(scheduledAt)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close"
                    className="shrink-0 flex items-center justify-center active:scale-90 transition-transform"
                    style={{ width: 32, height: 32, borderRadius: 999, background: 'rgba(17,17,17,.06)' }}
                  >
                    <X style={{ width: 16, height: 16, color: RIDE_TEXT }} strokeWidth={2.4} />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={onCancelScheduled}
                  className="w-full flex items-center justify-center active:scale-[0.97] transition-transform"
                  style={{ height: 48, borderRadius: 15, ...chipGlass }}
                >
                  <span style={{ fontSize: 14.5, fontWeight: 700, color: RIDE_RED }}>Cancel scheduled ride</span>
                </button>
                <div style={{ padding: '6px 0 10px' }} className="flex justify-center">
                  <span className="rounded-full" style={{ width: 140, height: 5, background: RIDE_TEXT }} />
                </div>
              </>
            ) : (
              <>
                {/* Section 1 — header */}
                <div className="flex items-center" style={{ gap: 11 }}>
                  <span className="shrink-0 flex items-center justify-center" style={{ width: 40, height: 40, borderRadius: 14, ...iconTileGlass }}>
                    <Calendar style={{ width: 19, height: 19, color: RIDE_RED }} />
                  </span>
                  <div className="min-w-0" style={{ flex: 1 }}>
                    <p style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-.02em', lineHeight: 1.2, color: RIDE_TEXT }}>Schedule your ride</p>
                    <p className="truncate" style={{ marginTop: 3, fontSize: 12.5, fontWeight: 500, lineHeight: 1.2, color: RIDE_TEXT_2 }}>
                      {destinationName} · {tierLabel} · {fareLabel}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close"
                    className="shrink-0 flex items-center justify-center active:scale-90 transition-transform"
                    style={{ width: 32, height: 32, borderRadius: 999, background: 'rgba(17,17,17,.06)' }}
                  >
                    <X style={{ width: 16, height: 16, color: RIDE_TEXT }} strokeWidth={2.4} />
                  </button>
                </div>

                {/* Section 2 — day chips */}
                <div className="flex items-stretch" style={{ gap: 8 }}>
                  {days.map((day, i) => {
                    const selected = i === dayIndex;
                    return (
                      <button
                        key={i}
                        type="button"
                        disabled={day.disabled}
                        onClick={() => { setDayIndex(i); haptic('light'); }}
                        className="flex flex-col items-center active:scale-[0.97] transition-transform disabled:opacity-40"
                        style={{ flex: 1, padding: '10px 0', borderRadius: 14, gap: 2, ...(selected ? daySelected : chipGlass) }}
                      >
                        <span style={{ fontSize: 11, fontWeight: 600, color: selected ? 'rgba(255,255,255,.8)' : RIDE_TEXT_2 }}>
                          {formatDayLabel(day.date, i)}
                        </span>
                        <span style={{ fontSize: 15, fontWeight: 700, color: selected ? '#FFFFFF' : RIDE_TEXT }}>
                          {formatDateLabel(day.date)}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Section 3 — time list */}
                <div className="flex flex-col" style={{ gap: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: RIDE_TEXT_2, textTransform: 'uppercase', letterSpacing: '.12em' }}>
                    Pickup time
                  </span>
                  <div ref={timeRowRef} className="flex overflow-x-auto no-scrollbar" style={{ gap: 7 }}>
                    {times.length === 0 && (
                      <span style={{ fontSize: 13, fontWeight: 500, color: RIDE_TEXT_2, padding: '8px 0' }}>
                        No more pickup times today
                      </span>
                    )}
                    {times.map((t) => {
                      const selected = selectedTime?.getTime() === t.getTime();
                      return (
                        <button
                          key={t.getTime()}
                          type="button"
                          onClick={() => { setSelectedTime(t); haptic('light'); }}
                          className="shrink-0 tabular-nums active:scale-95 transition-transform"
                          style={{
                            height: 40, padding: '0 15px', borderRadius: 999,
                            fontSize: 14, fontWeight: selected ? 700 : 600,
                            color: RIDE_TEXT,
                            ...(selected ? timeChipSelected : chipGlass),
                          }}
                        >
                          {formatTime24(t)}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Section 4 — dispatch info note: the load-bearing copy on this screen */}
                <div className="flex items-start" style={{ ...tintBlue, borderRadius: 16, padding: '11px 13px', gap: 10 }}>
                  <Info style={{ width: 16, height: 16, color: '#1A73E8', marginTop: 1 }} className="shrink-0" strokeWidth={2} />
                  <p style={{ fontSize: 12.5, fontWeight: 500, lineHeight: 1.4, color: RIDE_TEXT_3 }}>
                    We'll send your request to drivers at{' '}
                    <span style={{ fontWeight: 700, color: RIDE_TEXT }}>{dispatchTime ? formatTime24(dispatchTime) : '—'}</span>
                    , {DISPATCH_LEAD_MINUTES} minutes before pickup. The fare is confirmed then, not now.
                  </p>
                </div>

                {/* Section 5 — reminder toggle */}
                <button
                  type="button"
                  onClick={() => setRemindMe((v) => !v)}
                  className="flex items-center w-full text-left active:scale-[0.98] transition-transform"
                  style={{ height: 44, padding: '0 14px', borderRadius: 15, gap: 10, ...chipGlass }}
                >
                  <Bell style={{ width: 17, height: 17, color: RIDE_TEXT_2 }} strokeWidth={1.9} />
                  <span style={{ flex: 1, fontSize: 14, fontWeight: 500, color: RIDE_TEXT }}>Remind me 30 min before</span>
                  <span
                    className="shrink-0 flex items-center"
                    style={{
                      width: 44, height: 26, borderRadius: 999, padding: '0 3px',
                      justifyContent: remindMe ? 'flex-end' : 'flex-start',
                      background: remindMe ? RIDE_RED : 'rgba(17,17,17,.12)',
                      boxShadow: remindMe ? 'inset 0 1px 2px rgba(0,0,0,.12)' : 'none',
                      transition: 'background .15s ease',
                    }}
                  >
                    <span className="rounded-full" style={{ width: 20, height: 20, background: '#FFFFFF', boxShadow: '0 1px 3px rgba(0,0,0,.24)' }} />
                  </span>
                </button>

                {/* Section 6 — action row */}
                <div className="flex items-center" style={{ gap: 12 }}>
                  <button
                    type="button"
                    onClick={onClose}
                    className="shrink-0 flex items-center justify-center active:scale-[0.97] transition-transform"
                    style={{ width: 104, height: 48, borderRadius: 15, ...chipGlass }}
                  >
                    <span style={{ fontSize: 14.5, fontWeight: 700, color: RIDE_TEXT_2 }}>Cancel</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirm}
                    disabled={!selectedTime}
                    className="flex items-center justify-center active:scale-[0.97] transition-transform relative overflow-hidden disabled:opacity-50"
                    style={{ flex: 1, height: 48, borderRadius: 15, ...redCta, boxShadow: '0 10px 20px rgba(184,17,4,.36), inset 0 1px 0 rgba(255,255,255,.3)' }}
                  >
                    <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2" style={{ background: 'linear-gradient(180deg, rgba(255,255,255,.2), rgba(255,255,255,0))' }} />
                    <span className="relative" style={{ fontSize: 15.5, fontWeight: 700 }}>
                      {selectedTime ? `Schedule for ${formatTime24(selectedTime)}` : 'Pick a time'}
                    </span>
                  </button>
                </div>

                {/* Section 7 — iOS home indicator */}
                <div style={{ padding: '6px 0 10px' }} className="flex justify-center">
                  <span className="rounded-full" style={{ width: 140, height: 5, background: RIDE_TEXT }} />
                </div>
              </>
            )}
          </div>
            </RideGlassPanel>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
