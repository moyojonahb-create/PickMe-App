import { useState, useRef, useCallback, useEffect } from 'react';
import { Camera, ShieldCheck, Loader2, X, RotateCcw, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/lib/supabaseClient';

interface DriverSelfieCheckProps {
  open: boolean;
  onVerified: () => void;
  onSkip?: () => void;
}

export default function DriverSelfieCheck({ open, onVerified, onSkip }: DriverSelfieCheckProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [step, setStep] = useState<'prompt' | 'camera' | 'preview' | 'verifying' | 'done' | 'error'>('prompt');
  const [capturedImage, setCapturedImage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    }
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [open]);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: 480, height: 480 },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      setStep('camera');
    } catch {
      // Camera not available — allow skip
      onVerified();
    }
  }, [onVerified]);

  const capture = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;
    canvasRef.current.width = 480;
    canvasRef.current.height = 480;
    ctx.drawImage(videoRef.current, 0, 0, 480, 480);
    const dataUrl = canvasRef.current.toDataURL('image/jpeg', 0.8);
    setCapturedImage(dataUrl);
    // Stop stream
    streamRef.current?.getTracks().forEach((t) => t.stop());
    setStep('preview');
  }, []);

  const retake = useCallback(() => {
    setCapturedImage(null);
    startCamera();
  }, [startCamera]);

  const verify = useCallback(async () => {
    if (!capturedImage) return;
    setStep('verifying');
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setStep('error');
        return;
      }

      const blob = await (await fetch(capturedImage)).blob();
      const path = `${user.id}/selfie-${Date.now()}.jpg`;

      const { error: uploadError } = await supabase.storage
        .from('driver-documents')
        .upload(path, blob, { contentType: 'image/jpeg', upsert: true });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from('driver-documents').getPublicUrl(path);

      const { error: insertError } = await supabase.from('driver_documents').insert({
        driver_id: user.id,
        document_type: 'selfie',
        file_url: urlData.publicUrl,
        status: 'pending',
      });
      if (insertError) throw insertError;

      setStep('done');
      setTimeout(() => onVerified(), 1500);
    } catch (err) {
      console.error('Selfie submission failed:', err);
      setStep('error');
    }
  }, [capturedImage, onVerified]);

  const handleClose = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    onSkip?.();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="sm:max-w-sm p-0 overflow-hidden">
        <DialogHeader className="p-5 pb-0">
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            Identity Check
          </DialogTitle>
          <DialogDescription>
            Take a quick selfie before going online to verify your identity.
          </DialogDescription>
        </DialogHeader>

        <div className="p-5 pt-3">
          <AnimatePresence mode="wait">
            {step === 'prompt' && (
              <motion.div
                key="prompt"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center gap-4 py-6"
              >
                <div className="w-24 h-24 rounded-full bg-primary/10 flex items-center justify-center">
                  <Camera className="w-10 h-10 text-primary" />
                </div>
                <p className="text-sm text-muted-foreground text-center">
                  This helps keep riders safe by confirming the registered driver is behind the wheel.
                </p>
                <Button onClick={startCamera} className="w-full font-bold gap-2">
                  <Camera className="w-4 h-4" />
                  Open Camera
                </Button>
                {onSkip && (
                  <button onClick={handleClose} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                    Skip for now
                  </button>
                )}
              </motion.div>
            )}

            {step === 'camera' && (
              <motion.div
                key="camera"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center gap-3"
              >
                <div className="relative w-full aspect-square rounded-2xl overflow-hidden bg-black">
                  <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                  {/* Face guide overlay */}
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-48 h-48 rounded-full border-2 border-dashed border-primary/50" />
                  </div>
                </div>
                <canvas ref={canvasRef} className="hidden" />
                <Button onClick={capture} size="lg" className="w-full font-bold gap-2">
                  <Camera className="w-4 h-4" />
                  Take Photo
                </Button>
              </motion.div>
            )}

            {step === 'preview' && capturedImage && (
              <motion.div
                key="preview"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center gap-3"
              >
                <div className="w-full aspect-square rounded-2xl overflow-hidden">
                  <img src={capturedImage} alt="Selfie" className="w-full h-full object-cover" />
                </div>
                <div className="flex gap-2 w-full">
                  <Button variant="outline" onClick={retake} className="flex-1 gap-1.5">
                    <RotateCcw className="w-4 h-4" />
                    Retake
                  </Button>
                  <Button onClick={verify} className="flex-1 font-bold gap-1.5">
                    <ShieldCheck className="w-4 h-4" />
                    Confirm
                  </Button>
                </div>
              </motion.div>
            )}

            {step === 'verifying' && (
              <motion.div
                key="verifying"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center gap-4 py-10"
              >
                <Loader2 className="w-10 h-10 animate-spin text-primary" />
                <p className="text-sm font-semibold text-foreground">Uploading your photo…</p>
              </motion.div>
            )}

            {step === 'done' && (
              <motion.div
                key="done"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center gap-3 py-10"
              >
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 15 }}
                  className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center"
                >
                  <ShieldCheck className="w-8 h-8 text-primary" />
                </motion.div>
                <p className="text-sm font-bold text-foreground">Submitted for review</p>
                <p className="text-xs text-muted-foreground text-center">
                  An admin will review your photo shortly.
                </p>
              </motion.div>
            )}

            {step === 'error' && (
              <motion.div
                key="error"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center gap-3 py-10"
              >
                <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
                  <AlertTriangle className="w-8 h-8 text-destructive" />
                </div>
                <p className="text-sm font-bold text-foreground">Upload failed</p>
                <p className="text-xs text-muted-foreground text-center">
                  Please check your connection and try again.
                </p>
                <Button onClick={verify} className="w-full font-bold gap-1.5">
                  <RotateCcw className="w-4 h-4" />
                  Retry
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </DialogContent>
    </Dialog>
  );
}
