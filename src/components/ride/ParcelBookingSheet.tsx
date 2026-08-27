import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Banknote, Box, Boxes, Camera, ChevronRight, ImagePlus, MessageSquare, Package, ShieldAlert, User, X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { haptic } from '@/lib/haptics';
import { normalizePhoneZW } from '@/lib/region';
import { uploadParcelPhoto, deleteParcelPhoto } from '@/lib/parcelStorage';
import { pickNativeContact } from '@/lib/nativeContactPicker';
import carParcel from '@/assets/cars/car-parcel.png';
import RideGlassPanel from './RideGlassPanel';
import { redCta, tintBlue, tintYellow, RIDE_RED, RIDE_TEXT, RIDE_TEXT_2, RIDE_TEXT_3 } from './rideGlass';

export interface ParcelBookingData {
  packageSize: 'small' | 'medium' | 'large';
  recipientName: string;
  recipientPhone: string;
  deliveryNote: string;
  whoPays: 'sender' | 'recipient';
  photoPath: string | null;
}

interface ParcelBookingSheetProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (data: ParcelBookingData) => void;
  submitting: boolean;
  pickupName: string;
  dropoffName: string;
  distanceKm: number;
  fare: number;
  currencySymbol: string;
  paymentMethod: 'cash' | 'wallet';
  packageSize: 'small' | 'medium' | 'large';
  onPackageSizeChange: (size: 'small' | 'medium' | 'large') => void;
}

const SIZE_TILES: { id: 'small' | 'medium' | 'large'; label: string; hint: string; icon: typeof Package }[] = [
  { id: 'small', label: 'Small', hint: 'Fits on a lap', icon: Package },
  { id: 'medium', label: 'Medium', hint: 'Boot space', icon: Box },
  { id: 'large', label: 'Large', hint: 'Back seat', icon: Boxes },
];

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
const tintRedWarning: CSSProperties = {
  background: 'linear-gradient(135deg, rgba(255,248,247,.9), rgba(184,17,4,.05))',
  boxShadow: 'inset 0 .5px 0 rgba(255,255,255,.9), inset 0 0 0 .5px rgba(184,17,4,.14)',
};
const photoTint: CSSProperties = {
  background: 'linear-gradient(135deg, rgba(238,243,252,.9), rgba(26,115,232,.1))',
  boxShadow: 'inset 0 .5px 0 rgba(255,255,255,.85), inset 0 0 0 .5px rgba(26,115,232,.2)',
};

export default function ParcelBookingSheet({
  open, onClose, onConfirm, submitting, pickupName, dropoffName, distanceKm, fare, currencySymbol,
  paymentMethod, packageSize, onPackageSizeChange,
}: ParcelBookingSheetProps) {
  const { user } = useAuth();
  const [recipientName, setRecipientName] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('');
  const [deliveryNote, setDeliveryNote] = useState('');
  const [whoPays, setWhoPays] = useState<'sender' | 'recipient'>('sender');
  const [recipientEditorOpen, setRecipientEditorOpen] = useState(false);
  const [whoPaysPickerOpen, setWhoPaysPickerOpen] = useState(false);

  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  // Wallet + recipient-pays is nonsensical (nobody's card is charged at the
  // door) — fall back to sender-pays the moment the payment method isn't cash.
  useEffect(() => {
    if (paymentMethod !== 'cash' && whoPays === 'recipient') setWhoPays('sender');
  }, [paymentMethod, whoPays]);

  useEffect(() => {
    return () => { if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl); };
  }, [photoPreviewUrl]);

  const handlePhotoFile = async (file: File | undefined) => {
    if (!file || !user?.id) return;
    if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    const previewUrl = URL.createObjectURL(file);
    setPhotoPreviewUrl(previewUrl);
    setPhotoUploading(true);
    try {
      const path = await uploadParcelPhoto(file, user.id);
      setPhotoPath(path);
    } catch (e) {
      toast.error('Could not upload photo', { description: (e as Error).message });
      URL.revokeObjectURL(previewUrl);
      setPhotoPreviewUrl(null);
    } finally {
      setPhotoUploading(false);
    }
  };

  const handleRemovePhoto = () => {
    if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    if (photoPath) deleteParcelPhoto(photoPath).catch(() => {});
    setPhotoPreviewUrl(null);
    setPhotoPath(null);
  };

  const handlePickRecipientFromContacts = async () => {
    const result = await pickNativeContact();
    if (result.status === 'picked') {
      setRecipientName(result.name);
      setRecipientPhone(result.phone);
      haptic('light');
    } else if (result.status === 'unsupported') {
      toast('Contacts unavailable — type the name and number in below instead.');
    }
  };

  const phoneValid = normalizePhoneZW(recipientPhone).replace(/\D/g, '').length >= 11;
  const canConfirm = recipientName.trim().length > 0 && phoneValid && !submitting && !photoUploading;

  const handleConfirm = () => {
    if (!canConfirm) return;
    onConfirm({
      packageSize,
      recipientName: recipientName.trim(),
      recipientPhone,
      deliveryNote,
      whoPays,
      photoPath,
    });
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
            <RideGlassPanel panelStyle={panelStyle} style={{ maxHeight: '90vh', paddingBottom: 'env(safe-area-inset-bottom)' }} onRibbonClick={onClose}>
              <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
                <div className="p-4" style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
                  {/* Section 1 — header */}
                  <div className="flex items-center" style={{ gap: 11 }}>
                    <img src={carParcel} alt="" style={{ width: 52, height: 38 }} className="object-contain shrink-0" />
                    <div className="min-w-0" style={{ flex: 1 }}>
                      <p style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-.02em', lineHeight: 1.2, color: RIDE_TEXT }}>Send a parcel</p>
                      <p className="truncate" style={{ marginTop: 3, fontSize: 12.5, fontWeight: 500, lineHeight: 1.2, color: RIDE_TEXT_2 }}>
                        {pickupName} → {dropoffName} · {distanceKm.toFixed(1)} km
                      </p>
                    </div>
                    <div className="flex flex-col items-end shrink-0">
                      <span className="tabular-nums" style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-.03em', lineHeight: 1, color: RIDE_RED }}>
                        {currencySymbol}{fare.toFixed(2)}
                      </span>
                      <span style={{ fontSize: 10.5, fontWeight: 600, color: RIDE_TEXT_2 }}>estimate</span>
                    </div>
                  </div>

                  {/* Section 2 — package size */}
                  <div className="flex flex-col" style={{ gap: 7 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: RIDE_TEXT_2, textTransform: 'uppercase', letterSpacing: '.12em' }}>
                      Package size
                    </span>
                    <div className="flex items-stretch" style={{ gap: 8 }}>
                      {SIZE_TILES.map((tile) => {
                        const selected = packageSize === tile.id;
                        const Icon = tile.icon;
                        return (
                          <button
                            key={tile.id}
                            type="button"
                            onClick={() => { onPackageSizeChange(tile.id); haptic('light'); }}
                            className="flex flex-col items-center active:scale-[0.97] transition-transform"
                            style={{ flex: 1, padding: '10px 4px', borderRadius: 14, gap: 3, ...(selected ? tintYellow : chipGlass) }}
                          >
                            <Icon style={{ width: 17, height: 17, color: selected ? RIDE_TEXT : RIDE_TEXT_2 }} />
                            <span style={{ fontSize: 12.5, fontWeight: 700, color: RIDE_TEXT }}>{tile.label}</span>
                            <span style={{ fontSize: 10, fontWeight: 500, color: RIDE_TEXT_2 }}>{tile.hint}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Section 3 — parcel photo */}
                  <div className="flex flex-col" style={{ gap: 7 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: RIDE_TEXT_2, textTransform: 'uppercase', letterSpacing: '.12em' }}>
                      Photo of the parcel
                    </span>
                    <div className="flex items-stretch" style={{ gap: 8 }}>
                      {photoPreviewUrl && (
                        <div className="relative shrink-0" style={{ width: 66, height: 66, borderRadius: 14, overflow: 'hidden', ...photoTint }}>
                          <img src={photoPreviewUrl} alt="" className="w-full h-full object-cover" />
                          {photoUploading && (
                            <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(255,255,255,.5)' }}>
                              <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" style={{ color: RIDE_RED }} />
                            </div>
                          )}
                          <button
                            type="button"
                            onClick={handleRemovePhoto}
                            aria-label="Remove photo"
                            className="absolute flex items-center justify-center active:scale-90 transition-transform"
                            style={{ top: 3, right: 3, width: 16, height: 16, borderRadius: 999, background: 'rgba(17,17,17,.55)' }}
                          >
                            <X style={{ width: 9, height: 9, color: '#fff' }} strokeWidth={3} />
                          </button>
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => cameraInputRef.current?.click()}
                        className="flex flex-col items-center justify-center active:scale-[0.97] transition-transform"
                        style={{ flex: 1, height: 66, borderRadius: 14, gap: 4, ...chipGlass }}
                      >
                        <Camera style={{ width: 19, height: 19, color: RIDE_TEXT }} strokeWidth={1.9} />
                        <span style={{ fontSize: 12, fontWeight: 700, color: RIDE_TEXT }}>Take photo</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => galleryInputRef.current?.click()}
                        className="flex flex-col items-center justify-center active:scale-[0.97] transition-transform"
                        style={{ flex: 1, height: 66, borderRadius: 14, gap: 4, ...chipGlass }}
                      >
                        <ImagePlus style={{ width: 19, height: 19, color: RIDE_TEXT }} strokeWidth={1.9} />
                        <span style={{ fontSize: 12, fontWeight: 700, color: RIDE_TEXT }}>Upload</span>
                      </button>
                      <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden"
                        onChange={(e) => { void handlePhotoFile(e.target.files?.[0]); e.target.value = ''; }} />
                      <input ref={galleryInputRef} type="file" accept="image/*" className="hidden"
                        onChange={(e) => { void handlePhotoFile(e.target.files?.[0]); e.target.value = ''; }} />
                    </div>
                    <p style={{ padding: '0 2px', fontSize: 10.5, fontWeight: 500, lineHeight: 1.3, color: RIDE_TEXT_2 }}>
                      Proof of what was handed over — the driver sees this too.
                    </p>
                  </div>

                  {/* Section 4 — recipient card */}
                  {recipientEditorOpen ? (
                    <div className="flex flex-col" style={{ ...tintBlue, borderRadius: 16, padding: '12px 13px', gap: 9 }}>
                      <div className="flex items-center" style={{ gap: 8 }}>
                        <input
                          value={recipientName}
                          onChange={(e) => setRecipientName(e.target.value)}
                          placeholder="Recipient name"
                          className="outline-none"
                          style={{ flex: 1, height: 38, padding: '0 10px', borderRadius: 10, fontSize: 13.5, fontWeight: 600, background: 'rgba(255,255,255,.9)', boxShadow: 'inset 0 0 0 1px rgba(17,17,17,.1)', color: RIDE_TEXT }}
                        />
                        <button
                          type="button"
                          onClick={handlePickRecipientFromContacts}
                          aria-label="Pick from contacts"
                          className="shrink-0 flex items-center justify-center active:scale-90 transition-transform"
                          style={{ width: 38, height: 38, borderRadius: 10, background: 'rgba(255,255,255,.9)', boxShadow: 'inset 0 0 0 1px rgba(17,17,17,.1)' }}
                        >
                          <User style={{ width: 17, height: 17, color: '#1A73E8' }} />
                        </button>
                      </div>
                      <input
                        value={recipientPhone}
                        onChange={(e) => setRecipientPhone(e.target.value)}
                        placeholder="Phone number (e.g. 077 234 1180)"
                        type="tel"
                        className="w-full outline-none tabular-nums"
                        style={{ height: 38, padding: '0 10px', borderRadius: 10, fontSize: 13.5, fontWeight: 600, background: 'rgba(255,255,255,.9)', boxShadow: 'inset 0 0 0 1px rgba(17,17,17,.1)', color: RIDE_TEXT }}
                      />
                      <textarea
                        value={deliveryNote}
                        onChange={(e) => setDeliveryNote(e.target.value)}
                        placeholder="Delivery note — e.g. hand to reception, not the gate"
                        rows={2}
                        maxLength={140}
                        className="w-full outline-none resize-none"
                        style={{ padding: '8px 10px', borderRadius: 10, fontSize: 13, fontWeight: 500, background: 'rgba(255,255,255,.9)', boxShadow: 'inset 0 0 0 1px rgba(17,17,17,.1)', color: RIDE_TEXT_3 }}
                      />
                      <button
                        type="button"
                        onClick={() => setRecipientEditorOpen(false)}
                        disabled={!recipientName.trim() || !phoneValid}
                        className="flex items-center justify-center active:scale-95 transition-transform disabled:opacity-50"
                        style={{ height: 36, borderRadius: 10, background: RIDE_RED }}
                      >
                        <span style={{ fontSize: 12.5, fontWeight: 700, color: '#fff' }}>Done</span>
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setRecipientEditorOpen(true)}
                      className="flex flex-col w-full text-left active:scale-[0.99] transition-transform"
                      style={{ ...tintBlue, borderRadius: 16, overflow: 'hidden' }}
                    >
                      <div className="flex items-center" style={{ padding: '11px 13px', gap: 11 }}>
                        <User style={{ width: 17, height: 17, color: '#1A73E8' }} strokeWidth={2} className="shrink-0" />
                        <div className="min-w-0" style={{ flex: 1 }}>
                          <span style={{ fontSize: 10.5, fontWeight: 700, color: RIDE_TEXT_2, textTransform: 'uppercase', letterSpacing: '.06em' }}>Receiving</span>
                          <p className="truncate" style={{ marginTop: 2, fontSize: 14.5, fontWeight: 600, lineHeight: 1.2, color: RIDE_TEXT }}>
                            {recipientName || 'Add recipient details'}
                          </p>
                        </div>
                        {recipientPhone && (
                          <span className="tabular-nums shrink-0" style={{ fontSize: 13, fontWeight: 600, color: RIDE_TEXT }}>{recipientPhone}</span>
                        )}
                      </div>
                      {(deliveryNote || !recipientName) && (
                        <>
                          <span style={{ height: 0.5, background: 'rgba(17,17,17,.08)' }} />
                          <div className="flex items-center" style={{ padding: '11px 13px', gap: 11 }}>
                            <MessageSquare style={{ width: 17, height: 17, color: '#1A73E8' }} strokeWidth={2} className="shrink-0" />
                            <p style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.35, color: RIDE_TEXT_3 }}>
                              {deliveryNote || 'Tap to add a name, phone and delivery note'}
                            </p>
                          </div>
                        </>
                      )}
                    </button>
                  )}

                  {/* Section 5 — who pays */}
                  {whoPaysPickerOpen ? (
                    <div className="flex flex-col" style={{ borderRadius: 15, overflow: 'hidden', ...chipGlass }}>
                      {(['sender', 'recipient'] as const).map((opt) => {
                        const disabled = opt === 'recipient' && paymentMethod !== 'cash';
                        return (
                          <button
                            key={opt}
                            type="button"
                            disabled={disabled}
                            onClick={() => { setWhoPays(opt); setWhoPaysPickerOpen(false); haptic('light'); }}
                            className="flex items-center justify-between w-full text-left disabled:opacity-40"
                            style={{ padding: '11px 14px' }}
                          >
                            <div>
                              <p style={{ fontSize: 13.5, fontWeight: 700, color: RIDE_TEXT }}>
                                {opt === 'sender' ? 'I pay now' : 'Recipient pays on delivery'}
                              </p>
                              {disabled && <p style={{ fontSize: 10.5, fontWeight: 500, color: RIDE_TEXT_2, marginTop: 1 }}>Cash only</p>}
                            </div>
                            {whoPays === opt && <span className="rounded-full" style={{ width: 8, height: 8, background: RIDE_RED }} />}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setWhoPaysPickerOpen(true)}
                      className="flex items-center w-full text-left active:scale-[0.98] transition-transform"
                      style={{ height: 44, padding: '0 14px', borderRadius: 15, gap: 10, ...chipGlass }}
                    >
                      <Banknote style={{ width: 17, height: 17, color: RIDE_TEXT }} strokeWidth={1.9} />
                      <span style={{ flex: 1, fontSize: 14, fontWeight: 500, color: RIDE_TEXT }}>Who pays the driver</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: RIDE_TEXT }}>
                        {whoPays === 'sender' ? 'I pay now' : 'Recipient pays'}
                      </span>
                      <ChevronRight style={{ width: 15, height: 15, color: RIDE_TEXT_2 }} className="shrink-0" />
                    </button>
                  )}

                  {/* Section 6 — contents warning */}
                  <div className="flex items-start" style={{ ...tintRedWarning, borderRadius: 16, padding: '10px 12px', gap: 9 }}>
                    <ShieldAlert style={{ width: 16, height: 16, color: RIDE_RED, marginTop: 1 }} strokeWidth={2} className="shrink-0" />
                    <p style={{ fontSize: 12, fontWeight: 500, lineHeight: 1.4, color: RIDE_TEXT_3 }}>
                      No cash, phones or fragile electronics. CruiXe does not insure parcel contents.
                    </p>
                  </div>

                  {/* Section 7 — action row */}
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
                      onClick={handleConfirm}
                      disabled={!canConfirm}
                      className="flex items-center justify-center active:scale-[0.97] transition-transform relative overflow-hidden disabled:opacity-50"
                      style={{ flex: 1, height: 48, borderRadius: 15, ...redCta }}
                    >
                      <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2" style={{ background: 'linear-gradient(180deg, rgba(255,255,255,.2), rgba(255,255,255,0))' }} />
                      <span className="relative" style={{ fontSize: 15.5, fontWeight: 700 }}>
                        {submitting ? 'Finding a driver…' : `Find a driver · ${currencySymbol}${fare.toFixed(2)}`}
                      </span>
                    </button>
                  </div>

                  {/* Section 8 — iOS home indicator */}
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
  );
}
