/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string;
  readonly VITE_MAPBOX_ACCESS_TOKEN?: string;
  readonly VITE_GO_BACKEND_URL?: string;
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_BACKEND_URL?: string;
  readonly VITE_API_URL?: string;
  readonly VITE_WS_URL?: string;
  readonly VITE_APP_VERSION?: string;
  readonly VITE_DD_RUM_ENABLED?: string;
  readonly VITE_DD_RUM_APPLICATION_ID?: string;
  readonly VITE_DD_RUM_CLIENT_TOKEN?: string;
  readonly VITE_DD_RUM_SITE?: string;
  readonly VITE_DD_RUM_SERVICE?: string;
  readonly VITE_DD_RUM_ENV?: string;
  readonly VITE_DD_RUM_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
