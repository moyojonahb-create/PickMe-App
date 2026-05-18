/**
 * Runtime breadcrumb logger.
 *
 * Captures the user's last ~50 actions (clicks, route changes, console errors,
 * network failures) into a ring buffer. When an uncaught error or unhandled
 * rejection fires, the buffer is attached to the Sentry event as `context`
 * so we can see exactly which button / page / fetch led to the crash.
 *
 * Also exposes `window.__pickmeBreadcrumbs()` for live debugging in DevTools.
 *
 * Safe to import multiple times — initialization is idempotent.
 */
import * as Sentry from '@sentry/react';

export interface Breadcrumb {
  t: number;          // epoch ms
  kind: 'click' | 'nav' | 'console' | 'fetch' | 'note';
  path: string;       // current route
  label: string;      // human-readable: button text, URL, error message
  detail?: string;
}

const MAX = 50;
const buf: Breadcrumb[] = [];

function push(b: Breadcrumb) {
  buf.push(b);
  if (buf.length > MAX) buf.shift();
}

function shortLabel(el: Element): string {
  const aria = el.getAttribute('aria-label');
  if (aria) return aria.slice(0, 80);
  const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ');
  if (text) return text.slice(0, 80);
  const tag = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id}` : '';
  const cls = el.className && typeof el.className === 'string' ? `.${el.className.split(' ')[0]}` : '';
  return `${tag}${id}${cls}`;
}

let installed = false;

export function installRuntimeBreadcrumbs() {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  // 1. Click capture — find the nearest interactive ancestor.
  document.addEventListener(
    'click',
    (e) => {
      const target = e.target as Element | null;
      if (!target) return;
      const interactive = target.closest('button, a, [role="button"], [role="link"], input[type="submit"]');
      if (!interactive) return;
      push({
        t: Date.now(),
        kind: 'click',
        path: location.pathname,
        label: shortLabel(interactive),
        detail: interactive.tagName.toLowerCase(),
      });
    },
    true,
  );

  // 2. Navigation capture (popstate + push/replaceState patching).
  const recordNav = (reason: string) =>
    push({ t: Date.now(), kind: 'nav', path: location.pathname, label: location.pathname, detail: reason });

  window.addEventListener('popstate', () => recordNav('popstate'));
  const origPush = history.pushState;
  const origReplace = history.replaceState;
  history.pushState = function (...args) {
    const r = origPush.apply(this, args as Parameters<typeof history.pushState>);
    recordNav('push');
    return r;
  };
  history.replaceState = function (...args) {
    const r = origReplace.apply(this, args as Parameters<typeof history.replaceState>);
    recordNav('replace');
    return r;
  };

  // 3. console.error capture (does NOT swallow original).
  const origErr = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    try {
      const msg = args
        .map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : JSON.stringify(a)))
        .join(' ')
        .slice(0, 240);
      push({ t: Date.now(), kind: 'console', path: location.pathname, label: msg });
    } catch {
      /* never break console */
    }
    origErr(...args);
  };

  // 4. fetch failures (status >= 500 or network throw).
  const origFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request).url;
    try {
      const res = await origFetch(...(args as Parameters<typeof fetch>));
      if (!res.ok && res.status >= 500) {
        push({ t: Date.now(), kind: 'fetch', path: location.pathname, label: `${res.status} ${url}` });
      }
      return res;
    } catch (err) {
      push({
        t: Date.now(),
        kind: 'fetch',
        path: location.pathname,
        label: `THROW ${url}`,
        detail: String(err).slice(0, 200),
      });
      throw err;
    }
  };

  // 5. Wire into Sentry — attach breadcrumbs as context on every event.
  Sentry.addEventProcessor((event) => {
    if (buf.length > 0) {
      event.contexts = {
        ...(event.contexts ?? {}),
        pickme_breadcrumbs: {
          count: buf.length,
          steps: buf.slice(-25).map((b) => `[${new Date(b.t).toISOString().slice(11, 19)}] ${b.kind} @ ${b.path}: ${b.label}`),
        },
      };
    }
    return event;
  });

  // 6. DevTools helper — call `__pickmeBreadcrumbs()` from console.
  (window as unknown as { __pickmeBreadcrumbs: () => Breadcrumb[] }).__pickmeBreadcrumbs = () => [...buf];
}

/** Manually record a custom note (e.g. from a try/catch). */
export function noteBreadcrumb(label: string, detail?: string) {
  push({ t: Date.now(), kind: 'note', path: typeof location !== 'undefined' ? location.pathname : '', label, detail });
}

/** Snapshot the current breadcrumbs (for tests or in-app reporting). */
export function getBreadcrumbs(): Breadcrumb[] {
  return [...buf];
}
