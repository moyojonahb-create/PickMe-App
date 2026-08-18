// Driver mode landing page
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useDriverStatus } from '@/hooks/useDriverStatus';
import { Button } from '@/components/ui/button';
import { Clock, DollarSign, Percent, ChevronRight } from 'lucide-react';
import PickMeLogo from '@/components/PickMeLogo';
import pickMeCarFront from '@/assets/pickme-car-front.png';
import { useState } from 'react';
import AuthModalWrapper from '@/components/auth/AuthModalWrapper';

const benefits = [
  { icon: Clock, text: 'Flexible hours' },
  { icon: DollarSign, text: 'Your prices' },
  { icon: Percent, text: 'Low service payments' },
];

const features = [
  { icon: DollarSign, text: 'Offer your fare' },
  { icon: Percent, text: 'Keep more with low service fees' },
  { icon: Clock, text: 'Choose requests and your schedule' },
];

export default function DriverModeLanding() {
  const { user } = useAuth();
  const { isApproved, isDriver } = useDriverStatus();
  const navigate = useNavigate();
  const location = useLocation();
  const isMapp = location.pathname.startsWith('/mapp');
  const prefix = isMapp ? '/mapp' : '';

  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('signup');

  const handleDriverAction = () => {
    if (user && isDriver && isApproved) {
      navigate('/driver/dashboard');
      return;
    }
    if (user && isDriver) {
      // Pending/rejected driver - show application status
      navigate('/driver/application');
      return;
    }
    // New user or not a driver - go to registration
    navigate('/driver/register');
  };

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 glass-nav">
        {!isMapp && (
          <button onClick={() => navigate(-1)} className="text-muted-foreground hover:text-foreground text-sm">
            ← Back
          </button>
        )}
        <PickMeLogo size="sm" />
        {!isMapp && <div className="w-12" />}
      </div>

      <div className="flex-1 px-5 py-6 flex flex-col gap-4">
        {/* Hero card */}
        <div className="rounded-3xl p-6 mb-2 text-primary-foreground" style={{ background: 'var(--gradient-primary)' }}>
          <h2 className="text-2xl font-bold text-primary-foreground mb-4">Get income with PickMe</h2>
          <div className="space-y-2">
            {benefits.map((b) => (
              <div key={b.text} className="flex items-center gap-3 text-primary-foreground/90">
                <span className="w-8 h-8 rounded-xl bg-white/15 flex items-center justify-center">
                  <b.icon className="w-4 h-4" />
                </span>
                <span className="text-sm font-medium">{b.text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Driver CTA card */}
        <button
          onClick={handleDriverAction}
          className="flex items-center gap-4 p-5 rounded-2xl glass-card hover:bg-foreground/[0.02] transition-colors mb-2"
        >
          <img src={pickMeCarFront} alt="" className="h-12 w-auto object-contain shrink-0" />
          <span className="text-lg font-semibold text-foreground flex-1 text-left">Driver</span>
          <ChevronRight className="w-5 h-5 text-muted-foreground" />
        </button>

        {/* Features list */}
        <div className="space-y-6 mb-auto">
          {features.map((f) => (
            <div key={f.text} className="flex items-center gap-4 glass-card px-3 py-2.5 rounded-2xl">
              <div className="p-2 rounded-xl bg-accent/20 glass-glow-yellow">
                <f.icon className="w-5 h-5 text-accent" />
              </div>
              <span className="text-foreground font-medium">{f.text}</span>
            </div>
          ))}
        </div>

        {/* Bottom actions */}
        <div className="mt-8 space-y-3">
          <Button
            onClick={() => navigate('/driver/register')}
            className="w-full h-14 rounded-full text-lg font-semibold bg-primary text-primary-foreground hover:opacity-95 shadow-[0_8px_24px_hsl(var(--primary)/0.35)]"
          >
            Register
          </Button>

          {!user && (
            <>
              <Button
                variant="outline"
                className="w-full h-14 rounded-full text-lg font-medium"
                onClick={() => { setAuthMode('login'); setAuthOpen(true); }}
              >
                I already have an account
              </Button>
              <button
                onClick={() => navigate(`${prefix}/ride`)}
                className="w-full text-center text-muted-foreground hover:text-foreground text-sm py-2"
              >
                Go to passenger mode
              </button>
            </>
          )}
        </div>
      </div>

      <AuthModalWrapper
        isOpen={authOpen}
        onClose={() => setAuthOpen(false)}
        mode={authMode}
        onSwitchMode={() => setAuthMode(authMode === 'login' ? 'signup' : 'login')}
      />
    </div>
  );
}



