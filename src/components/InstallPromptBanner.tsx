import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { X, Download, Share, Plus } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface InstallPromptBannerProps {
  forceShow?: boolean;
}

export default function InstallPromptBanner({ forceShow = false }: InstallPromptBannerProps) {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || 
      ((window.navigator as unknown as Record<string, unknown>).standalone === true);
    
    if (isStandalone) {
      setIsInstalled(true);
      return;
    }

    if (forceShow) {
      localStorage.removeItem('pickme_install_modal_last');
    }

    const lastShown = Number(localStorage.getItem('pickme_install_modal_last') || 0);
    const threeDays = 3 * 24 * 60 * 60 * 1000;
    if (!forceShow && Date.now() - lastShown < threeDays) {
      return;
    }

    const isIOSDevice = /iphone|ipad|ipod/i.test(navigator.userAgent);
    setIsIOS(isIOSDevice);

    const showTimer = setTimeout(() => {
      localStorage.setItem('pickme_install_modal_last', String(Date.now()));
      setShowModal(true);
    }, 3500);

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setShowModal(false);
      setDeferredPrompt(null);
    };
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      clearTimeout(showTimer);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, [forceShow]);

  const handleInstall = async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      setDeferredPrompt(null);
    }
    setShowModal(false);
  };

  const handleDismiss = () => {
    setShowModal(false);
  };

  if (isInstalled || !showModal) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[99999] bg-foreground/60 flex items-center justify-center p-4">
      <div className="w-full max-w-[400px] bg-card rounded-3xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-300">
        {/* Header */}
        <div className="relative p-6 pb-4 text-center">
          <button
            onClick={handleDismiss}
            className="absolute top-4 right-4 p-2 rounded-full hover:bg-secondary transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
          
          <img 
            src="/icons/cruixe-icon-512.png" 
            alt="CruiXe" 
            className="w-24 h-24 mx-auto rounded-2xl object-contain shadow-lg mb-4"
          />
          <h2 className="text-xl font-bold text-foreground">Install CruiXe</h2>
          <p className="text-sm text-muted-foreground mt-1">Add to your home screen</p>
        </div>

        {/* Content */}
        <div className="px-6 pb-6">
          {isIOS ? (
            <div className="space-y-4">
              <p className="text-muted-foreground text-center text-sm">
                Install CruiXe for the best experience:
              </p>
              <div className="bg-secondary rounded-2xl p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                    <Share className="w-4 h-4 text-primary-foreground" />
                  </div>
                  <span className="text-foreground/80 text-sm">Tap the <strong>Share</strong> button below</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                    <Plus className="w-4 h-4 text-primary-foreground" />
                  </div>
                  <span className="text-foreground/80 text-sm">Select <strong>Add to Home Screen</strong></span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                    <span className="text-primary-foreground text-xs font-bold">✓</span>
                  </div>
                  <span className="text-foreground/80 text-sm">Tap <strong>Add</strong> to confirm</span>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground text-center text-sm">
              Get quick access to CruiXe from your home screen for the best ride-hailing experience.
            </p>
          )}
        </div>

        {/* Footer buttons */}
        <div className="flex gap-3 p-4 pt-0 border-t border-border">
          <Button
            variant="ghost"
            onClick={handleDismiss}
            className="flex-1 h-12 rounded-xl text-muted-foreground"
          >
            Maybe later
          </Button>
          <Button
            onClick={handleInstall}
            className="flex-1 h-12 rounded-xl gap-2 bg-primary hover:bg-primary/90"
          >
            {isIOS ? (
              'Got it!'
            ) : (
              <>
                <Download className="w-4 h-4" />
                Install
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
