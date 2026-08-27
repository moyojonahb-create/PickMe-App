import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { lovable } from '@/integrations/lovable/index';
import CruiXeLogo from '@/components/CruiXeLogo';
import { updateMyProfile } from '@/lib/businessApi';

const Auth = () => {
  const [searchParams] = useSearchParams();
  const defaultMode = searchParams.get('mode') === 'signup' ? 'signup' : 'login';
  const [mode, setMode] = useState<'login' | 'signup'>(defaultMode);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { user, loading, signIn, signUp } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  // Form state - plain controlled inputs
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [showSignupPassword, setShowSignupPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [signupError, setSignupError] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isResetting, setIsResetting] = useState(false);


  useEffect(() => {
    if (!loading && user) {
      navigate('/ride', { replace: true });
    }
  }, [user, loading, navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    if (!email || !password) return;
    setIsSubmitting(true);
    try {
      const { error } = await signIn(email, password);
      if (error) {
        setLoginError(error.message || 'Invalid credentials');
      } else {
        toast({ title: 'Welcome back!' });
        navigate('/ride', { replace: true });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleForgotPassword = async () => {
    const trimmed = email.trim();
    if (!trimmed || !trimmed.includes('@')) {
      toast({
        title: 'Enter your email',
        description: 'Password reset only works with an email address. Type the email you signed up with in the field above.',
        variant: 'destructive',
      });
      return;
    }
    setIsResetting(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(trimmed, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) {
        toast({ title: 'Could not send reset email', description: error.message, variant: 'destructive' });
      } else {
        toast({ title: 'Check your email', description: `We sent a password reset link to ${trimmed}.` });
      }
    } finally {
      setIsResetting(false);
    }
  };

  const formatPhone = (p: string) => {
    let cleaned = p.replace(/[\s-]/g, '');
    if (cleaned.startsWith('0')) cleaned = '+263' + cleaned.substring(1);
    if (!cleaned.startsWith('+')) cleaned = '+' + cleaned;
    return cleaned;
  };

  const loginIdentifierToEmail = (identifier: string) => {
    const v = identifier.trim();
    if (v.includes('@')) return v;
    const formatted = formatPhone(v);
    return `${formatted.replace(/\+/g, '')}@pickme.phone`;
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setSignupError(null);
    if (!fullName || fullName.length < 2) {
      setSignupError('Name must be at least 2 characters.');
      return;
    }
    if (!phone || phone.replace(/\D/g, '').length < 9) {
      setSignupError('Please enter a valid phone number.');
      return;
    }
    if (!password || password.length < 8) {
      setSignupError('Password must be at least 8 characters.');
      return;
    }
    const hasUpper = /[A-Z]/.test(password);
    const hasLower = /[a-z]/.test(password);
    const hasDigit = /[0-9]/.test(password);
    const hasSpecial = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(password);
    if (!hasUpper || !hasLower || !hasDigit || !hasSpecial) {
      setSignupError('Password must include uppercase, lowercase, number, and special character (e.g. !@#$%).');
      return;
    }

    setIsSubmitting(true);
    try {
      const formattedPhone = formatPhone(phone);

      const { data: existingPhone } = await supabase
        .from('profiles')
        .select('id')
        .eq('phone', formattedPhone)
        .maybeSingle();

      if (existingPhone) {
        setSignupError('This phone number is already linked to an account. Please sign in instead.');
        setIsSubmitting(false);
        return;
      }

      const signupEmail = email.trim() || `${formattedPhone.replace(/\+/g, '')}@pickme.phone`;

      const { error } = await signUp(signupEmail, password, fullName);
      if (error) {
        let message = error.message;
        if (message.includes('already registered') || message.includes('already been registered')) {
          message = 'An account with this email/phone already exists. Please sign in instead.';
        }
        if (message.includes('weak_password') || message.includes('Password should contain')) {
          message = 'Password must include uppercase, lowercase, number, and a special character (e.g. !@#$%).';
        }
        setSignupError(message);
        return;
      }

      const { data: authData } = await supabase.auth.getUser();
      if (authData?.user) {
        await updateMyProfile({ phone: formattedPhone });
      }

      toast({ title: 'Account created!', description: 'Welcome to CruiXe.' });
      navigate('/ride', { replace: true });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-background gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="text-sm text-muted-foreground">Connecting to CruiXe…</span>
      </div>
    );
  }

  return (
    <div
      className="min-h-[100dvh] bg-gradient-to-b from-primary/10 via-primary/5 to-background px-4 py-6 flex items-center justify-center"
      style={{ paddingTop: 'max(1.5rem, env(safe-area-inset-top))', paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}
    >
      <Card className="w-full max-w-md rounded-3xl border border-border/40 bg-card/35 shadow-2xl backdrop-blur-2xl backdrop-saturate-150">
        <CardHeader className="text-center space-y-4">
          <Link to="/" className="mx-auto">
            <CruiXeLogo size="md" />
          </Link>
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">CruiXe</p>
            <CardTitle className="text-2xl text-foreground">
            {mode === 'login' ? 'Welcome back' : 'Create an account'}
            </CardTitle>
          </div>
          <CardDescription className="text-muted-foreground">
            {mode === 'login' 
              ? 'Sign in to your CruiXe account' 
              : 'Sign up to start using CruiXe'
            }
          </CardDescription>

        </CardHeader>
        <CardContent className="max-h-[72dvh] overflow-y-auto pr-1">
          {/* Google Sign-In */}
          <button
            onClick={async () => {
              const result = await lovable.auth.signInWithOAuth("google", {
                redirect_uri: window.location.origin + '/ride',
              });
              if (result?.error) {
                toast({ title: 'Google sign-in failed', variant: 'destructive' });
              }
            }}
            className="w-full flex items-center justify-center gap-3 p-3 border border-border/50 bg-card/60 rounded-xl hover:bg-card transition-colors mb-4"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            <span className="font-medium">Continue with Google</span>
          </button>

          <div className="flex items-center gap-3 mb-4">
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs text-muted-foreground">or continue with email</span>
            <div className="flex-1 h-px bg-border" />
          </div>

          {mode === 'login' ? (
            <form onSubmit={handleLogin} className="space-y-4">
              {loginError && (
                <div className="rounded-xl bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive font-medium animate-in fade-in slide-in-from-top-2 duration-300">
                  ⚠️ {loginError}
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="login-email">Email or Phone</Label>
                <Input
                  id="login-email"
                  type="text"
                  placeholder="you@example.com or +263..."
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="username"
                  className="h-12 rounded-xl border-border/50 bg-card/80"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="login-password">Password</Label>
                <div className="relative">
                  <Input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    className="h-12 rounded-xl border-border/50 bg-card/80 pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between text-sm">
                <label className="inline-flex items-center gap-2 text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="h-4 w-4 rounded border-border"
                  />
                  Remember me
                </label>
                <button
                  type="button"
                  className="text-primary hover:underline disabled:opacity-60"
                  onClick={handleForgotPassword}
                  disabled={isResetting}
                >
                  {isResetting ? 'Sending…' : 'Forgot password?'}
                </button>
              </div>

              <p className="text-xs text-muted-foreground">Use the same email or phone number you registered with.</p>

              <Button type="submit" className="w-full h-12 rounded-xl" style={{ background: 'var(--gradient-primary)' }} disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Sign In
              </Button>
            </form>
          ) : (
            <form onSubmit={handleSignup} className="space-y-4">
              {signupError && (
                <div className="rounded-xl bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive font-medium animate-in fade-in slide-in-from-top-2 duration-300">
                  ⚠️ {signupError}
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="signup-name">Full Name</Label>
                <Input
                  id="signup-name"
                  type="text"
                  placeholder="John Doe"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  autoComplete="name"
                  className="h-12 rounded-xl border-border/50 bg-card/80"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="signup-phone">Phone Number</Label>
                <Input
                  id="signup-phone"
                  type="tel"
                  inputMode="tel"
                  placeholder="+263 77 123 4567"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  autoComplete="tel"
                  className="h-12 rounded-xl border-border/50 bg-card/80"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="signup-email">Email <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input
                  id="signup-email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  className="h-12 rounded-xl border-border/50 bg-card/80"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="signup-password">Password <span className="text-muted-foreground font-normal text-xs">(must include A-Z, a-z, 0-9, special char)</span></Label>
                <div className="relative">
                  <Input
                    id="signup-password"
                    type={showSignupPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                    className="h-12 rounded-xl border-border/50 bg-card/80 pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSignupPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                    aria-label={showSignupPassword ? 'Hide password' : 'Show password'}
                  >
                    {showSignupPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="signup-confirm-password">Confirm Password <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <div className="relative">
                  <Input
                    id="signup-confirm-password"
                    type={showConfirmPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                    className="h-12 rounded-xl border-border/50 bg-card/80 pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                    aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                  >
                    {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">By continuing, you agree to CruiXe safety and account policies.</p>

              <Button type="submit" className="w-full h-12 rounded-xl" style={{ background: 'var(--gradient-primary)' }} disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Create Account
              </Button>
            </form>
          )}

          <div className="mt-6 text-center text-sm">
            {mode === 'login' ? (
              <p className="text-muted-foreground">
                Don't have an account?{' '}
                <button onClick={() => { setMode('signup'); setSignupError(null); setLoginError(null); }} className="text-accent font-medium hover:underline">
                  Sign up
                </button>
              </p>
            ) : (
              <p className="text-muted-foreground">
                Already have an account?{' '}
                <button onClick={() => { setMode('login'); setSignupError(null); setLoginError(null); }} className="text-accent font-medium hover:underline">
                  Sign in
                </button>
              </p>
            )}
          </div>

          <div className="mt-4 text-center">
            <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
              ← Back to home
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Auth;
