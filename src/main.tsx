// Environment polyfill MUST be imported first to patch missing env vars
import './lib/envPolyfill';

import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import App from "./App";
import { AuthProvider } from "./hooks/useAuth";
import { I18nProvider } from "./lib/i18n";
import { FemaleThemeProvider } from "./hooks/useFemaleTheme";
import ErrorBoundary from "./components/ErrorBoundary";
import { initNativePlatform } from "./lib/nativeBridge";
import "./index.css";

const SENTRY_DSN = "https://fae54652b1b4535904d5ca4d198008f7@o4511199932645376.ingest.de.sentry.io/4511200277692496";

// ── Early error buffer ────────────────────────────────────────────────
// Telemetry SDKs are initialized AFTER first paint (see initTelemetry).
// Anything thrown before that is buffered here and replayed into Sentry
// once it is ready, so deferring init never loses a crash.
const earlyErrors: unknown[] = [];
let telemetryReady = false;
let reportTelemetryError: ((error: unknown) => void) | null = null;

function captureError(err: unknown) {
  if (telemetryReady && reportTelemetryError) reportTelemetryError(err);
  else if (earlyErrors.length < 20) earlyErrors.push(err);
}

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
    sendDefaultPii: true,
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: 0.3,
    replaysOnErrorSampleRate: 1.0,
    replaysSessionSampleRate: 0.1,
    // Ignore noisy non-actionable errors
    ignoreErrors: [
      'ResizeObserver loop',
      'Non-Error promise rejection',
      'Loading chunk',
      'Failed to fetch',
      'NetworkError',
      'AbortError',
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

  reportTelemetryError = (error) => Sentry.captureException(error);
  telemetryReady = true;
  earlyErrors.splice(0).forEach((err) => Sentry.captureException(err));

  // Session replay is the heaviest integration (DOM mutation observers +
  // snapshotting) — load it separately, and only in production.
  if (import.meta.env.PROD) {
    Sentry.lazyLoadIntegration('replayIntegration')
      .then((replayIntegration) => {
        Sentry.getClient()?.addIntegration(
          (replayIntegration as typeof Sentry.replayIntegration)({
            maskAllText: false,
            blockAllMedia: false,
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
              <App />
            </AuthProvider>
          </FemaleThemeProvider>
        </I18nProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </QueryClientProvider>
);

scheduleTelemetry();
