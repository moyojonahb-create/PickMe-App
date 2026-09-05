# CruiXe — Phase 3 Screen Inventory (Web → React Native)

Scope: **counting and classifying Phase 3**, the rider and driver screen
migration. Read-only audit of the working tree — no code written, no packages
installed, no network used.

Every number below was derived by reading `src/App.tsx` and measuring the files,
not estimated. Where a page is a thin wrapper over a component subtree, that is
called out — per-page line counts badly understate the real work, and that is
the single most important correction in this document.

---

## Headline numbers

| Metric | Count |
|---|---|
| Route declarations in `App.tsx` | **74** |
| — of which pure redirects | 21 |
| **Rendering screens** | **53** |
| Page files on disk (`src/pages/**`) | 54 (one unrouted: `DriverRegistrationIntro.tsx`) |
| **In scope for mobile** | **24** |
| Out of scope (admin, marketing, PWA-only) | 29 |

**In-scope split: 8 complex / 9 moderate / 7 trivial.**

That is the honest size of Phase 3: **24 screens** — not 53, and not "70,000
lines". The 70k figure covers the whole web app including 22 admin screens that
mobile never gets.

---

## 1. The redirect layer disappears

21 of 74 routes render nothing — they are `<Navigate>` shims. Legacy `/mapp/*`
paths (12 routes) date from the Capacitor build, and `/negotiate/*` (3 routes)
redirect a removed feature. **None of these port.** React Navigation has no
equivalent concept and needs none; the few that matter become deep-link aliases
in the `linking` config.

Redirect-only: `/`, `/login`, `/mapp` ×12, `/ride-history`, `/driver-mode`,
`/negotiate/request`, `/negotiate/offers/:requestId`,
`/negotiate/driver-requests`, plus `/ride/:rideId` and `/rider/ride/:rideId`
which both hit `RideDetailRedirect`.

> `RideDetailRedirect` exists because `RiderRideDetail.tsx` was deleted upstream
> (see the Phase 0 audit). There is no rider ride-detail screen any more —
> tracking is served by `/track/:tripId`. Do not budget for one.

---

## 2. Full screen inventory

### Rider — 13 in scope

| Route | File | LOC | Complexity | Dependencies |
|---|---|---|---|---|
| `/auth` | `src/pages/Auth.tsx` | 460 | moderate | forms, Supabase auth |
| `/signup` | `src/pages/Signup.tsx` | 434 | moderate | **zod** + RHF (only page importing zod directly) |
| `/reset-password` | `src/pages/ResetPassword.tsx` | 175 | trivial | forms |
| `/ride` | `src/pages/Ride.tsx` | **5** | **complex** | 5-line wrapper over `RideView` (1,834) + `components/ride/` (61 files, 10,409 LOC) |
| `/ride/:rideId/matching` | `src/pages/RideMatching.tsx` | 1,786 | **complex** | map, websocket, agora, motion, payments |
| `/track/:tripId` | `src/pages/LiveTrackingPage.tsx` | 362 | **complex** | map, websocket, motion |
| `/history` | `src/pages/RideHistory.tsx` | 253 | moderate | payments |
| `/profile` | `src/pages/RiderProfile.tsx` | 408 | moderate | upload, payments |
| `/edit-profile` | `src/pages/EditProfile.tsx` | 202 | moderate | upload |
| `/wallet` | `src/pages/RiderWalletPage.tsx` | 480 | moderate | payments, `components/wallet/` (10 files, 1,528 LOC) |
| `/student-verification` | `src/pages/StudentVerificationPage.tsx` | 749 | **complex** | camera/upload, motion |
| `/safety` | `src/pages/SafetyPage.tsx` | 171 | trivial | static content |
| `/delete-account` | `src/pages/DeleteAccount.tsx` | 104 | trivial | **Play Store requires in-app account deletion — do not drop** |

### Driver — 11 in scope

| Route | File | LOC | Complexity | Dependencies |
|---|---|---|---|---|
| `/driver` | `src/pages/DriverModeLanding.tsx` | 140 | trivial | — |
| `/driver/register` | `src/pages/DriverRegistrationPage.tsx` | **13** | **complex** | wrapper over `DriverRegistrationWizard` (488) + `DriverSelfieCheck` (257, camera) |
| `/driver/application` | `src/pages/DriverApplication.tsx` | 97 | trivial | upload |
| `/driver/dashboard` | `src/pages/DriverDashboard.tsx` | 730 | **complex** | websocket, agora, upload, payments, background location |
| `/driver/requests` | `src/pages/driver/DriverRideRequests.tsx` | 374 | **complex** | map |
| `/driver/ride/:rideId` | `src/pages/driver/DriverRideDetails.tsx` | 426 | **complex** | map, navigation |
| `/driver/trips` | `src/pages/driver/DriverTrips.tsx` | 87 | trivial | — |
| `/driver/profile` | `src/pages/driver/DriverProfile.tsx` | 686 | moderate | upload |
| `/driver/wallet` | `src/pages/DriverWalletPage.tsx` | 372 | moderate | payments |
| `/driver/deposit` | `src/pages/DriverDepositPage.tsx` | 118 | moderate | payments (EcoCash modal) |
| `/driver/leaderboard` | `src/pages/DriverLeaderboard.tsx` | 128 | trivial | motion |

### Out of scope — 29

**Admin/ops — 22 screens, all of `src/pages/admin/`.** Stays on web. These are
desk tools; `AdminSystemHealth` alone is 1,267 LOC of dashboards. Critically,
three admin screens (`AdminDashboard`, `AdminReports`, `AdminSystemHealth`) are
the **only** consumers of `recharts` in the entire app. Leaving admin on web
means **recharts never needs an RN replacement** — that deletes a whole
workstream the Phase 0 audit had budgeted for.

**Marketing / PWA-only — 7.** `/home` (Index), `/terms`, `/privacy`, `/offline`,
`/install`, `*` (NotFound), `/app` (AppDashboard — a pure redirect shim).
`/offline` and `/install` are service-worker/PWA artifacts with no RN meaning.
Terms and Privacy should be a WebView or external link, not rebuilt screens —
store review needs the links, not native rendering.

---

## 3. Dependency flags — measured, not assumed

Grepped across all 54 page files:

| Dependency | Pages | In-scope | RN replacement |
|---|---|---|---|
| **Mapbox** | 5 | **4** — `RideMatching`, `LiveTrackingPage`, `DriverRideRequests`, `DriverRideDetails` | `@rnmapbox/maps` — **full rewrite, not a port** (web loads Mapbox GL from CDN and drives it imperatively via `document.createElement`) |
| **recharts** | 3 | **0** | none needed — admin-only |
| **leaflet** | 0 | 0 | none needed — **zero page imports**; dead dependency |
| **vaul** (drawer) | 0 direct | 0 | `@gorhom/bottom-sheet`; isolated to `components/ui/drawer.tsx` |
| **@radix-ui** | 0 direct | 0 | all behind `components/ui/` (59 files, 4,355 LOC) — rebuild the wrapper layer once, not per screen |
| **agora** | 3 | 2 — `RideMatching`, `DriverDashboard` | `react-native-agora` |
| **zod** | 1 | 1 — `Signup` | portable as-is |
| **framer-motion** | 4 | 4 | `react-native-reanimated` + `moti` |

**The headline:** no in-scope screen imports recharts, leaflet, vaul, or Radix
*directly*. The four libraries with the weakest RN story are all either
admin-only or already hidden behind the `components/ui/` wrapper layer. **Map is
the only hard dependency blocker on the rider/driver path**, and it hits exactly
4 screens.

---

## 4. React Navigation structure

```
RootStack (native-stack)
├─ AuthStack                         [unauthenticated]
│  ├─ Auth                           ← /auth
│  ├─ Signup                         ← /signup
│  └─ ResetPassword                  ← /reset-password
│
├─ RiderTabs (bottom-tabs)           [authenticated, role=rider]
│  ├─ RideTab     → Ride             ← /ride  (home)
│  ├─ HistoryTab  → RideHistory      ← /history
│  ├─ WalletTab   → RiderWallet      ← /wallet
│  └─ ProfileTab  → RiderProfile     ← /profile
│
├─ DriverTabs (bottom-tabs)          [authenticated, role=driver]
│  ├─ DashboardTab → DriverDashboard ← /driver/dashboard
│  ├─ RequestsTab  → DriverRideRequests ← /driver/requests
│  ├─ TripsTab     → DriverTrips     ← /driver/trips
│  ├─ WalletTab    → DriverWallet    ← /driver/wallet
│  └─ ProfileTab   → DriverProfile   ← /driver/profile
│
├─ Full-screen pushes (over tabs, no tab bar)
│  ├─ RideMatching       ← /ride/:rideId/matching   {rideId}
│  ├─ LiveTracking       ← /track/:tripId           {tripId}
│  └─ DriverRideDetails  ← /driver/ride/:rideId     {rideId}
│
├─ ModalStack (presentation: 'modal')
│  ├─ EditProfile         ← /edit-profile
│  ├─ DriverDeposit       ← /driver/deposit
│  ├─ StudentVerification ← /student-verification
│  ├─ Safety              ← /safety
│  └─ DeleteAccount       ← /delete-account
│
└─ Onboarding (pushed, gated)
   ├─ DriverModeLanding   ← /driver
   ├─ DriverRegistration  ← /driver/register
   └─ DriverApplication   ← /driver/application

WebView / external link (not native screens):
   Terms ← /terms   ·   Privacy ← /privacy
```

**Notes on the mapping:**

- **`AuthGuard` / role gating becomes conditional navigators, not wrappers.** The
  web app wraps 20+ routes in `<AuthGuard>`. In React Navigation you render
  `AuthStack` or the role tabs based on auth state — the guard *disappears*
  rather than being ported 20 times.
- **Rider and driver split into separate tab navigators.** Web serves both from
  one flat table with `/driver/*` prefixes; the app needs a role switch.
  `DriverModeLanding` is the seam.
- **`RideMatching`, `LiveTracking`, `DriverRideDetails` must be full-screen
  pushes, not tabs** — they are active-ride states where a tab bar is wrong.
- **Deep links:** `/track/:tripId` is the one route genuinely linked from outside
  (riders share tracking). Keep its path shape in the `linking` config.
- **Nothing is silently dropped:** all 24 in-scope screens appear above; the 29
  out-of-scope ones are listed in §2 with a reason.

---

## 5. Minimum vertical slice

Smallest set that proves the architecture end to end (request → match → track →
complete):

| # | Screen | Why it is in the slice |
|---|---|---|
| 1 | **Auth** | Supabase session + the AsyncStorage auth adapter — the whole data layer depends on this |
| 2 | **Ride** (`RideView`) | Request entry: destination search, tier select, fare quote |
| 3 | **RideMatching** | Match state + **websocket** — proves realtime |
| 4 | **LiveTracking** | Driver position over time — proves delivery and background location |
| 5 | **RideHistory** | Completion + receipt — proves the ride actually closed |

**Five screens**, hitting every architectural unknown exactly once: auth/session,
`packages/core` reuse, websocket realtime, background location, and — last —
the map.

### 5a. Build the slice against a stub map first

**Do not put Mapbox in the first pass of this slice.** Build LiveTracking
initially against a **stub map**: a plain list of incoming coordinates with
timestamps, or a static image with absolutely-positioned markers. Anything that
renders positions without a map SDK.

**The reason is diagnostic isolation, not effort.** As originally sequenced this
slice could not complete without solving Mapbox, which put the single largest
unknown in front of proof of the other four. Worse, it makes failure ambiguous:
if a driver marker never appears, that is equally consistent with a dropped
websocket, a broken background-location handoff, a `packages/core` mapping bug,
*or* a misconfigured map SDK — and you cannot tell which from the symptom. A
coordinate list makes the same failure unambiguous, because you are reading the
data directly rather than through a rendering layer that can also be wrong.

So the first pass proves, with nothing to hide behind:

- session + AsyncStorage auth adapter survive backgrounding
- `packages/core` logic is genuinely shared and framework-agnostic
- websocket messages actually arrive, in order, at the expected rate
- background location keeps producing fixes when the app is not foregrounded

### 5b. Then Mapbox, as a bounded problem

Once positions are proven to arrive correctly, Mapbox stops being a fight and
becomes a contained rendering task: *draw coordinates that are already known to
be good.* Any remaining fault is unambiguously in the map layer.

**It still needs its own API design pass, and this is not optional.** The web app
drives Mapbox GL **imperatively** — loading it from CDN via
`src/lib/mapboxLoader.ts`, building markers with `document.createElement`, and
calling `addSource`/`addLayer` directly. `@rnmapbox/maps` is **declarative**:
sources and layers are components, and camera control happens through refs.

**The interaction model changes, not just the library.** A call-by-call
translation of the existing imperative code will produce something that fights
React's render cycle. The design pass decides explicitly what becomes props
(sources, layers, marker collections, camera bounds) versus what stays an
imperative ref handle (`flyTo`, `fitBounds`, gesture overrides) — before any
porting starts.

### Slice logistics

**No second device or real driver needed.** `src/hooks/useDriverSimulation.ts`
already exists in the web app and can drive the driver side of the journey,
keeping the slice a single-device task — and removing the laptop-as-rider
workaround entirely.

**Explicitly not in the slice:** wallet/payments (real money, mockable), driver
registration (camera/upload — a separate risk), student verification,
leaderboard, and every admin screen.

---

## 6. `components/ui/` is a standalone workstream — build it first

**Sequence it as its own deliberate piece of work, after the vertical slice and
*before* the 9 moderate screens.** Not as a library nobody owns, and not as
something that accretes.

`src/components/ui/` is **59 files, 4,355 LOC** — the shadcn/Radix primitive
layer. Rebuilding it on RN primitives (plus `@gorhom/bottom-sheet` for
`drawer.tsx`, the only `vaul` consumer) is what converts the 9 moderate screens
from design work into mechanical work. That multiplier is the entire argument for
treating it as a workstream.

**The leverage only exists if it is built up front.** If instead each screen
pulls in the one primitive it happens to need, you get three slightly different
button implementations, two spacing scales and inconsistent focus and press
states — and then no multiplier at all, because screen number seven cannot reuse
what screens one through six each solved differently. The cost of that is not
just visual drift; it is that the work stops compounding. Piecemeal accretion
converts a fixed 59-file cost into a recurring per-screen cost.

Practical shape:

- **Own it explicitly.** One person, one pass, reviewed as a unit — not
  distributed across the screen backlog.
- **Do the design-token layer with it.** `index.css` carries the whole token
  system today (see the Phase 0 audit); the primitives are where those tokens
  land on mobile, so the two move together or neither works.
- **Scope it against the 24 in-scope screens, not all 59 files.** Some primitives
  exist only for admin. Build what the mobile screens actually consume; a `data
  table` primitive that only `AdminTrips` uses is not mobile's problem.
- **Dark mode belongs here too.** `next-themes` (3 files) is replaced by context +
  AsyncStorage at this layer, once, rather than per screen.

Ordering, end to end: **vertical slice (§5) → `components/ui/` (§6) → the 9
moderate screens → the remaining complex screens.** The slice comes first because
it proves the architecture is sound before anyone invests 59 files of primitives
into it.

---

## 7. What this means for sizing

| Bucket | Screens | Notes |
|---|---|---|
| Complex | 8 | 4 need the map rewrite; 2 need Agora; 2 need camera/upload |
| Moderate | 9 | Forms, lists, wallet views — mechanical once `components/ui/` exists |
| Trivial | 7 | Static or near-static |
| **In scope** | **24** | |

Two structural facts that shrink this below what it looks like:

1. **`components/ui/` (59 files, 4,355 LOC) is rebuilt once**, not per screen. It
   is the single largest lever — 9 moderate screens become mechanical the moment
   it exists. **Conditional on it being built as its own workstream (§6);** built
   piecemeal it is a recurring per-screen cost instead of a fixed one.
2. **`components/ride/` (61 files, 10,409 LOC) is the real Phase 3.** The `/ride`
   route is 5 lines; the subtree behind it is larger than every admin screen
   combined. Any plan that sizes Phase 3 from page-file line counts will be wrong
   by roughly an order of magnitude on this one route.

The riskiest single item is not a screen at all — it is the **Mapbox rewrite**,
which gates 4 of the 8 complex screens and has no port path, only a rebuild.
**Per §5a it is deliberately not on the critical path of the vertical slice:**
staging it behind a stub map means the other four unknowns are proven first, and
Mapbox is then attempted against data already known to be correct.

---

*Produced by reading `src/App.tsx` (229 lines, 74 routes) and measuring all 54
page files plus their component subtrees. No packages installed, no network used.*
