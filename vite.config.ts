import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { sentryVitePlugin } from "@sentry/vite-plugin";

// Fallback values for Supabase (PUBLIC anon key — safe to embed in client bundle).
// NOTE: Never add fallbacks for private secrets here (Google Maps key, Twilio,
// Agora cert, Sentry auth token, etc.). Anything defined here is inlined into
// the browser bundle and visible to every visitor.
const FALLBACK_SUPABASE_URL = 'https://jidfganntquilvsytslp.supabase.co';
const FALLBACK_SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImppZGZnYW5udHF1aWx2c3l0c2xwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkzNDM5MDIsImV4cCI6MjA4NDkxOTkwMn0.clwzOYffNy78E9kN2UnXVSHlWfTm3cMbZu3WtwCT3UM';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return ({
  server: {
    host: "::",
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
    },
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    mode === "production" && sentryVitePlugin({
      org: "pickme-5v",
      project: "pick-me",
      authToken: env.SENTRY_AUTH_TOKEN,
      release: { name: env.VITE_APP_VERSION || undefined },
      sourcemaps: { assets: "./dist/**" },
      telemetry: false,
    }),
  ].filter(Boolean),
  define: {
    // Ensure these env vars are ALWAYS defined with fallbacks
    // This prevents the Supabase client from crashing during preview
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(
      env.VITE_SUPABASE_URL || FALLBACK_SUPABASE_URL
    ),
    'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify(
      env.VITE_SUPABASE_PUBLISHABLE_KEY || FALLBACK_SUPABASE_KEY
    ),
    // Google Maps key MUST come from env (with HTTP-referrer restrictions).
    // Do NOT inline a fallback — that would leak the key into every public bundle.
    'import.meta.env.VITE_GOOGLE_MAPS_API_KEY': JSON.stringify(
      env.VITE_GOOGLE_MAPS_API_KEY || ''
    ),
  },
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
