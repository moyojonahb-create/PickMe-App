import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useUserRole } from '@/hooks/useUserRole';
import { useDriverStatus } from '@/hooks/useDriverStatus';
// Rider wallet removed — riders pay drivers directly
import { useProfileStats } from '@/hooks/useProfileStats';
import { useWallet } from '@/hooks/useWallet';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/lib/supabaseClient';
import { resolveAvatarUrl } from '@/lib/avatarUrl';
import {
  User, LogOut, Shield, ShieldCheck, CarFront,
  MapPin, ChevronRight, Edit3, History, Camera, Loader2, Wallet,
  ArrowLeft,
  Moon, Sun, Trash2, Gift, Navigation, Banknote, Users, Copy, Check,
  DollarSign, TrendingUp, GraduationCap,
} from 'lucide-react';
import pickMeCarIcon from '@/assets/pickme-car-icon.png';
import { useStudentProfile } from '@/hooks/useStudentProfile';
import { updateMyProfileAvatar } from '@/lib/businessApi';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import CruiXeLogo from '@/components/CruiXeLogo';
import BottomNavBar from '@/components/BottomNavBar';

import { Switch } from '@/components/ui/switch';
import { useTheme } from 'next-themes';
import RiderPreferencesSettings from '@/components/settings/RiderPreferencesSettings';
import { toast } from 'sonner';
import { haptic } from '@/lib/haptics';
import { format } from 'date-fns';

export default function RiderProfile() {
  const { user, signOut } = useAuth();
  const { isAdmin } = useUserRole();
  const { isApproved: isApprovedDriver } = useDriverStatus();
  const { stats } = useProfileStats();
  const { balance: walletBalance, loading: walletLoading } = useWallet();
  const { profile: studentProfile } = useStudentProfile();
  const [profileLoading, setProfileLoading] = useState(true);
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const isMapp = location.pathname.startsWith('/mapp');
  const prefix = isMapp ? '/mapp' : '';
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [copied, setCopied] = useState(false);

  const userName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Rider';
  const userEmail = user?.email || '';
  const initials = userName.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2);

  useEffect(() => {
    if (user) {
      supabase
        .from('profiles')
        .select('avatar_url')
        .eq('user_id', user.id)
        .maybeSingle()
        .then(async ({ data }) => {
          if (data?.avatar_url) {
            const resolved = await resolveAvatarUrl(data.avatar_url);
            if (resolved) setAvatarUrl(resolved);
          }
          setProfileLoading(false);
        });
    } else {
      setProfileLoading(false);
    }
  }, [user]);

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    if (file.size > 5 * 1024 * 1024) { toast.error('Photo must be less than 5MB'); return; }
    setUploading(true);
    try {
      const ext = file.name.split('.').pop();
      const path = `${user.id}/avatar.${ext}`;
      const { error: uploadErr } = await supabase.storage.from('driver-avatars').upload(path, file, { upsert: true });
      if (uploadErr) throw uploadErr;
      const { data: signedData, error: signedErr } = await supabase.storage.from('driver-avatars').createSignedUrl(path, 60 * 60 * 24 * 365);
      if (signedErr || !signedData?.signedUrl) throw signedErr || new Error('Failed to get URL');
      setAvatarUrl(signedData.signedUrl);
      await updateMyProfileAvatar(path);
      toast.success('Photo updated!');
    } catch (err: unknown) {
      toast.error('Upload failed', { description: (err as Error).message });
    } finally {
      setUploading(false);
    }
  };

  const handleCopyReferral = async () => {
    if (!stats.referralCode) return;
    const text = `Join CruiXe and ride! Use my code: ${stats.referralCode} — You earn $2!`;
    if (navigator.share) {
      try { await navigator.share({ title: 'Join CruiXe', text }); return; } catch { /* fallback */ }
    }
    await navigator.clipboard.writeText(stats.referralCode);
    setCopied(true);
    toast.success('Referral code copied!');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSignOut = async () => { haptic('medium'); await signOut(); navigate('/'); };

  return (
    <div className="min-h-[100dvh] bg-background relative">
      {/* Header */}
      <div className="sticky top-0 z-30 relative overflow-hidden" style={{ background: 'var(--gradient-primary)' }}>
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 80% 20%, white 0%, transparent 50%)' }} />
        <div className="relative px-4 pb-3" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 8px)' }}>
          {/* Single row: back + identity + logo */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(-1)}
              className="w-9 h-9 shrink-0 flex items-center justify-center rounded-full bg-primary-foreground/15 backdrop-blur-sm active:scale-95 transition-all"
              aria-label="Back"
            >
              <ArrowLeft className="w-4 h-4 text-primary-foreground" />
            </button>

            <label className="relative cursor-pointer group shrink-0">
              <div className="w-11 h-11 rounded-full bg-white/95 backdrop-blur-sm flex items-center justify-center ring-2 ring-accent shadow-lg overflow-hidden">
                {profileLoading ? (
                  <Skeleton className="w-full h-full rounded-full" />
                ) : avatarUrl ? (
                  <img src={avatarUrl} alt="Profile" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-sm font-bold text-primary">{initials}</span>
                )}
              </div>
              <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-accent flex items-center justify-center border-2 border-white group-hover:scale-110 transition-transform shadow-sm">
                {uploading ? <Loader2 className="w-2.5 h-2.5 animate-spin text-accent-foreground" /> : <Camera className="w-2.5 h-2.5 text-accent-foreground" />}
              </div>
              <input type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} disabled={uploading} />
            </label>

            <div className="min-w-0 flex-1">
              {profileLoading ? (
                <>
                  <Skeleton className="h-4 w-28 mb-1 bg-white/30" />
                  <Skeleton className="h-3 w-32 bg-white/20" />
                </>
              ) : (
                <>
                  <h1 className="text-base font-bold text-white truncate leading-tight drop-shadow-sm">{userName}</h1>
                </>
              )}
              <div className="flex items-center gap-1 mt-1 flex-wrap">
                <Badge className="h-[18px] text-[10px] bg-accent text-accent-foreground border-0 px-1.5 font-bold">
                  Rider
                </Badge>
                {isAdmin && user?.email?.toLowerCase() === 'moyojonahb@gmail.com' && (
                  <Badge className="h-[18px] text-[10px] bg-white/25 text-white border-0 px-1.5 cursor-pointer backdrop-blur-sm" onClick={() => navigate(`${prefix}/admin`)}>
                    <ShieldCheck className="w-2.5 h-2.5 mr-0.5" /> Admin
                  </Badge>
                )}
                {isApprovedDriver && (
                  <Badge className="h-[18px] text-[10px] bg-white/25 text-white border-0 px-1.5 cursor-pointer backdrop-blur-sm" onClick={() => navigate(`${prefix}/driver`)}>
                    <CarFront className="w-2.5 h-2.5 mr-0.5" /> Driver
                  </Badge>
                )}
              </div>
            </div>

            <div className="bg-white rounded-full px-2 py-1 shadow-md flex items-center shrink-0">
              <CruiXeLogo size="xs" />
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="relative z-10 px-4 py-4 space-y-3">
        {/* Quick actions row with stats */}
        <div className="grid grid-cols-4 gap-2">
          <QuickAction
            icon={<MapPin className="w-4 h-4" />}
            label="Ride"
            sublabel={stats.completedRides > 0 ? `${stats.completedRides} trips` : 'Book now'}
            onClick={() => navigate(`${prefix}/ride`)}
            accent
            color="yellow"
          />
          <QuickAction
            icon={<Wallet className="w-4 h-4" />}
            label="Wallet"
            sublabel={walletLoading ? '...' : `$${walletBalance.toFixed(2)}`}
            sublabelLoading={walletLoading}
            onClick={() => navigate('/wallet')}
            color="yellow"
          />
          <QuickAction
            icon={<Shield className="w-4 h-4" />}
            label="Safety"
            sublabel="SOS & contacts"
            onClick={() => navigate('/safety')}
            color="yellow"
          />
          <QuickAction
            icon={<img src={pickMeCarIcon} alt="" className="h-5 w-auto object-contain" />}
            label="Drive"
            sublabel={isApprovedDriver ? 'Active' : 'Earn $'}
            onClick={() => navigate(`${prefix}/driver`)}
            color="yellow"
          />
        </div>


        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground pt-2 px-1">Offers</p>
        {/* Referral Card */}
        {stats.referralCode && (
          <div className="glass-card rounded-2xl p-3.5 bg-gradient-to-r from-yellow-100 to-amber-50 border border-yellow-200 dark:from-yellow-950/40 dark:to-amber-950/30 dark:border-yellow-800/60">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Gift className="w-4 h-4 text-yellow-600 dark:text-yellow-400" />
                <div>
                  <p className="text-sm font-semibold text-foreground">Invite & Earn $2</p>
                  <p className="text-[10px] text-muted-foreground">
                    {stats.referralCount > 0
                      ? `${stats.referralCount} referred · $${stats.referralEarnings} earned`
                      : 'Share your code with friends'}
                  </p>
                </div>
              </div>
              <button
                onClick={handleCopyReferral}
                className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-yellow-500 text-yellow-950 text-xs font-bold active:scale-95 transition-all dark:bg-yellow-400 dark:text-yellow-950"
              >
                {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                {stats.referralCode}
              </button>
            </div>
          </div>
        )}

        {/* Student Verification Card */}
        <button
          onClick={() => navigate('/student-verification')}
          className="w-full glass-card rounded-2xl p-3.5 bg-gradient-to-r from-primary/10 to-primary/5 border border-primary/20 active:scale-[0.98] transition-all text-left"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
                <GraduationCap className="w-4 h-4 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">
                  {studentProfile?.verification_status === 'approved'
                    ? '🎓 Verified Student'
                    : studentProfile?.verification_status === 'pending'
                    ? 'Verification Pending'
                    : studentProfile?.verification_status === 'rejected'
                    ? 'Verification Rejected'
                    : 'Get $1 off every ride'}
                </p>
                <p className="text-[10px] text-muted-foreground truncate">
                  {studentProfile?.verification_status === 'approved'
                    ? '$1 off, up to 4 rides per day'
                    : studentProfile?.verification_status === 'pending'
                    ? 'Awaiting admin review'
                    : 'Verify your student status'}
                </p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
          </div>
        </button>

        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground pt-3 px-1">Settings</p>
        {/* Preferences — collapsible */}
        <details className="glass-card rounded-2xl overflow-hidden group">
          <summary className="flex items-center justify-between px-4 py-3 cursor-pointer list-none active:scale-[0.98] transition-all">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold text-foreground">Preferences</span>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground transition-transform group-open:rotate-90" />
          </summary>
          <div className="px-2 pb-3">
            <RiderPreferencesSettings />
          </div>
        </details>

        {/* Settings rows */}
        <div className="space-y-1.5">
          {/* Dark Mode */}
          <div className="w-full flex items-center gap-3 px-4 py-3 glass-card rounded-2xl">
            {theme === 'dark' ? <Moon className="w-4 h-4 text-primary" /> : <Sun className="w-4 h-4 text-accent" />}
            <span className="text-sm font-medium text-foreground flex-1">Dark Mode</span>
            <Switch checked={theme === 'dark'} onCheckedChange={(v) => setTheme(v ? 'dark' : 'light')} />
          </div>

          <NavRow
            icon={<History className="w-4 h-4 text-primary" />}
            label="Ride history"
            sublabel="Past trips, fares and pickups"
            onClick={() => navigate('/history')}
          />
          <NavRow
            icon={<User className="w-4 h-4 text-primary" />}
            label="Edit Profile"
            sublabel="Photo, name, phone"
            onClick={() => navigate(`${prefix}/edit-profile`)}
          />

          <NavRow
            icon={<Shield className="w-4 h-4 text-primary" />}
            label="Safety"
            sublabel="Emergency contacts, SOS"
            onClick={() => navigate(`${prefix}/safety`)}
          />
          <NavRow
            icon={<Trash2 className="w-4 h-4 text-destructive" />}
            label="Delete Account"
            sublabel="Permanent action"
            onClick={() => navigate('/delete-account')}
          />
        </div>

        <Button variant="outline" className="w-full h-11 rounded-2xl text-destructive border-destructive/20 hover:bg-destructive/5 glass-card text-sm" onClick={handleSignOut}>
          <LogOut className="w-4 h-4 mr-2" /> Sign Out
        </Button>

        {/* Brand mark + build, the conventional foot of a settings list.
            Version is what a tester quotes when reporting a bug. */}
        <div className="flex flex-col items-center gap-1.5 pt-4 pb-2 opacity-60">
          <CruiXeLogo size="sm" variant="default" />
          <p className="text-[10px] text-muted-foreground">Version {import.meta.env.VITE_APP_VERSION || '1.0.0'}</p>
        </div>

        <div className="h-20" />
      </div>

      <BottomNavBar />
    </div>
  );
}

/* ——— Sub-components ——— */

function QuickAction({ icon, label, sublabel, sublabelLoading, onClick, accent }: {
  icon: React.ReactNode; label: string; sublabel?: string; sublabelLoading?: boolean; onClick: () => void; accent?: boolean; color?: 'yellow' | 'primary';
}) {
  return (
    <button
      onClick={() => { haptic('light'); onClick(); }}
      className={`relative flex flex-col items-center justify-center gap-1 py-3 px-1.5 rounded-2xl active:scale-95 transition-all overflow-hidden group ${
        accent
          ? 'text-primary-foreground shadow-[0_10px_28px_-8px_hsl(4_96%_37%/0.25)]'
          : 'glass-card text-foreground border border-primary/10'
      }`}
      style={accent ? { background: 'linear-gradient(135deg, hsl(var(--cruixe-red)) 0%, hsl(var(--cruixe-red-dark)) 100%)' } : undefined}
    >
      {accent && (
        <>
          <div className="absolute -top-6 -right-6 w-16 h-16 rounded-full bg-white/15 blur-2xl" aria-hidden />
          <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-destructive shadow-[0_0_6px_hsl(0_84%_60%/0.8)]" aria-hidden />
        </>
      )}
      <span className={`relative ${accent ? 'text-primary-foreground' : 'text-primary'}`}>{icon}</span>
      <span className={`relative text-[11px] font-bold leading-tight ${accent ? 'text-primary-foreground' : 'text-foreground'}`}>{label}</span>
      {sublabelLoading ? (
        <Skeleton className={`h-2.5 w-10 ${accent ? 'bg-white/30' : 'bg-primary/10'}`} />
      ) : sublabel ? (
        <span className={`relative text-[9px] leading-tight font-medium ${accent ? 'text-primary-foreground/85' : 'text-muted-foreground'}`}>
          {sublabel}
        </span>
      ) : null}
    </button>
  );
}

function StatMini({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      {icon}
      <div>
        <p className="text-sm font-bold text-foreground leading-tight">{value}</p>
        <p className="text-[9px] text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

function NavRow({ icon, label, sublabel, onClick, badge }: {
  icon: React.ReactNode; label: string; sublabel?: string; onClick: () => void; badge?: number;
}) {
  return (
    <button onClick={onClick} className="w-full flex items-center gap-3 px-4 py-3 glass-card hover:bg-foreground/[0.02] active:scale-[0.98] transition-all text-left rounded-2xl">
      {icon}
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium text-foreground block">{label}</span>
        {sublabel && <span className="text-[10px] text-muted-foreground">{sublabel}</span>}
      </div>
      {badge !== undefined && badge > 0 && (
        <span className="w-5 h-5 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
          {badge > 9 ? '9+' : badge}
        </span>
      )}
      <ChevronRight className="w-4 h-4 text-muted-foreground" />
    </button>
  );
}
