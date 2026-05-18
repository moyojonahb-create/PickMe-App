// Environment polyfill MUST be imported first to patch missing env vars
import './lib/envPolyfill';

import * as Sentry from "@sentry/react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import App from "./App";
import { AuthProvider } from "./hooks/useAuth";
import { I18nProvider } from "./lib/i18n";
import { FemaleThemeProvider } from "./hooks/useFemaleTheme";
import ErrorBoundary from "./components/ErrorBoundary";
import { initNativePlatform } from "./lib/nativeBridge";
import { initDatadog } from './rum';
import { installRuntimeBreadcrumbs } from './lib/runtimeBreadcrumbs';
import "./index.css";

// Initialize Sentry before anything else
Sentry.init({
  dsn: "https://fae54652b1b4535904d5ca4d198008f7@o4511199932645376.ingest.de.sentry.io/4511200277692496",
  environment: import.meta.env.MODE,
  enabled: import.meta.env.PROD,
  release: import.meta.env.VITE_APP_VERSION,
  sendDefaultPii: true,
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration({ maskAllText: false, blockAllMedia: false }),
  ],
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

// Initialize native Capacitor plugins (no-ops on web)
initNativePlatform();

// Initialize telemetry as early as possible (before rendering)
initDatadog();

// Install breadcrumb capture — records clicks, navigations, console.error
// and 5xx fetches, then attaches the trail to every Sentry event so we can
// see exactly which button / route / request led to a crash.
installRuntimeBreadcrumbs();

window.addEventListener('unhandledrejection', (event) => {
  Sentry.captureException(event.reason);
  console.error('[PickMe] Unhandled promise rejection:', event.reason);
});

window.addEventListener('error', (event) => {
  Sentry.captureException(event.error || event.message);
  console.error('[PickMe] Global runtime error:', event.error || event.message);
});

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

      navigator.serviceWorker.register('/sw-tiles.js')
        .then((registration) => {
          console.log('[PickMe] Tile cache SW registered:', registration.scope);
        })
        .catch((error) => {
          console.log('[PickMe] Tile cache SW registration failed:', error);
        });
    } else {
      // Clean up previously installed service workers while in dev.
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  });
}

createRoot(document.getElementById("root")!).render(
  <Sentry.ErrorBoundary fallback={<p className="p-8 text-center text-destructive">Something went wrong. Please refresh.</p>}>
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
  </Sentry.ErrorBoundary>
);
