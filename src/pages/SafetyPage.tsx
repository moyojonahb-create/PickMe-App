import { MessageSquare, Users, Phone, Shield, Car, AlertTriangle, Lock, ChevronRight } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import PickMeLogo from '@/components/PickMeLogo';
import BottomNavBar from '@/components/BottomNavBar';

const protectionCards = [
  { icon: Shield, title: 'Proactive safety support', desc: 'We monitor every trip in real time.' },
  { icon: Users, title: 'Verified passengers', desc: 'ID and phone verification required.' },
  { icon: Lock, title: 'Your privacy protected', desc: 'Trip data encrypted end-to-end.' },
  { icon: Car, title: 'Safe on every ride', desc: 'Rate drivers and share your trip.' },
  { icon: AlertTriangle, title: 'Accident guidance', desc: 'Step-by-step help if the worst happens.', tone: 'warn' as const },
];

export default function SafetyPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const isMapp = location.pathname.startsWith('/mapp');

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

      <div className="flex-1 px-5 pb-24 space-y-5 -mt-10">
        {/* Emergency call — hero action */}
        <a
          href="tel:995"
          className="relative flex items-center gap-4 w-full p-5 rounded-3xl text-destructive-foreground overflow-hidden active:scale-[0.98] transition-transform"
          style={{
            background: 'linear-gradient(135deg, hsl(0 84% 55%), hsl(0 78% 48%))',
            boxShadow: '0 20px 40px -12px hsl(0 84% 55% / 0.55), 0 0 0 1px hsl(0 84% 55% / 0.2)',
          }}
        >
          <div className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur flex items-center justify-center shrink-0">
            <Phone className="w-7 h-7" strokeWidth={2.4} />
          </div>
          <div className="flex-1 text-left">
            <p className="text-[11px] font-bold uppercase tracking-widest text-white/80">Emergency</p>
            <p className="text-xl font-black leading-tight">Call 995</p>
            <p className="text-xs text-white/85 mt-0.5">Zimbabwe emergency services</p>
          </div>
          <ChevronRight className="w-5 h-5 text-white/80 shrink-0" />
        </a>

        {/* Quick actions */}
        <div className="grid grid-cols-2 gap-3">
          <button className="glass-card-heavy p-5 rounded-3xl flex flex-col items-center gap-2.5 active:scale-[0.97] transition-transform">
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center"
              style={{
                background: 'linear-gradient(135deg, hsl(224 71% 37% / 0.12), hsl(225 65% 48% / 0.08))',
              }}
            >
              <MessageSquare className="w-5 h-5 text-primary" strokeWidth={2.2} />
            </div>
            <span className="text-sm font-bold text-foreground">Support</span>
            <span className="text-[11px] text-muted-foreground -mt-1">Chat with us</span>
          </button>
          <button className="glass-card-heavy p-5 rounded-3xl flex flex-col items-center gap-2.5 active:scale-[0.97] transition-transform">
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center"
              style={{
                background: 'linear-gradient(135deg, hsl(224 71% 37% / 0.12), hsl(225 65% 48% / 0.08))',
              }}
            >
              <Users className="w-5 h-5 text-primary" strokeWidth={2.2} />
            </div>
            <span className="text-sm font-bold text-foreground">Contacts</span>
            <span className="text-[11px] text-muted-foreground -mt-1">Trusted circle</span>
          </button>
        </div>

        {/* How you're protected */}
        <div>
          <div className="flex items-baseline justify-between mb-3 px-1">
            <h2 className="text-lg font-black text-foreground">How you're protected</h2>
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{protectionCards.length} tools</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {protectionCards.map((card) => {
              const isWarn = card.tone === 'warn';
              return (
                <button
                  key={card.title}
                  className="glass-card-heavy rounded-3xl p-4 flex flex-col items-start gap-3 text-left active:scale-[0.98] transition-transform min-h-[132px]"
                >
                  <div
                    className="w-10 h-10 rounded-2xl flex items-center justify-center"
                    style={
                      isWarn
                        ? {
                            background: 'linear-gradient(135deg, hsl(0 84% 60% / 0.15), hsl(0 84% 60% / 0.08))',
                          }
                        : {
                            background: 'linear-gradient(135deg, hsl(224 71% 37% / 0.14), hsl(225 65% 48% / 0.08))',
                          }
                    }
                  >
                    <card.icon
                      className={`w-5 h-5 ${isWarn ? 'text-destructive' : 'text-primary'}`}
                      strokeWidth={2.2}
                    />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-bold text-foreground leading-tight">{card.title}</p>
                    <p className="text-[11px] text-muted-foreground mt-1 leading-snug">{card.desc}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <BottomNavBar />
    </div>
  );
}
