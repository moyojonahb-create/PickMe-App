-- Rider emergency contact — surfaced on the in-trip Safety sheet (4l).
-- No dedicated table needed: this is a single name/phone pair per rider,
-- same cardinality as the other per-rider preference fields already on
-- public.profiles (quiet_ride, gender_preference, etc.). Existing RLS on
-- profiles already scopes reads/writes to the owning user, so no new
-- policy is needed for these columns.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS emergency_contact_name text,
  ADD COLUMN IF NOT EXISTS emergency_contact_phone text;
