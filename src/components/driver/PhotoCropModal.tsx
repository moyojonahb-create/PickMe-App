import { useEffect, useRef, useState, useCallback } from 'react';
import { X, ZoomIn } from 'lucide-react';

interface PhotoCropModalProps {
  file: File | null;
  shape: 'circle' | 'rect';
  /** width / height, only used when shape === 'rect' */
  aspect?: number;
  outputSize?: number;
  title?: string;
  onCancel: () => void;
  onCropped: (blob: Blob) => void;
}

const VIEWPORT_W = 288;

/** A small, dependency-free crop step shown between "pick a file" and
 * "upload it" — drag to reposition, slider to zoom, confirm to export a
 * cropped JPEG blob. No crop library exists in this project yet and this
 * is a single, self-contained use case, so a plain <canvas> export beats
 * pulling in a new dependency for it. */
export default function PhotoCropModal({ file, shape, aspect = 1, outputSize = 512, title = 'Adjust photo', onCancel, onCropped }: PhotoCropModalProps) {
  const viewportW = VIEWPORT_W;
  const viewportH = shape === 'circle' ? VIEWPORT_W : Math.round(VIEWPORT_W / aspect);

  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [exporting, setExporting] = useState(false);
  const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  useEffect(() => {
    if (!file) { setImg(null); return; }
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      setImg(image);
      setZoom(1);
      setOffset({ x: 0, y: 0 });
    };
    image.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const baseScale = img ? Math.max(viewportW / img.naturalWidth, viewportH / img.naturalHeight) : 1;

  const clampOffset = useCallback((x: number, y: number, z: number) => {
    if (!img) return { x: 0, y: 0 };
    const dw = img.naturalWidth * baseScale * z;
    const dh = img.naturalHeight * baseScale * z;
    const maxX = Math.max(0, (dw - viewportW) / 2);
    const maxY = Math.max(0, (dh - viewportH) / 2);
    return { x: Math.min(maxX, Math.max(-maxX, x)), y: Math.min(maxY, Math.max(-maxY, y)) };
  }, [img, baseScale, viewportW, viewportH]);

  const handlePointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    dragState.current = { startX: e.clientX, startY: e.clientY, origX: offset.x, origY: offset.y };
  };
  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragState.current) return;
    const dx = e.clientX - dragState.current.startX;
    const dy = e.clientY - dragState.current.startY;
    setOffset(clampOffset(dragState.current.origX + dx, dragState.current.origY + dy, zoom));
  };
  const handlePointerUp = () => { dragState.current = null; };

  const handleZoomChange = (z: number) => {
    setZoom(z);
    setOffset((prev) => clampOffset(prev.x, prev.y, z));
  };

  const handleConfirm = () => {
    if (!img) return;
    setExporting(true);
    const scale = baseScale * zoom;
    const sx = (img.naturalWidth * scale / 2 - offset.x - viewportW / 2) / scale;
    const sy = (img.naturalHeight * scale / 2 - offset.y - viewportH / 2) / scale;
    const sw = viewportW / scale;
    const sh = viewportH / scale;

    const outW = shape === 'circle' ? outputSize : outputSize;
    const outH = shape === 'circle' ? outputSize : Math.round(outputSize / aspect);

    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    if (!ctx) { setExporting(false); return; }
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
    canvas.toBlob((blob) => {
      setExporting(false);
      if (blob) onCropped(blob);
    }, 'image/jpeg', 0.9);
  };

  if (!file) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-foreground/50 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-full max-w-sm bg-background rounded-3xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <p className="font-bold text-foreground">{title}</p>
          <button type="button" onClick={onCancel} aria-label="Cancel" className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-muted">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        <div
          className="relative mx-auto overflow-hidden bg-muted touch-none select-none cursor-grab active:cursor-grabbing"
          style={{ width: viewportW, height: viewportH, borderRadius: shape === 'circle' ? '9999px' : '16px' }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        >
          {img && (
            <img
              src={img.src}
              alt=""
              draggable={false}
              className="absolute top-1/2 left-1/2 max-w-none pointer-events-none"
              style={{
                width: img.naturalWidth * baseScale * zoom,
                height: img.naturalHeight * baseScale * zoom,
                transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px)`,
              }}
            />
          )}
        </div>

        <div className="flex items-center gap-3">
          <ZoomIn className="w-4 h-4 text-muted-foreground shrink-0" />
          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            onChange={(e) => handleZoomChange(Number(e.target.value))}
            className="w-full accent-primary"
            aria-label="Zoom"
          />
        </div>

        <div className="flex items-center gap-3">
          <button type="button" onClick={onCancel} className="flex-1 py-3 rounded-2xl border border-border font-bold text-sm text-foreground active:scale-[0.97] transition-transform">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!img || exporting}
            className="flex-1 py-3 rounded-2xl bg-primary text-primary-foreground font-bold text-sm active:scale-[0.97] transition-transform disabled:opacity-60"
          >
            {exporting ? 'Saving…' : 'Save photo'}
          </button>
        </div>
      </div>
    </div>
  );
}
