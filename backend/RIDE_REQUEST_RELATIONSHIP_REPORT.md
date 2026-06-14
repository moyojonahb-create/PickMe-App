# Ride Request Relationship Report

## Scope

This report uses production schema evidence only. No backend code, frontend code, wallets, or migrations were changed.

Objects inspected:

```text
public.rides
app.ride_requests
app.ride_offers
app.rides
```

The current Go backend source was also searched for SQL touching `rides` and `ride_requests`.

## Executive Summary

The runtime failure is caused by an incorrect relationship assumption.

`app.ride_offers.request_id` does **not** reference `public.rides.id`.

It references:

```text
app.ride_requests(id)
```

Production data currently shows:

```text
public.rides row count:       9
app.ride_requests row count:  0
app.ride_offers row count:    0
matching public.rides.id = app.ride_requests.id: 0
public.rides rows without matching app.ride_requests: 9
```

There is no foreign key between `public.rides` and `app.ride_requests`, and no trigger/rule was found that automatically creates an `app.ride_requests` row from a `public.rides` row.

## Exact Schema Relationships

### `public.rides`

Columns discovered:

```text
id uuid primary key default gen_random_uuid()
rider_id uuid not null
driver_id uuid nullable
pickup_location text nullable
dropoff_location text nullable
estimated_fare numeric not null
final_fare numeric nullable
payment_method text not null
payment_status text nullable default 'pending'
ride_status text nullable default 'requested'
created_at timestamptz nullable default now()
started_at timestamp nullable
completed_at timestamp nullable
```

Constraints:

```text
rides_pkey:
  PRIMARY KEY (id)

rides_rider_id_fkey:
  FOREIGN KEY (rider_id) REFERENCES auth.users(id)

rides_driver_id_fkey:
  FOREIGN KEY (driver_id) REFERENCES auth.users(id)

rides_payment_method_check:
  CHECK payment_method IN ('cash', 'wallet')
```

Trigger:

```text
auto_payment_after_ride_complete:
  AFTER UPDATE ON public.rides
  EXECUTE FUNCTION trigger_auto_payment_on_complete()
```

No FK from `public.rides` to `app.ride_requests` was found.

### `app.ride_requests`

Columns discovered:

```text
id uuid primary key default gen_random_uuid()
rider_id uuid not null
pickup_name text nullable
pickup_lat double precision not null
pickup_lng double precision not null
dropoff_name text nullable
dropoff_lat double precision nullable
dropoff_lng double precision nullable
suggested_fare numeric nullable
status text not null default 'open'
assigned_driver_id uuid nullable
created_at timestamptz not null default now()
fare_amount numeric nullable
fare_currency text nullable default 'USD'
fare_usd numeric nullable
platform_fee_usd numeric nullable
fx_usd_per_zar numeric nullable
fx_zar_per_usd numeric nullable
expires_at timestamptz nullable
pickup_address text nullable
dropoff_address text nullable
```

Constraints:

```text
ride_requests_pkey:
  PRIMARY KEY (id)

ride_requests_rider_id_fkey:
  FOREIGN KEY (rider_id) REFERENCES app.profiles(id) ON DELETE CASCADE

ride_requests_assigned_driver_id_fkey:
  FOREIGN KEY (assigned_driver_id) REFERENCES app.profiles(id)

ride_requests_status_check:
  CHECK status IN ('open', 'assigned', 'cancelled', 'completed')

ride_requests_fare_currency_check:
  CHECK fare_currency IN ('USD', 'ZAR')
```

Indexes:

```text
ride_requests_pkey ON app.ride_requests(id)
ride_requests_rider_idx ON app.ride_requests(rider_id)
ride_requests_status_idx ON app.ride_requests(status)
ride_requests_status_created_idx ON app.ride_requests(status, created_at DESC)
ride_requests_pickup_idx ON app.ride_requests(pickup_lat, pickup_lng)
```

No trigger or rule was found on `app.ride_requests`.

### `app.ride_offers`

Relevant columns discovered:

```text
id uuid primary key default gen_random_uuid()
request_id uuid not null
driver_id uuid not null
offer_price numeric not null
status text not null default 'sent'
created_at timestamptz not null default now()
ride_request_id uuid nullable
offered_fare numeric nullable
eta_minutes integer nullable
expires_at timestamptz nullable default now() + interval '2 minutes'
accepted_at timestamptz nullable
declined_at timestamptz nullable
```

Constraints:

```text
ride_offers_request_id_fkey:
  FOREIGN KEY (request_id) REFERENCES app.ride_requests(id) ON DELETE CASCADE

ride_offers_driver_id_fkey:
  FOREIGN KEY (driver_id) REFERENCES app.profiles(id) ON DELETE CASCADE

ride_offers_request_id_driver_id_key:
  UNIQUE (request_id, driver_id)

ride_offers_status_check:
  CHECK status IN ('pending', 'accepted', 'declined', 'expired', 'cancelled')
```

Trigger:

```text
trg_ride_offers_updated:
  BEFORE UPDATE ON app.ride_offers
  EXECUTE FUNCTION set_updated_at()
```

Important: `ride_request_id` exists but is nullable and does not appear in the discovered FK constraints. The enforced canonical FK is `request_id -> app.ride_requests(id)`.

### `app.rides`

Production also contains a separate `app.rides` table.

Relevant columns:

```text
id uuid primary key
rider_id uuid not null
driver_id uuid nullable
pickup_latitude numeric not null
pickup_longitude numeric not null
dropoff_latitude numeric not null
dropoff_longitude numeric not null
pickup_address text not null
dropoff_address text not null
status text not null default 'requested'
estimated_fare numeric nullable
actual_fare numeric nullable
created_at timestamp nullable default now()
started_at timestamp nullable
completed_at timestamp nullable
cancelled_at timestamp nullable
accepted_driver_id uuid nullable
```

Constraints:

```text
rides_rider_id_fkey:
  FOREIGN KEY (rider_id) REFERENCES app.users(id) ON DELETE CASCADE

rides_driver_id_fkey:
  FOREIGN KEY (driver_id) REFERENCES app.users(id) ON DELETE SET NULL

rides_accepted_driver_id_fkey:
  FOREIGN KEY (accepted_driver_id) REFERENCES auth.users(id)

rides_status_check:
  CHECK status IN ('requested', 'accepted', 'started', 'completed', 'cancelled')
```

Trigger:

```text
trg_ride_completed:
  AFTER UPDATE ON app.rides
  EXECUTE FUNCTION on_ride_completed()
```

Current Go backend does not write `app.rides`.

## Source SQL Findings

Go backend SQL touches:

```text
public.rides
app.ride_offers
driver_sessions
driver_locations
```

Go backend SQL does not touch:

```text
app.ride_requests
app.rides
```

Current ride creation flow inserts only into:

```text
public.rides
```

Current offer submit flow attempts to insert into:

```text
app.ride_offers
```

with:

```text
request_id = public.rides.id
ride_request_id = public.rides.id
```

That is invalid for `request_id`.

## Answers To Required Questions

### 1. How is `app.ride_requests` populated?

From production schema evidence and current source:

```text
Not by the current Go backend.
```

Evidence:

- No Go SQL references `app.ride_requests`.
- No trigger/rule was found on `public.rides` that inserts into `app.ride_requests`.
- No trigger/rule was found on `app.ride_requests`.
- Current row count is `0`.

Therefore, `app.ride_requests` is currently not being populated by this backend.

### 2. Should every `public.rides` row have a matching `app.ride_requests` row?

Production evidence says:

```text
No enforced relationship exists today.
```

Evidence:

```text
public.rides rows: 9
app.ride_requests rows: 0
matching IDs: 0
public.rides rows without matching app.ride_requests: 9
```

There is no FK or trigger enforcing a one-to-one relationship.

Architecturally, if `app.ride_offers` is canonical for offers, each offerable ride request must have a valid `app.ride_requests.id`. That does not mean every historical `public.rides` row currently has one.

### 3. Does `public.rides` contain a foreign key to `app.ride_requests`?

```text
No.
```

Discovered `public.rides` FKs:

```text
rider_id -> auth.users(id)
driver_id -> auth.users(id)
```

No `public.rides` column references `app.ride_requests(id)`.

### 4. Should ride creation create both rows?

For the current Go contract to support `app.ride_offers`, yes, ride creation needs a backend-owned way to produce a valid `app.ride_requests.id`.

However, current `POST /api/rides` payload and `public.rides` schema are text-location oriented:

```text
pickup_location text
dropoff_location text
```

`app.ride_requests` requires:

```text
pickup_lat double precision NOT NULL
pickup_lng double precision NOT NULL
```

So the backend cannot safely create `app.ride_requests` from the current ride creation payload unless it receives or derives coordinates.

### 5. Is `app.ride_requests` the true source of ride requests and `public.rides` only the trip lifecycle table?

Schema evidence suggests `app.ride_requests` is the true source for the offer marketplace:

- `app.ride_offers.request_id` is a required FK to `app.ride_requests(id)`.
- `app.ride_requests` has request/open/assignment semantics:
  - `status IN ('open', 'assigned', 'cancelled', 'completed')`
  - `assigned_driver_id`
  - fare quote fields
  - pickup/dropoff coordinates
  - expiry

But current Go runtime treats `public.rides` as both request and lifecycle table:

- `public.rides.ride_status = 'requested'`
- ride creation inserts `public.rides`
- offer routes receive `rideId` from `public.rides`
- accept updates `public.rides.driver_id` and `ride_status`

Therefore the system is currently split:

```text
Schema offer model: app.ride_requests -> app.ride_offers
Current Go model:   public.rides -> app.ride_offers
```

That split is the root of the runtime FK failure.

## Table Ownership

Recommended ownership based on current architecture rule:

| Table | Storage Owner | Business Logic Owner | Current Go Usage | Notes |
|---|---|---|---|---|
| `app.ride_requests` | Supabase | Go should own request/matching decisions | Not used | Required parent for `app.ride_offers.request_id`. |
| `app.ride_offers` | Supabase | Go owns offer lifecycle and race control | Used by Phase B1 | Must use valid `request_id`. |
| `public.rides` | Supabase | Go currently owns lifecycle | Heavily used | No FK to `app.ride_requests`; current trip lifecycle table in Go. |
| `app.rides` | Supabase | Unknown/not currently Go-owned | Not used | Separate app lifecycle table exists; not part of current Go flow. |

## Correct `request_id` Mapping For `app.ride_offers`

Correct:

```text
app.ride_offers.request_id = app.ride_requests.id
```

Current incorrect mapping:

```text
app.ride_offers.request_id = public.rides.id
```

`app.ride_offers.ride_request_id` is nullable and not the enforced FK. It may be populated for compatibility, but it cannot replace `request_id`.

## Recommended Backend Fix

Recommended Phase B1 correction:

1. Stop writing `public.rides.id` into `app.ride_offers.request_id`.
2. Introduce an internal resolver for offer routes:

```text
Go route rideId -> canonical app.ride_requests.id
```

3. Because no relationship currently exists, the backend must choose one of these explicit strategies:

### Preferred Strategy

Make `POST /api/rides` create the canonical request row in `app.ride_requests` and the lifecycle row in `public.rides` with the same generated UUID.

Then:

```text
public.rides.id = app.ride_requests.id
app.ride_offers.request_id = app.ride_requests.id
app.ride_offers.ride_request_id = app.ride_requests.id
```

This preserves the frontend route shape while making the ID valid for the offer FK.

Blocking detail: current API must provide or derive `pickup_lat` and `pickup_lng`, because `app.ride_requests` requires them.

### Minimal Safe Runtime Strategy

For `POST /api/rides/:rideId/offers`, first require that:

```sql
SELECT id FROM app.ride_requests WHERE id = $1
```

exists.

If it does not exist, return a conflict-style error instead of inserting an invalid FK:

```text
409 Ride request is not offerable
```

This prevents 500s but does not make current `public.rides`-only rides offerable.

### Not Recommended

Do not write to `app.ride_offers.request_id` with `public.rides.id`.

Do not write offers only using nullable `ride_request_id`; the unique constraint and FK are on `request_id`.

Do not add migrations or new linking tables as part of this fix unless explicitly starting a schema phase.

## Final Classification

```text
Relationship status: BROKEN for current Go offer flow
Schema source of offer parent: app.ride_requests
Current Go ride source: public.rides
Required fix: backend must resolve or create app.ride_requests.id before inserting app.ride_offers
```

No code was modified. No migrations were created. Frontend was not touched.
