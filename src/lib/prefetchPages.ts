/**
 * Smart prefetch strategy.
 *
 * Goals:
 *  - Never block the landing page first paint (run in idle time, staggered).
 *  - Don't waste bandwidth fetching admin / driver bundles for users who
 *    can't access them (admins are gated to a single email, drivers must
 *    be approved). Anonymous visitors get only public + auth pages.
 *  - Always safe to call repeatedly — dynamic import is cached by the
 *    browser/Vite so the second call is a no-op.
 */

type Loader = () => Promise<unknown>;

// ─── Public / always-prefetch (small, used by everyone) ───
const publicPages: Loader[] = [
  () => import("@/pages/Auth"),
  () => import("@/pages/Signup"),
  () => import("@/pages/SafetyPage"),
  () => import("@/pages/TermsOfService"),
  () => import("@/pages/PrivacyPolicy"),
  () => import("@/pages/Offline"),
  () => import("@/pages/Install"),
  () => import("@/pages/NotFound"),
  () => import("@/pages/LiveTrackingPage"),
];

// ─── Authenticated rider pages ───
const riderPages: Loader[] = [
  () => import("@/pages/Ride"),
  () => import("@/pages/RiderRideDetail"),
  () => import("@/pages/AppDashboard"),
  () => import("@/pages/RideHistory"),
  () => import("@/pages/RiderProfile"),
  () => import("@/pages/EditProfile"),
  () => import("@/pages/RiderWalletPage"),
  () => import("@/pages/DeleteAccount"),
  () => import("@/pages/StudentVerificationPage"),
];

// ─── Driver pages (only for users who have applied / been approved) ───
const driverPages: Loader[] = [
  () => import("@/pages/DriverModeLanding"),
  () => import("@/pages/DriverApplication"),
  () => import("@/pages/DriverRegistrationPage"),
  () => import("@/pages/DriverDashboard"),
  () => import("@/pages/DriverDepositPage"),
  () => import("@/pages/DriverLeaderboard"),
  () => import("@/pages/DriverWalletPage"),
];

// ─── Admin pages (only for the single admin email) ───
const adminPages: Loader[] = [
  () => import("@/pages/admin/AdminDashboard"),
  () => import("@/pages/admin/AdminDrivers"),
  () => import("@/pages/admin/AdminDriverDetail"),
  () => import("@/pages/admin/AdminDriversMap"),
  () => import("@/pages/admin/AdminLandmarks"),
  () => import("@/pages/admin/AdminLedger"),
  () => import("@/pages/admin/AdminPromos"),
  () => import("@/pages/admin/AdminRatePage"),
  () => import("@/pages/admin/AdminReports"),
  () => import("@/pages/admin/AdminTrips"),
  () => import("@/pages/admin/AdminDepositsPage"),
  () => import("@/pages/admin/AdminRiderDepositsPage"),
  () => import("@/pages/admin/AdminSettings"),
  () => import("@/pages/admin/AdminTownPricing"),
  () => import("@/pages/admin/ImportOsmPlaces"),
  () => import("@/pages/admin/AdminDisputes"),
  () => import("@/pages/admin/AdminSystemHealth"),
  () => import("@/pages/admin/AdminStudents"),
  () => import("@/pages/admin/AdminWithdrawalsPage"),
  () => import("@/pages/admin/AdminWalletDashboard"),
  () => import("@/pages/admin/AdminRlsViewer"),
];

export interface PrefetchContext {
  isAuthenticated: boolean;
  isDriver: boolean;
  isAdmin: boolean;
}

export function selectPagesForUser(ctx: PrefetchContext): Loader[] {
  // Authenticated users: rider Ride/Wallet/Profile go FIRST so navigation
  // from the landing page feels instant (no chunk download wait).
  const list: Loader[] = [];
  if (ctx.isAuthenticated) {
    list.push(
      () => import("@/pages/Ride"),
      () => import("@/pages/RiderWalletPage"),
      () => import("@/pages/RiderProfile"),
    );
  }
  list.push(...publicPages);
  if (ctx.isAuthenticated) list.push(...riderPages);
  if (ctx.isDriver) list.push(...driverPages);
  if (ctx.isAdmin) list.push(...adminPages);
  // de-dupe loaders by reference (the high-priority ones above are also in riderPages)
  return Array.from(new Set(list));
}

// Use the lib.dom IdleRequestCallback signature directly to stay compatible
// across TS lib versions (some include it as required, some as optional).
type IdleCb = (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void;

/**
 * Kick off prefetching after the landing page has painted.
 * Runs in idle time, stagger 30ms between loads — never blocks the main thread.
 */
export function prefetchPages(ctx: PrefetchContext): void {
  const pages = selectPagesForUser(ctx);

  const run = () => {
    pages.forEach((load, i) => {
      setTimeout(() => {
        load().catch(() => {
          /* network/chunk failure is non-fatal — Suspense will retry on nav */
        });
      }, i * 30);
    });
  };

  const ric = (window as unknown as { requestIdleCallback?: (cb: IdleCb, o?: { timeout: number }) => number }).requestIdleCallback;
  if (typeof ric === "function") {
    ric(run, { timeout: 2000 });
  } else {
    // Safari / old browsers — wait until after first paint
    setTimeout(run, 500);
  }
}
