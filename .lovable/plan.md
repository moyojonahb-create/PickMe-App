# Ramz One Enterprise Stabilization Plan

Scope is large. I'll execute in 6 focused phases, verifying with the heuristic scanner between phases. No business-logic changes — only safety, performance, and visibility fixes.

## Phase 1 — Google Maps Visibility & Loader

**New file:** `src/lib/googleMapsLoader.ts`
- Singleton `loadGoogleMaps()` that injects the script exactly once
- Reads key from `import.meta.env.VITE_GOOGLE_MAPS_API_KEY` only
- Loads libraries: `places, geometry, routes, marker`
- Resolves when `window.google.maps` is ready; one retry on script error
- Returns cached promise on subsequent calls

**Refactor:** `src/hooks/useGoogleMaps.ts` to delegate to the loader (no duplicate `<script>` injection, no hardcoded fallback key).

**Map container hygiene** in `MapGoogle.tsx` / `TripGoogleMap.tsx` / `PremiumTrackingMap.tsx`:
- Ensure wrapper has `h-full w-full min-h-[100vh]` where appropriate (only where currently broken)
- Skeleton loader while `loading`, fallback UI on `error` with retry
- Guard render until coords valid + container mounted
- Memoize markers, reuse `DirectionsRenderer`, throttle camera updates with rAF

## Phase 2 — Supabase Query Safety

Replace `.single()` → `.maybeSingle()` and handle null in:
- `src/hooks/useWebRTCCall.ts:391`
- `src/hooks/useWallet.ts:55,64`
- `src/hooks/usePricingSettings.ts:73`
- `src/hooks/useAgoraCall.ts:373`
- `src/lib/requestRide.ts:132,150`
- `src/lib/offerHelpers.ts:171,193`

Replace `select("*")` with explicit columns + `.limit()` in:
- `src/lib/requestRide.ts:124`
- `src/hooks/useTownPricing.ts:140`
- `src/lib/offerHelpers.ts:81,82`
- `src/lib/ramzActions.ts:148`
- `src/components/admin/LoadPulsePanel.tsx` (8 selects)

## Phase 3 — Polling & Realtime

- `PremiumOffersSheet.tsx`: `setInterval(... ,1000)` only drives countdown UI — keep it (UI tick, not network). Bump to `requestAnimationFrame`-style interval guard with cleanup; gate to active offers presence.
- `DriverETABanner.tsx`: replace 1s tick with single combined timer; ensure cleanup. (UI countdown, not network polling — safe to keep ≥1s for MM:SS display.)

Note: these are display tickers, not network polls, so the heuristic rule is overly strict. I'll consolidate timers and ensure cleanup, which addresses the actual concern.

## Phase 4 — Console Log Hygiene

Wrap or remove `console.log` in:
- `useAgoraCall.ts` (14 sites) — wrap in `if (import.meta.env.DEV)`
- `push.ts` (3 sites) — same
- `useVoiceNavigation.ts:36` — same

Keep `console.warn` / `console.error` as-is (production diagnostics).

## Phase 5 — Type Safety

Remove explicit `any` in:
- `ramzHeuristicScan.ts:124`
- `haptics.ts:18`
- `useGooglePlacesAutocomplete.ts:79`

## Phase 6 — Security: envPolyfill

`src/lib/envPolyfill.ts`: remove hardcoded Supabase URL + anon key. Replace with no-op (kept as a side-effect entry to preserve existing imports), and rely solely on `import.meta.env`.

## Verification
After each phase, re-run the Ramz heuristic scan logic mentally against changed files. No DB migrations. No behavior changes to ride/wallet/payment flows.

## Out of scope (intentional)
- No changes to RLS, edge functions, Capacitor config, or schema
- No refactor of pricing/wallet RPCs
- No rewrites of the Agora call state machine — only log gating
