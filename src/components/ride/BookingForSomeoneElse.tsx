import { useEffect, useState, type CSSProperties } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Banknote, BellRing, ChevronRight, Phone, User, UserPlus, Users, X } from 'lucide-react';
import { normalizePhoneZW } from '@/lib/region';
import RideGlassPanel from './RideGlassPanel';
import { redCta, tintBlue, tintYellow, RIDE_RED, RIDE_RED_GRADIENT, RIDE_TEXT, RIDE_TEXT_2, RIDE_TEXT_3 } from './rideGlass';

interface BookingForSomeoneElseProps {
  open: boolean;
  onClose: () => void;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  tierLabel: string;
  pickupName: string;
  dropoffName: string;
  fare: number;
  currencySymbol: string;
  paymentMethod: 'cash' | 'wallet';
  passengerName: string;
  onPassengerNameChange: (v: string) => void;
  passengerPhone: string;
  onPassengerPhoneChange: (v: string) => void;
  payer: 'booker' | 'passenger';
  onPayerChange: (v: 'booker' | 'passenger') => void;
  notifyBooker: boolean;
  onNotifyBookerChange: (v: boolean) => void;
  onConfirm: () => void;
  submitting: boolean;
  onOpenContacts: () => void;
}

const panelStyle: CSSProperties = {
  background: 'rgba(255,255,255,.88)',
  backdropFilter: 'blur(28px) saturate(190%)',
  WebkitBackdropFilter: 'blur(28px) saturate(190%)',
  boxShadow: 'inset 0 0 0 .5px rgba(255,255,255,.6), 0 -8px 30px rgba(17,17,17,.06)',
};
const chipGlass: CSSProperties = {
  background: 'linear-gradient(160deg, rgba(255,255,255,.8), rgba(255,255,255,.48))',
  boxShadow: 'inset 0 .75px 0 rgba(255,255,255,.98), inset 0 0 0 .5px rgba(17,17,17,.09)',
};
const segmentSelected: CSSProperties = {
  background: RIDE_RED_GRADIENT,
  boxShadow: '0 8px 18px rgba(184,17,4,.3)',
};
const iconTileGlass: CSSProperties = {
  background: 'linear-gradient(135deg, rgba(255,248,247,.95), rgba(184,17,4,.1))',
  boxShadow: 'inset 0 0 0 .5px rgba(184,17,4,.18)',
};

export default function BookingForSomeoneElse({
  open, onClose, enabled, onEnabledChange, tierLabel, pickupName, dropoffName, fare, currencySymbol,
  paymentMethod, passengerName, onPassengerNameChange, passengerPhone, onPassengerPhoneChange,
  payer, onPayerChange, notifyBooker, onNotifyBookerChange, onConfirm, submitting, onOpenContacts,
}: BookingForSomeoneElseProps) {
  const [payerPickerOpen, setPayerPickerOpen] = useState(false);

  // Mirrors ParcelBookingSheet's own recipient-pays guard: "passenger pays"
  // is cash-only, so switching the ride's payment method away from cash
  // must fall the payer back to the booker rather than leave a stale
  // "passenger pays" choice paired with a payment method that can't honour it.
  useEffect(() => {
    if (paymentMethod !== 'cash' && payer === 'passenger') onPayerChange('booker');
  }, [paymentMethod, payer, onPayerChange]);

  const phoneValid = normalizePhoneZW(passengerPhone).replace(/\D/g, '').length >= 11;
  const canBook = enabled && passengerName.trim().length > 0 && phoneValid;
  const firstName = passengerName.trim().split(' ')[0] || 'them';

  const handleSelectMyself = () => {
    // Reversible: switching back to Myself clears the third-party fields so
    // a half-entered passenger can never leak onto a self-booking.
    onEnabledChange(false);
    onPassengerNameChange('');
    onPassengerPhoneChange('');
    onPayerChange('booker');
  };

  const handleConfirmClick = () => {
    if (!enabled) { onClose(); return; }
    if (!canBook) return;
    onConfirm();
  };

  return (
    <>
      <AnimatePresence>
        {open && (
          <>
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
              <RideGlassPanel panelStyle={panelStyle} style={{ maxHeight: '90vh', paddingBottom: 'env(safe-area-inset-bottom)' }} onRibbonClick={onClose}>
                <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
                  <div className="p-4" style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
                    {/* Section 1 — header */}
                    <div className="flex items-center" style={{ gap: 11 }}>
                      <span className="shrink-0 flex items-center justify-center" style={{ width: 40, height: 40, borderRadius: 14, ...iconTileGlass }}>
                        <UserPlus style={{ width: 19, height: 19, color: RIDE_RED }} />
                      </span>
                      <div className="min-w-0" style={{ flex: 1 }}>
                        <p style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-.02em', lineHeight: 1.2, color: RIDE_TEXT }}>Who is riding?</p>
                        <p className="truncate" style={{ marginTop: 3, fontSize: 12.5, fontWeight: 500, lineHeight: 1.2, color: RIDE_TEXT_2 }}>
                          {tierLabel} · {pickupName} → {dropoffName}
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

                    {/* Section 2 — Myself / Someone else */}
                    <div className="flex items-stretch" style={{ gap: 8 }}>
                      <button
                        type="button"
                        onClick={handleSelectMyself}
                        className="flex items-center justify-center active:scale-[0.97] transition-transform"
                        style={{ flex: 1, height: 44, borderRadius: 14, gap: 7, ...(!enabled ? segmentSelected : chipGlass) }}
                      >
                        <User style={{ width: 16, height: 16, color: !enabled ? '#fff' : RIDE_TEXT_2 }} />
                        <span style={{ fontSize: 14, fontWeight: !enabled ? 700 : 600, color: !enabled ? '#fff' : RIDE_TEXT_2 }}>Myself</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onEnabledChange(true)}
                        className="flex items-center justify-center active:scale-[0.97] transition-transform"
                        style={{ flex: 1, height: 44, borderRadius: 14, gap: 7, ...(enabled ? segmentSelected : chipGlass) }}
                      >
                        <Users style={{ width: 16, height: 16, color: enabled ? '#fff' : RIDE_TEXT_2 }} />
                        <span style={{ fontSize: 14, fontWeight: enabled ? 700 : 600, color: enabled ? '#fff' : RIDE_TEXT_2 }}>Someone else</span>
                      </button>
                    </div>

                    {enabled && (
                      <>
                        {/* Section 3 — passenger card */}
                        <div className="flex flex-col" style={{ ...tintBlue, borderRadius: 16, overflow: 'hidden' }}>
                          <div className="flex items-center" style={{ padding: '11px 13px', gap: 11 }}>
                            <span
                              className="shrink-0 flex items-center justify-center rounded-full"
                              style={{ width: 34, height: 34, background: 'linear-gradient(135deg,#C6CBD4,#868E9B)', boxShadow: '0 0 0 2px rgba(255,255,255,.95)' }}
                            >
                              <User style={{ width: 17, height: 17 }} className="text-white" strokeWidth={2.2} />
                            </span>
                            <div className="min-w-0" style={{ flex: 1 }}>
                              <span style={{ fontSize: 10.5, fontWeight: 700, color: RIDE_TEXT_2, textTransform: 'uppercase', letterSpacing: '.06em' }}>Passenger</span>
                              <input
                                value={passengerName}
                                onChange={(e) => onPassengerNameChange(e.target.value)}
                                placeholder="Passenger's name"
                                className="w-full outline-none bg-transparent"
                                style={{ marginTop: 2, fontSize: 14.5, fontWeight: 600, lineHeight: 1.2, color: RIDE_TEXT }}
                              />
                            </div>
                            <button
                              type="button"
                              onClick={onOpenContacts}
                              aria-label="Pick from contacts"
                              className="shrink-0 active:scale-90 transition-transform"
                            >
                              <User style={{ width: 16, height: 16, color: '#1A73E8' }} />
                            </button>
                          </div>
                          <span style={{ height: 0.5, background: 'rgba(17,17,17,.08)' }} />
                          <div className="flex items-center" style={{ padding: '11px 13px', gap: 11 }}>
                            <Phone style={{ width: 17, height: 17, color: '#1A73E8' }} strokeWidth={2} className="shrink-0" />
                            <div className="min-w-0" style={{ flex: 1 }}>
                              <p style={{ fontSize: 12.5, fontWeight: 500, lineHeight: 1.35, color: RIDE_TEXT_3 }}>
                                The driver calls <strong style={{ color: RIDE_TEXT, fontWeight: 700 }}>{firstName}</strong>, not you. {passengerName.trim() ? firstName : 'They'} get{passengerName.trim() ? 's' : ''} an SMS with the plate and ETA.
                              </p>
                              <input
                                value={passengerPhone}
                                onChange={(e) => onPassengerPhoneChange(e.target.value)}
                                placeholder="Phone number (e.g. 077 419 6620)"
                                type="tel"
                                className="w-full outline-none bg-transparent tabular-nums"
                                style={{ marginTop: 6, fontSize: 13, fontWeight: 600, color: RIDE_TEXT }}
                              />
                            </div>
                          </div>
                        </div>

                        {/* Section 4 — keep me updated */}
                        <button
                          type="button"
                          onClick={() => onNotifyBookerChange(!notifyBooker)}
                          className="flex items-center w-full text-left active:scale-[0.98] transition-transform"
                          style={{ height: 44, padding: '0 14px', borderRadius: 15, gap: 10, ...chipGlass }}
                        >
                          <BellRing style={{ width: 17, height: 17, color: RIDE_TEXT_2 }} strokeWidth={1.9} />
                          <span style={{ flex: 1, fontSize: 14, fontWeight: 500, color: RIDE_TEXT }}>Also keep me updated</span>
                          <span
                            className="shrink-0 flex items-center"
                            style={{
                              width: 44, height: 26, borderRadius: 999, padding: '0 3px',
                              justifyContent: notifyBooker ? 'flex-end' : 'flex-start',
                              background: notifyBooker ? RIDE_RED : 'rgba(17,17,17,.12)',
                              boxShadow: notifyBooker ? 'inset 0 1px 2px rgba(0,0,0,.12)' : 'none',
                              transition: 'background .15s ease',
                            }}
                          >
                            <span className="rounded-full" style={{ width: 20, height: 20, background: '#FFFFFF', boxShadow: '0 1px 3px rgba(0,0,0,.24)' }} />
                          </span>
                        </button>

                        {/* Section 5 — who pays */}
                        {payerPickerOpen ? (
                          <div className="flex flex-col" style={{ borderRadius: 15, overflow: 'hidden', ...tintYellow }}>
                            {(['booker', 'passenger'] as const).map((opt) => {
                              const disabled = opt === 'passenger' && paymentMethod !== 'cash';
                              return (
                                <button
                                  key={opt}
                                  type="button"
                                  disabled={disabled}
                                  onClick={() => { onPayerChange(opt); setPayerPickerOpen(false); }}
                                  className="flex items-center justify-between w-full text-left disabled:opacity-40"
                                  style={{ padding: '11px 14px' }}
                                >
                                  <div>
                                    <p style={{ fontSize: 13.5, fontWeight: 700, color: RIDE_TEXT }}>
                                      {opt === 'booker' ? "I'm paying · cash on arrival" : `${firstName} pays · cash on arrival`}
                                    </p>
                                    {disabled && <p style={{ fontSize: 10.5, fontWeight: 500, color: RIDE_TEXT_2, marginTop: 1 }}>Cash only</p>}
                                  </div>
                                  {payer === opt && <span className="rounded-full" style={{ width: 8, height: 8, background: RIDE_RED }} />}
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setPayerPickerOpen(true)}
                            className="flex items-center w-full text-left active:scale-[0.98] transition-transform"
                            style={{ height: 44, padding: '0 14px', borderRadius: 15, gap: 10, ...tintYellow }}
                          >
                            <Banknote style={{ width: 17, height: 17, color: RIDE_TEXT }} strokeWidth={1.9} />
                            <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: RIDE_TEXT }}>
                              {payer === 'booker' ? "I'm paying · cash on arrival" : `${firstName} pays · cash on arrival`}
                            </span>
                            <ChevronRight style={{ width: 16, height: 16, color: RIDE_TEXT_2 }} className="shrink-0" />
                          </button>
                        )}
                      </>
                    )}

                    {/* Section 6 — action row */}
                    <div className="flex items-center" style={{ gap: 12 }}>
                      <button
                        type="button"
                        onClick={onClose}
                        className="shrink-0 flex items-center justify-center active:scale-[0.97] transition-transform"
                        style={{ width: 104, height: 48, borderRadius: 15, ...chipGlass }}
                      >
                        <span style={{ fontSize: 14.5, fontWeight: 700, color: RIDE_TEXT_2 }}>Back</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleConfirmClick}
                        disabled={enabled && (!canBook || submitting)}
                        className="flex items-center justify-center active:scale-[0.97] transition-transform relative overflow-hidden disabled:opacity-50"
                        style={{ flex: 1, height: 48, borderRadius: 15, ...redCta }}
                      >
                        <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2" style={{ background: 'linear-gradient(180deg, rgba(255,255,255,.2), rgba(255,255,255,0))' }} />
                        <span className="relative" style={{ fontSize: 15.5, fontWeight: 700 }}>
                          {enabled
                            ? (submitting ? 'Booking…' : `Book for ${firstName} · ${currencySymbol}${fare.toFixed(2)}`)
                            : 'Continue'}
                        </span>
                      </button>
                    </div>

                    {/* Section 7 — iOS home indicator */}
                    <div style={{ padding: '6px 0 10px' }} className="flex justify-center">
                      <span className="rounded-full" style={{ width: 140, height: 5, background: RIDE_TEXT }} />
                    </div>
                  </div>
                </div>
              </RideGlassPanel>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
