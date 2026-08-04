# Load performance diagnosis (no changes made yet)

## Verdict

Nothing is hard-blocking first paint. The slowness comes from stacked eager work in the first chunk plus a chatty `/ride` mount. Note: no production build exists in the workspace, so byte sizes below are static analysis, not measured.

## Culprits, ranked by impact

**1. Telemetry SDKs initialize synchronously before React mounts — `src/main.tsx:19-62`**
Sentry (`browserTracingIntegration` + `replayIntegration`, session replay = DOM mutation observers), Datadog RUM (`src/integrations/datadog/rum.ts:46-64`, `startSessionReplayRecording()` at 100% sample when enabled — `.env.example` defaults it to `false`), and `installRuntimeBreadcrumbs()` (patches `console.error`, `fetch`, `history`, adds a capturing document click listener) all run before `createRoot().render()` at `main.tsx:114`. This is parse + exec + ingest network on every load, on every route.

**2. Render-blocking Google Fonts — `src/index.css:1`**
`@import url('https://fonts.googleapis.com/css2?...')` inside CSS serializes three round trips (CSS request → font CSS parse → gstatic font fetch). `index.html:54-55` preconnects to Google Maps and Supabase but **not** to `fonts.googleapis.com` / `fonts.gstatic.com`.

**3. `/ride` fires ~5 concurrent operations on mount — `src/components/ride/RideView.tsx`**
High-accuracy geolocation with a 10s timeout (line ~306), a Supabase `profiles` query (~184), landmarks search + `useNearbyDrivers` realtime (~162), and OSRM route wiring (~199). None gate the render, but they contend for main thread and network exactly when the map script is also downloading from `api.mapbox.com`.

**4. Wasted bytes / requests on the eager path**
- `src/assets/hero-city.jpg` (324 KB JPEG) imported eagerly by `LandingHero.tsx:6` — this one actually ships to every landing visitor.
- `index.html:48` unconditionally preloads Leaflet CSS from unpkg, though Leaflet is only used in admin/OSM-fallback screens — an extra DNS+TLS handshake for nearly all users.
- `public/icons/*` PWA icons are ~700–800 KB each despite being 72–384 px (only the 512 icon is properly compressed at 13 KB). Fetched during install/manifest checks.
- `src/assets/voyex-logo-new.png` (2.1 MB), `voyex-logo-transparent.png` (946 KB), `voyex-logo-clean.png` (759 KB) are **not imported anywhere in `src`** — repo weight only, no runtime cost.

**5. Eager landing page tree — `src/App.tsx:20`, `src/pages/Index.tsx`**
`Index` is the only non-lazy page and statically pulls Header, 4 marketing sections, Footer, auth modal, two sheets, and framer-motion. Logged-in users also briefly see it before the `/ride` redirect resolves (`Index.tsx:20-24`).

**6. Splash floor — `index.html:100-122`**
Minimum 1200 ms splash with a 2500 ms hard fallback. Perceived load can never beat 1.2s by design.

## Cleared (not problems)

- `mapbox-gl` is **not** bundled — loaded via runtime `<script>` in `src/lib/mapboxLoader.ts`.
- Capacitor Contacts is dynamically imported; Agora SDK and recharts/leaflet are only reachable from lazy route chunks.
- 48 routes are `React.lazy` in `App.tsx`; `useAuth` renders children immediately (800 ms safety timeout) and never gates paint.
- The recent redesign (destination search, booking sheet, pin SVG) adds no mount-time cost beyond the framer-motion already in the `/ride` chunk.

## Proposed fixes (awaiting your go-ahead)

1. Defer Sentry/Datadog/breadcrumb init to after first paint (`requestIdleCallback` or post-mount), and drop Sentry `replayIntegration` to lazy-load form.
2. Move the font `@import` out of `index.css` into a `<link rel="preload" as="style">` + `preconnect` pair in `index.html`.
3. Stagger `/ride` mount work: start with a low-accuracy/cached GPS fix and upgrade to high accuracy afterwards; defer nearby-drivers realtime until the map is ready.
4. Convert `hero-city.jpg` to WebP + add `loading`/`fetchpriority` hints; regenerate PWA icons at correct sizes; delete the three unused multi-MB logos; make the Leaflet CSS preload conditional.
5. Lazy-load the below-the-fold marketing sections in `Index.tsx`.
6. Lower the splash minimum from 1200 ms to ~400 ms once the above land.

## Technical notes

Recommend running `vite build` with `rollup-plugin-visualizer` first to get real entry-chunk numbers before and after, so the wins are measurable rather than assumed. `manualChunks` in `vite.config.ts:59-77` lists `leaflet`/`recharts` vendors that aren't entry-reachable — harmless, but worth tidying while in there.
