import { useState } from 'react';
import { Car, ChevronRight, X, Camera, Loader2 } from 'lucide-react';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabaseClient';
import { toast } from 'sonner';
import PhotoCropModal from './PhotoCropModal';

interface VehicleCardProps {
  make: string | null;
  model: string | null;
  color: string | null;
  plate: string | null;
  vehicleType: string | null;
  photoUrl: string | null;
  onPhotoChange: (url: string) => void;
}

/** Vehicle info (make/model/plate/etc.) is set during driver
 * registration/approval — there's no post-approval edit flow for those
 * fields, so this stays a read-only detail view for them. The vehicle
 * photo is the one field a driver can add/change themselves. */
export default function VehicleCard({ make, model, color, plate, vehicleType, photoUrl, onPhotoChange }: VehicleCardProps) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  useEscapeKey(open, () => setOpen(false));
  const title = [make, model].filter(Boolean).join(' ') || 'Vehicle';

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { toast.error('Photo must be less than 8MB'); return; }
    setPendingFile(file);
  };

  const handleCropped = async (blob: Blob) => {
    setPendingFile(null);
    if (!user) return;
    setUploading(true);
    try {
      const path = `${user.id}/car.jpg`;
      const { error: uploadErr } = await supabase.storage.from('vehicle-photos').upload(path, blob, { upsert: true, contentType: 'image/jpeg' });
      if (uploadErr) throw uploadErr;
      const { data: signedData, error: signedErr } = await supabase.storage.from('vehicle-photos').createSignedUrl(path, 60 * 60 * 24 * 365);
      if (signedErr || !signedData?.signedUrl) throw signedErr || new Error('Failed to get URL');

      const { error: driverErr } = await supabase.from('drivers').update({ vehicle_photo_url: signedData.signedUrl } as never).eq('user_id', user.id);
      if (driverErr) throw driverErr;

      onPhotoChange(signedData.signedUrl);
      toast.success('Car photo updated!');
    } catch (err: unknown) {
      toast.error('Upload failed', { description: (err as Error).message });
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full flex items-center gap-3 rounded-2xl border border-border bg-card p-4 text-left active:bg-muted/40 transition-colors"
      >
        <div className="w-11 h-11 rounded-2xl shrink-0 overflow-hidden flex items-center justify-center" style={{ background: '#FFE6E6' }}>
          {photoUrl ? (
            <img src={photoUrl} alt={title} className="w-full h-full object-cover" />
          ) : (
            <Car className="w-5 h-5" style={{ color: '#B81104' }} />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-semibold text-muted-foreground">Vehicle Information</p>
          <p className="text-[14px] font-bold text-foreground truncate">
            {title}{color ? ` • ${color}` : ''}
          </p>
          <p className="text-[12px] text-muted-foreground">{plate || 'Plate not set'}</p>
        </div>
        <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
      </button>

      {open && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-foreground/30 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="relative w-full max-w-lg bg-background rounded-t-3xl p-5 space-y-4" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 20px)' }}>
            <div className="flex items-center justify-between">
              <p className="font-bold text-foreground">Vehicle details</p>
              <button onClick={() => setOpen(false)} aria-label="Close" className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-muted">
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>

            <label className="relative block w-full h-40 rounded-2xl overflow-hidden bg-muted cursor-pointer">
              {photoUrl ? (
                <img src={photoUrl} alt={title} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center gap-1.5 text-muted-foreground">
                  <Car className="w-6 h-6" />
                  <span className="text-[12px] font-semibold">No car photo yet</span>
                </div>
              )}
              <span className="absolute bottom-2.5 right-2.5 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/95 shadow-sm text-[12px] font-bold text-foreground active:scale-95 transition-transform">
                {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
                {photoUrl ? 'Change photo' : 'Add photo'}
              </span>
              <input type="file" accept="image/*" className="hidden" onChange={handleFileSelected} disabled={uploading} />
            </label>

            <div className="space-y-2.5">
              <DetailRow label="Make & model" value={title} />
              <DetailRow label="Color" value={color || '—'} />
              <DetailRow label="Plate number" value={plate || '—'} />
              <DetailRow label="Vehicle type" value={vehicleType || '—'} capitalize />
            </div>
            <p className="text-[12px] text-muted-foreground">
              To update your make, model, plate or color, contact PickMe support.
            </p>
          </div>
        </div>
      )}

      <PhotoCropModal
        file={pendingFile}
        shape="rect"
        aspect={4 / 3}
        title="Adjust your car photo"
        onCancel={() => setPendingFile(null)}
        onCropped={handleCropped}
      />
    </>
  );
}

function DetailRow({ label, value, capitalize }: { label: string; value: string; capitalize?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-0">
      <span className="text-[13px] text-muted-foreground">{label}</span>
      <span className={`text-[13px] font-semibold text-foreground ${capitalize ? 'capitalize' : ''}`}>{value}</span>
    </div>
  );
}
