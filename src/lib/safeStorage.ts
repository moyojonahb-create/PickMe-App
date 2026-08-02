/**
 * SafeStorage — crash-proof wrapper around window.localStorage.
 *
 * iOS WKWebView (Capacitor), Safari Private Mode and devices with a full disk
 * throw synchronously on localStorage access (SecurityError / QuotaExceededError).
 * Unguarded access at module scope or during render kills the whole React tree.
 *
 * This wrapper never throws: it falls back to an in-memory Map so the app keeps
 * working (just without persistence) in restrictive environments.
 */

const memory = new Map<string, string>();

function backend(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    const ls = window.localStorage;
    // Probe — some WebViews expose the object but throw on access.
    const probe = "__pickme_probe__";
    ls.setItem(probe, "1");
    ls.removeItem(probe);
    return ls;
  } catch {
    return null;
  }
}

let cached: Storage | null | undefined;
function store(): Storage | null {
  if (cached === undefined) cached = backend();
  return cached;
}

export const SafeStorage = {
  get(key: string): string | null {
    try {
      const s = store();
      if (s) return s.getItem(key);
    } catch {
      /* fall through to memory */
    }
    return memory.has(key) ? memory.get(key)! : null;
  },

  set(key: string, value: string): void {
    memory.set(key, value);
    try {
      store()?.setItem(key, value);
    } catch {
      /* memory copy already kept */
    }
  },

  remove(key: string): void {
    memory.delete(key);
    try {
      store()?.removeItem(key);
    } catch {
      /* ignore */
    }
  },

  /** Parse a stored JSON value without ever throwing. */
  getJSON<T>(key: string, fallback: T): T {
    const raw = SafeStorage.get(key);
    if (raw == null) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  },

  setJSON(key: string, value: unknown): void {
    try {
      SafeStorage.set(key, JSON.stringify(value));
    } catch {
      /* ignore non-serialisable values */
    }
  },
};

/** Parse arbitrary JSON input without throwing. */
export function safeJsonParse<T>(input: unknown, fallback: T): T {
  if (typeof input !== "string") return fallback;
  try {
    return JSON.parse(input) as T;
  } catch {
    return fallback;
  }
}

export default SafeStorage;
