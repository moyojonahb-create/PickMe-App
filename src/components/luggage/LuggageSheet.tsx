import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Camera, ImageIcon, Trash2, Briefcase, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { uploadLuggagePhoto, deleteLuggagePhoto, getLuggageSignedUrls } from '@/lib/luggageStorage';

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
  const [itemCount, setItemCount] = useState(initial?.item_count || 1);
  const [paths, setPaths] = useState<string[]>(initial?.image_paths || []);
  const [previews, setPreviews] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setDescription(initial?.description || '');
    setWeight(initial?.estimated_weight || 'small');
    setItemCount(initial?.item_count || 1);
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
      item_count: itemCount,
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
            className="fixed bottom-0 inset-x-0 z-[71] bg-background rounded-t-3xl max-h-[90vh] flex flex-col"
          >
            <div className="flex justify-center pt-3 pb-1 shrink-0">
              <div className="w-12 h-1.5 rounded-full bg-muted-foreground/30" />
            </div>
            <div className="flex items-center justify-between px-5 pb-3 border-b border-border shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-full bg-yellow-400 flex items-center justify-center">
                  <Briefcase className="w-5 h-5 text-black" />
                </div>
                <h2 className="text-lg font-bold text-foreground">Add Luggage</h2>
              </div>
              <button onClick={onClose} className="p-2 rounded-full hover:bg-muted">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
              {/* Description */}
              <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground">What are you transporting?</label>
                <Textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="2 suitcases, groceries, small fridge, bags, TV stand…"
                  maxLength={500}
                  className="min-h-[90px] resize-none"
                />
                <p className="text-xs text-muted-foreground text-right">{description.length}/500</p>
              </div>

              {/* Weight */}
              <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground">Size / Weight</label>
                <div className="grid grid-cols-2 gap-2">
                  {WEIGHTS.map(w => (
                    <button
                      key={w.value}
                      type="button"
                      onClick={() => setWeight(w.value)}
                      className={cn(
                        'p-3 rounded-xl border text-left transition-all',
                        weight === w.value
                          ? 'border-yellow-400 bg-yellow-400/10'
                          : 'border-border bg-background hover:bg-muted'
                      )}
                    >
                      <p className="text-sm font-bold text-foreground">{w.label}</p>
                      <p className="text-xs text-muted-foreground">{w.hint}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Item count */}
              <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground">Number of items</label>
                <div className="flex items-center justify-between bg-muted rounded-xl p-3">
                  <span className="text-sm text-foreground">{itemCount} {itemCount === 1 ? 'item' : 'items'}</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setItemCount(c => Math.max(1, c - 1))}
                      className="w-9 h-9 rounded-full bg-background border border-border font-bold text-foreground"
                    >−</button>
                    <span className="w-8 text-center font-bold">{itemCount}</span>
                    <button
                      onClick={() => setItemCount(c => Math.min(99, c + 1))}
                      className="w-9 h-9 rounded-full bg-background border border-border font-bold text-foreground"
                    >+</button>
                  </div>
                </div>
              </div>

              {/* Photos */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-semibold text-foreground">Photos ({paths.length}/{MAX_IMAGES})</label>
                  {uploading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {paths.map((_, i) => (
                    <div key={i} className="relative aspect-square rounded-xl overflow-hidden bg-muted">
                      {previews[i] ? (
                        <img src={previews[i]} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                        </div>
                      )}
                      <button
                        onClick={() => removePhoto(i)}
                        className="absolute top-1 right-1 w-7 h-7 rounded-full bg-black/70 flex items-center justify-center"
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
                        className="aspect-square rounded-xl border-2 border-dashed border-border flex flex-col items-center justify-center gap-1 hover:bg-muted disabled:opacity-50"
                      >
                        <Camera className="w-5 h-5 text-muted-foreground" />
                        <span className="text-[10px] text-muted-foreground font-medium">Camera</span>
                      </button>
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploading}
                        className="aspect-square rounded-xl border-2 border-dashed border-border flex flex-col items-center justify-center gap-1 hover:bg-muted disabled:opacity-50"
                      >
                        <ImageIcon className="w-5 h-5 text-muted-foreground" />
                        <span className="text-[10px] text-muted-foreground font-medium">Gallery</span>
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
                <p className="text-[11px] text-muted-foreground">
                  🔒 Photos are private and only visible to drivers who view your ride.
                </p>
              </div>
            </div>

            <div className="p-4 border-t border-border shrink-0 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
              <Button onClick={handleSave} disabled={uploading} size="lg" className="w-full bg-yellow-400 hover:bg-yellow-300 text-black font-bold">
                Save Luggage Details
              </Button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
