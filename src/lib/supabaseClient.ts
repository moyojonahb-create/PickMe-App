// Re-export from the auto-generated Supabase client to avoid duplicate instances
export { supabase } from '@/integrations/supabase/client';

// Export URL and key for edge function calls etc.
// Do NOT keep secrets or production keys in source. Read from env and fail-safe to null.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || null;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || null;

// Fail gracefully (not a hard boot crash) if env vars are missing. Throwing here
// at module-load time would white-screen the entire app before React can mount.
// Instead we log a clear error and let the app boot; downstream Supabase calls
// will surface their own errors in-context. The underlying client in
// '@/integrations/supabase/client' handles actual client construction.
if (!SUPABASE_URL) {
  console.error('Missing required environment variable: VITE_SUPABASE_URL');
}
if (!SUPABASE_PUBLISHABLE_KEY) {
  console.error('Missing required environment variable: VITE_SUPABASE_PUBLISHABLE_KEY');
}

export { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY };
