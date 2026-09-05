/**
 * The auth surface the API and socket clients actually need.
 *
 * Both clients currently import the Supabase singleton directly and register
 * module-level `onAuthStateChange` subscriptions as an import side effect. That
 * makes them (a) impossible to unit-test without standing up a real Supabase
 * client, and (b) bound to the web app's specific client instance — while the
 * RN app needs a different one, with an AsyncStorage adapter.
 *
 * Narrowing to this interface is what lets the same client code serve both, and
 * lets the tests the migration brief asks for first ("unit-test the ported
 * goBackendClient and backendSocketClient logic") run against a fake in-memory
 * provider with no network and no Supabase at all.
 */

export type AuthEvent = 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED';

export interface AuthTokenProvider {
  /** Current access token, or null when signed out. Must already be hydrated. */
  getToken(): Promise<string | null>;
  /** Force a refresh; returns the new token, or null if the refresh failed. */
  refreshToken(): Promise<string | null>;
  /** Subscribe to auth transitions. Returns an unsubscribe function. */
  onAuthEvent(listener: (event: AuthEvent) => void): () => void;
}

/**
 * Wraps a supabase-js client in the interface above.
 *
 * Kept generic over the client shape rather than importing SupabaseClient, so
 * `packages/core` does not force a supabase-js version on its consumers and the
 * tests can pass a hand-rolled stub.
 */
export interface SupabaseAuthLike {
  auth: {
    getSession(): Promise<{ data: { session: { access_token?: string } | null } }>;
    refreshSession(): Promise<{
      data: { session: { access_token?: string } | null };
      error: unknown;
    }>;
    onAuthStateChange(
      cb: (event: string, session: unknown) => void,
    ): { data: { subscription: { unsubscribe(): void } } };
  };
}

export function createSupabaseAuthProvider(
  client: SupabaseAuthLike,
  options: {
    /**
     * Awaited before the first token read. The web app has an `authReady`
     * promise for exactly this: reading getSession() before the client has
     * hydrated hands back a stale/absent session and sends the request into a
     * spurious 401.
     */
    authReady?: Promise<unknown>;
  } = {},
): AuthTokenProvider {
  return {
    async getToken() {
      if (options.authReady) await options.authReady;
      const { data } = await client.auth.getSession();
      return data.session?.access_token ?? null;
    },

    async refreshToken() {
      const { data, error } = await client.auth.refreshSession();
      if (error) return null;
      return data.session?.access_token ?? null;
    },

    onAuthEvent(listener) {
      const { data } = client.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED') {
          listener(event);
        }
      });
      return () => data.subscription.unsubscribe();
    },
  };
}
