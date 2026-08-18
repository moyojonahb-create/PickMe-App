import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useAppBootstrap } from '@/hooks/useAppBootstrap';
import { supabase } from '@/lib/supabaseClient';
import { resolveAvatarUrl } from '@/lib/avatarUrl';
import { ArrowLeft, User, Camera, Loader2, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import PickMeLogo from '@/components/PickMeLogo';
import { updateMyProfile } from '@/lib/businessApi';


export default function EditProfile() {
  const { user, loading: authLoading } = useAuth();
  const { profile: cachedProfile } = useAppBootstrap();
  const navigate = useNavigate();
  const location = useLocation();
  const isMapp = location.pathname.startsWith('/mapp');
  const prefix = isMapp ? '/mapp' : '';

  // The splash bootstrap already fetched full_name/phone/avatar_url — seed
  // from that cache so this screen renders instantly instead of blocking on
  // its own fetch. avatar_url still needs async resolution (signed URL),
  // so that alone loads in the background.
  const [fullName, setFullName] = useState(cachedProfile?.full_name ?? '');
  const [phone, setPhone] = useState(cachedProfile?.phone ?? '');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loaded, setLoaded] = useState(!!cachedProfile);

  useEffect(() => {
    if (!authLoading && !user) { navigate('/auth'); return; }
    if (user && !loaded) loadProfile();
    else if (user && cachedProfile) resolveAvatarUrl(cachedProfile.avatar_url).then(setAvatarUrl);
  }, [user, authLoading]);

  const loadProfile = async () => {
    const { data } = await supabase
      .from('profiles')
      .select('full_name, phone, avatar_url')
      .eq('user_id', user!.id)
      .maybeSingle();
    if (data) {
      setFullName(data.full_name || '');
      setPhone(data.phone || '');
      const resolved = await resolveAvatarUrl(data.avatar_url);
      setAvatarUrl(resolved);
    } else {
      setFullName(user!.user_metadata?.full_name || '');
      setPhone(user!.user_metadata?.phone || user!.phone || '');
    }
    setLoaded(true);
  };

  const handleSave = async () => {
    if (!user || !fullName.trim()) return;
    setSaving(true);
    try {
      await updateMyProfile({
        full_name: fullName.trim(),
        phone: phone.trim(),
        avatar_url: avatarUrl,
      });

      // Also update auth metadata
      await supabase.auth.updateUser({
        data: { full_name: fullName.trim() }
      });

      toast.success('Profile updated!');
      navigate(-1);
    } catch (e: unknown) {
      toast.error('Failed to update profile', { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Photo must be less than 5MB');
      return;
    }

    setUploading(true);
    try {
      const ext = file.name.split('.').pop();
      const path = `${user.id}/avatar.${ext}`;

      const { error: uploadErr } = await supabase.storage
        .from('driver-avatars')
        .upload(path, file, { upsert: true });
      if (uploadErr) throw uploadErr;

      const { data: signedData, error: signedErr } = await supabase.storage
        .from('driver-avatars')
        .createSignedUrl(path, 60 * 60 * 24 * 365);
      if (signedErr || !signedData?.signedUrl) throw signedErr || new Error('Failed to get URL');
      setAvatarUrl(signedData.signedUrl);
      toast.success('Photo uploaded!');
    } catch (e: unknown) {
      toast.error('Upload failed', { description: (e as Error).message });
    } finally {
      setUploading(false);
    }
  };

  if (!loaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-background">
      {/* Header */}
      <div className="h-36 w-full" style={{ background: 'var(--gradient-primary)' }}>
        <div className="flex items-center justify-between px-4" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 12px)' }}>
          <button onClick={() => navigate(-1)} className="w-12 h-12 flex items-center justify-center rounded-full glass-btn active:scale-95 transition-all">
            <ArrowLeft className="w-5 h-5 text-primary-foreground" />
          </button>
          <h1 className="text-lg font-bold text-primary-foreground">Edit Profile</h1>
          <PickMeLogo variant="light" size="sm" />
        </div>
      </div>

      {/* Avatar */}
      <div className="flex justify-center -mt-14 relative z-10">
        <label className="relative cursor-pointer group">
          <div className="w-28 h-28 rounded-full bg-muted border-4 border-background overflow-hidden flex items-center justify-center">
            {avatarUrl ? (
              <img src={avatarUrl} alt="Profile" className="w-full h-full object-cover" />
            ) : (
              <User className="w-12 h-12 text-muted-foreground" />
            )}
          </div>
          <div className="absolute bottom-0 right-0 w-9 h-9 rounded-full bg-primary flex items-center justify-center border-2 border-background group-hover:scale-110 transition-transform">
            {uploading ? <Loader2 className="w-4 h-4 animate-spin text-primary-foreground" /> : <Camera className="w-4 h-4 text-primary-foreground" />}
          </div>
          <input type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} disabled={uploading} />
        </label>
      </div>

      {/* Form */}
      <div className="px-5 pt-8 pb-28 space-y-5">
        <div>
          <Label htmlFor="name" className="text-sm font-semibold text-foreground">Full Name</Label>
          <Input
            id="name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Your full name"
            className="mt-1.5 h-12 rounded-2xl"
          />
        </div>

        <div>
          <Label htmlFor="phone" className="text-sm font-semibold text-foreground">Phone Number</Label>
          <Input
            id="phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+263 77 123 4567"
            className="mt-1.5 h-12 rounded-2xl"
          />
        </div>

        <div>
          <Label className="text-sm font-semibold text-foreground">Email</Label>
          <Input
            value={user?.email || ''}
            disabled
            className="mt-1.5 h-12 rounded-2xl bg-muted text-muted-foreground"
          />
          <p className="text-xs text-muted-foreground mt-1">Email cannot be changed</p>
        </div>

        <Button
          onClick={handleSave}
          disabled={saving || !fullName.trim()}
          className="w-full h-[52px] rounded-2xl font-bold text-base mt-4"
        >
          {saving ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <Check className="w-5 h-5 mr-2" />}
          Save Changes
        </Button>
      </div>

      
    </div>
  );
}
