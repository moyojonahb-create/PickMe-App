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
  // Only inject values that actually exist. Defining them unconditionally
  // stomped Vite's own env replacement with "" and crashed the published app
  // with "supabaseUrl is required".
  define: Object.fromEntries(
    (['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'VITE_MAPBOX_ACCESS_TOKEN'] as const)
      .map((key) => [key, publicEnv(env, key)] as const)
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


