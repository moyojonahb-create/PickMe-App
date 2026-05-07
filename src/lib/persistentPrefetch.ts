/**
 * Persistent prefetch cache.
 *
 * The browser already HTTP-caches lazy chunks, but on a hard refresh the
 * module map is empty so React.lazy still has to wait for the response
 * round-trip. We accelerate this by:
 *
 *   1. Recording in localStorage which high-priority routes the user has
 *      successfully prefetched in this session.
 *   2. On the next page load (incl. after refresh), injecting
 *      <link rel="modulepreload"> hints for those routes BEFORE React
 *      mounts. The browser then has the chunks warm in its HTTP cache and
 *      Vite's module graph by the time React.lazy asks for them.
 *
 * This keeps navigation to /ride, /wallet and /profile instant even on
 * slow networks and across refreshes.
 */

const STORAGE_KEY = "pickme:prefetch:v1";
const HIGH_PRIORITY = ["/ride", "/wallet", "/profile"] as const;

interface CacheShape {
  // route -> resolved chunk URL last seen for that route
  routes: Record<string, string>;
  ts: number;
}

function read(): CacheShape {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { routes: {}, ts: 0 };
    const parsed = JSON.parse(raw) as CacheShape;
    if (!parsed?.routes) return { routes: {}, ts: 0 };
    return parsed;
  } catch {
    return { routes: {}, ts: 0 };
  }
}

function write(next: CacheShape) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* quota / privacy mode — ignore */
  }
}

/**
 * Record that a high-priority route's chunk was loaded successfully.
 * We capture the resolved URL of the most recently added <script> tag
 * (Vite's lazy import always injects one).
 */
export function recordPrefetched(route: string) {
  if (!HIGH_PRIORITY.includes(route as (typeof HIGH_PRIORITY)[number])) return;
  // Best-effort: pick the most recently added module script.
  const scripts = Array.from(document.querySelectorAll('script[type="module"][src]')) as HTMLScriptElement[];
  const last = scripts[scripts.length - 1];
  const url = last?.src;
  if (!url) return;
  const cur = read();
  if (cur.routes[route] === url) return;
  cur.routes[route] = url;
  cur.ts = Date.now();
  write(cur);
}

/**
 * Inject <link rel="modulepreload"> hints for everything we cached on a
 * previous visit. Safe to call multiple times — duplicates are guarded
 * by URL.
 */
export function warmFromCache(): void {
  if (typeof document === "undefined") return;
  const { routes } = read();
  const seen = new Set<string>();
  document
    .querySelectorAll('link[rel="modulepreload"]')
    .forEach((l) => seen.add((l as HTMLLinkElement).href));

  for (const url of Object.values(routes)) {
    if (!url || seen.has(url)) continue;
    const link = document.createElement("link");
    link.rel = "modulepreload";
    link.href = url;
    link.crossOrigin = "anonymous";
    document.head.appendChild(link);
    seen.add(url);
  }
}

/** Clear cache — useful on logout / version bumps. */
export function clearPrefetchCache(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export const HIGH_PRIORITY_ROUTES = HIGH_PRIORITY;
