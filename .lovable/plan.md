# Luggage Feature — Implementation Plan

A premium "Luggage" add-on for rides. Riders attach a description + up to 5 photos to a ride; drivers see this before accepting and can either accept the original fare, propose a higher fare, or decline. Rider gets a popup to accept/decline the new fare.

Branding: yellow pill button + badges (luggage), blue stays primary ride color.

---

## 1. Database (one migration)

**Table `luggage_requests`**
- `id uuid pk`
- `ride_id uuid` (nullable until ride is created — we attach by ride_id after insert)
- `rider_id uuid not null`
- `description text`
- `image_paths text[]` (storage paths, not public URLs)
- `estimated_weight text` (small / medium / large / xl)
- `item_count int`
- `created_at timestamptz default now()`

**Table `fare_adjustments`**
- `id uuid pk`
- `ride_id uuid not null`
- `driver_id uuid not null`
- `old_price numeric`
- `new_price numeric`
- `reason text`
- `status text` ('pending' | 'accepted' | 'declined') default 'pending'
- `created_at`, `updated_at`

**Storage bucket `luggage-photos`** (private). RLS:
- Rider can insert/select their own folder (`{user_id}/...`).
- Drivers with role `driver` AND assigned/eligible to the ride can SELECT via signed URLs (we'll generate signed URLs server-side on demand from rider-trusted reads; for simplicity, allow authenticated drivers who have an approved `drivers` row to read the bucket — moderation later).

**RLS**
- `luggage_requests`: rider can insert/select own; approved drivers can select rows whose `ride_id` is in `pending` or assigned to them.
- `fare_adjustments`: driver inserts own; rider/driver of the ride can select; rider updates status.

**Realtime**: add both tables to `supabase_realtime` publication.

---

## 2. Rider UI

- New `LuggageButton` (yellow rounded pill, luggage icon) shown on ride request screens (`AppDashboard` ride flow + `RiderRequestScreen` for negotiate). 
- `LuggageSheet` bottom sheet (Framer Motion):
  - Textarea description (placeholder example).
  - Weight chips (Small / Medium / Large / XL).
  - Item count stepper.
  - Image grid: up to 5; camera/gallery via `<input capture>`; client-side compression via existing `src/lib/imageCompression.ts`; drag to remove.
  - Save button → stores draft in local state (attached on ride request) OR upserts `luggage_requests` if ride exists.
- Yellow "Luggage (N)" badge near pickup/destination once configured.
- On `RiderRideDetail`, listen for `fare_adjustments` realtime → modal "Driver adjusted fare due to luggage size. $X → $Y" with Accept/Decline; on accept update ride `fare`, set adjustment `accepted`; decline cancels ride or sets `declined`.

## 3. Driver UI

- In `OffersModal` / driver ride card: if luggage exists show yellow "🧳 Luggage (3 photos)" badge + description preview.
- Tap → `LuggagePreviewSheet`: shows description, weight, count, image gallery (signed URLs, zoomable).
- Action buttons: **Accept**, **Adjust fare** (number input + reason), **Decline**.
- Adjust → insert `fare_adjustments` row; wait for rider response (realtime).

## 4. Signed image URLs

Helper `getLuggageSignedUrls(paths: string[])` using `supabase.storage.from('luggage-photos').createSignedUrls(paths, 600)`. Called by driver sheet only.

## 5. Files to add/change

**New**
- `src/components/luggage/LuggageButton.tsx`
- `src/components/luggage/LuggageSheet.tsx`
- `src/components/luggage/LuggagePreviewSheet.tsx`
- `src/components/luggage/FareAdjustmentModal.tsx` (rider-side popup)
- `src/hooks/useLuggageRequest.ts` (create/update/fetch by ride_id)
- `src/hooks/useFareAdjustments.ts` (realtime subscribe)
- `src/lib/luggageStorage.ts` (upload + signed URL helpers)

**Edited**
- `src/pages/AppDashboard.tsx` — add LuggageButton to ride flow, pass luggage draft into ride creation.
- `src/pages/negotiate/RiderRequestScreen.tsx` — add LuggageButton.
- `src/pages/RiderRideDetail.tsx` — luggage badge + fare-adjustment modal.
- `src/components/OffersModal.tsx` (and/or driver dashboard offer card) — luggage badge + open preview sheet + adjust-fare action.

## 6. Out of scope (noted for later)

- AI image moderation / prohibited-item detection — placeholder hook only.
- Vehicle-suitability auto-recommendation (just shows weight category for now).
- Image reordering (drag) — basic remove only.

---

After approval I'll run the migration first (separate call), then implement files in parallel.
