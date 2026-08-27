import { useAuth } from '@/hooks/useAuth';
import { useDriverApplication } from '@/hooks/useDriverApplication';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import DriverRegistrationWizard from '@/components/driver/DriverRegistrationWizard';
import DocumentUpload from '@/components/driver/DocumentUpload';
import ApplicationStatus from '@/components/driver/ApplicationStatus';
import { Loader2, ArrowLeft } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import AuthModalWrapper from '@/components/auth/AuthModalWrapper';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Car } from 'lucide-react';

const DriverApplication = () => {
  const { user, loading: authLoading } = useAuth();
  const { driverProfile, documentsStatus, isLoading, refetchDriver, hasApplied } = useDriverApplication();
  const navigate = useNavigate();
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('signup');

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-background">
        <Header 
          onLoginClick={() => { setAuthMode('login'); setAuthModalOpen(true); }}
          onSignupClick={() => { setAuthMode('signup'); setAuthModalOpen(true); }}
          onFavoritesClick={() => {}}
          onHistoryClick={() => {}}
        />
        <main className="container mx-auto px-4 py-12">
          <Card className="max-w-md mx-auto">
            <CardHeader className="text-center">
              <div className="mx-auto p-3 rounded-full bg-accent/10 w-fit mb-4">
                <Car className="h-8 w-8 text-accent" />
              </div>
              <CardTitle>Become a CruiXe Driver</CardTitle>
              <CardDescription>Sign in or create an account to start your driver application</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button className="w-full" onClick={() => { setAuthMode('signup'); setAuthModalOpen(true); }}>Create Account</Button>
              <Button variant="outline" className="w-full" onClick={() => { setAuthMode('login'); setAuthModalOpen(true); }}>Sign In</Button>
            </CardContent>
          </Card>
        </main>
        <Footer />
        <AuthModalWrapper isOpen={authModalOpen} onClose={() => setAuthModalOpen(false)} mode={authMode} onSwitchMode={() => setAuthMode(authMode === 'login' ? 'signup' : 'login')} />
      </div>
    );
  }

  // Already applied — show status + documents
  if (hasApplied && driverProfile) {
    return (
      <div className="min-h-screen bg-background">
        <Header onLoginClick={() => {}} onSignupClick={() => {}} onFavoritesClick={() => {}} onHistoryClick={() => {}} />
        <main className="container mx-auto px-4 py-8">
          <div className="max-w-2xl mx-auto">
            <Link to="/" className="inline-flex items-center text-muted-foreground hover:text-foreground mb-6">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Home
            </Link>
            <div className="mb-8">
              <h1 className="text-3xl font-bold">Driver Application</h1>
              <p className="text-muted-foreground mt-2">Track your application status and manage documents</p>
            </div>
            <div className="space-y-6">
              <ApplicationStatus
                status={driverProfile.status}
                vehicleInfo={{ make: driverProfile.vehicle_make, model: driverProfile.vehicle_model, year: driverProfile.vehicle_year, plateNumber: driverProfile.plate_number, type: driverProfile.vehicle_type }}
                documentsStatus={documentsStatus}
              />
              <DocumentUpload driverId={driverProfile.id} />
            </div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  // New application — multi-step wizard
  return (
    <DriverRegistrationWizard onSuccess={refetchDriver} onClose={() => navigate('/')} />
  );
};

export default DriverApplication;
