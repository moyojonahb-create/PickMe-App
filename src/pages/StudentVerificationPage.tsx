import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, GraduationCap, Search, Camera, RotateCcw,
  ShieldCheck, Loader2, Upload, AlertTriangle, CheckCircle2, Clock,
  Sun, Frame, Sparkles, Eye, Smile, Glasses,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/hooks/useAuth';
import { useInstitutions, useStudentProfile, type Institution } from '@/hooks/useStudentProfile';
import { compressImage, getDeviceId } from '@/lib/imageCompression';
import { measureQuality, evaluateQuality, type PhotoQuality, type QualityIssue } from '@/lib/photoQuality';
import { cn } from '@/lib/utils';

type TipIcon = typeof Sun;

/** Accessible, high-contrast tip list. Each tip is a labelled list item readable by screen readers. */
const PhotoTips = ({ tips, label }: { tips: { Icon: TipIcon; label: string }[]; label: string }) => (
  <ul
    role="list"
    aria-label={label}
    className="rounded-2xl border-2 border-primary/30 bg-white dark:bg-primary/10 p-3 mb-4 space-y-2 shadow-sm"
  >
    {tips.map(({ Icon, label: t }, i) => (
      <li key={i} className="flex items-start gap-2.5 text-[13px] sm:text-[12.5px] text-foreground font-medium leading-snug">
        <Icon aria-hidden="true" className="w-4 h-4 mt-0.5 text-primary shrink-0" />
        <span>{t}</span>
      </li>
    ))}
  </ul>
);

/** Inline issue panel shown after a quality check fails. */
const QualityIssueList = ({ issues }: { issues: QualityIssue[] }) => (
  <div
    role="alert"
    aria-live="polite"
    className="rounded-2xl border-2 border-amber-500/60 bg-amber-50 dark:bg-amber-950/40 p-3 mb-4"
  >
    <p className="text-xs font-bold text-amber-900 dark:text-amber-100 mb-1.5 flex items-center gap-1.5">
      <AlertTriangle aria-hidden="true" className="w-4 h-4" />
      Photo could be better
    </p>
    <ul role="list" className="space-y-1">
      {issues.map(i => (
        <li key={i.code} className="text-[12.5px] text-amber-950 dark:text-amber-50 leading-snug">
          <span className="font-semibold">{i.label}:</span> {i.tip}
        </li>
      ))}
    </ul>
  </div>
);

type Step = 'institution' | 'reg' | 'nid' | 'idphoto' | 'selfie' | 'submitting' | 'result';

export default function StudentVerificationPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { institutions, loading: instLoading } = useInstitutions();
  const { profile, refetch } = useStudentProfile();

  const [step, setStep] = useState<Step>('institution');
  const [institution, setInstitution] = useState<Institution | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'university' | 'college' | 'polytechnic'>('all');
  const [reg, setReg] = useState('');
  const [nid, setNid] = useState('');
  const [idPhoto, setIdPhoto] = useState<Blob | null>(null);
  const [idPhotoPreview, setIdPhotoPreview] = useState<string | null>(null);
  const [idQuality, setIdQuality] = useState<PhotoQuality | null>(null);
  const [idIssues, setIdIssues] = useState<QualityIssue[]>([]);
  const [selfie, setSelfie] = useState<Blob | null>(null);
  const [selfiePreview, setSelfiePreview] = useState<string | null>(null);
  const [selfieQuality, setSelfieQuality] = useState<PhotoQuality | null>(null);
  const [selfieIssues, setSelfieIssues] = useState<QualityIssue[]>([]);
  const [result, setResult] = useState<{
    status: string;
    score: number;
    reason?: string;
    rejectedStep?: 'id' | 'selfie' | null;
    idQuality?: PhotoQuality | null;
    selfieQuality?: PhotoQuality | null;
  } | null>(null);

  // If already verified or pending, show result screen by default
  useEffect(() => {
    if (profile && step === 'institution' && (profile.verification_status === 'approved' || profile.verification_status === 'pending' || profile.verification_status === 'locked')) {
      setResult({
        status: profile.verification_status,
        score: profile.face_match_score ?? 0,
        reason: profile.rejection_reason ?? undefined,
        idQuality: (profile.id_photo_quality as PhotoQuality | null) ?? null,
        selfieQuality: (profile.selfie_photo_quality as PhotoQuality | null) ?? null,
      });
      setStep('result');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  const filteredInstitutions = useMemo(() => {
    const q = search.trim().toLowerCase();
    return institutions.filter(i => {
      if (typeFilter !== 'all' && i.type !== typeFilter) return false;
      if (!q) return true;
      return i.name.toLowerCase().includes(q) || i.city.toLowerCase().includes(q);
    });
  }, [institutions, search, typeFilter]);

  const goNext = () => {
    if (step === 'institution' && institution) setStep('reg');
    else if (step === 'reg' && reg.trim().length >= 3) setStep('nid');
    else if (step === 'nid' && nid.trim().length >= 5) setStep('idphoto');
    else if (step === 'idphoto' && idPhoto) setStep('selfie');
    else if (step === 'selfie' && selfie) submit();
  };

  const goBack = () => {
    const order: Step[] = ['institution', 'reg', 'nid', 'idphoto', 'selfie'];
    const idx = order.indexOf(step as typeof order[number]);
    if (idx > 0) setStep(order[idx - 1]);
    else navigate(-1);
  };

  const handleIdUpload = async (file: File) => {
    try {
      const blob = await compressImage(file, 1280, 0.85);
      setIdPhoto(blob);
      setIdPhotoPreview(URL.createObjectURL(blob));
      const q = await measureQuality(blob);
      setIdQuality(q);
      setIdIssues(evaluateQuality(q, 'id'));
    } catch (e) {
      toast.error('Could not process image');
    }
  };

  const retakeAll = () => {
    setIdPhoto(null); setIdPhotoPreview(null); setIdQuality(null); setIdIssues([]);
    setSelfie(null); setSelfiePreview(null); setSelfieQuality(null); setSelfieIssues([]);
    setResult(null);
    setStep('idphoto');
  };

  /** Reset only the photo type that failed and jump straight to that step. */
  const retakeStep = (kind: 'id' | 'selfie') => {
    if (kind === 'id') {
      setIdPhoto(null); setIdPhotoPreview(null); setIdQuality(null); setIdIssues([]);
      setStep('idphoto');
    } else {
      setSelfie(null); setSelfiePreview(null); setSelfieQuality(null); setSelfieIssues([]);
      setStep('selfie');
    }
    setResult(null);
  };

  const submit = async () => {
    if (!user || !institution || !idPhoto || !selfie) return;
    setStep('submitting');
    try {
      const idPath = `${user.id}/id_${Date.now()}.jpg`;
      const selfiePath = `${user.id}/selfie_${Date.now()}.jpg`;

      const [idUp, selfieUp] = await Promise.all([
        supabase.storage.from('student-verification').upload(idPath, idPhoto, { contentType: 'image/jpeg', upsert: true }),
        supabase.storage.from('student-verification').upload(selfiePath, selfie, { contentType: 'image/jpeg', upsert: true }),
      ]);
      if (idUp.error) throw idUp.error;
      if (selfieUp.error) throw selfieUp.error;

      const { data: session } = await supabase.auth.getSession();
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/verify-student`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.session?.access_token ?? ''}`,
        },
        body: JSON.stringify({
          institution_id: institution.id,
          registration_number: reg.trim(),
          national_id_number: nid.trim(),
          id_photo_path: idPath,
          selfie_photo_path: selfiePath,
          device_id: getDeviceId(),
          id_photo_quality: idQuality,
          selfie_photo_quality: selfieQuality,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        toast.error(data.error || 'Verification failed');
        setResult({
          status: 'rejected',
          score: 0,
          reason: data.error,
          rejectedStep: null,
          idQuality,
          selfieQuality,
        });
        setStep('result');
        await refetch();
        return;
      }
      setResult({
        status: data.verification_status,
        score: data.face_match_score,
        rejectedStep: data.rejected_step ?? null,
        idQuality: (data.id_quality as PhotoQuality) ?? idQuality,
        selfieQuality: (data.selfie_quality as PhotoQuality) ?? selfieQuality,
      });
      setStep('result');
      await refetch();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Upload failed';
      toast.error(msg);
      setStep('selfie');
    }
  };

  const progress = useMemo(() => {
    const map: Record<Step, number> = { institution: 20, reg: 40, nid: 60, idphoto: 75, selfie: 90, submitting: 95, result: 100 };
    return map[step];
  }, [step]);

  return (
    <div className="min-h-[100dvh] bg-gradient-to-b from-primary/5 via-background to-background">
      {/* Header */}
      <header className="sticky top-0 z-10 backdrop-blur-md bg-background/80 border-b border-border/50">
        <div className="max-w-xl mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={goBack} className="w-9 h-9 rounded-full hover:bg-accent flex items-center justify-center" aria-label="Back">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex-1">
            <h1 className="text-base font-bold flex items-center gap-1.5">
              <GraduationCap className="w-4 h-4 text-primary" />
              Student Verification
            </h1>
            <div className="h-1 w-full bg-muted rounded-full mt-1.5 overflow-hidden">
              <motion.div
                className="h-full bg-primary rounded-full"
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-4 py-6">
        <AnimatePresence mode="wait">
          {/* Step 1: institution */}
          {step === 'institution' && (
            <motion.div key="inst" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <h2 className="text-2xl font-bold mb-1">Choose your institution</h2>
              <p className="text-sm text-muted-foreground mb-4">Search universities, colleges, and polytechnics in Zimbabwe.</p>

              <div className="relative mb-3">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="e.g. UZ, NUST, Harare Poly"
                  className="pl-9 h-11 rounded-2xl"
                />
              </div>

              <div className="flex gap-1.5 mb-4 overflow-x-auto no-scrollbar">
                {(['all', 'university', 'polytechnic', 'college'] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => setTypeFilter(t)}
                    className={cn(
                      'px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap border transition-colors',
                      typeFilter === t ? 'bg-primary text-white border-primary' : 'bg-card border-border text-foreground',
                    )}
                  >
                    {t === 'all' ? 'All' : t.charAt(0).toUpperCase() + t.slice(1) + 's'}
                  </button>
                ))}
              </div>

              {instLoading ? (
                <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
              ) : (
                <div className="space-y-1.5 mb-4 max-h-[55dvh] overflow-y-auto">
                  {filteredInstitutions.map(i => (
                    <button
                      key={i.id}
                      onClick={() => setInstitution(i)}
                      className={cn(
                        'w-full text-left px-4 py-3 rounded-2xl border transition-all',
                        institution?.id === i.id
                          ? 'border-primary bg-primary/5 ring-1 ring-primary'
                          : 'border-border bg-card hover:border-primary/40',
                      )}
                    >
                      <div className="font-semibold text-sm">{i.name}</div>
                      <div className="text-[11px] text-muted-foreground flex items-center gap-2 mt-0.5">
                        <Badge variant="secondary" className="text-[10px] py-0 px-1.5 capitalize">{i.type}</Badge>
                        {i.city}
                      </div>
                    </button>
                  ))}
                  {filteredInstitutions.length === 0 && (
                    <p className="text-center text-sm text-muted-foreground py-6">No matches. Try a different search.</p>
                  )}
                </div>
              )}

              <Button onClick={goNext} disabled={!institution} className="w-full h-12 font-bold gap-2 bg-primary hover:bg-primary/90">
                Continue <ArrowRight className="w-4 h-4" />
              </Button>
            </motion.div>
          )}

          {/* Step 2: reg # */}
          {step === 'reg' && (
            <motion.div key="reg" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <h2 className="text-2xl font-bold mb-1">Registration number</h2>
              <p className="text-sm text-muted-foreground mb-4">Enter the student ID issued by {institution?.name}.</p>
              <Input
                value={reg}
                onChange={(e) => setReg(e.target.value.toUpperCase())}
                placeholder="e.g. R234567H"
                className="h-12 rounded-2xl text-base font-mono mb-4"
                autoFocus
              />
              <Button onClick={goNext} disabled={reg.trim().length < 3} className="w-full h-12 font-bold gap-2 bg-primary hover:bg-primary/90">
                Continue <ArrowRight className="w-4 h-4" />
              </Button>
            </motion.div>
          )}

          {/* Step 3: NID */}
          {step === 'nid' && (
            <motion.div key="nid" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <h2 className="text-2xl font-bold mb-1">National ID number</h2>
              <p className="text-sm text-muted-foreground mb-4">Used only to confirm your identity. Stored securely.</p>
              <Input
                value={nid}
                onChange={(e) => setNid(e.target.value.toUpperCase())}
                placeholder="e.g. 63-1234567-A-12"
                className="h-12 rounded-2xl text-base font-mono mb-4"
                autoFocus
              />
              <Button onClick={goNext} disabled={nid.trim().length < 5} className="w-full h-12 font-bold gap-2 bg-primary hover:bg-primary/90">
                Continue <ArrowRight className="w-4 h-4" />
              </Button>
            </motion.div>
          )}

          {/* Step 4: ID photo */}
          {step === 'idphoto' && (
            <motion.div key="idp" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <h2 className="text-2xl font-bold mb-1">Photo of your ID</h2>
              <p className="text-sm text-muted-foreground mb-4">Take a clear photo of your national ID. Make sure the face is visible.</p>

              <PhotoTips
                label="Tips for capturing your ID"
                tips={[
                  { Icon: Sun, label: 'Use bright, even lighting — avoid harsh shadows across the card.' },
                  { Icon: Frame, label: 'Fit the entire ID inside the dashed frame, flat on a dark surface.' },
                  { Icon: Sparkles, label: 'No glare or reflections — tilt slightly if you see a shine.' },
                  { Icon: Eye, label: 'Keep the photo and text sharp and readable — no blur.' },
                ]}
              />

              {idIssues.length > 0 && <QualityIssueList issues={idIssues} />}

              <label
                htmlFor="id-upload"
                aria-label="Upload a photo of your national ID"
                className="relative block aspect-[4/3] rounded-3xl border-2 border-dashed border-primary/60 bg-primary/5 dark:bg-primary/10 cursor-pointer overflow-hidden mb-4"
              >
                {idPhotoPreview ? (
                  <img src={idPhotoPreview} alt="Your captured ID document" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-primary">
                    <Upload aria-hidden="true" className="w-8 h-8" />
                    <p className="text-sm font-semibold">Tap to capture or upload</p>
                    <p className="text-[11px] text-muted-foreground">Auto-compressed before upload</p>
                  </div>
                )}
                {/* ID alignment frame overlay (always visible to teach the boundary) */}
                <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="w-[88%] h-[72%] rounded-2xl border-2 border-primary/80 shadow-[0_0_0_9999px_rgba(15,23,42,0.18)]" />
                  <span className="absolute top-3 left-1/2 -translate-x-1/2 text-[10px] font-bold uppercase tracking-wider text-white bg-primary/90 px-2 py-0.5 rounded-full">
                    Align ID inside frame
                  </span>
                </div>
              </label>
              <input
                id="id-upload"
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleIdUpload(e.target.files[0])}
              />

              <div className="flex gap-2">
                {idPhoto && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => { setIdPhoto(null); setIdPhotoPreview(null); setIdQuality(null); setIdIssues([]); }}
                    className="h-12 gap-2 px-4"
                    aria-label="Retake ID photo"
                  >
                    <RotateCcw className="w-4 h-4" /> Retake
                  </Button>
                )}
                <Button onClick={goNext} disabled={!idPhoto} className="flex-1 h-12 font-bold gap-2 bg-primary hover:bg-primary/90">
                  Continue <ArrowRight className="w-4 h-4" />
                </Button>
              </div>
            </motion.div>
          )}

          {/* Step 5: selfie */}
          {step === 'selfie' && (
            <SelfieCapture
              onDone={(blob, preview, q) => {
                setSelfie(blob);
                setSelfiePreview(preview);
                setSelfieQuality(q);
                setSelfieIssues(evaluateQuality(q, 'selfie'));
              }}
              currentPreview={selfiePreview}
              issues={selfieIssues}
              onSubmit={goNext}
              hasSelfie={!!selfie}
            />
          )}

          {step === 'submitting' && (
            <motion.div key="sub" className="py-20 flex flex-col items-center gap-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <Loader2 className="w-10 h-10 animate-spin text-primary" />
              <p className="text-sm font-semibold">Verifying your identity…</p>
              <p className="text-xs text-muted-foreground">Comparing your selfie with your ID photo.</p>
            </motion.div>
          )}

          {step === 'result' && result && (
            <ResultScreen
              status={result.status}
              score={result.score}
              reason={result.reason}
              rejectedStep={result.rejectedStep ?? null}
              idQuality={result.idQuality ?? null}
              selfieQuality={result.selfieQuality ?? null}
              onClose={() => navigate('/profile')}
              onRetry={retakeAll}
              onRetryStep={retakeStep}
            />
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

function SelfieCapture({
  onDone, currentPreview, issues, onSubmit, hasSelfie,
}: {
  onDone: (blob: Blob, preview: string, quality: PhotoQuality) => void;
  currentPreview: string | null;
  issues: QualityIssue[];
  onSubmit: () => void;
  hasSelfie: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [active, setActive] = useState(false);

  const start = useCallback(async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 720, height: 720 } });
      streamRef.current = s;
      if (videoRef.current) {
        videoRef.current.srcObject = s;
        await videoRef.current.play();
      }
      setActive(true);
    } catch {
      toast.error('Could not access camera');
    }
  }, []);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setActive(false);
  }, []);

  useEffect(() => () => stop(), [stop]);

  const capture = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;
    canvasRef.current.width = 720;
    canvasRef.current.height = 720;
    ctx.drawImage(videoRef.current, 0, 0, 720, 720);
    const blob = await new Promise<Blob>((res, rej) =>
      canvasRef.current!.toBlob(b => b ? res(b) : rej(), 'image/jpeg', 0.85)
    );
    const compressed = await compressImage(blob, 1024, 0.85);
    const q = await measureQuality(compressed);
    onDone(compressed, URL.createObjectURL(compressed), q);
    stop();
  };

  return (
    <motion.div key="self" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
      <h2 className="text-2xl font-bold mb-1">Take a selfie</h2>
      <p className="text-sm text-muted-foreground mb-4">Look directly at the camera. We'll match it with your ID photo.</p>

      <PhotoTips
        label="Tips for taking your selfie"
        tips={[
          { Icon: Sun, label: 'Face a window or bright light — avoid backlight from behind you.' },
          { Icon: Smile, label: 'Centre your face inside the oval, neutral expression.' },
          { Icon: Glasses, label: 'Remove sunglasses, hats, or masks that hide your face.' },
          { Icon: Sparkles, label: 'Hold steady — keep the photo sharp, no motion blur.' },
        ]}
      />

      {issues.length > 0 && <QualityIssueList issues={issues} />}

      <div
        role="img"
        aria-label={active ? 'Live camera preview with face alignment oval' : 'Selfie preview'}
        className="aspect-square rounded-3xl bg-black overflow-hidden mb-4 relative"
      >
        {currentPreview && !active ? (
          <img src={currentPreview} alt="Your captured selfie" className="w-full h-full object-cover" />
        ) : (
          <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
        )}
        {/* Always-on face alignment oval (only over live video) */}
        {active && (
          <div aria-hidden="true" className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-[62%] aspect-[3/4] rounded-[50%] border-[3px] border-primary shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
            <span className="absolute bottom-4 left-1/2 -translate-x-1/2 text-[11px] font-bold uppercase tracking-wider text-white bg-primary/90 px-3 py-1 rounded-full">
              Centre your face
            </span>
          </div>
        )}
      </div>
      <canvas ref={canvasRef} className="hidden" />

      <div className="flex gap-2">
        {!active && !hasSelfie && (
          <Button
            onClick={start}
            autoFocus
            aria-label="Open camera to take selfie"
            className="flex-1 h-12 font-bold gap-2 bg-primary hover:bg-primary/90 focus-visible:ring-4 focus-visible:ring-primary/40 focus-visible:ring-offset-2"
          >
            <Camera className="w-4 h-4" /> Open Camera
          </Button>
        )}
        {active && (
          <Button
            onClick={capture}
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Escape') stop(); }}
            aria-label="Capture selfie now"
            aria-keyshortcuts="Enter Space"
            className="flex-1 h-12 font-bold gap-2 bg-primary hover:bg-primary/90 focus-visible:ring-4 focus-visible:ring-primary/40 focus-visible:ring-offset-2"
          >
            <Camera className="w-4 h-4" /> Take Photo
          </Button>
        )}
        {!active && hasSelfie && (
          <>
            <Button
              onClick={start}
              variant="outline"
              aria-label="Retake selfie"
              className="flex-1 h-12 gap-2 focus-visible:ring-4 focus-visible:ring-primary/40 focus-visible:ring-offset-2"
            >
              <RotateCcw className="w-4 h-4" /> Retake
            </Button>
            <Button
              onClick={onSubmit}
              autoFocus
              aria-label="Submit verification"
              className="flex-1 h-12 font-bold gap-2 bg-primary hover:bg-primary/90 focus-visible:ring-4 focus-visible:ring-primary/40 focus-visible:ring-offset-2"
            >
              <ShieldCheck className="w-4 h-4" /> Submit
            </Button>
          </>
        )}
      </div>
    </motion.div>
  );
}

/** Small chip showing brightness/glare/blur for one photo. */
function QualityChips({ q, label }: { q: PhotoQuality | null; label: string }) {
  if (!q) return null;
  const tone = (ok: boolean) => ok ? 'bg-emerald-100 text-emerald-800 border-emerald-300' : 'bg-rose-100 text-rose-800 border-rose-300';
  const brightOk = q.brightness >= 30 && q.brightness <= 85;
  const blurOk = q.blur <= 60;
  const glareOk = !q.glare;
  return (
    <div className="text-left mb-3">
      <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        <span className={cn('text-[11px] font-semibold px-2 py-1 rounded-full border', tone(brightOk))} aria-label={`Brightness ${q.brightness} percent`}>
          ☀ Brightness {q.brightness}%
        </span>
        <span className={cn('text-[11px] font-semibold px-2 py-1 rounded-full border', tone(glareOk))} aria-label={q.glare ? 'Glare detected' : 'No glare'}>
          ✨ {q.glare ? 'Glare detected' : 'No glare'}
        </span>
        <span className={cn('text-[11px] font-semibold px-2 py-1 rounded-full border', tone(blurOk))} aria-label={`Blur level ${q.blur}`}>
          🎯 Blur {q.blur}
        </span>
      </div>
    </div>
  );
}

function ResultScreen({
  status, score, reason, rejectedStep, idQuality, selfieQuality, onClose, onRetry, onRetryStep,
}: {
  status: string;
  score: number;
  reason?: string;
  rejectedStep: 'id' | 'selfie' | null;
  idQuality: PhotoQuality | null;
  selfieQuality: PhotoQuality | null;
  onClose: () => void;
  onRetry: () => void;
  onRetryStep: (kind: 'id' | 'selfie') => void;
}) {
  const config = {
    approved: {
      Icon: CheckCircle2,
      title: 'You\'re verified! 🎓',
      desc: 'Your $1 student discount is now active for the next ride.',
      tone: 'text-emerald-600 bg-emerald-50',
    },
    pending: {
      Icon: Clock,
      title: 'Awaiting review',
      desc: 'Our team will review your submission and notify you shortly.',
      tone: 'text-amber-600 bg-amber-50',
    },
    locked: {
      Icon: AlertTriangle,
      title: 'Manual review required',
      desc: 'You\'ve reached the attempt limit. Our team will review your account.',
      tone: 'text-rose-600 bg-rose-50',
    },
    rejected: {
      Icon: AlertTriangle,
      title: 'Verification needs another try',
      desc: reason || 'Please try again with clearer photos.',
      tone: 'text-rose-600 bg-rose-50',
    },
  }[status] ?? {
    Icon: Clock, title: 'Submitted', desc: 'We\'ll get back to you soon.', tone: 'text-primary bg-primary/10',
  };

  const { Icon } = config;
  const showRetake = status === 'rejected' || (status === 'pending' && score > 0 && score < 90);

  return (
    <motion.div key="res" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-center py-8">
      <motion.div
        initial={{ scale: 0 }} animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 15 }}
        className={cn('w-24 h-24 rounded-full mx-auto flex items-center justify-center mb-5', config.tone)}
      >
        <Icon className="w-12 h-12" />
      </motion.div>
      <h2 className="text-2xl font-bold mb-2">{config.title}</h2>
      <p className="text-sm text-muted-foreground max-w-sm mx-auto mb-4">{config.desc}</p>
      {score > 0 && (
        <Badge variant="secondary" className="mb-4">Match score: {score}/100</Badge>
      )}

      {/* Quality chips for the photo type that needs attention */}
      {showRetake && (
        <div className="max-w-sm mx-auto mb-4">
          {(rejectedStep === 'id' || !rejectedStep) && (
            <QualityChips q={idQuality} label="ID photo quality" />
          )}
          {(rejectedStep === 'selfie' || !rejectedStep) && (
            <QualityChips q={selfieQuality} label="Selfie quality" />
          )}
        </div>
      )}

      {showRetake && (
        <div className="max-w-sm mx-auto mb-5 text-left">
          <PhotoTips
            label="How to pass on the next try"
            tips={[
              { Icon: Sun, label: 'Move to a brighter spot — natural daylight works best.' },
              { Icon: Frame, label: 'Hold the ID inside the frame and your face inside the oval.' },
              { Icon: Sparkles, label: 'Wipe your camera lens and remove any glare on the ID.' },
              { Icon: Eye, label: 'Look straight at the camera, no hats or sunglasses.' },
            ]}
          />
        </div>
      )}

      <div className="space-y-2 max-w-xs mx-auto">
        {/* Step-specific retake — only resets the rejected photo */}
        {showRetake && rejectedStep === 'id' && (
          <Button
            onClick={() => onRetryStep('id')}
            className="w-full h-12 font-bold gap-2 bg-primary hover:bg-primary/90 focus-visible:ring-4 focus-visible:ring-primary/40"
            aria-label="Retake only the ID photo"
          >
            <RotateCcw className="w-4 h-4" /> Retake ID photo only
          </Button>
        )}
        {showRetake && rejectedStep === 'selfie' && (
          <Button
            onClick={() => onRetryStep('selfie')}
            className="w-full h-12 font-bold gap-2 bg-primary hover:bg-primary/90 focus-visible:ring-4 focus-visible:ring-primary/40"
            aria-label="Retake only the selfie"
          >
            <RotateCcw className="w-4 h-4" /> Retake selfie only
          </Button>
        )}
        {showRetake && (
          <Button onClick={onRetry} variant="outline" className="w-full h-12 gap-2 focus-visible:ring-4 focus-visible:ring-primary/40" aria-label="Retake both photos and try again">
            <RotateCcw className="w-4 h-4" /> Retake both photos
          </Button>
        )}
        <Button onClick={onClose} variant={showRetake ? 'ghost' : 'default'} className={cn('w-full h-12 font-bold', !showRetake && 'bg-primary hover:bg-primary/90')}>
          Back to profile
        </Button>
      </div>
    </motion.div>
  );
}
