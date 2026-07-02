# Frontend Supabase Write Migration V2 Report

Date: 2026-06-15

Scope: Migrated the next batch of remaining frontend Supabase table writes behind Go API endpoints. Frontend UX and API contracts were preserved where possible. Supabase remains in frontend use for auth session reads, storage uploads/signed URLs, realtime subscriptions, and read-only queries.

## Executive Summary

Result: **MIGRATION COMPLETE FOR TARGETED WRITE BATCH**

The targeted browser-side writes for driver onboarding, driver documents, driver feedback, driver settings/avatar metadata, profiles, rider settings/preferences, favorite locations, ride messages, call sessions, fatigue break writes, places cache, and Ramz audit inserts now route through Go.

Final scan:

```text
rg -n "\.(insert|update|upsert|delete)\(" src --glob "!src/test/**"
```

Remaining matches are local/client state only: JavaScript `Map.delete`, IndexedDB offline queue deletion, UI overlay updates, toast timeout cleanup, and similar non-Supabase operations. No remaining active Supabase table `.insert`, `.update`, `.upsert`, or `.delete` calls were found in `src/`.

## Classification

| Area | Files | Classification | Result |
|---|---|---|---|
| Driver onboarding | `DriverApplicationForm.tsx`, `DriverRegistrationWizard.tsx`, `DriverReviewForm.tsx` | Migrate now | Migrated to Go |
| Driver documents | `DocumentUpload.tsx`, `DriverRegistrationWizard.tsx` | Storage allowed, DB write migrate now | Storage kept; metadata writes migrated |
| Driver avatar/settings | `DriverAvatarUpload.tsx`, `DriverSettingsPanel.tsx` | Storage allowed, DB write migrate now | Migrated metadata/settings writes |
| Driver feedback | `DriverFeedback.tsx` | Migrate now | Migrated to Go |
| Profiles | `AuthForm.tsx`, `Auth.tsx`, `Signup.tsx`, `EditProfile.tsx`, `RiderProfile.tsx` | Auth allowed, DB write migrate now | Migrated profile writes |
| Rider settings/preferences | `RiderSettingsPanel.tsx`, `RiderPreferencesSettings.tsx` | Migrate now | Migrated to Go |
| Favorite locations | `FavoritesSheet.tsx`, `RiderRideDetail.tsx` | Migrate now | Migrated create/delete |
| Chat messages | `RideCommunication.tsx`, `RideDetail.tsx` | Realtime/read allowed, DB write migrate now | Migrated message sends |
| Call signaling | `useAgoraCall.ts`, `useWebRTCCall.ts` | Realtime/broadcast allowed, DB write migrate now | Migrated `call_sessions` create/update |
| Driver fatigue sessions | `useFatigueMonitor.ts` | Migrate now | Migrated forced-break insert |
| Places cache | `placeCache.ts` | Dev/cache write | Migrated cache insert to Go; read cache remains frontend read-only |
| Ramz audit | `ramzAudit.ts` | Dev/admin write | Migrated inserts to admin Go endpoint |
| Supabase storage | Driver documents, avatars | Acceptable Supabase storage usage | Left unchanged |
| Supabase auth | Sign-up/session/update metadata | Acceptable auth usage | Left unchanged |
| Supabase realtime | Ride messages/calls/tracking subscriptions | Realtime read/subscription | Left unchanged |

## New Go Endpoints

| Endpoint | Purpose |
|---|---|
| `POST /api/drivers/applications` | Create authenticated driver application |
| `POST /api/drivers/applications/upsert` | Upsert authenticated profile and driver application |
| `POST /api/drivers/documents` | Create driver document metadata after storage upload |
| `PATCH /api/drivers/me` | Update authenticated driver-owned settings/avatar metadata |
| `POST /api/drivers/feedback` | Create authenticated driver feedback |
| `PATCH /api/profiles/me` | Upsert authenticated user profile fields |
| `PATCH /api/profiles/me/avatar` | Update authenticated profile avatar path |
| `POST /api/user-settings` | Upsert authenticated rider notification settings |
| `PATCH /api/rider-preferences` | Update authenticated rider preference fields |
| `POST /api/favorite-locations` | Create authenticated favorite location |
| `DELETE /api/favorite-locations/:id` | Delete authenticated user-owned favorite |
| `POST /api/messages` | Create ride message with sender from JWT |
| `POST /api/call-sessions` | Create call session with caller from JWT |
| `PATCH /api/call-sessions/:id` | Update call session status for caller/callee |
| `POST /api/driver-sessions/fatigue-break` | Record authenticated driver fatigue break |
| `POST /api/dev/places-cache` | Best-effort places cache insert |
| `POST /admin/ramz-audit` | Admin-only Ramz patch audit insert |

## Frontend Adapter

Added functions to `src/lib/businessApi.ts` for all new writes. Existing UI components now call the adapter instead of mutating Supabase tables directly.

## Files Changed

Backend:

- `backend/internal/business/handler.go`
- `backend/internal/business/handler_test.go`

Frontend:

- `src/lib/businessApi.ts`
- `src/components/driver/DriverApplicationForm.tsx`
- `src/components/driver/DriverRegistrationWizard.tsx`
- `src/components/driver/DocumentUpload.tsx`
- `src/components/driver/DriverReviewForm.tsx`
- `src/components/driver/DriverAvatarUpload.tsx`
- `src/components/driver/DriverFeedback.tsx`
- `src/components/settings/DriverSettingsPanel.tsx`
- `src/components/settings/RiderSettingsPanel.tsx`
- `src/components/settings/RiderPreferencesSettings.tsx`
- `src/components/FavoritesSheet.tsx`
- `src/components/auth/AuthForm.tsx`
- `src/components/ride/RideCommunication.tsx`
- `src/hooks/useAgoraCall.ts`
- `src/hooks/useWebRTCCall.ts`
- `src/hooks/useFatigueMonitor.ts`
- `src/lib/placeCache.ts`
- `src/lib/ramzAudit.ts`
- `src/pages/Auth.tsx`
- `src/pages/Signup.tsx`
- `src/pages/EditProfile.tsx`
- `src/pages/RiderProfile.tsx`
- `src/pages/RiderRideDetail.tsx`
- `src/pages/RideDetail.tsx`

## Verification

Backend:

```text
cd backend
go test ./...
PASS
```

Frontend:

```text
npx tsc --noEmit -p tsconfig.app.json
PASS
```

## Remaining Notes

- Supabase read-only queries remain in the frontend and are intentionally outside this write-migration pass.
- Supabase Storage uploads and signed URLs remain in the frontend by architecture rule.
- Supabase Realtime subscriptions remain for chat/calls/tracking until the Go realtime layer fully replaces those consumers.
- Existing Supabase RPC calls such as `expire_old_rides`, `update_demand_zones`, `can_driver_operate`, and `is_top_driver` are not table writes and were not migrated in this pass.
- The new backend route tests validate registration/auth/input behavior. Postgres-backed integration tests should still be added for ownership and successful insert/update paths before production.

