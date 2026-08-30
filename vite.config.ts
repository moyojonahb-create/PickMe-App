import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { sentryVitePlugin } from "@sentry/vite-plugin";

const publicEnv = (env: Record<string, string>, key: string) => env[key] || process.env[key] || '';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return ({
  server: {
    host: "::" ,
    port: 8080,
    // Proxy to avoid CORS issues in the browser when calling Nominatim directly.
    // Frontend can call `/api/nominatim/search?...`.
    proxy: {
      '/api/nominatim': {
        target: 'https://nominatim.openstreetmap.org',
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/api\/nominatim/, ''),
      },
      // The deployed Go backend's CORS allowlist doesn't include localhost,
      // so browser calls to it fail in local dev. Proxying through Vite
      // (server-to-server, not subject to browser CORS) fixes that without
      // touching the deployed backend. goBackendClient/backendSocketClient
      // route through these paths only when import.meta.env.DEV is true.
      '/go-api': {
        target: env.VITE_GO_BACKEND_URL || 'https://koloi-ride-with-confidence-production.up.railway.app',
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/go-api/, ''),
      },
      '/go-ws': {
        target: env.VITE_GO_BACKEND_URL || 'https://koloi-ride-with-confidence-production.up.railway.app',
        changeOrigin: true,
        secure: true,
        ws: true,
        rewrite: (p) => p.replace(/^\/go-ws/, '/ws'),
      },
    },
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    mode === "production" && sentryVitePlugin({
      org: "pickme-rides",
      project: "cruixe-web",
      authToken: env.SENTRY_AUTH_TOKEN,
      release: { name: env.VITE_APP_VERSION || undefined },
      sourcemaps: { assets: "./dist/**" },
      telemetry: false,
    }),
  ].filter(Boolean),
  // Only inject values that actually exist. Defining them unconditionally
  // stomped Vite's own env replacement with "" and crashed the published app
  // with "supabaseUrl is required". The publishable key can also arrive as
  // VITE_SUPABASE_ANON_KEY in some build environments, so fall back to it.
  // Last-resort fallbacks: if the managed Cloud vars are missing at build time
  // the app used to ship blank credentials and die with "supabaseUrl is
  // required". These owner-supplied public values keep the build bootable.
  define: Object.fromEntries(
    (
      [
        ['VITE_SUPABASE_URL', ['VITE_SUPABASE_URL', 'SUPABASE_URL'], 'https://foksbnjtzubsjpeoorvo.supabase.co'],
        ['VITE_SUPABASE_PUBLISHABLE_KEY', ['VITE_SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY'], 'sb_publishable_vgKlnioVW-ZyBiPeHgmaNw_411hQVXA'],
        ['VITE_MAPBOX_ACCESS_TOKEN', ['VITE_MAPBOX_ACCESS_TOKEN', 'VITE_MAPBOX_TOKEN', 'VITE_MAPBOX_PUBLIC_TOKEN'], 'pk.eyJ1IjoidGF1dG9uYXNvbHV0aW9ucyIsImEiOiJjbWt1MGZzOW0wMGpjM2VyM29rcWU4ZXZmIn0.T-K9P68HdR7OPDB4i36tMw'],
        ['VITE_GO_BACKEND_URL', ['VITE_GO_BACKEND_URL', 'VITE_API_BASE_URL', 'VITE_BACKEND_URL'], 'https://koloi-ride-with-confidence-production.up.railway.app'],
        // Without this the published build has no VITE_WS_URL at all, so
        // backendSocketClient.connect() throws immediately and the Go
        // realtime channel is simply never attempted in production.
        ['VITE_WS_URL', ['VITE_WS_URL'], 'wss://koloi-ride-with-confidence-production.up.railway.app/ws'],

      ] as const
    )
      .map(([key, sources, fallback]) => [key, sources.map((s) => publicEnv(env, s)).find(Boolean) || fallback] as const)
      .filter(([, value]) => Boolean(value))
      .map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)])
  ),


  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    chunkSizeWarningLimit: 1000,
    target: 'es2020',
    sourcemap: true,
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-supabase': ['@supabase/supabase-js'],
          'vendor-ui': ['@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu', '@radix-ui/react-select', '@radix-ui/react-tabs', '@radix-ui/react-toast', '@radix-ui/react-popover'],
          // clsx / tailwind-merge are used by every component AND by recharts.
          // Without their own chunk they get bucketed into vendor-charts, which
          // drags the whole 380KB charting bundle into the initial page load.
          'vendor-utils': ['clsx', 'tailwind-merge', 'class-variance-authority'],
          'vendor-motion': ['framer-motion'],
          'vendor-query': ['@tanstack/react-query'],
          'vendor-maps': ['leaflet'],
          'vendor-charts': ['recharts'],
        },
      },
    },
  },
  });
});
