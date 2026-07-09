import { MessageSquare, Users, Phone, Shield, Car, AlertTriangle, Lock, Send, Sparkles, PhoneCall, CircleAlert, ChevronRight } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import PickMeLogo from '@/components/PickMeLogo';
import BottomNavBar from '@/components/BottomNavBar';

const protectionCards = [
  { icon: Shield, title: 'Live support', description: 'Help is available whenever you need it.', color: 'bg-accent/20 text-accent' },
  { icon: Users, title: 'Verified rides', description: 'Trusted drivers and clear trip details.', color: 'bg-accent/20 text-accent' },
  { icon: Lock, title: 'Private by default', description: 'Your trip details stay in the app.', color: 'bg-accent/20 text-accent' },
  { icon: Car, title: 'Route awareness', description: 'Track your trip as it progresses.', color: 'bg-accent/20 text-accent' },
  { icon: AlertTriangle, title: 'Accident steps', description: 'Quick guidance for urgent situations.', color: 'bg-yellow-500/20 text-yellow-600' },
];

export default function SafetyPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const isMapp = location.pathname.startsWith('/mapp');

  const handleShareTrip = async () => {
    const shareText = 'I’m sharing my current ride safety status from PickMe.';
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title: 'PickMe Safety', text: shareText, url: window.location.href });
        return;
      } catch {
        // fall back to clipboard if the share sheet is dismissed
      }
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(`${shareText}\n${window.location.href}`);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col">
      {/* Gradient header */}
      <div
        className="px-5 pt-5 pb-16 text-primary-foreground relative overflow-hidden"
        style={{ background: 'linear-gradient(135deg, hsl(224 71% 37%), hsl(225 65% 48%))' }}
      >
        <div className="absolute -top-16 -right-12 w-56 h-56 rounded-full bg-white/10 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-20 -left-10 w-64 h-64 rounded-full bg-accent/20 blur-3xl pointer-events-none" />

        <div className="relative flex items-center justify-between">
          {!isMapp ? (
            <button
              onClick={() => navigate(-1)}
              className="w-10 h-10 rounded-full bg-white/15 backdrop-blur flex items-center justify-center hover:bg-white/25 transition-colors"
              aria-label="Back"
            >
              <ChevronRight className="w-5 h-5 rotate-180" />
            </button>
          ) : <div className="w-10" />}
          <div className="flex items-center gap-2">
            <PickMeLogo size="sm" iconOnly />
            <span className="font-black text-sm tracking-wide">SAFETY CENTER</span>
          </div>
          <div className="w-10" />
        </div>

        <div className="relative mt-6">
          <h1 className="text-3xl font-black leading-tight">Your safety,<br />our priority.</h1>
          <p className="text-sm text-primary-foreground/85 mt-2 max-w-[280px]">
            Tools and guidance to keep every trip secure — before, during and after.
          </p>
        </div>
      </div>

      <div className="flex-1 px-5 py-6 pb-24 space-y-5">
        <div className="rounded-[24px] border border-border/50 bg-card/80 p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">Safety toolkit</p>
              <h2 className="mt-1 text-lg font-bold text-foreground">Stay calm and act fast</h2>
              <p className="mt-1 text-sm text-muted-foreground">Your emergency tools stay within reach whenever you need help.</p>
            </div>
            <div className="rounded-2xl bg-destructive/10 p-3 text-destructive">
              <Shield className="h-5 w-5" />
            </div>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <a href="tel:995" className="flex items-center justify-between rounded-2xl bg-destructive px-4 py-3 text-left text-destructive-foreground">
              <div>
                <p className="text-sm font-semibold">Emergency SOS</p>
                <p className="text-xs opacity-90">Call 995 for urgent help</p>
              </div>
              <PhoneCall className="h-4 w-4" />
            </a>
            <button onClick={handleShareTrip} className="flex items-center justify-between rounded-2xl border border-border/50 bg-background/70 px-4 py-3 text-left">
              <div>
                <p className="text-sm font-semibold text-foreground">Share trip status</p>
                <p className="text-xs text-muted-foreground">Alert trusted contacts quickly</p>
              </div>
              <Send className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <a href="tel:995" className="rounded-[22px] border border-border/50 bg-card/80 p-4 text-left shadow-sm">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-red-500/10 p-2.5 text-red-600"><Phone className="h-4 w-4" /></div>
              <div>
                <p className="font-semibold text-foreground">Trusted contacts</p>
                <p className="text-sm text-muted-foreground">Reach help instantly</p>
              </div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">Call the emergency support line or use the in-app help desk.</p>
          </a>
          <div className="rounded-[22px] border border-border/50 bg-card/80 p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-amber-500/10 p-2.5 text-amber-600"><CircleAlert className="h-4 w-4" /></div>
              <div>
                <p className="font-semibold text-foreground">Safety tips</p>
                <p className="text-sm text-muted-foreground">Stay aware before and during the ride</p>
              </div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">Share your live trip, keep your phone charged, and stay in well-lit pickup areas.</p>
          </div>
        </div>

        <div className="rounded-[24px] border border-border/50 bg-card/80 p-4 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">Emergency numbers</p>
              <h3 className="text-base font-bold text-foreground">Always ready in the moment</h3>
            </div>
            <div className="rounded-2xl bg-primary/10 p-2.5 text-primary"><Sparkles className="h-4 w-4" /></div>
          </div>
          <div className="mt-4 space-y-2">
            <a href="tel:995" className="flex items-center justify-between rounded-2xl border border-border/40 bg-background/70 px-3 py-3">
              <div>
                <p className="text-sm font-semibold text-foreground">Emergency support</p>
                <p className="text-xs text-muted-foreground">National emergency line</p>
              </div>
              <span className="text-sm font-semibold text-primary">995</span>
            </a>
            <a href="tel:112" className="flex items-center justify-between rounded-2xl border border-border/40 bg-background/70 px-3 py-3">
              <div>
                <p className="text-sm font-semibold text-foreground">Police / rescue</p>
                <p className="text-xs text-muted-foreground">Alternative emergency line</p>
              </div>
              <span className="text-sm font-semibold text-primary">112</span>
            </a>
          </div>
        </div>

        <div>
          <h2 className="mb-3 text-lg font-bold text-foreground">Why PickMe feels safer</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {protectionCards.map((card) => {
              const Icon = card.icon;
              return (
                <div key={card.title} className="rounded-[22px] border border-border/50 bg-card/80 p-4 shadow-sm">
                  <div className={`inline-flex rounded-2xl p-2.5 ${card.color}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <p className="mt-3 text-sm font-semibold text-foreground">{card.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{card.description}</p>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <BottomNavBar />
    </div>
  );
}
