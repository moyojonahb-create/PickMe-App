import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import CruiXeLogo from '@/components/CruiXeLogo';

const SHELL_CLASS = 'min-h-[100dvh] bg-gradient-to-b from-primary/10 via-primary/5 to-background px-4 py-6 flex items-center justify-center';
const SHELL_STYLE = { paddingTop: 'max(1.5rem, env(safe-area-inset-top))', paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' } as const;

const ResetPassword = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [checkingSession, setCheckingSession] = useState(true);
  const [hasRecoverySession, setHasRecoverySession] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Supabase's client auto-detects the recovery token in the URL on load and
  // establishes a session for it; PASSWORD_RECOVERY fires once that happens.
  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (mounted) {
        setHasRecoverySession(!!session);
        setCheckingSession(false);
      }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setHasRecoverySession(true);
        setCheckingSession(false);
      }
    });
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!password || password.length < 8) {
      setFormError('Password must be at least 8 characters.');
      return;
    }
    const hasUpper = /[A-Z]/.test(password);
    const hasLower = /[a-z]/.test(password);
    const hasDigit = /[0-9]/.test(password);
    const hasSpecial = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(password);
    if (!hasUpper || !hasLower || !hasDigit || !hasSpecial) {
      setFormError('Password must include uppercase, lowercase, number, and special character (e.g. !@#$%).');
      return;
    }
    if (password !== confirmPassword) {
      setFormError('Passwords do not match.');
      return;
    }
    setIsSubmitting(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setFormError(error.message || 'Could not update your password. Please try again.');
        return;
      }
      toast({ title: 'Password updated', description: 'You can now sign in with your new password.' });
      navigate('/ride', { replace: true });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (checkingSession) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-background gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="text-sm text-muted-foreground">Verifying reset link…</span>
      </div>
    );
  }

  if (!hasRecoverySession) {
    return (
      <div className={SHELL_CLASS} style={SHELL_STYLE}>
        <Card className="w-full max-w-md rounded-3xl border border-border/40 bg-card/35 shadow-2xl backdrop-blur-2xl backdrop-saturate-150">
          <CardHeader className="text-center space-y-4">
            <Link to="/auth" className="mx-auto">
              <CruiXeLogo size="md" />
            </Link>
            <CardTitle className="text-2xl text-foreground">Link expired</CardTitle>
            <CardDescription className="text-muted-foreground">
              This password reset link is invalid or has expired. Request a new one from the sign-in screen.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full h-12 rounded-xl" onClick={() => navigate('/auth')}>
              Back to sign in
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className={SHELL_CLASS} style={SHELL_STYLE}>
      <Card className="w-full max-w-md rounded-3xl border border-border/40 bg-card/35 shadow-2xl backdrop-blur-2xl backdrop-saturate-150">
        <CardHeader className="text-center space-y-4">
          <Link to="/auth" className="mx-auto">
            <CruiXeLogo size="md" />
          </Link>
          <CardTitle className="text-2xl text-foreground">Set a new password</CardTitle>
          <CardDescription className="text-muted-foreground">Choose a new password for your CruiXe account.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {formError && (
              <div className="rounded-xl bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive font-medium">
                ⚠️ {formError}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="new-password">New password</Label>
              <div className="relative">
                <Input
                  id="new-password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
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
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm password</Label>
              <Input
                id="confirm-password"
                type={showPassword ? 'text' : 'password'}
                placeholder="••••••••"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                className="h-12 rounded-xl border-border/50 bg-card/80"
              />
            </div>
            <Button type="submit" className="w-full h-12 rounded-xl" style={{ background: 'var(--gradient-primary)' }} disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Update password
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default ResetPassword;
