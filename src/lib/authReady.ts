// Resolves once the Supabase client has produced its first real session
// result (from onAuthStateChange or getSession() — not useAuth's 800ms UI
// safety timeout). Go API calls that fire the instant `user` appears can
// otherwise race ahead of session hydration and get sent with a token that
// hasn't finished settling, coming back 401 even though the user is signed
// in. Any authenticated fetch must await this before reading the session.
let resolveReady: () => void;
export const authReady: Promise<void> = new Promise((resolve) => {
  resolveReady = resolve;
});

let settled = false;
export function markAuthReady() {
  if (settled) return;
  settled = true;
  resolveReady();
}

// Fallback only — if the Supabase auth listener never fires (broken client,
// dropped storage event), don't leave every Go API call hung forever.
setTimeout(markAuthReady, 10_000);
