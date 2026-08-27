import { useState } from 'react';
import { Eye, EyeOff, Mail, Phone, ArrowLeft, Loader2, User } from 'lucide-react';
import { lovable } from '@/integrations/lovable/index';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabaseClient';
import { toast } from 'sonner';
import { z } from 'zod';
import { updateMyProfile } from '@/lib/businessApi';

interface AuthFormProps {
  mode: 'login' | 'signup';
  onSwitchMode: () => void;
  onSuccess: () => void;
}

type AuthMethod = 'email' | 'phone';
type Step = 'select' | 'credentials' | 'otp';

const emailSchema = z.string().email('Please enter a valid email address');
const passwordSchema = z.string().min(6, 'Password must be at least 6 characters');
const phoneSchema = z.string().min(9, 'Please enter a valid phone number');
const nameSchema = z.string().min(2, 'Name must be at least 2 characters');

const digitsOnly = (value: string) => value.replace(/\D/g, '');

const AuthForm = ({ mode, onSwitchMode, onSuccess }: AuthFormProps) => {
  const { signUp, signIn, signInWithPhone, verifyOtp } = useAuth();
  
  const [authMethod, setAuthMethod] = useState<AuthMethod | null>(null);
  const [step, setStep] = useState<Step>('select');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [gender, setGender] = useState<'male' | 'female' | ''>('');
  const [phone, setPhone] = useState('');
  const [countryCode, setCountryCode] = useState('+263');
  const [otp, setOtp] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleBack = () => {
    if (step === 'otp') {
      setStep('credentials');
      setOtp('');
    } else if (step === 'credentials') {
      setStep('select');
      setAuthMethod(null);
    }
    setErrors({});
  };

  const handleMethodSelect = (method: AuthMethod) => {
    setAuthMethod(method);
    setStep('credentials');
  };

  const validateEmail = () => {
    const result = emailSchema.safeParse(email);
    if (!result.success) {
      setErrors(prev => ({ ...prev, email: result.error.errors[0].message }));
      return false;
    }
    setErrors(prev => ({ ...prev, email: '' }));
    return true;
  };

  const validatePassword = () => {
    const result = passwordSchema.safeParse(password);
    if (!result.success) {
      setErrors(prev => ({ ...prev, password: result.error.errors[0].message }));
      return false;
    }
    setErrors(prev => ({ ...prev, password: '' }));
    return true;
  };

  const validatePhone = () => {
    const normalizedPhone = digitsOnly(phone);
    const result = phoneSchema.safeParse(normalizedPhone);
    if (!result.success) {
      setErrors(prev => ({ ...prev, phone: result.error.errors[0].message }));
      return false;
    }
    setErrors(prev => ({ ...prev, phone: '' }));
    return true;
  };

  const validateName = () => {
    const result = nameSchema.safeParse(fullName);
    if (!result.success) {
      setErrors(prev => ({ ...prev, fullName: result.error.errors[0].message }));
      return false;
    }
    setErrors(prev => ({ ...prev, fullName: '' }));
    return true;
  };

  // Update profile with phone and gender after signup
  const updateProfileAfterSignup = async (_userId: string, phoneNumber: string, userGender: string) => {
    try {
      const updateData: Record<string, string> = { phone: phoneNumber };
      if (userGender) updateData.gender = userGender;
      await updateMyProfile(updateData);
    } catch (e) {
      console.warn('Could not update profile:', e);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const isValidEmail = validateEmail();
    const isValidPassword = validatePassword();
    const isValidName = mode === 'signup' ? validateName() : true;
    const isValidPhone = mode === 'signup' ? validatePhone() : true;
    const isValidGender = mode === 'signup' ? (() => {
      if (!gender) { setErrors(prev => ({ ...prev, gender: 'Please select your gender' })); return false; }
      setErrors(prev => ({ ...prev, gender: '' }));
      return true;
    })() : true;
    
    if (!isValidEmail || !isValidPassword || !isValidName || !isValidPhone || !isValidGender) return;
    
    setLoading(true);
    
    try {
      if (mode === 'signup') {
        const fullPhone = `${countryCode}${digitsOnly(phone)}`;
        const { error } = await signUp(email, password, fullName);
        if (error) {
          if (error.message.includes('already registered')) {
            toast.error('An account with this email already exists. Please log in instead.');
          } else {
            toast.error(error.message);
          }
          return;
        }
        
        // Get the newly created user and update their phone
        const { data: userData } = await supabase.auth.getUser();
        if (userData?.user) {
          await updateProfileAfterSignup(userData.user.id, fullPhone, gender);
        }
        
        toast.success('Account created successfully!');
        onSuccess();
      } else {
        const { error } = await signIn(email, password);
        if (error) {
          if (error.message.includes('Invalid login credentials')) {
            toast.error('Invalid email or password. Please try again.');
          } else {
            toast.error(error.message);
          }
          return;
        }
        toast.success('Welcome back!');
        onSuccess();
      }
    } finally {
      setLoading(false);
    }
  };

  const handlePhoneSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validatePhone()) return;
    
    setLoading(true);
    
    try {
      const fullPhone = `${countryCode}${digitsOnly(phone)}`;
      const { error } = await signInWithPhone(fullPhone);
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success('Verification code sent!');
      setStep('otp');
    } finally {
      setLoading(false);
    }
  };

  const handleOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const normalizedOtp = digitsOnly(otp).slice(0, 6);
    if (normalizedOtp.length !== 6) {
      setErrors(prev => ({ ...prev, otp: 'Please enter the 6-digit code' }));
      return;
    }
    
    setLoading(true);
    
    try {
      const fullPhone = `${countryCode}${digitsOnly(phone)}`;
      const { error } = await verifyOtp(fullPhone, normalizedOtp);
      if (error) {
        toast.error('Invalid verification code. Please try again.');
        return;
      }
      toast.success('Phone verified successfully!');
      onSuccess();
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin + '/app',
      });
      if (result?.error) {
        toast.error('Google sign-in failed. Please try again.');
      }
    } catch {
      toast.error('Google sign-in failed.');
    } finally {
      setLoading(false);
    }
  };

  if (step === 'select') {
    return (
      <div className="animate-fade-in">
        <h2 className="text-2xl font-extrabold text-foreground mb-1.5 tracking-tight">
          {mode === 'login' ? 'Welcome back' : 'Create an account'}
        </h2>
        <p className="text-[15px] text-muted-foreground mb-8">
          {mode === 'login' 
            ? 'Log in to continue to CruiXe' 
            : 'Sign up to get started with CruiXe'}
        </p>

        <div className="space-y-3">
          <button
            onClick={handleGoogleSignIn}
            disabled={loading}
            className="w-full flex items-center gap-4 p-4 border border-border/60 rounded-2xl hover:bg-secondary active:scale-[0.98] transition-all text-left"
          >
            <div className="w-11 h-11 rounded-full bg-muted flex items-center justify-center">
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
            </div>
            <span className="text-[15px] font-semibold">
              {loading ? 'Connecting...' : 'Continue with Google'}
            </span>
          </button>

          <div className="flex items-center gap-3 my-2">
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs text-muted-foreground font-medium">or</span>
            <div className="flex-1 h-px bg-border" />
          </div>

          <button
            onClick={() => handleMethodSelect('email')}
            className="w-full flex items-center gap-4 p-4 border border-border/60 rounded-2xl hover:bg-secondary active:scale-[0.98] transition-all text-left"
          >
            <div className="w-11 h-11 rounded-full bg-muted flex items-center justify-center">
              <Mail className="w-5 h-5 text-muted-foreground" />
            </div>
            <span className="text-[15px] font-semibold">Continue with email</span>
          </button>
          <button
            onClick={() => handleMethodSelect('phone')}
            className="w-full flex items-center gap-4 p-4 border border-border/60 rounded-2xl hover:bg-secondary active:scale-[0.98] transition-all text-left"
          >
            <div className="w-11 h-11 rounded-full bg-muted flex items-center justify-center">
              <Phone className="w-5 h-5 text-muted-foreground" />
            </div>
            <span className="text-[15px] font-semibold">Continue with phone</span>
          </button>
        </div>

        <div className="mt-8 text-center text-[14px] text-muted-foreground">
          {mode === 'login' ? (
            <>
              Don't have an account?{' '}
              <button 
                onClick={onSwitchMode}
                className="text-foreground font-semibold underline underline-offset-2 hover:no-underline"
              >
                Sign up
              </button>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <button 
                onClick={onSwitchMode}
                className="text-foreground font-semibold underline underline-offset-2 hover:no-underline"
              >
                Log in
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  if (step === 'credentials' && authMethod === 'email') {
    return (
      <form onSubmit={handleEmailSubmit} className="animate-fade-in">
        <button 
          type="button"
          onClick={handleBack}
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground mb-5 transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
          <span className="text-[15px] font-medium">Back</span>
        </button>

        <h2 className="text-2xl font-extrabold text-foreground mb-6 tracking-tight">
          {mode === 'login' ? 'Log in with email' : 'Sign up with email'}
        </h2>

        <div className="space-y-4">
          {mode === 'signup' && (
            <>
              <div>
                <Label htmlFor="fullName">Full name *</Label>
                <div className="relative mt-1.5">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="fullName"
                    type="text"
                    placeholder="Enter your full name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    onBlur={validateName}
                    className="pl-10"
                    required
                  />
                </div>
                {errors.fullName && (
                  <p className="text-destructive text-sm mt-1">{errors.fullName}</p>
                )}
              </div>

              <div>
                <Label htmlFor="signupPhone">Phone number *</Label>
                <div className="flex gap-2 mt-1.5">
                  <select 
                    value={countryCode}
                    onChange={(e) => setCountryCode(e.target.value)}
                    className="cruixe-input w-24"
                  >
                    <option value="+263">+263</option>
                    <option value="+27">+27</option>
                    <option value="+254">+254</option>
                    <option value="+234">+234</option>
                  </select>
                  <Input
                    id="signupPhone"
                    type="tel"
                    placeholder="Phone number"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    onBlur={validatePhone}
                    className="flex-1"
                    required
                  />
                </div>
                {errors.phone && (
                  <p className="text-destructive text-sm mt-1">{errors.phone}</p>
                )}
              </div>

              <div>
                <Label htmlFor="gender">Gender *</Label>
                <div className="flex gap-2 mt-1.5">
                  <button
                    type="button"
                    onClick={() => { setGender('male'); setErrors(prev => ({ ...prev, gender: '' })); }}
                    className={`flex-1 py-3 rounded-2xl border text-sm font-semibold transition-all ${gender === 'male' ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:border-muted-foreground/50'}`}
                  >
                    Male
                  </button>
                  <button
                    type="button"
                    onClick={() => { setGender('female'); setErrors(prev => ({ ...prev, gender: '' })); }}
                    className={`flex-1 py-3 rounded-2xl border text-sm font-semibold transition-all ${gender === 'female' ? 'border-pink-400 bg-pink-50 text-pink-600 dark:bg-pink-950/20' : 'border-border text-muted-foreground hover:border-muted-foreground/50'}`}
                  >
                    Female
                  </button>
                </div>
                {errors.gender && (
                  <p className="text-destructive text-sm mt-1">{errors.gender}</p>
                )}
              </div>
            </>
          )}

          <div>
            <Label htmlFor="email">Email *</Label>
            <div className="relative mt-1.5">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                id="email"
                type="email"
                placeholder="Enter your email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={validateEmail}
                className="pl-10"
                required
              />
            </div>
            {errors.email && (
              <p className="text-destructive text-sm mt-1">{errors.email}</p>
            )}
          </div>

          <div>
            <Label htmlFor="password">Password *</Label>
            <div className="relative mt-1.5">
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onBlur={validatePassword}
                className="pr-10"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {errors.password && (
              <p className="text-destructive text-sm mt-1">{errors.password}</p>
            )}
          </div>
        </div>

        <Button 
          type="submit" 
          className="w-full mt-8 cruixe-btn-primary"
          disabled={loading}
        >
          {loading && <Loader2 className="w-5 h-5 animate-spin mr-2" />}
          {mode === 'login' ? 'Log in' : 'Create account'}
        </Button>
      </form>
    );
  }

  if (step === 'credentials' && authMethod === 'phone') {
    return (
      <form onSubmit={handlePhoneSubmit}>
        <button 
          type="button"
          onClick={handleBack}
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground mb-4 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>

        <h2 className="text-2xl font-bold text-foreground mb-6">
          Enter your phone number
        </h2>

        <div>
          <Label htmlFor="phone">Phone number</Label>
          <div className="flex gap-2 mt-1.5">
            <select 
              value={countryCode}
              onChange={(e) => setCountryCode(e.target.value)}
              className="cruixe-input w-24"
            >
              <option value="+263">+263</option>
              <option value="+27">+27</option>
              <option value="+254">+254</option>
              <option value="+234">+234</option>
            </select>
            <Input
              id="phone"
              type="tel"
              placeholder="Phone number"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onBlur={validatePhone}
              className="flex-1"
              required
            />
          </div>
          {errors.phone && (
            <p className="text-destructive text-sm mt-1">{errors.phone}</p>
          )}
        </div>

        <Button 
          type="submit" 
          className="w-full mt-6 cruixe-btn-primary"
          disabled={loading}
        >
          {loading && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
          Continue
        </Button>
      </form>
    );
  }

  if (step === 'otp') {
    return (
      <form onSubmit={handleOtpSubmit}>
        <button 
          type="button"
          onClick={handleBack}
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground mb-4 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>

        <h2 className="text-2xl font-bold text-foreground mb-2">
          Verify your number
        </h2>
        <p className="text-muted-foreground mb-6">
          We sent a code to {countryCode} {phone}
        </p>

        <div>
          <Input
            type="text"
            placeholder="Enter 6-digit code"
            value={otp}
            onChange={(e) => setOtp(e.target.value.slice(0, 6))}
            className="text-center text-2xl tracking-widest"
            maxLength={6}
            required
          />
          {errors.otp && (
            <p className="text-destructive text-sm mt-1">{errors.otp}</p>
          )}
        </div>

        <Button 
          type="submit" 
          className="w-full mt-6 cruixe-btn-primary"
          disabled={loading}
        >
          {loading && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
          Verify
        </Button>

        <p className="text-center mt-4">
          <button 
            type="button" 
            className="text-muted-foreground text-sm hover:text-foreground transition-colors underline underline-offset-2"
          >
            Resend code
          </button>
        </p>
      </form>
    );
  }

  return null;
};

export default AuthForm;
