import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { sentryVitePlugin } from "@sentry/vite-plugin";

const requiredEnv = (env: Record<string, string>, key: string) => {
  const value = env[key];
  if (!value) {
    throw new Error(`${key} is required for Vite builds`);
  }
  return value;
};

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
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(
      requiredEnv(env, 'VITE_SUPABASE_URL')
    ),
    'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify(
      requiredEnv(env, 'VITE_SUPABASE_PUBLISHABLE_KEY')
    ),
    // Mapbox uses a public browser token. Keep it in env so builds never carry stale keys.
    'import.meta.env.VITE_MAPBOX_ACCESS_TOKEN': JSON.stringify(
      env.VITE_MAPBOX_ACCESS_TOKEN || ''
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


