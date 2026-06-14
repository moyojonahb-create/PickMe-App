# Phase B1 Schema Verification

## Inspection scope

- All runtime SQL touching `public.active_driver_offers` was inspected in the repo.
- The only code path with actual SQL touching `public.active_driver_offers` is `internal/rides/handler.go`.
- Test files reference `public.active_driver_offers`, but they do not introduce additional runtime schema assumptions beyond the handler SQL.

## SQL references to `public.active_driver_offers`

1. `SubmitOffer`
   - `INSERT INTO public.active_driver_offers (id, ride_id, driver_id, status, expires_at, created_at, updated_at)`

2. `ListOffers`
   - `SELECT id, driver_id, status, expires_at, created_at, updated_at FROM public.active_driver_offers WHERE ride_id = $1 AND status = 'pending' AND expires_at > NOW()`

3. `RejectOffer`
   - `UPDATE public.active_driver_offers SET status = 'rejected', updated_at = NOW() WHERE id = $1 AND ride_id = $2 AND driver_id = $3 AND status = 'pending'`

4. `acceptOffer` / `AcceptOffer`
   - `SELECT id, ride_id, driver_id, status, expires_at FROM public.active_driver_offers WHERE id = $1`
   - `UPDATE public.active_driver_offers SET status = 'accepted', updated_at = NOW() WHERE id = $1 AND status = 'pending' AND expires_at > NOW()`
   - `UPDATE public.active_driver_offers SET status = 'expired', updated_at = NOW() WHERE ride_id = $1 AND status = 'pending'`

## Columns referenced by code

- `id`
- `ride_id`
- `driver_id`
- `status`
- `expires_at`
- `created_at`
- `updated_at`

## Production schema provided for `active_driver_offers`

- `id`
- `ride_request_id`
- `driver_id`
- `amount`
- `currency`
- `created_at`
- `expires_at`

## Verification results

- `active_driver_offers` in code uses `ride_id`; production schema uses `ride_request_id`.
- `status` is referenced in code but is absent from the provided production schema.
- `updated_at` is referenced in code but is absent from the provided production schema.
- The code also assumes a `ride_id` foreign key, which does not exist in the provided production schema.
- The production schema contains `amount` and `currency`, which the code does not reference.

## Conclusion

- The current implementation is not schema-aligned with production.
- A migration is required to align `public.active_driver_offers` with the code's runtime expectations.

## Classification

- `NEEDS MIGRATION`

## Notes

- If the production table is intentionally named `ride_request_id` rather than `ride_id`, the code must either be changed to use `ride_request_id` or the schema must be migrated/aliased accordingly.
- The mismatch is structural: the code expects an offer-state model (`status`, `updated_at`, `ride_id`) that is not present in the supplied production schema.
- No wallet work is included in this verification.
