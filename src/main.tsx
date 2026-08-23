// Environment polyfill MUST be imported first to patch missing env vars
import './lib/envPolyfill';

import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import App from "./App";
import { AuthProvider } from "./hooks/useAuth";
import { AppBootstrapProvider } from "./hooks/useAppBootstrap";
import { I18nProvider } from "./lib/i18n";
import { FemaleThemeProvider } from "./hooks/useFemaleTheme";
import ErrorBoundary from "./components/ErrorBoundary";
import { initNativePlatform } from "./lib/nativeBridge";
import { captureError, markTelemetryReady } from "./lib/telemetryBuffer";
import "./index.css";

const SENTRY_DSN = "https://fae54652b1b4535904d5ca4d198008f7@o4511199932645376.ingest.de.sentry.io/4511200277692496";

window.addEventListener('unhandledrejection', (event) => {
  captureError(event.reason);
  console.error('[PickMe] Unhandled promise rejection:', event.reason);
});

window.addEventListener('error', (event) => {
  captureError(event.error || event.message);
  console.error('[PickMe] Global runtime error:', event.error || event.message);
});

// Initialize native Capacitor plugins (no-ops on web)
initNativePlatform();

/**
 * All third-party monitoring runs off the critical path.
 *
 * Sentry (incl. session replay), Datadog RUM and the runtime breadcrumb
 * patches used to run synchronously before `createRoot().render()`, adding
 * SDK parse/exec plus ingest requests to every single page load. They are
 * now scheduled in idle time after the first paint.
 */
async function initTelemetry() {
  const Sentry = await import("@sentry/react");
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: import.meta.env.MODE,
    enabled: import.meta.env.PROD,
    release: import.meta.env.VITE_APP_VERSION,
    // Was `true` — this app records wallet PINs (WalletPinModal), driver
    // licence/ID uploads, phone numbers and home addresses. Sending default
    // PII (IP, cookies) alongside session replay is how that ends up
    // readable in a third-party dashboard. Off unless a specific, deliberate
    // need for it shows up.
    sendDefaultPii: false,
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: 0.3,
    replaysOnErrorSampleRate: 1.0,
    replaysSessionSampleRate: 0.1,
    // 'Failed to fetch' / 'NetworkError' / 'AbortError' / 'Loading chunk'
    // used to be filtered out here — on Econet/NetOne those aren't noise,
    // they're the production failures this market actually needs visibility
    // into. Only the two below are genuine non-actionable browser quirks.
    ignoreErrors: [
      'ResizeObserver loop',
      'Non-Error promise rejection',
    ],
    beforeSend(event) {
      // Enrich with device context
      event.tags = {
        ...event.tags,
        screen_width: `${window.screen?.width ?? 0}`,
        connection: (navigator as any).connection?.effectiveType ?? 'unknown',
        online: String(navigator.onLine),
      };
      return event;
    },
  });

  markTelemetryReady((error) => Sentry.captureException(error));

  // Session replay is the heaviest integration (DOM mutation observers +
  // snapshotting) — load it separately, and only in production.
  if (import.meta.env.PROD) {
    Sentry.lazyLoadIntegration('replayIntegration')
      .then((replayIntegration) => {
        Sentry.getClient()?.addIntegration(
          // Was `false`/`false` — every error-containing session (100% of
          // them) and 10% of all sessions were recorded with text masking
          // off, meaning wallet PINs and any typed field were captured
          // in plain text. Mask by default; unmask specific known-safe
          // elements individually if a real debugging need ever justifies it.
          (replayIntegration as typeof Sentry.replayIntegration)({
            maskAllText: true,
            blockAllMedia: true,
          }),
        );
      })
      .catch(() => {
        /* replay is best-effort — never break the app for it */
      });
  }

  // Breadcrumb capture — records clicks, navigations, console.error and 5xx
  // fetches, then attaches the trail to every Sentry event.
  import('./lib/runtimeBreadcrumbs')
    .then((m) => m.installRuntimeBreadcrumbs())
    .catch(() => {});

  // Datadog RUM (opt-in via VITE_DD_RUM_ENABLED) — dynamic import keeps the
  // SDK out of the entry chunk entirely when it is disabled.
  if (import.meta.env.VITE_DD_RUM_ENABLED === 'true') {
    import('./rum').then((m) => m.initDatadog()).catch(() => {});
  }
}

function scheduleTelemetry() {
  const ric = (window as unknown as {
    requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
  }).requestIdleCallback;
  const start = () => { void initTelemetry().catch(() => {}); };
  if (typeof ric === 'function') ric(start, { timeout: 5000 });
  else setTimeout(start, 3000);
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,      // 5 min — avoid refetching on every mount
      gcTime: 10 * 60 * 1000,         // 10 min garbage collection
      retry: 1,                        // single retry to stay fast
      refetchOnWindowFocus: false,     // don't refetch when tab regains focus
    },
  },
});

// Register PWA service workers only in production.
// In development they can cache stale assets/routes and cause the app
// to appear stuck on splash/loading screens.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    if (import.meta.env.PROD) {
      navigator.serviceWorker.register('/sw.js')
        .then((registration) => {
          console.log('[PickMe] PWA SW registered:', registration.scope);
        })
        .catch((error) => {
          console.log('[PickMe] PWA SW registration failed:', error);
        });

      // sw.js already owns tile caching. Registering a second worker at the
      // same root scope replaced the app-shell worker on some devices.
    } else {
      // Clean up previously installed service workers while in dev.
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  });
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("PickMe root element is missing");

createRoot(rootElement).render(
  <QueryClientProvider client={queryClient}>
    <ErrorBoundary>
      <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
        <I18nProvider>
          <FemaleThemeProvider>
            <AuthProvider>
              <AppBootstrapProvider>
                <App />
              </AppBootstrapProvider>
            </AuthProvider>
          </FemaleThemeProvider>
        </I18nProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </QueryClientProvider>
);

scheduleTelemetry();
