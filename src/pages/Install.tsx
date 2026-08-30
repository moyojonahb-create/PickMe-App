import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Download, Share, Plus, Check, Smartphone, Zap, MapPin, Shield } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export default function Install() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isAndroid, setIsAndroid] = useState(false);

  useEffect(() => {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
      ((window.navigator as unknown as Record<string, unknown>).standalone === true);
    if (isStandalone) setIsInstalled(true);

    setIsIOS(/iphone|ipad|ipod/i.test(navigator.userAgent));
    setIsAndroid(/android/i.test(navigator.userAgent));

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const installedHandler = () => setIsInstalled(true);
    window.addEventListener('beforeinstallprompt', handler);
    window.addEventListener('appinstalled', installedHandler);
    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener('appinstalled', installedHandler);
    };
  }, []);

  const handleInstall = async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      setDeferredPrompt(null);
    }
  };

  const features = [
    { icon: Zap, title: 'Lightning Fast', desc: 'Instant loading, works offline' },
    { icon: MapPin, title: 'Live Tracking', desc: 'Real-time ride tracking on map' },
    { icon: Shield, title: 'Safe & Secure', desc: 'Trip sharing & emergency features' },
    { icon: Smartphone, title: 'Native Feel', desc: 'Full-screen app experience' },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-primary/10 flex flex-col">
      {/* Hero */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 text-center">
        <img src="/icons/cruixe-icon-512.png" alt="CruiXe" className="w-36 h-36 rounded-3xl shadow-2xl mb-6 object-contain" />
        <h1 className="text-3xl font-extrabold text-foreground mb-2">Get CruiXe App</h1>
        <p className="text-muted-foreground text-lg mb-8 max-w-sm">
          Zimbabwe's #1 ride-hailing app. Install it now for the best experience.
        </p>

        {isInstalled ? (
          <div className="bg-accent/30 border border-accent rounded-2xl p-6 max-w-sm w-full">
            <Check className="w-12 h-12 text-primary mx-auto mb-3" />
            <h2 className="text-lg font-bold text-foreground">Already Installed!</h2>
            <p className="text-muted-foreground text-sm mt-1">CruiXe is on your home screen. Open it from there for the best experience.</p>
            <Button className="mt-4 w-full" onClick={() => window.location.href = '/ride'}>
              Open App
            </Button>
          </div>
        ) : isIOS ? (
          <div className="bg-card border border-border rounded-2xl p-6 max-w-sm w-full shadow-lg">
            <h2 className="text-lg font-bold text-foreground mb-4">Install on iPhone</h2>
            <div className="space-y-4 text-left">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                  <Share className="w-5 h-5 text-primary-foreground" />
                </div>
                <div>
                  <p className="font-semibold text-foreground text-sm">Step 1</p>
                  <p className="text-muted-foreground text-sm">Tap the <strong>Share</strong> button in Safari</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                  <Plus className="w-5 h-5 text-primary-foreground" />
                </div>
                <div>
                  <p className="font-semibold text-foreground text-sm">Step 2</p>
                  <p className="text-muted-foreground text-sm">Select <strong>Add to Home Screen</strong></p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                  <Check className="w-5 h-5 text-primary-foreground" />
                </div>
                <div>
                  <p className="font-semibold text-foreground text-sm">Step 3</p>
                  <p className="text-muted-foreground text-sm">Tap <strong>Add</strong> to confirm</p>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="max-w-sm w-full space-y-4">
            <Button
              onClick={handleInstall}
              size="lg"
              className="w-full h-14 text-lg rounded-2xl gap-3 shadow-lg"
              disabled={!deferredPrompt && !isAndroid}
            >
              <Download className="w-6 h-6" />
              Install CruiXe App
            </Button>
            {!deferredPrompt && (
              <p className="text-muted-foreground text-xs text-center">
                If the button is disabled, use your browser menu → "Add to Home Screen" or "Install App"
              </p>
            )}
          </div>
        )}

        {/* Features */}
        <div className="grid grid-cols-2 gap-3 mt-10 max-w-sm w-full">
          {features.map((f) => (
            <div key={f.title} className="bg-card border border-border rounded-xl p-4 text-center">
              <f.icon className="w-6 h-6 text-primary mx-auto mb-2" />
              <p className="font-semibold text-foreground text-xs">{f.title}</p>
              <p className="text-muted-foreground text-[11px]">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="text-center py-6 px-4">
        <p className="text-muted-foreground text-xs">
          © {new Date().getFullYear()} CruiXe Technologies • Your ride, your way.
        </p>
      </div>
    </div>
  );
}
