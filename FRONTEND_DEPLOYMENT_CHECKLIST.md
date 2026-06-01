# PickMe Frontend Deployment Checklist

Date: 2026-06-01

Use this checklist for the production release candidate that targets Go Core V1.

## 1. Environment

- [ ] Node version is 20 or 22.
- [ ] `npm ci` completed from a clean checkout.
- [ ] `VITE_API_URL` points to the Go Core V1 HTTPS API.
- [ ] `VITE_WS_URL` points to the Go Core V1 websocket endpoint.
- [ ] Supabase project URL and anon key point to production or staging as intended.
- [ ] Google/Mapbox keys are configured for the target environment.
- [ ] Sentry DSN is configured.
- [ ] Sentry auth token is configured if release creation and sourcemap upload are required.
- [ ] Capacitor production config points to the same release environment.

## 2. Build Gates

- [ ] `npm run build` passes.
- [ ] No TypeScript/Vite hard errors.
- [ ] Large chunk warnings reviewed and accepted for this release.
- [ ] Tailwind ambiguous class warning reviewed and accepted or fixed.
- [ ] Sentry sourcemap warning accepted or fixed by providing auth token.
- [ ] `dist/` generated from the intended commit.

## 3. Go API Command Verification

- [ ] Rider request ride calls `POST /api/rides`.
- [ ] Driver online/offline calls `POST /api/drivers/me/presence`.
- [ ] Driver offer calls `POST /api/rides/:rideId/offers`.
- [ ] Rider accept offer calls `POST /api/rides/:rideId/offers/:offerId/accept`.
- [ ] Driver status changes call `POST /api/rides/:rideId/status`.
- [ ] Rider/admin cancellation calls `POST /api/rides/:rideId/cancel`.
- [ ] Rider fare adjustment calls `POST /api/rides/:rideId/fare`.
- [ ] Driver completion calls `POST /api/rides/:rideId/complete`.
- [ ] Settlement calls `POST /api/rides/:rideId/settle`.
- [ ] Driver HTTP location fallback calls `POST /api/drivers/me/location`.

## 4. WebSocket Verification

- [ ] Authenticated websocket opens with Supabase JWT token.
- [ ] `join_ride` is sent when rider opens active ride detail.
- [ ] `join_ride` is sent when public tracking opens a trip.
- [ ] Rooms rejoin after network disconnect/reconnect.
- [ ] Token refresh happens before reconnect after auth token expiry.
- [ ] Heartbeat sends `ping`.
- [ ] Backend responds with `pong`.
- [ ] Client closes and reconnects when `pong` is missing.
- [ ] Send queue flushes after reconnect.
- [ ] `SIGNED_OUT` closes websocket.

## 5. Canonical Event E2E

- [ ] Driver receives `ride_offer`.
- [ ] Rider receives `ride_offer`.
- [ ] Rider accepts offer and both sides receive `ride_accepted`.
- [ ] Driver starts ride and rider receives `ride_started`.
- [ ] Driver sends `driver_location`.
- [ ] Rider receives `driver_location` and map marker updates.
- [ ] Driver completes ride and rider receives `ride_completed`.

## 6. Rider Flow

- [ ] Rider can log in.
- [ ] Rider can request a ride.
- [ ] Rider is routed to `/ride/:rideId`.
- [ ] `/ride/:rideId` renders Go-event-backed rider detail screen.
- [ ] Rider can view driver offers.
- [ ] Rider can accept an offer.
- [ ] Rider can cancel before pickup through Go.
- [ ] Rider can adjust fare before acceptance through Go.
- [ ] Rider sees driver location during accepted/in-progress trip.
- [ ] Rider sees completed state and rating prompt.

## 7. Driver Flow

- [ ] Driver can log in.
- [ ] Approved driver can go online through Go presence endpoint.
- [ ] Driver receives dispatch/offer opportunity.
- [ ] Driver can submit offer through Go.
- [ ] Driver sees active trip after rider acceptance.
- [ ] Driver can update status to enroute/arrived/in-progress through Go.
- [ ] Driver location sends `driver_location` over websocket.
- [ ] Driver can complete ride through Go.
- [ ] Driver wallet/earnings refresh after completion.

## 8. Negative Cases

- [ ] Expired offer cannot be accepted.
- [ ] Duplicate offer submission is rejected or idempotently handled by Go.
- [ ] Offline driver cannot update status.
- [ ] Rider cannot cancel a completed ride.
- [ ] Backend 401 forces re-auth or recoverable auth error.
- [ ] Backend 403 shows permission error.
- [ ] Backend conflict shows refresh/retry path.
- [ ] Websocket disconnect shows no false success state.

## 9. Mobile / Capacitor

- [ ] Android build uses production web assets.
- [ ] App launches on Android device/emulator.
- [ ] Location permission prompt works.
- [ ] Background/resume reconnects websocket.
- [ ] Background/resume refreshes JWT if needed.
- [ ] Driver GPS resumes after app foreground.
- [ ] Android network handoff Wi-Fi/mobile data does not strand active trip.
- [ ] Safe-area layout verified on common Android screen sizes.

## 10. Observability

- [ ] Backend command failures are visible in Sentry or equivalent logs.
- [ ] Websocket connection state is observable in logs/telemetry.
- [ ] Client build/release version is attached to error events.
- [ ] Sentry sourcemaps are uploaded for production, or release accepts minified stack traces.
- [ ] Admin/system health dashboards are read-only for ride lifecycle decisioning.

## 11. Rollback

- [ ] Previous frontend artifact is available.
- [ ] API compatibility with current Go Core V1 confirmed.
- [ ] Feature flags or redirects can disable legacy negotiation routes.
- [ ] Support team has known-issue script for websocket reconnect and ride status conflicts.
- [ ] Release owner and rollback owner are named.

## Final Gate

- [ ] Release owner signs frontend.
- [ ] Backend owner signs Go Core V1 staging compatibility.
- [ ] QA signs rider/driver E2E.
- [ ] Operations signs monitoring and rollback.

