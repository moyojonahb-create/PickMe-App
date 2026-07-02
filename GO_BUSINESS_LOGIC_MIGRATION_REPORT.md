# Go Business Logic Migration Report

Date: 2026-06-14

Scope: Frontend write migration for ride-adjacent business flows, ratings, disputes, emergency events, payments/tips, admin tables, pricing tables, notifications, and operational maintenance actions. Supabase remains in use for auth, storage, realtime subscriptions, and read paths where this pass did not request read migration.

## Executive Summary

Result: **PARTIAL MIGRATION COMPLETE**

The highest-risk direct frontend writes in the requested buckets now route through Go API calls instead of mutating Supabase tables from the browser.

Added a backend business-write surface in:

- `backend/internal/business/handler.go`

Registered it from:

- `backend/cmd/server/main.go`

Added a frontend adapter in:

- `src/lib/businessApi.ts`

The migrated frontend flows now call Go for:

- Driver ratings
- Ride disputes
- Emergency events
- Rider cancellation with fee recording
- Tips
- Fraud flags
- Ride stops
- Ride preferences
- Student discount usage
- User notification writes/read updates
- Admin promo writes
- Admin pricing writes
- Admin town pricing writes
- Admin trip cancellation
- Admin dispute status changes
- Admin driver status/document/student verification writes
- Admin landmark writes
- Admin system health log ingestion/resolution
- Admin stale GPS purge
- Admin ghost-driver/fatigue/stuck-ride maintenance actions

## New Go Endpoints

| Feature | Endpoint | Purpose |
|---|---|---|
| Driver rating | `POST /api/ratings/driver` | Insert `driver_ratings` using authenticated rider ID |
| Dispute create | `POST /api/disputes` | Insert `disputes` using authenticated reporter ID |
| Emergency event | `POST /api/emergency-events` | Insert `emergency_alerts` using authenticated user ID |
| Rider cancellation | `POST /api/rides/:rideId/cancel` | Record optional cancellation fee and cancel ride |
| Notification create | `POST /api/notifications` | Create in-app notification |
| Notification read | `POST /api/notifications/:id/read` | Mark one notification read for the authenticated user |
| Notifications read | `POST /api/notifications/read` | Mark many notifications read for the authenticated user |
| Tip | `POST /api/tips` | Insert tip using authenticated rider ID |
| Fraud flag | `POST /api/fraud-flags` | Insert fraud flag from frontend fraud detector |
| Ride stops | `POST /api/ride-stops` | Insert one or more ride stops |
| Ride preferences | `POST /api/ride-preferences` | Insert ride preference row |
| Student discount usage | `POST /api/student-discount-usage` | Record discount usage using authenticated user ID |
| Admin generic update | `PATCH /admin/business/:table/:id` | Allowlisted admin row update |
| Admin generic insert | `POST /admin/business/:table` | Allowlisted admin row insert |
| Admin generic delete | `DELETE /admin/business/:table/:id` | Allowlisted admin row delete |
| Admin cancel ride | `POST /admin/rides/:rideId/cancel` | Admin ride cancellation |
| Admin dispute status | `POST /admin/disputes/:id/status` | Update dispute status/admin response |
| Admin promo create | `POST /admin/promos` | Create promo code |
| Admin promo update | `PATCH /admin/promos/:id` | Update promo code |
| Admin promo delete | `DELETE /admin/promos/:id` | Delete promo code |
| Admin town pricing | `PATCH /admin/town-pricing/:id` | Update town pricing |
| Admin purge GPS | `POST /admin/live-locations/purge-stale` | Delete stale `live_locations` rows |
| Admin ghost drivers | `POST /admin/drivers/force-offline-ghosts` | Force stale online drivers offline |
| Admin stuck rides | `POST /admin/rides/cancel-stuck` | Cancel stale accepted rides |
| Admin fatigue break | `POST /admin/drivers/fatigue-break` | Force long-online drivers offline |
| Admin health ingest | `POST /admin/system-health/logs/ingest` | Archive old today logs and insert new scan rows |
| Admin health resolve | `POST /admin/system-health/logs/:id/resolve` | Mark system log resolved |

## Frontend Replacements

| Feature | Old Frontend Write | New Go API Call | Files |
|---|---|---|---|
| Driver rating | `driver_ratings.insert` | `submitDriverRating()` | `src/components/ride/DriverRatingModal.tsx` |
| Dispute create | `disputes.insert` | `submitDispute()` | `src/components/ride/DisputeForm.tsx` |
| Emergency alert | `emergency_alerts.insert` | `createEmergencyEvent()` | `src/components/ride/EmergencyButton.tsx` |
| Cancellation fee + ride cancel | `cancellation_fees.insert`, `rides.update` | `cancelRideWithPolicy()` | `src/components/ride/CancellationPolicy.tsx` |
| Tip | `tips.insert` | `createTip()` | `src/components/ride/TippingModal.tsx` |
| Ride stops | `ride_stops.insert` | `createRideStops()` | `src/components/ride/RideView.tsx` |
| Ride preferences | `ride_preferences.insert` | `createRidePreferences()` | `src/components/ride/RideView.tsx` |
| Student discount usage | `student_discount_usage.insert` | `createStudentDiscountUsage()` | `src/components/ride/RideView.tsx` |
| Passenger notification | `notifications.insert` | `createNotification()` | `src/components/ride/RideView.tsx` |
| Driver arrived notification | `notifications.insert` | `createNotification()` | `src/pages/DriverDashboard.tsx`, `src/components/driver/FullScreenNavigation.tsx` |
| Notification read state | `notifications.update` | `markNotificationRead()`, `markNotificationsRead()` | `src/components/NotificationCenter.tsx` |
| Fraud flag | `fraud_flags.insert` | `createFraudFlag()` | `src/lib/fraudDetection.ts` |
| Promo create/update/delete | `promo_codes.insert/update/delete` | `adminCreatePromo()`, `adminUpdatePromo()`, `adminDeletePromo()` | `src/pages/admin/AdminPromos.tsx` |
| Town pricing | `town_pricing.update` | `adminUpdateTownPricing()` | `src/pages/admin/AdminTownPricing.tsx` |
| Pricing settings | `pricing_settings.update` | `adminUpdateRow('pricing_settings')` | `src/hooks/usePricingSettings.ts` |
| Admin disputes | `disputes.update` | `adminUpdateDispute()` | `src/pages/admin/AdminDisputes.tsx` |
| Admin trip cancellation | `rides.update` | `adminCancelRide()` | `src/pages/admin/AdminTrips.tsx` |
| Admin driver status | `drivers.update` | `adminUpdateRow('drivers')` | `src/pages/admin/AdminDrivers.tsx`, `src/pages/admin/AdminDriverDetail.tsx` |
| Admin documents | `driver_documents.update` | `adminUpdateRow('driver_documents')` | `src/pages/admin/AdminDriverDetail.tsx` |
| Admin students | `student_profiles.update` | `adminUpdateRow('student_profiles')` | `src/pages/admin/AdminStudents.tsx` |
| Admin landmarks | `koloi_landmarks.insert/update/delete` | `adminInsertRow()`, `adminUpdateRow()`, `adminDeleteRow()` | `src/pages/admin/AdminLandmarks.tsx` |
| Admin health logs | `system_error_logs.insert/update` | `adminIngestSystemHealthLogs()`, `adminResolveSystemHealthLog()` | `src/pages/admin/AdminSystemHealth.tsx` |
| Admin stale GPS purge | `live_locations.delete` | `adminPurgeStaleLiveLocations()` | `src/components/admin/LoadPulsePanel.tsx`, `src/lib/ramzActions.ts` |
| Admin maintenance actions | `drivers.update`, `rides.update`, `driver_sessions.update`, `notifications.insert` | Go admin maintenance endpoints | `src/lib/ramzActions.ts` |

## Remaining Direct Frontend Writes

The requested buckets are migrated, but the repository still has direct frontend writes outside this pass:

- Auth/profile writes: `profiles`, rider settings, profile avatar, phone updates.
- Favorites and personal settings: `favorite_locations`, rider preferences settings.
- Chat and call signaling: `messages`, Agora/WebRTC call tables.
- Driver onboarding/self-service: `drivers`, `driver_documents`, `driver_feedback`, driver avatar/settings/application wizard.
- Local/admin tooling: `ramz_patch_audit`, `places_cache`, test-only wallet RLS probes.
- Existing non-wallet RPCs remain: `expire_old_rides`, `cleanup_old_messages`, `auto_resolve_noise_fraud_flags`, `update_demand_zones`, `can_driver_operate`, `is_top_driver`.

These should be migrated in a follow-up pass if the strict rule is "no browser Supabase writes at all."

## Security Notes

- Admin endpoints check `public.user_roles` for `role = 'admin'`.
- Generic admin mutation endpoints are table-allowlisted and validate SQL identifiers before generating update/insert statements.
- User-owned endpoints derive sensitive user IDs from the JWT where possible: ratings, disputes, emergency events, tips, and student discount usage.
- Ride cancellation now runs fee insert and ride update in one backend transaction.

Remaining hardening needed:

- Add route-level ownership checks for notification creation, ride stops, ride preferences, and fraud-flag submission.
- Replace generic admin mutation helpers with narrower service methods before production.
- Add idempotency keys for tips, cancellations, dispute creation, and ratings.
- Add backend tests for the new business handlers.

## Verification

Backend:

```text
cd backend
go test ./...
PASS
```

Frontend typecheck:

```text
npx tsc --noEmit -p tsconfig.app.json
PASS
```

## Verdict

The main ride/payment/admin/pricing write paths requested in this pass now go through Go. Supabase is still used by the frontend for reads, auth, storage, realtime subscriptions, and several out-of-scope personal/profile/driver-onboarding writes.
