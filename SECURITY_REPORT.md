# Security Audit Report — PickMe / Voyex
**Date:** 2026-05-27
**Auditor mode:** Authorized defensive review
**Scope:** Frontend (React/Vite), Supabase (DB + RLS + Edge Functions), storage buckets, wallet/ride/admin flows.

---

## 1. Threat model

| Actor | Capability against this app |
|---|---|
| Anonymous outsider | Hit any public REST endpoint, scrape bundle for API keys, brute-force OTP |
| Normal rider | Read/write their own data; try to read other riders' data, manipulate fare/wallet via direct REST |
| Driver | Accept rides, complete trips; try to fake completion, skip commission, read pre-trip PII |
| Fake / mass-created account | Spam ride requests, exploit promo/referral, drain wallet via duplicate transfers |
| Malicious admin (compromised) | Already trusted — mitigated by audit trail + role check from DB only |
| Modified APK / bot | Bypass client validation, spoof GPS, submit forged location/fare values |

---

## 2. Findings & fixes (this audit)

### 🔴 CRITICAL / ERROR — Riders could read raw national ID & registration number
- **Location:** `public.student_profiles` (cols `national_id_number`, `registration_number`)
- **Risk:** RLS allowed `auth.uid() = user_id` to SELECT the whole row, exposing national-ID-level PII to the client bundle. A compromised device or XSS would leak Zim national IDs.
- **Safe test:** As a logged-in student, `supabase.from('student_profiles').select('national_id_number')` — would return the value.
- **Fix applied:** Column-level `REVOKE SELECT (national_id_number, registration_number) ... FROM authenticated, anon`. Admin RPC `admin_list_student_profiles` (SECURITY DEFINER) still returns them server-side.
- **Expected result:** Client query now returns `null`/permission error for those columns; admin dashboard unaffected.

### 🟠 HIGH — Drivers could read passenger phone/name on pending rides
- **Location:** RLS policy `Drivers can view rides assigned to them` on `public.rides`
- **Risk:** `status = 'pending'` was in the allowed array. Any driver briefly assigned (or via race) could harvest `passenger_phone` and `passenger_name` before the trip began — useful for off-app contact / fraud.
- **Fix applied:** Policy rewritten to allow `accepted`, `in_progress`, `arrived`, `completed` only — never `pending`.
- **Expected result:** Driver only sees passenger contact info after they have actively accepted the trip.

### 🟠 HIGH — Drivers could read luggage descriptions/photos for ANY pending ride
- **Location:** RLS policy `Approved drivers view luggage for assigned rides` on `public.luggage_requests`
- **Risk:** The `OR r.status = 'pending'` branch meant every online driver could pull luggage descriptions + photo paths for every pending courier/freight request across the country. Exposes rider goods & enables targeted theft.
- **Fix applied:** Policy now requires the driver be the actually-assigned driver (`d.user_id = auth.uid()`).
- **Expected result:** Only the driver who took the job sees the luggage payload.

### 🟡 MEDIUM — OTP table reachable via PostgREST (already revoked, re-asserted)
- **Location:** `public.phone_verifications` (RLS-on, no policies; previously had default grants)
- **Fix:** Idempotent `REVOKE ALL ... FROM PUBLIC, anon, authenticated`; `GRANT ALL TO service_role` only. The `twilio-otp` edge function still works (uses service role).

### 🟠 OPERATIONAL (cannot fix from code) — Google Maps key in client bundle
- **Location:** `VITE_GOOGLE_MAPS_API_KEY` (must ship to browser for the JS SDK).
- **Risk:** Anyone can extract the key and bill your account.
- **Required action by you:** In Google Cloud Console → APIs & Services → Credentials → restrict key to HTTP referrers: `https://pickme.co.zw/*`, `https://*.voyex.site/*`, `https://*.lovable.app/*`, and your Capacitor bundle ID. Also restrict to only Maps JS, Places, Directions APIs.

---

## 3. Verified secure (no action required)

| Area | Why it's OK |
|---|---|
| **Service-role key** | Only present in edge functions (`Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')`), never in `src/`. |
| **Wallet RPCs** (`transfer_funds`, `pay_ride_from_wallet`, `complete_trip_with_commission`, `request_withdrawal`, `request_wallet_ride`) | All `SECURITY DEFINER` with internal `auth.uid()` checks, balance locks (`FOR UPDATE`), duplicate-detection windows, daily limits, fare derived server-side from `rides.fare` (not client). |
| **Admin gate** | `admin-api` edge function re-validates JWT then re-checks `user_roles` via service-role client. Frontend `has_role` cache is UX-only. |
| **`delete-account` fn** | Verifies `userId === user.id` before service-role delete. |
| **`wallet-pin` fn** | PBKDF2 100k iters + per-user salt, in-memory rate limit (5 attempts / 15-min lockout). |
| **Storage buckets** | All 6 buckets (`driver-documents`, `deposit-proofs`, `rider-deposit-proofs`, `driver-avatars`, `student-verification`, `luggage-photos`) are private; RLS scoped to `(storage.foldername(name))[1] = auth.uid()::text`. |
| **`dangerouslySetInnerHTML`** | Only in `src/components/ui/chart.tsx` (shadcn) with non-user-controlled config strings — no XSS sink. |
| **localStorage usage** | Only theme, locale, UI prefs, nav resume coords — no JWTs, no PINs, no balances. |
| **`request_wallet_ride`** | Forces `user_id := auth.uid()` and `payment_method := 'wallet'` server-side — client cannot inject another user. |
| **`complete_trip_with_commission`** | Auth gated to driver or rider of the ride; commission rounded server-side at 15%. Cannot be faked from client. |
| **`is_locked` wallets** | Auto-charge failure flips wallet to locked + fraud_flag → admin review. |
| **Rate limiting** | `public.check_rate_limit` available; PIN endpoint has dedicated brute-force lockout. |

---

## 4. Linter noise (intentional, ignored with rationale)

The 28 Supabase linter warnings remaining are all either:
- **`SECURITY DEFINER function callable by authenticated`** — required surface for wallet/ride/admin RPCs. Each function self-gates with `auth.uid()` and is covered by the CI guard `src/test/securityDefinerAllowlist.test.ts`.
- **`RLS enabled, no policy`** on `phone_verifications` & `wallet_pins` — intentional deny-by-default; only `service_role` (edge functions) is granted table access.

These are documented in `mem://technical/security/security-architecture`.

---

## 5. Remaining risks / recommendations before launch

1. **Restrict Google Maps key referrers** (only fix you must do in GCP console).
2. **Enable Supabase HIBP password check** if/when you add email-password auth (currently phone-only OTP, N/A).
3. **Add Sentry alerts** on `fraud_flags` insert with severity `high`/`critical` so admins are paged in real time.
4. **Periodic audit:** run `security--run_security_scan` after any RLS or new-table migration.
5. **GPS spoofing:** continue trusting the auto-resolve trigger that downgrades >2000 km/h flags as noise; consider server-side speed sanity check at trip end before paying out.
6. **APK signing:** ensure release builds use a hardware-backed key; reject unsigned builds in CI.
7. **Dependency scan:** run `npm audit` weekly; no high/critical found at audit time but the surface changes.

---

## 6. Migrations applied during this audit

1. `20260527160744_*.sql` — revoke EXECUTE on fraud-flag auto-resolve fns from anon/authenticated; revoke client grants on `phone_verifications` & `wallet_pins`.
2. `20260527161745_*.sql` — re-assertion / cleanup.
3. `20260527_*_security_hardening.sql` (this turn) — column REVOKE on student PII, tighter `luggage_requests` policy, tighter `rides` driver-SELECT policy.

---

**Posture after audit:** No known critical/high client-exploitable vulnerabilities remain. Single outstanding item is the Google Maps key referrer restriction, which is a Google Cloud Console action.
