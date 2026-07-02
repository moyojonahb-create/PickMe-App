# PickMe Frontend UX & Engineering Audit

**Auditor perspective:** Senior Product Designer + Frontend Engineer (Uber / Bolt background)
**Scope:** Frontend only (`src/`). No backend, no business logic, no files modified.
**Method:** Static scan of 390 TS/TSX files (~20k LOC in components/pages), route map (`App.tsx`), design tokens (`index.css`, `tailwind.config.ts`), and the primary user flows (Rider → Ride → Track → Wallet, Driver → Dashboard → Trip, Admin → Dashboard).

---

## Scorecard

| Area | Score | One-line verdict |
|---|---|---|
| **Overall frontend** | **68 / 100** | Ships and looks premium in hero screens (Ride, Wallet, Live Tracking, Offer Card) but suffers from monolithic files, inconsistent design language across admin, and weak loading/empty/error hygiene. |
| Rider UX | 78 / 100 | Recently redesigned surfaces (Ride, Wallet, Live Tracking, Offer cards) are top-tier. Profile, History, Notifications, Safety still feel legacy. |
| Driver UX | 62 / 100 | Dashboard is a 1,265-line god-component. Online/offline is functional but visually thin. Nav overlay is over-featured, offer card is good. |
| Admin UX | 55 / 100 | 25+ admin routes, no shared table/filter/empty primitives. `AdminSystemHealth` alone is 1,280 lines. Inconsistent typography, dense data walls. |
| Mobile readiness | 74 / 100 | Rider flows are mobile-first and safe-area aware. Admin is desktop-only. Some bottom-sheets clip on iPad landscape. |
| Design consistency | 60 / 100 | Glass Blue tokens exist but many components hardcode colors or use different card radii, shadow depths, and CTA styles. |
| Performance | 65 / 100 | Route-level code splitting is excellent. Component-level: only 64/390 files use `useMemo/useCallback/memo`. Several pages fetch on every render. |

---

## Rider Experience

| Screen | State | Notes |
|---|---|---|
| Home / Landing (`Index.tsx`) | 🟢 Good | Auto-redirects authed users, clean hero, good hierarchy. |
| Ride booking (`RideView.tsx`) | 🟡 Mixed | Visual quality is A-tier post-redesign, but the file is **1,626 lines** — a maintenance liability. Bottom sheet, map, autocomplete, fare, ride-types, geolocation are all fused. |
| Destination search | 🟡 | Google Places works, but no recent-destinations grouping surfaced by default, no offline fallback UI. |
| Offer selection (`PremiumOfferCard` + `PremiumOffersSheet`) | 🟢 Excellent | Fare-dominant, badges, trust chips. Best card in the app. |
| Live tracking (`LiveTrackingPage.tsx`) | 🟢 Good | 697-line page but well-structured. Timeline + metrics strip + fare card is Uber-parity. |
| Wallet (`RiderWalletPage.tsx`) | 🟢 Good | Recently redesigned, PayPal/Cash-App feel. |
| Profile (`RiderProfile.tsx`) | 🔴 Weak | Feels legacy vs. rest of the app. No visual parity with Ride/Wallet. |
| Notifications | 🔴 Weak | `NotificationCenter.tsx` is small and unstyled; no unread badges in nav. |
| Safety / SOS (`SafetyPage.tsx`, `EmergencyButton.tsx`) | 🟡 | Works but reads like an info page, not a safety toolkit. No visible “trusted contacts” UI on Ride screen. |

## Driver Experience

| Screen | State | Notes |
|---|---|---|
| Dashboard (`DriverDashboard.tsx`) | 🔴 Rewrite | **1,265 lines**, contains online/offline, incoming request, active trip, earnings tile, nav all in one component. Rerenders massively on every location tick. |
| Online/offline toggle | 🟡 | Functional; visually a plain switch, no state affordance (pulse, ring, or “you’re visible to X riders” copy). |
| Ride request card (`RideRequestCard.tsx` + `DriverOfferCard.tsx`) | 🟢 | Reasonable, but two overlapping components — pick one. |
| Active trip / navigation (`FullScreenNavigation.tsx`) | 🟡 | **801 lines**. Over-scoped: chat + call + arrival + nav all here. Great features, hard to iterate. |
| Earnings (`DriverEarningsDashboard.tsx`) | 🟡 | Numbers only, no chart hierarchy, no comparison-to-yesterday, no goal ring. |
| Wallet (`DriverWalletPage.tsx`) | 🟡 | Not yet aligned to the rider wallet redesign (visual drift). |
| Profile / Verification (`DriverRegistrationWizard.tsx`) | 🟢 | Wizard flow is clear (476 lines but justified by steps). |

## Admin Experience

25 admin routes; no shared design primitives beyond `AdminLayout`.

| Screen | State | Notes |
|---|---|---|
| `AdminDashboard` | 🟡 | 551 lines, KPI cards inconsistent sizing, some cards have shadow, others don't. |
| `AdminSystemHealth` | 🔴 | **1,280 lines** — worst offender in the repo. Must be split into panels. |
| `AdminWalletDashboard` | 🟡 | Data-dense, no filter chips, no CSV export. |
| `AdminDrivers` / `AdminTrips` / `AdminStudents` | 🟡 | Three different table implementations. No shared `<DataTable>`. |
| `AdminDriversMap` | 🟢 | Focused, good use of map real estate. |
| `AdminRlsViewer` | 🟡 | Developer-only tone; fine internally. |
| Notifications / Risk | 🔴 | No unified alerts inbox; `AdminEmergencyAlerts` is a global toast, not a queue. |

---

## Design Quality

- **Colors** — Glass Blue (`#1D4ED8/#2563EB/#3B82F6`) is defined in tokens, but grep shows components still use raw `bg-blue-*` / `text-white` in places. Semantic token adoption ≈ 70%.
- **Typography** — Inter is loaded, but sizes drift (`text-sm`, `text-[13px]`, `text-xs` mixed for the same role). No documented type scale.
- **Spacing** — 4/8/12/16 mostly, but bottom sheets use `p-4`, cards use `p-5`, admin uses `p-6`. Needs a spacing token.
- **Cards** — Radii vary: `rounded-2xl`, `rounded-3xl`, `rounded-xl`. Shadow depth varies: `shadow-md`, `shadow-lg`, `shadow-2xl`, custom `shadow-[...]`.
- **Buttons** — Two button systems in use: shadcn `<Button>` and hand-rolled `<button className>`. Primary CTA gradient differs between Ride, Wallet, and Driver.
- **Mobile responsiveness** — Rider: A. Driver: B. Admin: F (assumes ≥1024px).
- **Dark mode** — Tokens support it, but many components hardcode white cards. Effectively **not shipping** dark mode.
- **Loading states** — `PageSkeleton` exists at route level ✅. Inside pages, most lists show a spinner or nothing. Fare/ETA/nearby drivers now have skeletons post-redesign; History/Notifications/Admin tables do not.
- **Empty states** — Inconsistent. Some screens have illustrated empties (Wallet), most just show blank cards.
- **Error states** — `RouteErrorBoundary` catches route crashes. Inside pages, most `catch` blocks call `toast.error` and leave the UI in an ambiguous state.

---

## Top 20 UI / UX problems (ranked by user impact)

1. **Driver Dashboard visual density** — no clear focal point when idle; earnings, map, toggle, tips all compete.
2. **Online/offline toggle lacks affordance** — no pulse ring, no “drivers online near you” copy.
3. **Rider Profile screen** looks unrelated to the redesigned Ride/Wallet.
4. **Driver Wallet** hasn't inherited the fintech redesign; brand-inconsistent.
5. **Notification center** is essentially invisible; no bell badge, no grouping.
6. **Safety page** is copy-heavy, not action-first. No “Share trip” CTA at top.
7. **Admin has no shared DataTable** — filters, pagination, empty states re-implemented per page.
8. **Admin dashboards are not responsive** — break under 1024px width.
9. **Two offer-card components** (`DriverOfferCard` + `RideRequestCard`) with different styles — driver sees inconsistency.
10. **Fare formatting drift** — `$` vs `USD` vs `US$` appears across screens.
11. **Ride history** rows lack fare, driver avatar, and status color chips (bare list).
12. **Multi-stop input** exists (`MultiStopInput.tsx`) but isn't discoverable from Ride screen.
13. **Bottom sheet on iPad landscape** clips fare card at 72vh maxHeight.
14. **Autocomplete result list** has no icons distinguishing landmark vs address vs recent.
15. **No skeleton in RideHistory / DriverEarnings / Admin tables** — flashes empty.
16. **Emergency button** placement inconsistent between Ride and Live Tracking.
17. **Chat entry point** appears in nav bar of Ride card but has no unread indicator.
18. **Toasts stack aggressively** during ride flow (offer received + payment + status) — no dedupe.
19. **Language switcher** is present but visually a plain select — doesn't match brand.
20. **Referral share** UI is a modal buried in profile; no home-screen surface.

## Top 20 Frontend Technical problems

1. **`RideView.tsx` = 1,626 lines** — needs decomposition into `SheetIdle`, `SheetSearching`, `SheetOffers`, `SheetActive`.
2. **`AdminSystemHealth.tsx` = 1,280 lines** — split by panel.
3. **`DriverDashboard.tsx` = 1,265 lines** — split by lifecycle state.
4. **`FullScreenNavigation.tsx` = 801 lines** — split nav/chat/call.
5. **Only 64/390 files use memoization** — heavy pages rerender on every hook tick (location, realtime).
6. **`useDriverTracking` and `useRideRealtime`** run subscriptions inside `RideView` without effect cleanup guards — potential double-subs on Fast Refresh.
7. **Two supabase clients** (`integrations/supabase/client.ts` and `lib/supabaseClient.ts`) — pick one.
8. **`googleMapsLoader`** may double-load on route re-mount; no singleton guard test.
9. **Route-level `<Suspense>` is good**, but many pages import heavy libs eagerly (`chart.js`, `recharts`) — dynamic import them.
10. **`AdminDashboard` refetches on tab focus** without stale-time — hammers RPCs.
11. **Ride list realtime channels** aren't cleaned when navigating away → memory leak in long sessions.
12. **`useNearbyDrivers`** polls on interval AND subscribes to realtime — duplicate source of truth.
13. **`MapGoogle` re-creates markers** on every driver update rather than diffing (fixed for clustering, not for pins).
14. **Icons imported barrel-style** in some places (`import * as Lucide`) — kills tree-shake.
15. **Tailwind arbitrary values** (`text-[13px]`, `shadow-[0_4px_16px_...]`) leak across the codebase — extract tokens.
16. **`any` casts** are common (per `tsconfig` `noImplicitAny: false`) — hides real bugs (e.g. optional `rating`/`student_discount_applied`).
17. **No error boundary per feature** — one throw in a sheet kills the whole page.
18. **Toasts imported from two libs** (`sonner` and `use-toast`) inconsistently.
19. **Duplicate map providers** (`MapGoogle`, `MapboxMap`, `OSMMap`, `TripGoogleMap`) — pick primary and lazy-load alternates.
20. **PWA service worker (`sw.js`) caches aggressively** — no cache-busting on chunk hash change may serve stale UI post-deploy.

---

## Screens needing **urgent** improvement

1. `DriverDashboard.tsx` — split + visual pass.
2. `AdminSystemHealth.tsx` — split, then style.
3. `RiderProfile.tsx` — re-skin to match Ride/Wallet.
4. `DriverWalletPage.tsx` — align to rider wallet.
5. Admin table screens (`AdminDrivers`, `AdminTrips`, `AdminStudents`, `AdminWithdrawalsPage`) — build shared `<DataTable>` first.
6. `NotificationCenter` — real inbox UX with grouping + bell badge.
7. `SafetyPage` — restructure as action grid, not article.

## Screens already good enough (ship-ready)

- `Index.tsx` (Landing)
- `RideView.tsx` (visually — needs decomposition for maintainability)
- `LiveTrackingPage.tsx`
- `RiderWalletPage.tsx`
- `PremiumOfferCard` / `PremiumOffersSheet`
- `DriverRegistrationWizard.tsx`
- `AdminDriversMap.tsx`
- `Auth.tsx` / `Signup.tsx` / `PhoneOtpVerification.tsx`

---

## Recommended redesign phases

**Phase 1 — Design system foundation (1–2 days, no user-visible changes)**
- Extract typography scale, spacing tokens, radius + shadow tokens into `index.css`.
- Ban raw color utilities via ESLint rule.
- Consolidate to shadcn `<Button>` + `<Card>` + a new shared `<DataTable>`, `<EmptyState>`, `<ErrorState>`, `<Skeleton>` primitives.
- Delete the second supabase client.

**Phase 2 — Driver parity (2–3 days)**
- Decompose `DriverDashboard` into lifecycle sub-views.
- Redesign online/offline hero.
- Re-skin `DriverWalletPage` to match rider wallet.
- Split `FullScreenNavigation` into nav / chat / call panels.

**Phase 3 — Rider polish (1–2 days)**
- Rebuild `RiderProfile` with the Glass Blue system.
- Notification inbox + bell badge.
- Safety action grid + persistent Share-trip CTA.
- Ride history: fare, avatar, status chip, skeleton, empty state.

**Phase 4 — Admin overhaul (3–5 days)**
- Split `AdminSystemHealth` into panels.
- Adopt shared `<DataTable>` across 8 list pages.
- Responsive layout for ≥768px tablets.
- Unified alerts inbox to replace scattered emergency toasts.

**Phase 5 — Performance pass (1–2 days)**
- Memoize map marker layers and offer lists.
- Dynamic-import chart libraries.
- Add React Query staleTime to admin dashboards.
- Audit realtime channel cleanup.
- Deduplicate `useNearbyDrivers` polling vs subscription.

**Phase 6 — Dark mode (optional, 1 day)**
- Sweep hardcoded whites; verify semantic token coverage; ship.

---

*No source files were modified during this audit. Awaiting approval to proceed with any phase.*
