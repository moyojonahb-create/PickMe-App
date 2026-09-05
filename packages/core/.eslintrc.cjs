/**
 * The one rule that actually keeps this package portable.
 *
 * Everything in packages/core has to run unchanged on React Native (Hermes),
 * where these globals do not exist. Each of the banned globals below is one
 * that is currently used somewhere in the web app's copy of this logic and
 * would throw at runtime on device:
 *
 *   - location.protocol/host  → src/lib/backendSocketClient.ts (WS_URL)
 *   - document.body           → src/integrations/supabase/client.ts (error path)
 *   - localStorage/window     → src/integrations/supabase/previewAuthStorage.ts
 *
 * import.meta.env is the other half of the problem and can't be caught by this
 * rule — it is handled structurally instead, by requiring config to be passed
 * in (see src/config.ts).
 */
module.exports = {
  root: true,
  rules: {
    'no-restricted-globals': [
      'error',
      { name: 'document', message: 'DOM global — not available in React Native. Inject a platform adapter instead.' },
      { name: 'window', message: 'DOM global — not available in React Native. Inject a platform adapter instead.' },
      { name: 'location', message: 'DOM global — not available in React Native. Pass URLs in via CoreConfig.' },
      { name: 'localStorage', message: 'DOM global — not available in React Native. Inject a StorageAdapter instead.' },
      { name: 'sessionStorage', message: 'DOM global — not available in React Native. Inject a StorageAdapter instead.' },
      { name: 'navigator', message: 'DOM global — React Native provides only a partial shim. Inject what you need.' },
    ],
  },
};
