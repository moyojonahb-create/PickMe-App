import { useEffect, lazy, Suspense } from "react";
import { BrowserRouter, HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import AuthGuard from "./components/AuthGuard";
import AdminGuard from "./components/admin/AdminGuard";
import ErrorBoundary from "./components/ErrorBoundary";
import AdminEmergencyAlerts from "./components/admin/AdminEmergencyAlerts";
import RidePaymentNotifier from "./components/notifications/RidePaymentNotifier";
import AppHeader from "./components/AppHeader";
import RouteErrorBoundary from "./components/RouteErrorBoundary";
import { prefetchPages } from "./lib/prefetchPages";
import { recordPrefetched, warmFromCache } from "./lib/persistentPrefetch";
import { supabase } from "./integrations/supabase/client";

// Warm chunk cache from previous session BEFORE React mounts —
// keeps /ride, /wallet, /profile navigation instant after refresh.
warmFromCache();

// ─── Only the landing page is eagerly loaded ───
import Index from "./pages/Index";
// ─── Everything else is lazy — prefetched in idle time ───
const Auth = lazy(() => import("./pages/Auth"));
const Signup = lazy(() => import("./pages/Signup"));
const Ride = lazy(() => import("./pages/Ride").then((m) => { recordPrefetched("/ride"); return m; }));
const RideDetail = lazy(() => import("./pages/RideDetail"));
const DriverDashboard = lazy(() => import("./pages/DriverDashboard"));
const RiderRideDetail = lazy(() => import("./pages/RiderRideDetail"));
const AppDashboard = lazy(() => import("./pages/AppDashboard"));

// ─── Secondary screens ───
const RideHistory = lazy(() => import("./pages/RideHistory"));
const RiderProfile = lazy(() => import("./pages/RiderProfile").then((m) => { recordPrefetched("/profile"); return m; }));
const EditProfile = lazy(() => import("./pages/EditProfile"));
const RiderWalletPage = lazy(() => import("./pages/RiderWalletPage").then((m) => { recordPrefetched("/wallet"); return m; }));
const SafetyPage = lazy(() => import("./pages/SafetyPage"));
const TermsOfService = lazy(() => import("./pages/TermsOfService"));
const PrivacyPolicy = lazy(() => import("./pages/PrivacyPolicy"));
const Offline = lazy(() => import("./pages/Offline"));
const Install = lazy(() => import("./pages/Install"));
const DeleteAccount = lazy(() => import("./pages/DeleteAccount"));
const DriverApplication = lazy(() => import("./pages/DriverApplication"));
const DriverDepositPage = lazy(() => import("./pages/DriverDepositPage"));
const DriverLeaderboard = lazy(() => import("./pages/DriverLeaderboard"));
const DriverModeLanding = lazy(() => import("./pages/DriverModeLanding"));
const DriverRegistrationPage = lazy(() => import("./pages/DriverRegistrationPage"));
const DriverWalletPage = lazy(() => import("./pages/DriverWalletPage"));
const AdminDashboard = lazy(() => import("./pages/admin/AdminDashboard"));
const AdminDrivers = lazy(() => import("./pages/admin/AdminDrivers"));
const AdminDriverDetail = lazy(() => import("./pages/admin/AdminDriverDetail"));
const AdminDriversMap = lazy(() => import("./pages/admin/AdminDriversMap"));
const AdminLandmarks = lazy(() => import("./pages/admin/AdminLandmarks"));
const AdminLedger = lazy(() => import("./pages/admin/AdminLedger"));
const AdminPromos = lazy(() => import("./pages/admin/AdminPromos"));
const AdminRatePage = lazy(() => import("./pages/admin/AdminRatePage"));
const AdminReports = lazy(() => import("./pages/admin/AdminReports"));
const AdminTrips = lazy(() => import("./pages/admin/AdminTrips"));
const AdminDepositsPage = lazy(() => import("./pages/admin/AdminDepositsPage"));
const AdminRiderDepositsPage = lazy(() => import("./pages/admin/AdminRiderDepositsPage"));
const AdminSettings = lazy(() => import("./pages/admin/AdminSettings"));
const AdminTownPricing = lazy(() => import("./pages/admin/AdminTownPricing"));
const ImportOsmPlaces = lazy(() => import("./pages/admin/ImportOsmPlaces"));
const AdminDisputes = lazy(() => import("./pages/admin/AdminDisputes"));
const AdminSystemHealth = lazy(() => import("./pages/admin/AdminSystemHealth"));
const AdminStudents = lazy(() => import("./pages/admin/AdminStudents"));
const AdminWithdrawalsPage = lazy(() => import("./pages/admin/AdminWithdrawalsPage"));
const AdminWalletDashboard = lazy(() => import("./pages/admin/AdminWalletDashboard"));
const AdminRlsViewer = lazy(() => import("./pages/admin/AdminRlsViewer"));
const StudentVerificationPage = lazy(() => import("./pages/StudentVerificationPage"));
const NotFound = lazy(() => import("./pages/NotFound"));
const DriverRequestsScreen = lazy(() => import("./pages/negotiate/DriverRequestsScreen"));
const RiderOffersScreen = lazy(() => import("./pages/negotiate/RiderOffersScreen"));
const RiderRequestScreen = lazy(() => import("./pages/negotiate/RiderRequestScreen"));
const LiveTrackingPage = lazy(() => import("./pages/LiveTrackingPage"));

import PageSkeleton from "./components/PageSkeleton";

function SuspenseWrap({
  children,
  variant = "generic",
}: {
  children: React.ReactNode;
  variant?: "ride" | "wallet" | "profile" | "admin" | "generic";
}) {
  // Skeleton-first: never show a blank page or a centred spinner.
  return <Suspense fallback={<PageSkeleton variant={variant} />}>{children}</Suspense>;
}

// (prefetch is provided by ./lib/prefetchPages — it picks only the bundles
//  the current user can actually reach.)

const ADMIN_EMAIL = "moyojonahb@gmail.com";

/** Tiny wrapper: shared white header above a Suspense'd page. */
function MarketingShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AppHeader />
      <SuspenseWrap>{children}</SuspenseWrap>
    </>
  );
}

export default function App() {
  const Router = Capacitor.isNativePlatform() ? HashRouter : BrowserRouter;
  // (no need to keep ctx in state — prefetch is fire-and-forget)

  // Resolve auth/role context once, then kick off staggered idle-time prefetch.
  // Anonymous landing visitors only get public + auth bundles — no driver/admin code.
  useEffect(() => {
    (window as any).__dismissSplash?.();
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled) return;
      const user = session?.user ?? null;
      const isAdmin = user?.email?.toLowerCase() === ADMIN_EMAIL;
      let isDriver = false;
      if (user && !isAdmin) {
        const { data: drv } = await supabase
          .from("drivers").select("id").eq("user_id", user.id).maybeSingle();
        isDriver = !!drv;
      }
      const ctx = { isAuthenticated: !!user, isDriver, isAdmin };
      // ctx is fire-and-forget — pass directly to prefetch
      prefetchPages(ctx);
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <Router>
      <AdminEmergencyAlerts />
      <RidePaymentNotifier />


      <ErrorBoundary>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/home" element={<Index />} />
          <Route path="/auth" element={<MarketingShell><Auth /></MarketingShell>} />
          <Route path="/login" element={<Navigate to="/auth" replace />} />
          <Route path="/signup" element={<MarketingShell><Signup /></MarketingShell>} />

          {/* Legacy / mapp compatibility redirects */}
          <Route path="/mapp" element={<Navigate to="/ride" replace />} />
          <Route path="/mapp/login" element={<Navigate to="/auth" replace />} />
          <Route path="/mapp/ride" element={<Navigate to="/ride" replace />} />
          <Route path="/mapp/history" element={<Navigate to="/history" replace />} />
          <Route path="/mapp/ride-history" element={<Navigate to="/history" replace />} />
          <Route path="/mapp/wallet" element={<Navigate to="/wallet" replace />} />
          <Route path="/mapp/profile" element={<Navigate to="/profile" replace />} />
          <Route path="/mapp/edit-profile" element={<Navigate to="/edit-profile" replace />} />
          <Route path="/mapp/driver" element={<Navigate to="/driver" replace />} />
          <Route path="/mapp/admin" element={<Navigate to="/admin" replace />} />
          <Route path="/mapp/safety" element={<Navigate to="/safety" replace />} />
          <Route path="/mapp/*" element={<Navigate to="/ride" replace />} />

          <Route path="/ride" element={<SuspenseWrap variant="ride"><AuthGuard><Ride /></AuthGuard></SuspenseWrap>} />
          <Route path="/ride/:rideId" element={<SuspenseWrap><AuthGuard><RideDetail /></AuthGuard></SuspenseWrap>} />
          <Route path="/rider/ride/:rideId" element={<SuspenseWrap><AuthGuard><RiderRideDetail /></AuthGuard></SuspenseWrap>} />
          <Route path="/history" element={<SuspenseWrap><AuthGuard><RideHistory /></AuthGuard></SuspenseWrap>} />
          <Route path="/ride-history" element={<Navigate to="/history" replace />} />
          <Route path="/profile" element={<SuspenseWrap variant="profile"><AuthGuard><RiderProfile /></AuthGuard></SuspenseWrap>} />
          <Route path="/edit-profile" element={<SuspenseWrap><AuthGuard><EditProfile /></AuthGuard></SuspenseWrap>} />
          <Route path="/wallet" element={<SuspenseWrap variant="wallet"><AuthGuard><RiderWalletPage /></AuthGuard></SuspenseWrap>} />

          <Route path="/driver" element={<SuspenseWrap><DriverModeLanding /></SuspenseWrap>} />
          <Route path="/driver-mode" element={<Navigate to="/driver" replace />} />
          <Route path="/driver/register" element={<SuspenseWrap><AuthGuard><DriverRegistrationPage /></AuthGuard></SuspenseWrap>} />
          <Route path="/driver/application" element={<SuspenseWrap><DriverApplication /></SuspenseWrap>} />
          <Route path="/driver/dashboard" element={<SuspenseWrap variant="ride"><AuthGuard><DriverDashboard /></AuthGuard></SuspenseWrap>} />
          <Route path="/driver/deposit" element={<SuspenseWrap><AuthGuard><DriverDepositPage /></AuthGuard></SuspenseWrap>} />
          <Route path="/driver/leaderboard" element={<SuspenseWrap><AuthGuard><DriverLeaderboard /></AuthGuard></SuspenseWrap>} />
          <Route path="/driver/wallet" element={<SuspenseWrap variant="wallet"><AuthGuard><DriverWalletPage /></AuthGuard></SuspenseWrap>} />

          {/* Negotiation screens */}
          <Route path="/negotiate/request" element={<SuspenseWrap><AuthGuard><RiderRequestScreen /></AuthGuard></SuspenseWrap>} />
          <Route path="/negotiate/offers/:requestId" element={<SuspenseWrap><AuthGuard><RiderOffersScreen /></AuthGuard></SuspenseWrap>} />
          <Route path="/negotiate/driver-requests" element={<SuspenseWrap><AuthGuard><DriverRequestsScreen /></AuthGuard></SuspenseWrap>} />

          {/* Public live trip tracking */}
          <Route path="/track/:tripId" element={<SuspenseWrap><LiveTrackingPage /></SuspenseWrap>} />

          <Route path="/app" element={<SuspenseWrap><AuthGuard><AppDashboard /></AuthGuard></SuspenseWrap>} />

          <Route path="/safety" element={<MarketingShell><SafetyPage /></MarketingShell>} />
          <Route path="/terms" element={<MarketingShell><TermsOfService /></MarketingShell>} />
          <Route path="/privacy" element={<MarketingShell><PrivacyPolicy /></MarketingShell>} />
          <Route path="/offline" element={<MarketingShell><Offline /></MarketingShell>} />
          <Route path="/install" element={<MarketingShell><Install /></MarketingShell>} />
          <Route path="/delete-account" element={<MarketingShell><DeleteAccount /></MarketingShell>} />

          <Route path="/admin" element={<SuspenseWrap variant="admin"><AdminGuard><AdminDashboard /></AdminGuard></SuspenseWrap>} />
          <Route path="/admin/drivers" element={<SuspenseWrap variant="admin"><AdminGuard><AdminDrivers /></AdminGuard></SuspenseWrap>} />
          <Route path="/admin/drivers/:driverId" element={<SuspenseWrap variant="admin"><AdminGuard><AdminDriverDetail /></AdminGuard></SuspenseWrap>} />
          <Route path="/admin/drivers-map" element={<SuspenseWrap variant="admin"><AdminGuard><AdminDriversMap /></AdminGuard></SuspenseWrap>} />
          <Route path="/admin/landmarks" element={<SuspenseWrap variant="admin"><AdminGuard><AdminLandmarks /></AdminGuard></SuspenseWrap>} />
          <Route path="/admin/ledger" element={<SuspenseWrap variant="admin"><AdminGuard><AdminLedger /></AdminGuard></SuspenseWrap>} />
          <Route path="/admin/promos" element={<SuspenseWrap variant="admin"><AdminGuard><AdminPromos /></AdminGuard></SuspenseWrap>} />
          <Route path="/admin/rates" element={<SuspenseWrap variant="admin"><AdminGuard><AdminRatePage /></AdminGuard></SuspenseWrap>} />
          <Route path="/admin/reports" element={<SuspenseWrap variant="admin"><AdminGuard><AdminReports /></AdminGuard></SuspenseWrap>} />
          <Route path="/admin/trips" element={<SuspenseWrap variant="admin"><AdminGuard><AdminTrips /></AdminGuard></SuspenseWrap>} />
          <Route path="/admin/deposits" element={<SuspenseWrap variant="admin"><AdminGuard><AdminDepositsPage /></AdminGuard></SuspenseWrap>} />
          <Route path="/admin/rider-deposits" element={<SuspenseWrap variant="admin"><AdminGuard><AdminRiderDepositsPage /></AdminGuard></SuspenseWrap>} />
          <Route path="/admin/settings" element={<SuspenseWrap variant="admin"><AdminGuard><AdminSettings /></AdminGuard></SuspenseWrap>} />
          <Route path="/admin/town-pricing" element={<SuspenseWrap variant="admin"><AdminGuard><AdminTownPricing /></AdminGuard></SuspenseWrap>} />
          <Route path="/admin/import-places" element={<SuspenseWrap variant="admin"><AdminGuard><ImportOsmPlaces /></AdminGuard></SuspenseWrap>} />
          <Route path="/admin/disputes" element={<SuspenseWrap variant="admin"><AdminGuard><AdminDisputes /></AdminGuard></SuspenseWrap>} />
          <Route path="/admin/system-health" element={<SuspenseWrap variant="admin"><AdminGuard><AdminSystemHealth /></AdminGuard></SuspenseWrap>} />
          <Route path="/admin/students" element={<SuspenseWrap variant="admin"><AdminGuard><AdminStudents /></AdminGuard></SuspenseWrap>} />
          <Route path="/admin/withdrawals" element={<SuspenseWrap variant="admin"><AdminGuard><AdminWithdrawalsPage /></AdminGuard></SuspenseWrap>} />
          <Route path="/admin/wallet" element={<SuspenseWrap variant="admin"><AdminGuard><AdminWalletDashboard /></AdminGuard></SuspenseWrap>} />
          <Route path="/admin/rls" element={<SuspenseWrap variant="admin"><AdminGuard><AdminRlsViewer /></AdminGuard></SuspenseWrap>} />
          <Route path="/student-verification" element={<SuspenseWrap><AuthGuard><StudentVerificationPage /></AuthGuard></SuspenseWrap>} />

          <Route path="*" element={<MarketingShell><NotFound /></MarketingShell>} />
        </Routes>
      </ErrorBoundary>
    </Router>
  );
}
