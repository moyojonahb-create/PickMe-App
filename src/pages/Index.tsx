import { useState, useEffect, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import Header from '@/components/Header';
import LandingHero from '@/components/LandingHero';

// Below-the-fold marketing sections and overlays load after first paint so
// the entry chunk only carries the header + hero.
const SuggestionsSection = lazy(() => import('@/components/SuggestionsSection'));
const DriveSection = lazy(() => import('@/components/DriveSection'));
const BusinessSection = lazy(() => import('@/components/BusinessSection'));
const SafetySection = lazy(() => import('@/components/SafetySection'));
const Footer = lazy(() => import('@/components/Footer'));
const AuthModalWrapper = lazy(() => import('@/components/auth/AuthModalWrapper'));
const FavoritesSheet = lazy(() => import('@/components/FavoritesSheet'));
const RideHistorySheet = lazy(() => import('@/components/RideHistorySheet'));
const InstallPromptBanner = lazy(() => import('@/components/InstallPromptBanner'));

const Index = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  // Auto-redirect logged-in users straight to rider screen
  useEffect(() => {
    if (!loading && user) {
      navigate('/ride', { replace: true });
    }
  }, [user, loading, navigate]);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const handleLoginClick = () => {
    setAuthMode('login');
    setAuthModalOpen(true);
  };

  const handleSignupClick = () => {
    setAuthMode('signup');
    setAuthModalOpen(true);
  };

  const handleSwitchMode = () => {
    setAuthMode(authMode === 'login' ? 'signup' : 'login');
  };

  const handleGetStarted = () => {
    setAuthMode('signup');
    setAuthModalOpen(true);
  };

  return (
    <>
      <Suspense fallback={null}>
        <InstallPromptBanner />
      </Suspense>
      <div className="min-h-screen bg-background">
      <Header 
        onLoginClick={handleLoginClick} 
        onSignupClick={handleSignupClick}
        onFavoritesClick={() => setFavoritesOpen(true)}
        onHistoryClick={() => setHistoryOpen(true)}
        transparent
      />
      
      <main>
        <LandingHero onGetStarted={handleGetStarted} />
        <Suspense fallback={<div className="min-h-[40vh]" />}>
          <SuggestionsSection />
          <DriveSection />
          <BusinessSection />
          <SafetySection />
        </Suspense>
      </main>

      <Suspense fallback={null}>
        <Footer />
      </Suspense>

      <Suspense fallback={null}>
        {authModalOpen && (
          <AuthModalWrapper
            isOpen={authModalOpen}
            onClose={() => setAuthModalOpen(false)}
            mode={authMode}
            onSwitchMode={handleSwitchMode}
          />
        )}

        {favoritesOpen && (
          <FavoritesSheet
            isOpen={favoritesOpen}
            onClose={() => setFavoritesOpen(false)}
          />
        )}

        {historyOpen && (
          <RideHistorySheet
            isOpen={historyOpen}
            onClose={() => setHistoryOpen(false)}
          />
        )}
      </Suspense>
    </div>
    </>
  );
};

export default Index;
