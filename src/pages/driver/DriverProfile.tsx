import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Settings, Bell, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/hooks/useAuth';
import { getDriverProfile } from '@/lib/offerHelpers';
import { getDriverWalletSummary, listWalletDeposits } from '@/lib/walletApi';
import { setDriverOnline } from '@/lib/driverPresence';
import { useVoiceNavigation } from '@/hooks/useVoiceNavigation';
import DriverProfileCard from '@/components/driver/DriverProfileCard';
import WalletCard from '@/components/driver/WalletCard';
import VehicleCard from '@/components/driver/VehicleCard';
import PaymentSection from '@/components/driver/PaymentSection';
import LanguageRow from '@/components/driver/LanguageRow';
import DriverBottomNav from '@/components/driver/DriverBottomNav';
import DriverSettingsSheet from '@/components/driver/DriverSettingsSheet';
import type { DriverProfile as DriverProfileData } from '@/lib/offerHelpers';

export default function DriverProfilePage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [profile, setProfile] = useState<DriverProfileData | null>(null);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState<string | null>(null);
  const [balance, setBalance] = useState(0);
  const [walletLoading, setWalletLoading] = useState(true);
  const [proofStatus, setProofStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [togglingOnline, setTogglingOnline] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const { isSupported: voiceSupported } = useVoiceNavigation({ enabled: voiceEnabled });

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [driverProfile, profileRow] = await Promise.all([
        getDriverProfile(),
        supabase.from('profiles').select('full_name, phone').eq('user_id', user.id).maybeSingle(),
      ]);
      setProfile(driverProfile);
      setFullName(profileRow.data?.full_name || user.email?.split('@')[0] || 'Driver');
      setPhone(profileRow.data?.phone ?? null);
    } catch (e) {
      toast.error('Could not load profile', { description: (e as Error).message });
    } finally {
      setLoading(false);
    }

    setWalletLoading(true);
    try {
      const summary = await getDriverWalletSummary();
      setBalance(summary.balance);
    } catch {
      /* wallet card just shows $0.00 if unavailable */
    } finally {
      setWalletLoading(false);
    }

    try {
      const deposits = await listWalletDeposits({ type: 'driver', limit: 1 });
      setProofStatus(deposits[0]?.status ?? null);
    } catch {
      setProofStatus(null);
    }

    // vehicle_photo_url is a newer column (see supabase/migrations/20260816114709_add_vehicle_photo.sql)
    // that may not exist in every environment's DB yet — fetched separately
    // and swallowed on failure so a missing column never breaks the rest of
    // the profile page, only silently hides the vehicle-photo feature.
    const { data: photoRow, error: photoErr } = await supabase
      .from('drivers')
      .select('vehicle_photo_url')
      .eq('user_id', user.id)
      .maybeSingle();
    if (!photoErr && photoRow) {
      setProfile((prev) => (prev ? { ...prev, vehicle_photo_url: photoRow.vehicle_photo_url } : prev));
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const handleToggleOnline = async (online: boolean) => {
    setTogglingOnline(true);
    try {
      await setDriverOnline(online);
      setProfile((prev) => (prev ? { ...prev, is_online: online } : prev));
      toast.success(online ? "You're now online!" : "You're now offline");
    } catch (e) {
      toast.error('Failed to update status', { description: (e as Error).message });
    } finally {
      setTogglingOnline(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[100dvh] bg-background pb-20">
        <div className="p-4 space-y-3 max-w-lg mx-auto">
          <div className="h-32 rounded-3xl bg-muted animate-pulse" />
          <div className="h-16 rounded-2xl bg-muted animate-pulse" />
          <div className="h-16 rounded-2xl bg-muted animate-pulse" />
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

  return (
    <div className="min-h-[100dvh] bg-background pb-24">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-background/95 backdrop-blur-lg border-b border-border/50 px-4 py-3.5" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 14px)' }}>
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <button onClick={() => navigate(-1)} aria-label="Back" className="w-9 h-9 flex items-center justify-center rounded-full active:scale-90 transition-transform">
            <ArrowLeft className="w-5 h-5 text-foreground" />
          </button>
          <h1 className="text-[16px] font-bold text-foreground">Driver Profile</h1>
          <button onClick={() => setSettingsOpen(true)} aria-label="Settings" className="w-9 h-9 flex items-center justify-center rounded-full active:scale-90 transition-transform">
            <Settings className="w-5 h-5 text-foreground" />
          </button>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-3.5">
        <DriverProfileCard
          fullName={fullName}
          phone={phone}
          ratingAvg={profile.rating_avg}
          isApproved={profile.status === 'approved'}
          avatarUrl={profile.avatar_url}
          onAvatarChange={(url) => setProfile((prev) => (prev ? { ...prev, avatar_url: url } : prev))}
        />

        <WalletCard balance={balance} loading={walletLoading} onTopUp={() => navigate('/driver/deposit')} />

        <VehicleCard
          make={profile.vehicle_make}
          model={profile.vehicle_model}
          color={profile.vehicle_color}
          plate={profile.plate_number}
          vehicleType={profile.vehicle_type}
          photoUrl={profile.vehicle_photo_url}
          onPhotoChange={(url) => setProfile((prev) => (prev ? { ...prev, vehicle_photo_url: url } : prev))}
        />

        <PaymentSection
          proofStatus={proofStatus}
          onPaymentMethods={() => navigate('/driver/wallet')}
          onDeposit={() => navigate('/driver/deposit')}
          onPaymentProof={() => navigate('/driver/deposit')}
        />

        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <p className="px-4 pt-3.5 pb-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">General</p>
          <div className="px-4 border-t border-border/60">
            <LanguageRow />
          </div>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left active:opacity-70 transition-opacity border-t border-border/60"
          >
            <span className="flex items-center gap-2.5">
              <Bell className="w-4 h-4 text-muted-foreground" />
              <span className="text-[13px] font-semibold text-foreground">Notification Settings</span>
            </span>
            <span className="flex items-center gap-1 text-[13px] text-muted-foreground">
              Manage your notifications
              <ChevronRight className="w-3.5 h-3.5" />
            </span>
          </button>
        </div>
      </div>

      {profile && (
        <DriverSettingsSheet
          profile={profile}
          isOnline={profile.is_online ?? false}
          togglingOnline={togglingOnline}
          voiceEnabled={voiceEnabled}
          voiceSupported={voiceSupported}
          onToggleOnline={handleToggleOnline}
          onToggleVoice={setVoiceEnabled}
          onProfileUpdate={(updater) => setProfile((prev) => updater(prev))}
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          hideTrigger
        />
      )}

      <DriverBottomNav />
    </div>
  );
}
