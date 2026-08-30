import { useState, useMemo, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Loader2, ArrowLeft, RefreshCw, CheckCircle2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { lovable } from '@/integrations/lovable/index';
import { updateMyProfile } from '@/lib/businessApi';

const signupSchema = z.object({
  fullName: z.string().min(2, 'Full Name is required').max(100, 'Name too long'),
  idNumber: z.string().min(1, 'ID Number is required').max(50, 'ID too long'),
  phone: z.string()
    .min(10, 'Phone number must be at least 10 digits')
    .max(20, 'Phone number too long')
    .regex(/^\+?[0-9\s-]+$/, 'Enter a valid phone number'),
  email: z.string().email('Enter a valid email address').max(255, 'Email too long').optional().or(z.literal('')),
  password: z.string().min(6, 'Password must be at least 6 characters').max(72, 'Password too long')
    .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~])/, 'Must include uppercase, lowercase, number, and special character'),
});

type SignupFormData = z.infer<typeof signupSchema>;

type SignupStep = 'details' | 'verify-phone' | 'complete';

const Signup = () => {
  const [searchParams] = useSearchParams();
  const next = useMemo(() => searchParams.get('next') || '/ride', [searchParams]);
  const [step, setStep] = useState<SignupStep>('details');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState<SignupFormData | null>(null);
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  // Timer refs so navigating away during countdown / deferred signup
  // cancels the work instead of writing state to an unmounted component.
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const signupTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // OTP state
  const [otp, setOtp] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [isVerified, setIsVerified] = useState(false);
  const [countdown, setCountdown] = useState(0);

  const form = useForm<SignupFormData>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      fullName: '',
      idNumber: '',
      phone: '',
      email: '',
      password: '',
    },
  });

  const formatPhoneNumber = (phone: string): string => {
    let cleaned = phone.replace(/[\s-]/g, '');
    if (cleaned.startsWith('0')) {
      cleaned = '+263' + cleaned.substring(1);
    }
    if (!cleaned.startsWith('+')) {
      cleaned = '+' + cleaned;
    }
    return cleaned;
  };

  // Start countdown timer
  const startCountdown = () => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    setCountdown(60);
    countdownRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          if (countdownRef.current) clearInterval(countdownRef.current);
          countdownRef.current = null;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  // Send OTP via twilio-otp edge function (unauthenticated - we haven't signed up yet)
  const sendOtp = async (phoneNumber: string) => {
    if (countdown > 0) return;
    setIsSendingOtp(true);
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/twilio-otp`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
          body: JSON.stringify({ action: 'send', phone: phoneNumber }),
        }
      );
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || data.message || 'Failed to send OTP');
      }
      toast({ title: 'Code sent!', description: `Verification code sent to ${phoneNumber}` });
      startCountdown();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to send code';
      toast({ title: 'Failed to send code', description: message, variant: 'destructive' });
    } finally {
      setIsSendingOtp(false);
    }
  };

  // Verify OTP
  const verifyOtp = async () => {
    if (otp.length !== 6 || !formData) return;
    setIsVerifying(true);
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/twilio-otp`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
          body: JSON.stringify({ action: 'verify', phone: formData.phone, code: otp }),
        }
      );
      const data = await res.json();
      if (!res.ok || !data.success) {
        toast({ title: 'Invalid code', description: data.message || 'Please try again', variant: 'destructive' });
        setOtp('');
        return;
      }
      setIsVerified(true);
      toast({ title: 'Phone verified!' });
      // Proceed to create account
      signupTimeoutRef.current = setTimeout(() => completeSignup(formData), 800);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Verification failed';
      toast({ title: 'Verification failed', description: message, variant: 'destructive' });
      setOtp('');
    } finally {
      setIsVerifying(false);
    }
  };

  const onSubmitDetails = async (data: SignupFormData) => {
    const formattedData = {
      ...data,
      phone: formatPhoneNumber(data.phone),
    };

    // Check if phone number is already registered
    const { data: existingPhone } = await supabase
      .from('profiles')
      .select('id')
      .eq('phone', formattedData.phone)
      .maybeSingle();

    if (existingPhone) {
      toast({ title: 'Phone already registered', description: 'This phone number is already linked to an account. Please sign in instead.', variant: 'destructive' });
      return;
    }

    // Email uniqueness is enforced by Supabase Auth at signup time

    setFormData(formattedData);
    setStep('verify-phone');
    // Send OTP immediately
    await sendOtp(formattedData.phone);
  };

  const completeSignup = async (data: SignupFormData) => {
    setIsSubmitting(true);
    try {
      const email = data.email || `${data.phone.replace(/\+/g, '')}@pickme.phone`;
      const { error } = await signUp(email, data.password, data.fullName);
      if (error) {
        let message = error.message;
        if (message.includes('already registered')) {
          message = 'An account with this email/phone already exists. Please sign in.';
        }
        if (message.includes('weak_password') || message.includes('Password should contain')) {
          message = 'Password must include uppercase, lowercase, number, and a special character (e.g. !@#$%).';
        }
        toast({ title: 'Signup failed', description: message, variant: 'destructive' });
        return;
      }
      const { data: authData } = await supabase.auth.getUser();
      if (authData?.user) {
        await updateMyProfile({ phone: data.phone });
      }
      toast({ title: 'Account created!', description: 'Welcome to CruiXe.' });
      navigate(next);
    } catch {
      toast({ title: 'Sign up failed', description: 'Please try again.', variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Cancel any timers on unmount so they don't write state to a dead component.
  useEffect(() => () => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    if (signupTimeoutRef.current) clearTimeout(signupTimeoutRef.current);
  }, []);

  // OTP Verification Step
  if (step === 'verify-phone' && formData) {
    if (isVerified) {
      return (
        <div className="min-h-[100dvh] bg-primary flex items-center justify-center p-4">
          <div className="w-full max-w-[520px] bg-background rounded-3xl p-5 shadow-[0_18px_40px_rgba(0,0,0,0.22)]">
            <div className="flex flex-col items-center justify-center py-8 space-y-4">
              <div className="w-16 h-16 rounded-full bg-accent/20 flex items-center justify-center">
                <CheckCircle2 className="h-10 w-10 text-accent" />
              </div>
              <p className="text-lg font-semibold text-foreground">Phone Verified!</p>
              <p className="text-sm text-muted-foreground">
                {isSubmitting ? 'Creating your account...' : 'Completing registration...'}
              </p>
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-[100dvh] bg-primary flex items-center justify-center p-4 pt-[calc(16px+env(safe-area-inset-top))] pb-[calc(16px+env(safe-area-inset-bottom))]">
        <div className="w-full max-w-[520px] bg-background rounded-3xl p-5 shadow-[0_18px_40px_rgba(0,0,0,0.22)]">
          <div className="space-y-6">
            <div className="text-center space-y-2">
              <h2 className="text-xl font-bold text-foreground">Verify your phone</h2>
              <p className="text-sm text-muted-foreground">
                We sent a 6-digit code to <span className="font-medium">{formData.phone}</span>
              </p>
            </div>

            <div className="flex justify-center">
              <InputOTP maxLength={6} value={otp} onChange={setOtp} disabled={isVerifying}>
                <InputOTPGroup>
                  <InputOTPSlot index={0} className="w-12 h-14 text-xl" />
                  <InputOTPSlot index={1} className="w-12 h-14 text-xl" />
                  <InputOTPSlot index={2} className="w-12 h-14 text-xl" />
                  <InputOTPSlot index={3} className="w-12 h-14 text-xl" />
                  <InputOTPSlot index={4} className="w-12 h-14 text-xl" />
                  <InputOTPSlot index={5} className="w-12 h-14 text-xl" />
                </InputOTPGroup>
              </InputOTP>
            </div>

            <Button
              onClick={verifyOtp}
              disabled={otp.length !== 6 || isVerifying}
              className="w-full h-12 rounded-2xl bg-foreground hover:bg-foreground/90 text-background font-black text-base"
            >
              {isVerifying ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Verifying...</>
              ) : (
                'Verify Code'
              )}
            </Button>

            <div className="flex items-center justify-between">
              <Button
                variant="ghost"
                onClick={() => { setStep('details'); setOtp(''); }}
                disabled={isVerifying}
                className="text-muted-foreground"
              >
                Change number
              </Button>
              <Button
                variant="ghost"
                onClick={() => sendOtp(formData.phone)}
                disabled={countdown > 0 || isSendingOtp}
                className="text-accent"
              >
                {isSendingOtp ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                {countdown > 0 ? `Resend in ${countdown}s` : 'Resend code'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-primary flex items-center justify-center p-4 pt-[calc(16px+env(safe-area-inset-top))] pb-[calc(16px+env(safe-area-inset-bottom))]">
      <div className="w-full max-w-[520px] bg-background backdrop-blur-[10px] rounded-3xl p-5 shadow-[0_18px_40px_rgba(0,0,0,0.22)]">
        <div className="flex items-center gap-3 mb-4">
          <Link to="/" className="p-2 -ml-2 rounded-full hover:bg-muted transition-colors">
            <ArrowLeft className="h-5 w-5 text-foreground" />
          </Link>
          <div>
            <h1 className="text-xl font-black text-foreground">Create your account</h1>
            <p className="text-sm text-muted-foreground">Sign up as a User to get started.</p>
          </div>
        </div>

        {/* Google Sign-In */}
        <button
          onClick={async () => {
            const result = await lovable.auth.signInWithOAuth("google", {
              redirect_uri: window.location.origin + '/app',
            });
            if (result?.error) {
              toast({ title: 'Google sign-in failed', variant: 'destructive' });
            }
          }}
          className="w-full flex items-center justify-center gap-3 p-3.5 border border-border/60 rounded-2xl hover:bg-muted/50 active:scale-[0.98] transition-all mb-3"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          <span className="font-semibold text-[15px]">Continue with Google</span>
        </button>

        <div className="flex items-center gap-3 mb-3">
          <div className="flex-1 h-px bg-border" />
          <span className="text-xs text-muted-foreground font-medium">or</span>
          <div className="flex-1 h-px bg-border" />
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmitDetails)} className="space-y-4">
            <FormField control={form.control} name="fullName" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-foreground font-semibold">Full Name</FormLabel>
                <FormControl>
                  <Input placeholder="John Doe" className="h-12 rounded-2xl border-border bg-background text-foreground" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="idNumber" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-foreground font-semibold">ID Number</FormLabel>
                <FormControl>
                  <Input placeholder="National ID or Passport" className="h-12 rounded-2xl border-border bg-background text-foreground" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="phone" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-foreground font-semibold">Phone Number</FormLabel>
                <FormControl>
                  <Input type="tel" inputMode="tel" placeholder="+263 77 123 4567" className="h-12 rounded-2xl border-border bg-background text-foreground" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="email" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-foreground font-semibold">
                  Email <span className="text-muted-foreground font-normal">(optional)</span>
                </FormLabel>
                <FormControl>
                  <Input type="email" inputMode="email" placeholder="you@email.com" className="h-12 rounded-2xl border-border bg-background text-foreground" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="password" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-foreground font-semibold">Password</FormLabel>
                <FormControl>
                  <Input type="password" placeholder="••••••••" className="h-12 rounded-2xl border-border bg-background text-foreground" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <Button type="submit" className="w-full h-12 rounded-2xl bg-foreground hover:bg-foreground/90 text-background font-black text-base mt-2" disabled={isSubmitting}>
              {isSubmitting ? (<><Loader2 className="h-4 w-4 animate-spin mr-2" /> Sending code...</>) : 'Continue'}
            </Button>
          </form>
        </Form>

        <p className="mt-4 text-xs text-muted-foreground leading-relaxed">
          By continuing you agree to CruiXe's basic terms of use.
        </p>

        <p className="mt-4 text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link to="/login" className="text-accent font-semibold hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  );
};

export default Signup;
