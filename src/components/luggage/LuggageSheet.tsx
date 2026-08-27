import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Camera, ImageIcon, Trash2, Briefcase, Loader2 } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { uploadLuggagePhoto, deleteLuggagePhoto, getLuggageSignedUrls } from '@/lib/luggageStorage';
import { glassPanel, glassSurface, redCta, RIDE_RED, RIDE_RED_GRADIENT, RIDE_TEXT, RIDE_TEXT_2, RIDE_FONT } from '@/components/ride/rideGlass';

export interface LuggageDraft {
  description: string;
  estimated_weight: 'small' | 'medium' | 'large' | 'xl';
  item_count: number;
  image_paths: string[];
}

interface LuggageSheetProps {
  open: boolean;
  onClose: () => void;
  initial?: LuggageDraft | null;
  onSave: (draft: LuggageDraft) => void;
}

const MAX_IMAGES = 5;

const WEIGHTS: { value: LuggageDraft['estimated_weight']; label: string; hint: string }[] = [
  { value: 'small', label: 'Small', hint: '1-2 bags' },
  { value: 'medium', label: 'Medium', hint: '3-4 bags' },
  { value: 'large', label: 'Large', hint: 'Boxes / suitcases' },
  { value: 'xl', label: 'Extra Large', hint: 'Furniture / appliances' },
];

export default function LuggageSheet({ open, onClose, initial, onSave }: LuggageSheetProps) {
  const { user } = useAuth();
  const [description, setDescription] = useState(initial?.description || '');
  const [weight, setWeight] = useState<LuggageDraft['estimated_weight']>(initial?.estimated_weight || 'small');
  const [paths, setPaths] = useState<string[]>(initial?.image_paths || []);
  const [previews, setPreviews] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setDescription(initial?.description || '');
    setWeight(initial?.estimated_weight || 'small');
    setPaths(initial?.image_paths || []);
  }, [open, initial]);

  useEffect(() => {
    let cancelled = false;
    if (paths.length === 0) {
      setPreviews([]);
      return;
    }
    getLuggageSignedUrls(paths)
      .then(urls => { if (!cancelled) setPreviews(urls); })
      .catch(() => { if (!cancelled) setPreviews([]); });
    return () => { cancelled = true; };
  }, [paths]);

  const handleFiles = async (files: FileList | null) => {
    if (!files || !user) return;
    const remaining = MAX_IMAGES - paths.length;
    if (remaining <= 0) {
      toast({ title: 'Max 5 photos', variant: 'destructive' });
      return;
    }
    const arr = Array.from(files).slice(0, remaining);
    setUploading(true);
    try {
      const uploaded: string[] = [];
      for (const f of arr) {
        const p = await uploadLuggagePhoto(f, user.id);
        uploaded.push(p);
      }
      setPaths(prev => [...prev, ...uploaded]);
    } catch (e) {
      toast({ title: 'Upload failed', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setUploading(false);
    }
  };

  const removePhoto = async (idx: number) => {
    const p = paths[idx];
    setPaths(prev => prev.filter((_, i) => i !== idx));
    deleteLuggagePhoto(p).catch(() => {});
  };

  const handleSave = () => {
    if (!description.trim() && paths.length === 0) {
      toast({ title: 'Add a description or photo', variant: 'destructive' });
      return;
    }
    onSave({
      description: description.trim(),
      estimated_weight: weight,
      // Item count is no longer a separate stepper — the rider notes it in
      // the free-text description instead. Kept in the payload since the
      // column/driver preview still read it (falling back to 1 if absent).
      item_count: 1,
      image_paths: paths,
    });
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 z-[70]"
            onClick={onClose}
          />
          <motion.div
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            drag="y" dragConstraints={{ top: 0, bottom: 0 }} dragElastic={0.2}
            onDragEnd={(_, info) => { if (info.offset.y > 120) onClose(); }}
            className="fixed bottom-0 inset-x-0 z-[71] rounded-t-3xl max-h-[90vh] flex flex-col"
            style={{ ...glassPanel, fontFamily: RIDE_FONT }}
          >
            <div className="flex justify-center pt-3 pb-1 shrink-0">
              <div className="w-12 h-1.5 rounded-full bg-muted-foreground/30" />
            </div>
            <div className="flex items-center justify-between px-5 pb-3 shrink-0" style={{ boxShadow: 'inset 0 -1px 0 rgba(17,17,17,.08)' }}>
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: RIDE_RED_GRADIENT, boxShadow: '0 6px 14px rgba(184,17,4,.35)' }}>
                  <Briefcase className="w-[18px] h-[18px] text-white" />
                </div>
                <h2 className="text-lg font-bold" style={{ color: RIDE_TEXT }}>Add Luggage</h2>
              </div>
              <button
                onClick={onClose}
                aria-label="Close"
                className="flex items-center justify-center rounded-full active:scale-90 transition-transform"
                style={{ width: 32, height: 32, background: 'rgba(17,17,17,.06)' }}
              >
                <X className="w-4 h-4" style={{ color: RIDE_TEXT }} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
              {/* Description */}
              <div className="space-y-2">
                <label className="text-[13px] font-bold" style={{ color: RIDE_TEXT }}>What are you transporting?</label>
                <Textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="2 suitcases, groceries, small fridge, bags, TV stand…"
                  maxLength={500}
                  className="min-h-[90px] resize-none rounded-2xl border-0 shadow-none focus-visible:ring-0"
                  style={{ ...glassSurface, color: RIDE_TEXT }}
                />
                <p className="text-xs text-right" style={{ color: RIDE_TEXT_2 }}>{description.length}/500</p>
              </div>

              {/* Weight */}
              <div className="space-y-2">
                <label className="text-[13px] font-bold" style={{ color: RIDE_TEXT }}>Size / Weight</label>
                <div className="grid grid-cols-2 gap-2">
                  {WEIGHTS.map(w => (
                    <button
                      key={w.value}
                      type="button"
                      onClick={() => setWeight(w.value)}
                      className="p-3.5 rounded-2xl text-left transition-transform active:scale-[0.98]"
                      style={{
                        ...glassSurface,
                        ...(weight === w.value ? { boxShadow: `inset 0 0 0 2px ${RIDE_RED}, 0 8px 16px rgba(184,17,4,.14)` } : {}),
                      }}
                    >
                      <p className="text-sm font-bold" style={{ color: RIDE_TEXT }}>{w.label}</p>
                      <p className="text-xs" style={{ color: RIDE_TEXT_2 }}>{w.hint}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Photos */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[13px] font-bold" style={{ color: RIDE_TEXT }}>Photos ({paths.length}/{MAX_IMAGES})</label>
                  {uploading && <Loader2 className="w-4 h-4 animate-spin" style={{ color: RIDE_TEXT_2 }} />}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {paths.map((_, i) => (
                    <div key={i} className="relative aspect-square rounded-2xl overflow-hidden" style={glassSurface}>
                      {previews[i] ? (
                        <img src={previews[i]} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Loader2 className="w-4 h-4 animate-spin" style={{ color: RIDE_TEXT_2 }} />
                        </div>
                      )}
                      <button
                        onClick={() => removePhoto(i)}
                        className="absolute top-1 right-1 w-7 h-7 rounded-full flex items-center justify-center"
                        style={{ background: 'rgba(17,17,17,.65)', backdropFilter: 'blur(6px)' }}
                      >
                        <Trash2 className="w-3.5 h-3.5 text-white" />
                      </button>
                    </div>
                  ))}
                  {paths.length < MAX_IMAGES && (
                    <>
                      <button
                        onClick={() => cameraInputRef.current?.click()}
                        disabled={uploading}
                        className="aspect-square rounded-2xl border-2 border-dashed flex flex-col items-center justify-center gap-1 active:opacity-70 transition-opacity disabled:opacity-40"
                        style={{ ...glassSurface, borderColor: 'rgba(184,17,4,.28)' }}
                      >
                        <Camera className="w-5 h-5" style={{ color: RIDE_RED }} />
                        <span className="text-[10px] font-semibold" style={{ color: RIDE_TEXT_2 }}>Camera</span>
                      </button>
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploading}
                        className="aspect-square rounded-2xl border-2 border-dashed flex flex-col items-center justify-center gap-1 active:opacity-70 transition-opacity disabled:opacity-40"
                        style={{ ...glassSurface, borderColor: 'rgba(184,17,4,.28)' }}
                      >
                        <ImageIcon className="w-5 h-5" style={{ color: RIDE_RED }} />
                        <span className="text-[10px] font-semibold" style={{ color: RIDE_TEXT_2 }}>Gallery</span>
                      </button>
                    </>
                  )}
                </div>
                <input
                  ref={cameraInputRef} type="file" accept="image/*" capture="environment"
                  className="hidden" onChange={e => { handleFiles(e.target.files); e.target.value = ''; }}
                />
                <input
                  ref={fileInputRef} type="file" accept="image/*" multiple
                  className="hidden" onChange={e => { handleFiles(e.target.files); e.target.value = ''; }}
                />
                <p className="text-[11px]" style={{ color: RIDE_TEXT_2 }}>
                  🔒 Photos are private and only visible to drivers who view your ride.
                </p>
              </div>
            </div>

            <div className="p-4 shrink-0 pb-[calc(env(safe-area-inset-bottom)+1rem)]" style={{ boxShadow: 'inset 0 1px 0 rgba(17,17,17,.08)' }}>
              <button
                type="button"
                onClick={handleSave}
                disabled={uploading}
                className="relative w-full flex items-center justify-center overflow-hidden active:scale-[0.98] transition-transform disabled:opacity-60"
                style={{ height: 50, borderRadius: 16, ...redCta }}
              >
                <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2" style={{ background: 'linear-gradient(180deg, rgba(255,255,255,.2), rgba(255,255,255,0))' }} />
                <span className="relative text-[15.5px] font-bold text-white">Save Luggage Details</span>
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
