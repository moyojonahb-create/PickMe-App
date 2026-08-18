import { useState } from 'react';
import { Camera, ChevronRight, Loader2, Star, BadgeCheck } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/hooks/useAuth';
import { updateMyProfileAvatar } from '@/lib/businessApi';
import { toast } from 'sonner';
import defaultDriverAvatar from '@/assets/driver-avatar-jonah.png';
import PhotoCropModal from './PhotoCropModal';

interface DriverProfileCardProps {
  fullName: string;
  phone: string | null;
  ratingAvg: number | null;
  isApproved: boolean;
  avatarUrl: string | null;
  onAvatarChange: (url: string) => void;
  onClick?: () => void;
}

export default function DriverProfileCard({
  fullName,
  phone,
  ratingAvg,
  isApproved,
  avatarUrl,
  onAvatarChange,
  onClick,
}: DriverProfileCardProps) {
  const { user } = useAuth();
  const [uploading, setUploading] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error('Photo must be less than 5MB'); return; }
    setPendingFile(file);
  };

  const handleCropped = async (blob: Blob) => {
    setPendingFile(null);
    if (!user) return;
    setUploading(true);
    try {
      const path = `${user.id}/avatar.jpg`;
      const { error: uploadErr } = await supabase.storage.from('driver-avatars').upload(path, blob, { upsert: true, contentType: 'image/jpeg' });
      if (uploadErr) throw uploadErr;
      const { data: signedData, error: signedErr } = await supabase.storage.from('driver-avatars').createSignedUrl(path, 60 * 60 * 24 * 365);
      if (signedErr || !signedData?.signedUrl) throw signedErr || new Error('Failed to get URL');

      // Keep both surfaces in sync: profiles.avatar_url (rider-facing
      // profile) and drivers.avatar_url (what riders see once matched —
      // see fetchAssignedDriver in rideMatching.ts).
      await updateMyProfileAvatar(path);
      const { error: driverErr } = await supabase.from('drivers').update({ avatar_url: signedData.signedUrl } as never).eq('user_id', user.id);
      if (driverErr) throw driverErr;

      onAvatarChange(signedData.signedUrl);
      toast.success('Photo updated!');
    } catch (err: unknown) {
      toast.error('Upload failed', { description: (err as Error).message });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div
      className="relative overflow-hidden rounded-3xl p-4"
      style={{ background: 'var(--gradient-primary)' }}
    >
      <div className="absolute -top-10 -right-6 w-40 h-40 rounded-full bg-white/10 blur-2xl pointer-events-none" />
      <button type="button" onClick={onClick} className="relative w-full flex items-center gap-3.5 text-left">
        <label className="relative shrink-0 cursor-pointer group" onClick={(e) => e.stopPropagation()}>
          <div className="w-16 h-16 rounded-full bg-white/95 ring-2 ring-white/40 shadow-lg overflow-hidden flex items-center justify-center">
            <img src={avatarUrl || defaultDriverAvatar} alt={fullName} className="w-full h-full object-cover" />
          </div>
          <span className="absolute -bottom-0.5 -right-0.5 w-6 h-6 rounded-full bg-white flex items-center justify-center border-2 border-primary shadow-sm group-hover:scale-110 transition-transform">
            {uploading ? <Loader2 className="w-3 h-3 animate-spin text-primary" /> : <Camera className="w-3 h-3 text-primary" />}
          </span>
          <input type="file" accept="image/*" className="hidden" onChange={handleFileSelected} disabled={uploading} />
        </label>

        <div className="flex-1 min-w-0">
          <p className="text-base font-bold text-white truncate">{fullName}</p>
          {phone && <p className="text-[13px] text-white/85 truncate mt-0.5">{phone}</p>}
          <div className="flex items-center gap-2.5 mt-1.5">
            <span className="flex items-center gap-1 text-[12px] font-bold text-white">
              <Star className="w-3 h-3 fill-white text-white" />
              {ratingAvg ? ratingAvg.toFixed(1) : 'New'}
            </span>
            {isApproved && (
              <span className="flex items-center gap-1 text-[12px] font-semibold text-white/90">
                <BadgeCheck className="w-3.5 h-3.5" />
                Verified
              </span>
            )}
          </div>
        </div>
        {onClick && <ChevronRight className="w-4 h-4 text-white/70 shrink-0" />}
      </button>

      <PhotoCropModal
        file={pendingFile}
        shape="circle"
        title="Adjust your photo"
        onCancel={() => setPendingFile(null)}
        onCropped={handleCropped}
      />
    </div>
  );
}
