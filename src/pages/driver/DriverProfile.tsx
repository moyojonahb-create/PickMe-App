import { useEffect, useState, useCallback, type CSSProperties, type ReactNode, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Camera, Loader2, Star, BadgeCheck, Pencil, Power, Car, ChevronRight,
  Copy, Check, FileCheck2, ChartColumn, Bell, Volume2,
  ShieldAlert, CircleHelp, Clock, CreditCard,
} from 'lucide-react';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/hooks/useAuth';
import { getDriverProfile, fetchOpenRides } from '@/lib/offerHelpers';
import { fetchDriverWeekStats, type DriverWeekStats } from '@/lib/driverStats';
import { listWalletDeposits } from '@/lib/walletApi';
import { setDriverOnline } from '@/lib/driverPresence';
import { updateMyProfileAvatar } from '@/lib/businessApi';
import { useVoiceNavigation } from '@/hooks/useVoiceNavigation';
import PhotoCropModal from '@/components/driver/PhotoCropModal';
import LanguageRow from '@/components/driver/LanguageRow';
import DriverFeedback from '@/components/driver/DriverFeedback';
import DriverSettingsPanel from '@/components/settings/DriverSettingsPanel';
import DriverBottomNav from '@/components/driver/DriverBottomNav';
import defaultDriverAvatar from '@/assets/driver-avatar-jonah.png';
import { RIDE_RED, RIDE_RED_GRADIENT, RIDE_YELLOW, RIDE_TEXT, RIDE_TEXT_2 } from '@/components/ride/rideGlass';
import type { DriverProfile as DriverProfileData } from '@/lib/offerHelpers';

const glassSurface: CSSProperties = {
  background: 'linear-gradient(160deg, rgba(255,255,255,.8), rgba(255,255,255,.48))',
  boxShadow: 'inset 0 .75px 0 rgba(255,255,255,.98), inset 0 0 0 .5px rgba(17,17,17,.09)',
};
const tintBlue: CSSProperties = {
  background: 'linear-gradient(135deg, rgba(238,243,252,.85), rgba(26,115,232,.07))',
  boxShadow: 'inset 0 0 0 .5px rgba(255,255,255,.6), 0 6px 14px rgba(0,0,0,.05)',
};
const tintRed: CSSProperties = {
  background: 'linear-gradient(135deg, rgba(255,248,247,.95), rgba(184,17,4,.06))',
  boxShadow: 'inset 0 .5px 0 rgba(255,255,255,.9), inset 0 0 0 .5px rgba(184,17,4,.18)',
};

const DOCUMENT_EXPIRY_WARNING_DAYS = 14;

interface DriverDocRow {
  document_type: string;
  status: string;
  expiry_date: string | null;
}

function fmtUSD(n: number): string {
  return `$${n.toFixed(2)}`;
}

export default function DriverProfilePage() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();

  const [profile, setProfile] = useState<DriverProfileData | null>(null);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState<string | null>(null);
  const [balance, setBalance] = useState(0);
  const [proofStatus, setProofStatus] = useState<string | null>(null);
  const [lastDepositAmount, setLastDepositAmount] = useState<number | null>(null);
  const [lastDepositDate, setLastDepositDate] = useState<string | null>(null);
  const [weekStats, setWeekStats] = useState<DriverWeekStats | null>(null);
  const [waitingCount, setWaitingCount] = useState(0);
  const [documents, setDocuments] = useState<DriverDocRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [pendingAvatarFile, setPendingAvatarFile] = useState<File | null>(null);
  const [uploadingVehiclePhoto, setUploadingVehiclePhoto] = useState(false);
  const [pendingVehiclePhotoFile, setPendingVehiclePhotoFile] = useState<File | null>(null);
  const [togglingOnline, setTogglingOnline] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const [emergencyName, setEmergencyName] = useState('');
  const [emergencyPhone, setEmergencyPhone] = useState('');
  const [savingEmergency, setSavingEmergency] = useState(false);
  const { isSupported: voiceSupported } = useVoiceNavigation({ enabled: voiceEnabled });

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [driverProfile, profileRow] = await Promise.all([
        getDriverProfile(),
        supabase.from('profiles').select('full_name, phone, emergency_contact_name, emergency_contact_phone').eq('user_id', user.id).maybeSingle(),
      ]);
      setProfile(driverProfile);
      setFullName(profileRow.data?.full_name || user.email?.split('@')[0] || 'Driver');
      setPhone(profileRow.data?.phone ?? null);
      setEmergencyName(profileRow.data?.emergency_contact_name ?? '');
      setEmergencyPhone(profileRow.data?.emergency_contact_phone ?? '');

      if (driverProfile) {
        fetchDriverWeekStats(driverProfile.id, driverProfile.created_at).then(setWeekStats).catch(() => {});
        fetchOpenRides(driverProfile.gender).then((rows) => setWaitingCount(rows.length)).catch(() => {});
      }
    } catch (e) {
      toast.error('Could not load profile', { description: (e as Error).message });
    } finally {
      setLoading(false);
    }

    // Wallet balance reads the wallets table directly — the Go backend's
    // /api/wallets/* endpoints all query public.wallet_accounts, which
    // doesn't exist in this database (see the pre-launch audit fixes), so
    // they never return anything usable. wallets/user_id is the one table
    // that's actually real and readable under the driver's own RLS policy.
    supabase.from('wallets').select('balance').eq('user_id', user.id).maybeSingle()
      .then(({ data }) => { if (data) setBalance(Number(data.balance)); }, () => {});

    listWalletDeposits({ type: 'driver', limit: 1 })
      .then((deposits) => {
        const d = deposits[0];
        setProofStatus(d?.status ?? null);
        setLastDepositAmount(d ? Number(d.amount_usd ?? 0) : null);
        setLastDepositDate(d?.created_at ?? null);
      })
      .catch(() => setProofStatus(null));

    supabase.from('driver_documents').select('document_type, status, expiry_date').eq('driver_id', user.id)
      .then(({ data }) => setDocuments((data as DriverDocRow[]) ?? []), () => setDocuments([]));

    const { data: photoRow } = await supabase.from('drivers').select('vehicle_photo_url').eq('user_id', user.id).maybeSingle();
    if (photoRow) {
      setProfile((prev) => (prev ? { ...prev, vehicle_photo_url: photoRow.vehicle_photo_url } : prev));
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const handleToggleOnline = async () => {
    if (!profile) return;
    const next = !profile.is_online;
    setTogglingOnline(true);
    try {
      await setDriverOnline(next);
      setProfile((prev) => (prev ? { ...prev, is_online: next } : prev));
      toast.success(next ? "You're now online!" : "You're now offline");
    } catch (e) {
      toast.error('Failed to update status', { description: (e as Error).message });
    } finally {
      setTogglingOnline(false);
    }
  };

  const handleAvatarFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error('Photo must be less than 5MB'); return; }
    setPendingAvatarFile(file);
  };

  const handleAvatarCropped = async (blob: Blob) => {
    setPendingAvatarFile(null);
    if (!user) return;
    setUploadingAvatar(true);
    try {
      const path = `${user.id}/avatar.jpg`;
      const { error: uploadErr } = await supabase.storage.from('driver-avatars').upload(path, blob, { upsert: true, contentType: 'image/jpeg' });
      if (uploadErr) throw uploadErr;
      const { data: signedData, error: signedErr } = await supabase.storage.from('driver-avatars').createSignedUrl(path, 60 * 60 * 24 * 365);
      if (signedErr || !signedData?.signedUrl) throw signedErr || new Error('Failed to get URL');
      await updateMyProfileAvatar(path);
      const { error: driverErr } = await supabase.from('drivers').update({ avatar_url: signedData.signedUrl } as never).eq('user_id', user.id);
      if (driverErr) throw driverErr;
      setProfile((prev) => (prev ? { ...prev, avatar_url: signedData.signedUrl } : prev));
      toast.success('Photo updated!');
    } catch (err: unknown) {
      toast.error('Upload failed', { description: (err as Error).message });
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleVehiclePhotoFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { toast.error('Photo must be less than 8MB'); return; }
    setPendingVehiclePhotoFile(file);
  };

  const handleVehiclePhotoCropped = async (blob: Blob) => {
    setPendingVehiclePhotoFile(null);
    if (!user) return;
    setUploadingVehiclePhoto(true);
    try {
      const path = `${user.id}/car.jpg`;
      const { error: uploadErr } = await supabase.storage.from('vehicle-photos').upload(path, blob, { upsert: true, contentType: 'image/jpeg' });
      if (uploadErr) throw uploadErr;
      const { data: signedData, error: signedErr } = await supabase.storage.from('vehicle-photos').createSignedUrl(path, 60 * 60 * 24 * 365);
      if (signedErr || !signedData?.signedUrl) throw signedErr || new Error('Failed to get URL');
      const { error: driverErr } = await supabase.from('drivers').update({ vehicle_photo_url: signedData.signedUrl } as never).eq('user_id', user.id);
      if (driverErr) throw driverErr;
      setProfile((prev) => (prev ? { ...prev, vehicle_photo_url: signedData.signedUrl } : prev));
      toast.success('Car photo updated!');
    } catch (err: unknown) {
      toast.error('Upload failed', { description: (err as Error).message });
    } finally {
      setUploadingVehiclePhoto(false);
    }
  };

  const saveEmergencyContact = async () => {
    if (!user) return;
    setSavingEmergency(true);
    try {
      const { error } = await supabase.from('profiles').update({
        emergency_contact_name: emergencyName.trim() || null,
        emergency_contact_phone: emergencyPhone.trim() || null,
      } as never).eq('user_id', user.id);
      if (error) throw error;
      toast.success('Emergency contact saved');
      setEmergencyOpen(false);
    } catch (e) {
      toast.error('Could not save', { description: (e as Error).message });
    } finally {
      setSavingEmergency(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[100dvh] pb-24" style={{ background: '#F2F4F7' }}>
        <div className="p-4 space-y-3 max-w-lg mx-auto">
          <div className="h-52 rounded-3xl bg-muted animate-pulse" />
          <div className="h-16 rounded-2xl bg-muted animate-pulse" />
          <div className="h-40 rounded-2xl bg-muted animate-pulse" />
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-[100dvh] bg-background flex flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="font-bold text-foreground">Driver profile not found</p>
        <p className="text-sm text-muted-foreground">Complete driver registration first.</p>
        <button onClick={() => navigate('/driver/register')} className="mt-2 px-5 py-2.5 rounded-full bg-primary text-primary-foreground font-bold text-sm">
          Register as a driver
        </button>
      </div>
    );
  }

  const vehicleTitle = [profile.vehicle_make, profile.vehicle_model].filter(Boolean).join(' ') || 'Vehicle';
  const isOnline = profile.is_online ?? false;

  const expiringDoc = documents.find((d) => {
    if (!d.expiry_date) return false;
    const days = (new Date(d.expiry_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    return days <= DOCUMENT_EXPIRY_WARNING_DAYS;
  });

  return (
    <div className="min-h-[100dvh] pb-24" style={{ background: '#F2F4F7', fontFamily: "-apple-system, 'SF Pro Text', 'SF Pro Display', system-ui, sans-serif" }}>
      {/* Header */}
      <div style={{ background: RIDE_RED_GRADIENT, padding: '59px 16px 18px' }}>
        <div className="max-w-lg mx-auto">
          <div className="flex items-center" style={{ gap: 13 }}>
            <label className="relative shrink-0 cursor-pointer">
              <div className="rounded-full bg-white/95 overflow-hidden flex items-center justify-center" style={{ width: 60, height: 60, boxShadow: '0 0 0 2px rgba(255,255,255,.4)' }}>
                <img src={profile.avatar_url || defaultDriverAvatar} alt={fullName} className="w-full h-full object-cover" />
              </div>
              <span className="absolute -bottom-0.5 -right-0.5 rounded-full bg-white flex items-center justify-center border-2" style={{ width: 22, height: 22, borderColor: RIDE_RED }}>
                {uploadingAvatar ? <Loader2 className="w-3 h-3 animate-spin" style={{ color: RIDE_RED }} /> : <Camera className="w-3 h-3" style={{ color: RIDE_RED }} />}
              </span>
              <input type="file" accept="image/*" className="hidden" onChange={handleAvatarFile} disabled={uploadingAvatar} />
            </label>

            <div className="flex-1 min-w-0">
              <p className="truncate text-white" style={{ fontSize: 20, fontWeight: 700 }}>{fullName}</p>
              <div className="flex items-center flex-wrap" style={{ marginTop: 2, gap: 6, fontSize: 12.5, color: 'rgba(255,255,255,.85)' }}>
                <span className="flex items-center" style={{ gap: 3 }}>
                  <Star style={{ width: 12, height: 12 }} fill="#fff" color="#fff" />
                  {profile.rating_avg ? profile.rating_avg.toFixed(1) : 'New'}
                </span>
                {profile.status === 'approved' && (
                  <span className="flex items-center" style={{ gap: 3 }}>
                    <BadgeCheck style={{ width: 13, height: 13 }} /> Verified
                  </span>
                )}
                {phone && <span>· {phone}</span>}
              </div>
            </div>

            <button
              type="button"
              onClick={() => setNotificationsOpen(true)}
              aria-label="Edit profile"
              className="shrink-0 flex items-center justify-center rounded-full active:scale-90 transition-transform"
              style={{ width: 36, height: 36, background: 'rgba(255,255,255,.2)' }}
            >
              <Pencil style={{ width: 15, height: 15, color: '#fff' }} />
            </button>
          </div>

          {/* Stat pills */}
          <div className="flex" style={{ marginTop: 16, gap: 8 }}>
            {[
              { label: 'This week', value: weekStats ? fmtUSD(weekStats.weekEarnings) : '—' },
              { label: 'Completed', value: weekStats?.completionRate != null ? `${weekStats.completionRate}%` : '—' },
              { label: 'On CruiXe', value: weekStats ? `${weekStats.monthsOnPickMe} mo` : '—' },
            ].map((s) => (
              <div key={s.label} className="flex-1 flex flex-col items-center" style={{ background: 'rgba(255,255,255,.94)', borderRadius: 13, padding: '9px 4px' }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: RIDE_TEXT_2, textTransform: 'uppercase', letterSpacing: '.04em' }}>{s.label}</span>
                <span className="tabular-nums" style={{ fontSize: 17, fontWeight: 700, color: RIDE_TEXT, marginTop: 2 }}>{s.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4" style={{ paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Online / request-room block — two separate controls, not nested
            buttons: a <button> inside a <button> is invalid HTML and makes
            taps on the inner one unreliably bubble into the outer navigate. */}
        <div
          className="flex items-center"
          style={{
            padding: '12px 14px', borderRadius: 16, gap: 12,
            background: RIDE_RED_GRADIENT,
            boxShadow: '0 12px 26px rgba(184,17,4,.3), inset 0 1px 0 rgba(255,255,255,.28)',
          }}
        >
          <button
            type="button"
            aria-label={isOnline ? 'Go offline' : 'Go online'}
            onClick={handleToggleOnline}
            disabled={togglingOnline}
            className="shrink-0 flex items-center justify-center rounded-full active:scale-90 transition-all disabled:opacity-70"
            style={{
              width: 44,
              height: 44,
              background: isOnline ? '#FFFFFF' : '#111111',
              boxShadow: isOnline
                ? '0 4px 14px rgba(0,0,0,.18), inset 0 0 0 .5px rgba(17,17,17,.08)'
                : '0 4px 14px rgba(0,0,0,.35)',
            }}
          >
            {togglingOnline
              ? <Loader2 className="animate-spin" style={{ width: 20, height: 20, color: isOnline ? RIDE_RED : '#fff' }} />
              : <Power style={{ width: 20, height: 20, color: isOnline ? RIDE_RED : '#fff' }} />}
          </button>

          <button
            type="button"
            onClick={handleToggleOnline}
            disabled={togglingOnline}
            className="flex-1 min-w-0 text-left disabled:opacity-70"
          >
            <p style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>{isOnline ? "You're online" : "You're offline"}</p>
            <p style={{ fontSize: 11.5, fontWeight: 500, color: 'rgba(255,255,255,.8)', marginTop: 1 }}>
              {isOnline
                ? (waitingCount > 0 ? `${waitingCount} request${waitingCount === 1 ? '' : 's'} waiting` : 'No requests waiting')
                : 'Tap to go online'}
            </p>
          </button>
          <button
            type="button"
            onClick={() => navigate('/driver/requests')}
            className="shrink-0 flex items-center justify-center active:scale-95 transition-transform"
            style={{ height: 36, padding: '0 14px', borderRadius: 999, background: RIDE_YELLOW }}
          >
            <span style={{ fontSize: 13, fontWeight: 700, color: '#1F1F1F' }}>Go to request room</span>
          </button>
        </div>

        {/* Vehicle */}
        <section>
          <p style={{ fontSize: 11, fontWeight: 700, color: RIDE_TEXT_2, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 8 }}>Your vehicle</p>
          <div className="flex flex-col" style={{ ...glassSurface, borderRadius: 16, overflow: 'hidden' }}>
            <div className="flex items-center" style={{ padding: '11px 13px', gap: 12 }}>
              <span className="shrink-0 flex items-center justify-center rounded-2xl overflow-hidden" style={{ width: 56, height: 40, background: 'rgba(184,17,4,.08)' }}>
                {profile.vehicle_photo_url ? (
                  <img src={profile.vehicle_photo_url} alt={vehicleTitle} className="w-full h-full object-cover" />
                ) : (
                  <Car style={{ width: 20, height: 20, color: RIDE_RED }} />
                )}
              </span>
              <div className="min-w-0" style={{ flex: 1 }}>
                <p className="truncate" style={{ fontSize: 14.5, fontWeight: 700, color: RIDE_TEXT }}>
                  {vehicleTitle}{profile.vehicle_color ? ` · ${profile.vehicle_color}` : ''}
                </p>
                <p style={{ fontSize: 11.5, fontWeight: 500, color: RIDE_TEXT_2, marginTop: 1 }}>
                  {[profile.vehicle_type, '4 seats'].filter(Boolean).join(' · ') || 'Vehicle type not set'}
                </p>
              </div>
              {profile.plate_number && (
                <span className="shrink-0" style={{ padding: '4px 10px', borderRadius: 999, background: RIDE_TEXT, color: '#fff', fontSize: 12, fontWeight: 700, letterSpacing: '.03em' }}>
                  {profile.plate_number}
                </span>
              )}
            </div>
            <label className="flex items-center justify-between w-full text-left cursor-pointer" style={{ padding: '10px 13px', borderTop: '.5px solid rgba(17,17,17,.07)' }}>
              <span className="flex items-center" style={{ gap: 8 }}>
                {uploadingVehiclePhoto ? <Loader2 className="animate-spin" style={{ width: 15, height: 15, color: RIDE_TEXT_2 }} /> : <Camera style={{ width: 15, height: 15, color: RIDE_TEXT_2 }} />}
                <span style={{ fontSize: 13, fontWeight: 600, color: RIDE_TEXT }}>Vehicle photo</span>
              </span>
              <span className="flex items-center" style={{ gap: 4, fontSize: 12, fontWeight: 700, color: profile.vehicle_photo_url ? '#22A447' : RIDE_TEXT_2 }}>
                {profile.vehicle_photo_url ? 'Added' : 'Add'}
                <ChevronRight style={{ width: 14, height: 14 }} />
              </span>
              <input type="file" accept="image/*" className="hidden" onChange={handleVehiclePhotoFile} disabled={uploadingVehiclePhoto} />
            </label>
          </div>
        </section>

        {/* Wallet */}
        <section>
          <p style={{ fontSize: 11, fontWeight: 700, color: RIDE_TEXT_2, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 8 }}>Wallet</p>
          <button
            type="button"
            onClick={() => navigate('/driver/wallet')}
            className="flex items-center w-full text-left active:scale-[0.98] transition-transform"
            style={{ ...tintBlue, borderRadius: 15, padding: '12px 14px', gap: 10, marginBottom: 10 }}
          >
            <CreditCard style={{ width: 17, height: 17, color: '#1A73E8' }} />
            <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: RIDE_TEXT }}>Open wallet</span>
            <span className="tabular-nums" style={{ fontSize: 15, fontWeight: 700, color: RIDE_TEXT }}>{fmtUSD(balance)}</span>
            <ChevronRight style={{ width: 15, height: 15, color: RIDE_TEXT_2 }} />
          </button>

          <DriverWalletCard fullName={fullName} balance={balance} phone={phone} createdAt={profile.created_at} onTopUp={() => navigate('/driver/deposit')} />

          {lastDepositAmount != null && (
            <button
              type="button"
              onClick={() => navigate('/driver/deposit')}
              className="flex items-center w-full text-left"
              style={{ marginTop: 10, padding: '10px 13px', borderRadius: 14, ...glassSurface }}
            >
              <span style={{ flex: 1, fontSize: 12.5, fontWeight: 500, color: RIDE_TEXT_2 }}>
                Last deposit · <span style={{ color: RIDE_TEXT, fontWeight: 700 }}>{fmtUSD(lastDepositAmount)}</span>
                {lastDepositDate ? ` · ${new Date(lastDepositDate).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : ''}
              </span>
              {proofStatus === 'pending' && (
                <span style={{ padding: '3px 9px', borderRadius: 999, background: RIDE_RED, color: '#fff', fontSize: 10.5, fontWeight: 700 }}>Pending</span>
              )}
            </button>
          )}

          <button type="button" onClick={() => navigate('/driver/wallet')} className="flex items-center w-full text-left" style={{ marginTop: 8, padding: '10px 13px', borderRadius: 14, ...glassSurface }}>
            <CreditCard style={{ width: 16, height: 16, color: RIDE_TEXT_2 }} />
            <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: RIDE_TEXT, marginLeft: 8 }}>Payment methods</span>
            <ChevronRight style={{ width: 15, height: 15, color: RIDE_TEXT_2 }} />
          </button>
        </section>

        {/* Documents */}
        <section>
          <button
            type="button"
            onClick={() => navigate('/driver/application')}
            className="flex items-center w-full text-left active:scale-[0.98] transition-transform"
            style={{ ...(expiringDoc ? tintRed : glassSurface), borderRadius: 16, padding: '12px 14px', gap: 12 }}
          >
            <span className="shrink-0 flex items-center justify-center rounded-2xl" style={{ width: 38, height: 38, background: expiringDoc ? 'rgba(184,17,4,.1)' : 'rgba(34,164,71,.1)' }}>
              <FileCheck2 style={{ width: 18, height: 18, color: expiringDoc ? RIDE_RED : '#22A447' }} />
            </span>
            <div className="flex-1 min-w-0">
              <span className="flex items-center" style={{ gap: 7 }}>
                <span style={{ fontSize: 14.5, fontWeight: 700, color: RIDE_TEXT }}>Documents</span>
                {expiringDoc && (
                  <span style={{ padding: '2px 8px', borderRadius: 999, background: 'rgba(184,17,4,.12)', color: RIDE_RED, fontSize: 10.5, fontWeight: 700 }}>1 expiring</span>
                )}
              </span>
              <p style={{ fontSize: 11.5, fontWeight: 500, color: expiringDoc ? RIDE_RED : RIDE_TEXT_2, marginTop: 2 }}>
                {expiringDoc
                  ? `${expiringDoc.document_type.replace(/_/g, ' ')} expires ${new Date(expiringDoc.expiry_date!).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`
                  : documents.length > 0 ? 'Licence, registration, ID — all verified' : 'Complete your document upload'}
              </p>
            </div>
            <ChevronRight style={{ width: 16, height: 16, color: RIDE_TEXT_2 }} />
          </button>
        </section>

        {/* Account */}
        <section>
          <p style={{ fontSize: 11, fontWeight: 700, color: RIDE_TEXT_2, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 8 }}>Account</p>
          <div style={{ ...glassSurface, borderRadius: 16, overflow: 'hidden' }}>
            <AccountRow icon={ChartColumn} label="Earnings & trip history" onClick={() => navigate('/driver/trips')} />
            <AccountRow icon={Star} label="Ratings & feedback" onClick={() => setFeedbackOpen(true)} />
            <div style={{ padding: '0 14px' }}><LanguageRow /></div>
            <AccountRow icon={Bell} label="Settings & notifications" onClick={() => setNotificationsOpen(true)} />
            <AccountRow
              icon={Volume2}
              label="Voice navigation"
              trailing={
                <span
                  role="switch"
                  aria-checked={voiceEnabled}
                  onClick={(e) => { e.stopPropagation(); setVoiceEnabled((v) => !v); }}
                  className="shrink-0 flex items-center"
                  style={{ width: 40, height: 24, borderRadius: 999, padding: '0 3px', justifyContent: voiceEnabled ? 'flex-end' : 'flex-start', background: voiceEnabled ? RIDE_RED : 'rgba(17,17,17,.14)' }}
                >
                  <span className="rounded-full" style={{ width: 18, height: 18, background: '#fff' }} />
                </span>
              }
              disabled={!voiceSupported}
            />
            <AccountRow icon={ShieldAlert} label="Safety & emergency contact" iconColor={RIDE_RED} onClick={() => setEmergencyOpen(true)} />
            <AccountRow icon={CircleHelp} label="Help & support" href="mailto:support@pickme.co.zw" last />
          </div>
        </section>

        <button type="button" onClick={() => signOut()} className="text-center" style={{ padding: '14px 0 4px', fontSize: 13.5, fontWeight: 700, color: RIDE_RED }}>
          Log out
        </button>
      </div>

      <PhotoCropModal file={pendingAvatarFile} shape="circle" title="Adjust your photo" onCancel={() => setPendingAvatarFile(null)} onCropped={handleAvatarCropped} />
      <PhotoCropModal file={pendingVehiclePhotoFile} shape="rect" aspect={4 / 3} title="Adjust your car photo" onCancel={() => setPendingVehiclePhotoFile(null)} onCropped={handleVehiclePhotoCropped} />

      <Sheet open={feedbackOpen} onOpenChange={setFeedbackOpen}>
        <SheetContent side="bottom" className="h-[85dvh] rounded-t-3xl overflow-y-auto">
          <SheetHeader className="mb-2"><SheetTitle>Ratings & feedback</SheetTitle></SheetHeader>
          <DriverFeedback />
        </SheetContent>
      </Sheet>

      <Sheet open={notificationsOpen} onOpenChange={setNotificationsOpen}>
        <SheetContent side="bottom" className="h-[75dvh] rounded-t-3xl overflow-y-auto p-5">
          <SheetHeader className="mb-3"><SheetTitle>Settings</SheetTitle></SheetHeader>
          <DriverSettingsPanel
            driverId={profile.id}
            initialArea={profile.preferred_service_area ?? 'both'}
            initialEarningNotif={profile.earning_notifications ?? true}
            initialEcocash={profile.ecocash_number ?? ''}
          />
        </SheetContent>
      </Sheet>

      <Sheet open={emergencyOpen} onOpenChange={setEmergencyOpen}>
        <SheetContent side="bottom" className="rounded-t-3xl p-5 space-y-4" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 20px)' }}>
          <SheetHeader><SheetTitle>Emergency contact</SheetTitle></SheetHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Contact name</label>
              <input value={emergencyName} onChange={(e) => setEmergencyName(e.target.value)} placeholder="e.g. Rudo Moyo" className="w-full h-12 rounded-xl bg-muted/50 border-0 px-3.5 text-sm outline-none" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Phone number</label>
              <input value={emergencyPhone} onChange={(e) => setEmergencyPhone(e.target.value)} type="tel" placeholder="e.g. 077 419 6620" className="w-full h-12 rounded-xl bg-muted/50 border-0 px-3.5 text-sm outline-none" />
            </div>
          </div>
          <button onClick={saveEmergencyContact} disabled={savingEmergency} className="w-full h-12 rounded-xl font-bold text-sm text-white disabled:opacity-60" style={{ background: RIDE_RED_GRADIENT }}>
            {savingEmergency ? 'Saving…' : 'Save'}
          </button>
        </SheetContent>
      </Sheet>

      <DriverBottomNav />
    </div>
  );
}

function AccountRow({
  icon: Icon, label, onClick, href, trailing, iconColor, last, disabled,
}: {
  icon: typeof ChartColumn;
  label: string;
  onClick?: () => void;
  href?: string;
  trailing?: ReactNode;
  iconColor?: string;
  last?: boolean;
  disabled?: boolean;
}) {
  const content = (
    <>
      <Icon style={{ width: 17, height: 17, color: iconColor ?? RIDE_TEXT_2 }} />
      <span style={{ flex: 1, fontSize: 13.5, fontWeight: 500, color: RIDE_TEXT, marginLeft: 10 }}>{label}</span>
      {trailing ?? <ChevronRight style={{ width: 15, height: 15, color: RIDE_TEXT_2 }} />}
    </>
  );
  const style: CSSProperties = {
    padding: '12px 14px',
    borderTop: '.5px solid rgba(17,17,17,.07)',
    opacity: disabled ? 0.5 : 1,
  };
  if (!last) style.borderBottom = 'none';
  if (href) {
    return <a href={href} className="flex items-center" style={style}>{content}</a>;
  }
  return (
    <button type="button" onClick={disabled ? undefined : onClick} disabled={disabled} className="flex items-center w-full text-left" style={style}>
      {content}
    </button>
  );
}

function DriverWalletCard({
  fullName, balance, phone, createdAt, onTopUp,
}: {
  fullName: string;
  balance: number;
  phone: string | null;
  createdAt?: string | null;
  onTopUp: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const accountNumber = '7710 2244 8890 1156';
  const walletId = 'CRUIXE2024';
  const driverSince = createdAt
    ? new Date(createdAt).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
    : '—';

  const copyAccount = async () => {
    try {
      await navigator.clipboard.writeText(accountNumber.replace(/\s/g, ''));
      setCopied(true);
      toast.success('Account number copied');
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Could not copy');
    }
  };

  return (
    <div className="relative overflow-hidden" style={{ borderRadius: 22, background: '#fff', boxShadow: '0 10px 28px rgba(17,17,17,.1)' }}>
      <div className="absolute pointer-events-none" style={{ top: -30, right: -30, width: 130, height: 130, borderRadius: '50%', border: '18px solid rgba(184,17,4,.06)' }} />
      <div className="relative" style={{ padding: '15px 15px 0' }}>
        <div className="flex items-center justify-between">
          <span style={{ fontSize: 15, fontWeight: 700, color: RIDE_TEXT, letterSpacing: '-.01em' }}>CruiXe</span>
          <button type="button" onClick={onTopUp} className="flex items-center active:scale-95 transition-transform" style={{ height: 28, padding: '0 12px', borderRadius: 999, gap: 4, background: RIDE_RED_GRADIENT }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: '#fff' }}>+ Top up</span>
          </button>
        </div>

        <p style={{ marginTop: 14, fontSize: 9.5, fontWeight: 700, color: '#9AA1AD', textTransform: 'uppercase', letterSpacing: '.08em' }}>Account number</p>
        <button type="button" onClick={copyAccount} className="flex items-center active:opacity-70 transition-opacity" style={{ gap: 6, marginTop: 2 }}>
          <span className="tabular-nums" style={{ fontSize: 15, fontWeight: 700, color: RIDE_TEXT, letterSpacing: '.02em' }}>{accountNumber}</span>
          {copied ? <Check style={{ width: 13, height: 13, color: '#22A447' }} /> : <Copy style={{ width: 13, height: 13, color: '#9AA1AD' }} />}
        </button>

        <p style={{ marginTop: 10, fontSize: 9.5, fontWeight: 700, color: '#9AA1AD', textTransform: 'uppercase', letterSpacing: '.08em' }}>Wallet holder</p>
        <p style={{ fontSize: 13.5, fontWeight: 700, color: RIDE_TEXT, marginTop: 2 }}>{fullName}</p>

        <div className="flex items-end justify-between" style={{ marginTop: 12, paddingBottom: 14 }}>
          <div>
            <p style={{ fontSize: 9.5, fontWeight: 700, color: '#9AA1AD', textTransform: 'uppercase', letterSpacing: '.08em' }}>Balance</p>
            <p className="tabular-nums" style={{ fontSize: 20, fontWeight: 700, color: RIDE_RED, marginTop: 2 }}>{fmtUSD(balance)}</p>
          </div>
          <div className="text-right">
            <p style={{ fontSize: 9.5, fontWeight: 700, color: '#9AA1AD', textTransform: 'uppercase', letterSpacing: '.08em' }}>Phone number</p>
            <p style={{ fontSize: 12.5, fontWeight: 600, color: RIDE_TEXT, marginTop: 2 }}>{phone ?? '—'}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2" style={{ background: RIDE_RED_GRADIENT, padding: '11px 15px', rowGap: 10 }}>
        <WalletFooterStat icon={Clock} label="Driver since" value={driverSince} />
        <WalletFooterStat icon={BadgeCheck} label="Status" value="Verified" />
        <WalletFooterStat icon={CreditCard} label="Wallet ID" value={walletId} />
        <WalletFooterStat label="Scan to pay" value="Tap or scan" />
      </div>
    </div>
  );
}

function WalletFooterStat({ icon: Icon, label, value }: { icon?: typeof Clock; label: string; value: string }) {
  return (
    <div className="flex items-center" style={{ gap: 7 }}>
      {Icon && <Icon style={{ width: 12, height: 12, color: '#fff' }} />}
      <div>
        <p style={{ fontSize: 7, fontWeight: 700, color: 'rgba(255,255,255,.75)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{label}</p>
        <p style={{ fontSize: 10.5, fontWeight: 700, color: '#fff', marginTop: 1 }}>{value}</p>
      </div>
    </div>
  );
}
