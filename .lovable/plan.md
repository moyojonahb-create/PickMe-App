# PickMe Real-Time Smart Ride Experience

Premium fully-embedded live navigation for both rider and driver, built on Mapbox GL (primary) with Google fallback. No external app handoff during a ride.

## Scope (this iteration)

1. **In-app Live Navigation Map** (`LiveNavMap.tsx`, Mapbox GL)
   - Single shared component used by both driver and rider screens.
   - Layers: driver car marker (animated, GPU-interpolated), pickup pin, dropoff pin, route line, fading "consumed" sub-layer.
   - Smooth camera follow with bearing rotation toward movement direction; intelligent auto-zoom (tighter when close, wider when far).
   - Dark theme by default; respects `useFemaleTheme` accent.
   - Graceful weak-network handling: cached last route, retries via OSRM, no blocking spinners over the map.

2. **Yellow pickup route + Blue dropoff route**
   - Phase `to_pickup` → yellow (`#FACC15`) line + soft glow.
   - Phase `to_dropoff` → blue (`#2563EB`) line + soft glow.
   - Progressive fade: as the driver advances, the polyline is trimmed to start at the driver's snapped position. Implemented by recomputing the GeoJSON slice from nearest-point-on-line each location tick, so the remaining segment visually shortens in real time.
   - Smooth line-dasharray animation on idle for a "flowing" feel.

3. **Driver flow after accept**
   - On `accepted`/`enroute_pickup`, `DriverDashboard` opens an in-app full-screen `DriverLiveNav` (replaces external nav). Top card: "En Route To Pickup", rider name, ETA, distance.
   - Big animated **GO** button appears within arrival radius (≤80m). Tapping it sets ride to `in_progress`, swaps phase, route turns blue, target switches to dropoff.
   - Voice cues reuse existing `useVoiceNavigation`.

4. **Rider flow**
   - `RiderRideDetail` swaps current map for `LiveNavMap` in read-only mode showing the same yellow→blue progression, driver car icon, ETA, distance.
   - Floating glass **speed badge** (km/h) computed from successive `live_locations` deltas (Haversine / dt), smoothed with EMA.
   - Floating **3D direction arrow** (CSS 3D transform, tilts during bearing change) anchored bottom-right.

5. **Premium offer cards** (`OffersModal.tsx`)
   - Show: avatar, name, vehicle (make/model/color), plate, ⭐ rating, total trips, distance away, ETA. Glass card, rounded-2xl, subtle shadow, brand yellow accent.

6. **Book Ride for Someone Else**
   - New `BookForOtherSheet.tsx` opened from the request screen.
   - Uses Capacitor `@capacitor/contacts` on native (with permission prompt); falls back to the Web `navigator.contacts` Contact Picker API where supported, and a manual name+phone form everywhere else.
   - Fills existing `passenger_name` / `passenger_phone` fields on the ride.
   - Driver side: badge "Ride booked for another passenger" + call button on `RideRequestCard` / active trip card.

## Technical notes

- **Map provider**: Mapbox GL JS (already wired via `mapboxLoader` + `MapboxMap`). Google stays as background fallback only.
- **Route source**: existing `useOSRMRoute` for geometry; reuse `osrmSteps` for voice.
- **Polyline trimming**: turf.js `lineSlice` (add `@turf/turf` lite imports: `@turf/line-slice`, `@turf/nearest-point-on-line`, `@turf/helpers`).
- **Animation**: Mapbox `easeTo` for camera; `requestAnimationFrame` interpolation between GPS ticks for car marker.
- **Speed**: derived client-side from `useDriverTracking` deltas — no schema change.
- **No DB migration** required for this iteration (luggage already shipped; `passenger_name/phone` already exist).

## New / edited files

New:
- `src/components/map/LiveNavMap.tsx`
- `src/components/map/SpeedBadge.tsx`
- `src/components/map/DirectionArrow3D.tsx`
- `src/components/driver/DriverLiveNav.tsx` (wraps LiveNavMap + top card + GO button)
- `src/components/ride/BookForOtherSheet.tsx`
- `src/lib/routeProgress.ts` (lineSlice helper + EMA speed)

Edited:
- `src/pages/DriverDashboard.tsx` — open `DriverLiveNav` in-app instead of `openNavTo`.
- `src/pages/RiderRideDetail.tsx` — swap to `LiveNavMap` + SpeedBadge + DirectionArrow3D.
- `src/components/ride/RideView.tsx` — add "Book for someone else" button.
- `src/components/OffersModal.tsx` — premium offer card.
- `src/components/driver/RideRequestCard.tsx` — "Booked for another passenger" badge + call.

## Out of scope (call out)

- Map terrain/3D buildings tilt (can add later via Mapbox `setPitch`).
- Native iOS Contacts picker requires running on device — web preview will use manual fallback.
- No new tables, no RLS changes.
