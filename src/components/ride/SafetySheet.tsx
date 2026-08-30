import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronRight, Flag, Phone, ShieldCheck, Siren, User, X } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabaseClient';
import { haptic } from '@/lib/haptics';
import { createEmergencyEvent } from '@/lib/businessApi';
import { resolveEmergencyNumber } from '@/lib/region';
import RideGlassPanel from './RideGlassPanel';
import ShareTripButton from './ShareTripButton';
import DisputeForm from './DisputeForm';
import { RIDE_RED, RIDE_RED_GRADIENT, RIDE_TEXT, RIDE_TEXT_2, tintBlue } from './rideGlass';

const HOLD_MS = 3000;

function formatTime24(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const rowGlass: CSSProperties = {
  background: 'linear-gradient(160deg, rgba(255,255,255,.8), rgba(255,255,255,.48))',
  boxShadow: 'inset 0 .75px 0 rgba(255,255,255,.98), inset 0 0 0 .5px rgba(17,17,17,.09)',
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

function ActionRow({ icon, iconTileStyle, title, subtitle, onClick }: {
  icon: React.ReactNode;
  iconTileStyle: CSSProperties;
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center w-full text-left active:scale-[0.98] transition-transform"
      style={{ padding: '11px 13px', borderRadius: 16, gap: 12, ...rowGlass }}
    >
      <span className="shrink-0 flex items-center justify-center" style={{ width: 36, height: 36, borderRadius: 12, ...iconTileStyle }}>
        {icon}
      </span>
      <div className="min-w-0" style={{ flex: 1 }}>
        <p className="truncate" style={{ fontSize: 14.5, fontWeight: 600, lineHeight: 1.2, color: RIDE_TEXT }}>{title}</p>
        <p className="truncate" style={{ fontSize: 11.5, fontWeight: 500, lineHeight: 1.2, marginTop: 2, color: RIDE_TEXT_2 }}>{subtitle}</p>
      </div>
      <ChevronRight style={{ width: 17, height: 17, color: RIDE_TEXT_2 }} className="shrink-0" />
    </button>
  );
}

interface SafetySheetProps {
  open: boolean;
  onClose: () => void;
  rideId: string;
  /** Rider view: the driver's name. Driver view: the passenger's name. */
  counterpartName: string;
  counterpartAvatarUrl?: string | null;
  /** Rider view: driver's vehicle description. Driver view: omit — a
   * passenger has no vehicle to show. */
  counterpartMeta?: string | null;
  plateNumber: string | null;
  startedAt: string | null;
  pickupAddress: string;
  dropoffAddress: string;
  /** Who is opening this sheet — threaded to DisputeForm so a report is
   * filed as the right party. */
  role?: 'rider' | 'driver';
}

export default function SafetySheet({
  open, onClose, rideId, counterpartName, counterpartAvatarUrl, counterpartMeta, plateNumber, startedAt, pickupAddress, dropoffAddress, role = 'rider',
}: SafetySheetProps) {
  const [contact, setContact] = useState<{ name: string | null; phone: string } | null>(null);
  const [contactLoaded, setContactLoaded] = useState(false);
  const [editingContact, setEditingContact] = useState(false);
  const [contactNameDraft, setContactNameDraft] = useState('');
  const [contactPhoneDraft, setContactPhoneDraft] = useState('');
  const [savingContact, setSavingContact] = useState(false);

  const [holdProgress, setHoldProgress] = useState(0);
  const [holding, setHolding] = useState(false);
  const holdRaf = useRef<number | null>(null);
  const holdStart = useRef<number | null>(null);
  const firedRef = useRef<Set<number>>(new Set());

  // Load the rider's saved emergency contact fresh each time the sheet
  // opens — it's small, per-profile data, not worth caching across opens.
  useEffect(() => {
    if (!open) return;
    setEditingContact(false);
    setContactLoaded(false);
    let cancelled = false;
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id;
      if (!uid) { if (!cancelled) setContactLoaded(true); return; }
      const { data } = await (supabase as any)
        .from('profiles')
        .select('emergency_contact_name, emergency_contact_phone')
        .eq('user_id', uid)
        .maybeSingle();
      if (cancelled) return;
      if (data?.emergency_contact_phone) {
        setContact({ name: data.emergency_contact_name, phone: data.emergency_contact_phone });
      } else {
        setContact(null);
      }
      setContactLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    return () => { if (holdRaf.current) cancelAnimationFrame(holdRaf.current); };
  }, []);

  const handleSaveContact = async () => {
    const phone = contactPhoneDraft.trim();
    if (!phone) return;
    setSavingContact(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id;
      if (!uid) throw new Error('Not signed in');
      const { error } = await supabase
        .from('profiles')
        .upsert(
          { user_id: uid, emergency_contact_name: contactNameDraft.trim() || null, emergency_contact_phone: phone } as never,
          { onConflict: 'user_id' }
        );
      if (error) throw new Error(error.message);
      setContact({ name: contactNameDraft.trim() || null, phone });
      setEditingContact(false);
      haptic('light');
    } catch (e) {
      toast.error('Could not save emergency contact', { description: (e as Error).message });
    } finally {
      setSavingContact(false);
    }
  };

  const completeHold = () => {
    if (holdRaf.current) cancelAnimationFrame(holdRaf.current);
    holdStart.current = null;
    setHolding(false);
    setHoldProgress(1);
    haptic('success');
    const number = resolveEmergencyNumber();
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          createEmergencyEvent({ ride_id: rideId, latitude: pos.coords.latitude, longitude: pos.coords.longitude }).catch(() => {});
        },
        () => {},
        { enableHighAccuracy: true, timeout: 3000 }
      );
    }
    window.location.href = `tel:${number}`;
  };

  const stepHold = () => {
    if (holdStart.current == null) return;
    const elapsed = Date.now() - holdStart.current;
    const progress = Math.min(1, elapsed / HOLD_MS);
    setHoldProgress(progress);
    if (progress >= 0.34 && !firedRef.current.has(1)) { firedRef.current.add(1); haptic('medium'); }
    if (progress >= 0.67 && !firedRef.current.has(2)) { firedRef.current.add(2); haptic('heavy'); }
    if (progress >= 1) { completeHold(); return; }
    holdRaf.current = requestAnimationFrame(stepHold);
  };

  const startHold = () => {
    if (holding) return;
    setHolding(true);
    firedRef.current.clear();
    holdStart.current = Date.now();
    haptic('light');
    holdRaf.current = requestAnimationFrame(stepHold);
  };

  const cancelHold = () => {
    if (!holding) return;
    setHolding(false);
    holdStart.current = null;
    if (holdRaf.current) cancelAnimationFrame(holdRaf.current);
    if (holdProgress > 0 && holdProgress < 1) haptic('error');
    setHoldProgress(0);
  };

  return (
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
            <RideGlassPanel panelStyle={panelStyle} style={{ maxHeight: '86vh', paddingBottom: 'env(safe-area-inset-bottom)' }} onRibbonClick={onClose}>
              <div className="p-4" style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
                {/* Section 1 — header */}
                <div className="flex items-center" style={{ gap: 11 }}>
                  <span className="shrink-0 flex items-center justify-center" style={{ width: 40, height: 40, borderRadius: 14, ...iconTileGlass }}>
                    <ShieldCheck style={{ width: 19, height: 19, color: RIDE_RED }} />
                  </span>
                  <div className="min-w-0" style={{ flex: 1 }}>
                    <p style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-.02em', lineHeight: 1.2, color: RIDE_TEXT }}>Safety</p>
                    <p style={{ marginTop: 3, fontSize: 12.5, fontWeight: 500, lineHeight: 1.2, color: RIDE_TEXT_2 }}>
                      Your trip is being recorded
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

                {/* Section 2 — trip identity card: readable aloud on a call */}
                <div className="flex items-center" style={{ ...tintBlue, borderRadius: 16, padding: '10px 12px', gap: 11 }}>
                  <span
                    className="shrink-0 flex items-center justify-center rounded-full overflow-hidden"
                    style={{ width: 34, height: 34, background: 'linear-gradient(135deg,#C6CBD4,#868E9B)', boxShadow: '0 0 0 2px rgba(255,255,255,.95)' }}
                  >
                    {counterpartAvatarUrl ? (
                      <img src={counterpartAvatarUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <User style={{ width: 17, height: 17 }} className="text-white" strokeWidth={2.2} />
                    )}
                  </span>
                  <div className="min-w-0" style={{ flex: 1 }}>
                    <p className="truncate" style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.2, color: RIDE_TEXT }}>
                      {counterpartMeta ? `${counterpartName} · ${counterpartMeta}` : counterpartName}
                    </p>
                    <p className="truncate" style={{ marginTop: 2, fontSize: 12, fontWeight: 500, lineHeight: 1.2, color: RIDE_TEXT_2 }}>
                      Trip #PM-{rideId.slice(0, 4).toUpperCase()}{startedAt ? ` · started ${formatTime24(startedAt)}` : ''}
                    </p>
                  </div>
                  {plateNumber && (
                    <span
                      className="shrink-0 tabular-nums"
                      style={{ padding: '3px 9px', borderRadius: 7, background: RIDE_TEXT, color: '#FFFFFF', fontSize: 12, fontWeight: 700, letterSpacing: '.04em' }}
                    >
                      {plateNumber}
                    </span>
                  )}
                </div>

                {/* Sections 3–5 — share, call contact, report; in that order */}
                <ShareTripButton
                  rideId={rideId}
                  pickupAddress={pickupAddress}
                  dropoffAddress={dropoffAddress}
                  driverName={role === 'rider' ? counterpartName : undefined}
                  variant="row"
                  className="flex items-center w-full text-left active:scale-[0.98] transition-transform"
                  style={{ padding: '11px 13px', borderRadius: 16, gap: 12, color: RIDE_TEXT, ...rowGlass }}
                  rowIcon={
                    <span className="shrink-0 flex items-center justify-center" style={{ width: 36, height: 36, borderRadius: 12, background: 'rgba(52,199,89,.14)' }}>
                      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#15803d" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
                        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                      </svg>
                    </span>
                  }
                />

                {editingContact ? (
                  <div className="flex flex-col" style={{ padding: '11px 13px', borderRadius: 16, gap: 8, ...rowGlass }}>
                    <p style={{ fontSize: 12.5, fontWeight: 600, color: RIDE_TEXT }}>Add an emergency contact</p>
                    <input
                      value={contactNameDraft}
                      onChange={(e) => setContactNameDraft(e.target.value)}
                      placeholder="Name (optional)"
                      className="w-full outline-none"
                      style={{ height: 36, padding: '0 10px', borderRadius: 10, fontSize: 13, background: 'rgba(255,255,255,.9)', boxShadow: 'inset 0 0 0 1px rgba(17,17,17,.1)', color: RIDE_TEXT }}
                    />
                    <input
                      value={contactPhoneDraft}
                      onChange={(e) => setContactPhoneDraft(e.target.value)}
                      placeholder="Phone number"
                      type="tel"
                      className="w-full outline-none"
                      style={{ height: 36, padding: '0 10px', borderRadius: 10, fontSize: 13, background: 'rgba(255,255,255,.9)', boxShadow: 'inset 0 0 0 1px rgba(17,17,17,.1)', color: RIDE_TEXT }}
                    />
                    <div className="flex items-center" style={{ gap: 8, marginTop: 2 }}>
                      <button
                        type="button"
                        onClick={() => setEditingContact(false)}
                        className="flex-1 flex items-center justify-center active:scale-95 transition-transform"
                        style={{ height: 36, borderRadius: 10, background: 'rgba(17,17,17,.06)' }}
                      >
                        <span style={{ fontSize: 12.5, fontWeight: 700, color: RIDE_TEXT_2 }}>Cancel</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveContact}
                        disabled={!contactPhoneDraft.trim() || savingContact}
                        className="flex-1 flex items-center justify-center active:scale-95 transition-transform disabled:opacity-50"
                        style={{ height: 36, borderRadius: 10, background: RIDE_RED }}
                      >
                        <span style={{ fontSize: 12.5, fontWeight: 700, color: '#FFFFFF' }}>{savingContact ? 'Saving…' : 'Save'}</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <ActionRow
                    icon={<Phone style={{ width: 17, height: 17, color: '#1A73E8' }} />}
                    iconTileStyle={{ background: 'rgba(26,115,232,.12)' }}
                    title={contact ? 'Call your emergency contact' : 'Add an emergency contact'}
                    subtitle={
                      !contactLoaded ? '…' :
                      contact ? `${contact.name || 'Saved contact'} · ${contact.phone}` :
                      'So this row can reach someone for you'
                    }
                    onClick={() => {
                      if (contact) {
                        window.location.href = `tel:${contact.phone}`;
                      } else {
                        setContactNameDraft('');
                        setContactPhoneDraft('');
                        setEditingContact(true);
                      }
                    }}
                  />
                )}

                <DisputeForm
                  rideId={rideId}
                  role={role}
                  trigger={
                    <ActionRow
                      icon={<Flag style={{ width: 17, height: 17, color: RIDE_TEXT_2 }} />}
                      iconTileStyle={{ background: 'rgba(17,17,17,.06)' }}
                      title="Report a problem"
                      subtitle="Route, conduct or vehicle"
                      onClick={() => {}}
                    />
                  }
                />

                {/* Section 6 — emergency hold button, the only 56px button in the flow */}
                <button
                  type="button"
                  onPointerDown={startHold}
                  onPointerUp={cancelHold}
                  onPointerLeave={cancelHold}
                  onPointerCancel={cancelHold}
                  className="relative w-full flex items-center justify-center select-none"
                  style={{ height: 56, borderRadius: 16, overflow: 'hidden', gap: 10, background: RIDE_RED_GRADIENT, boxShadow: '0 12px 26px rgba(184,17,4,.4), inset 0 1px 0 rgba(255,255,255,.3)', touchAction: 'none' }}
                >
                  <span
                    className="absolute inset-y-0 left-0 pointer-events-none"
                    style={{ width: `${holdProgress * 100}%`, background: 'rgba(255,255,255,.16)', transition: holding ? 'none' : 'width .25s ease' }}
                  />
                  <Siren className="relative" style={{ width: 20, height: 20, color: '#FFFFFF' }} />
                  <div className="relative flex flex-col items-start">
                    <span style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.15, color: '#FFFFFF' }}>Hold for emergency</span>
                    <span style={{ fontSize: 11, fontWeight: 600, lineHeight: 1.15, color: 'rgba(255,255,255,.78)' }}>
                      Keep holding to call {resolveEmergencyNumber()}
                    </span>
                  </div>
                </button>

                {/* Section 7 — iOS home indicator */}
                <div style={{ padding: '6px 0 10px' }} className="flex justify-center">
                  <span className="rounded-full" style={{ width: 140, height: 5, background: RIDE_TEXT }} />
                </div>
              </div>
            </RideGlassPanel>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
