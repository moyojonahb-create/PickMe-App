# PickMe Monorepo

This repository now contains the PickMe frontend app at the root and the Go backend in `backend/`.

## Run Locally

Frontend:

```sh
bun install
bun dev
```

Backend:

```sh
cd backend
go run ./cmd/server
```

Backend tests:

```sh
cd backend
go test ./...
```

## Environment Variables

Frontend `.env`:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_GOOGLE_MAPS_API_KEY`
- `VITE_GO_BACKEND_URL` or `VITE_API_BASE_URL` or `VITE_BACKEND_URL`
- Optional Datadog RUM values from `.env.example`

Backend `backend/.env`:

- `DATABASE_URL`
- `SUPABASE_JWT_SECRET`
- `PORT` defaults to `3000`
- `APP_ENV` defaults to `production`
- `SUPABASE_URL`, `SUPABASE_JWT_AUDIENCE`, `SUPABASE_JWT_ISSUER`
- `CORS_ALLOW_ORIGINS`
- `REDIS_URL`, `REDIS_ENABLED`, `REDIS_DRIVER_LOCATION_TTL_SECONDS`, `REDIS_DRIVER_PRESENCE_TTL_SECONDS`, `REDIS_POOL_SIZE`
- `DISPATCH_MODE`, `DISPATCH_SHADOW_RADIUS_KM`, `DISPATCH_SHADOW_CANDIDATE_LIMIT`, `DISPATCH_SHADOW_SELECTED_LIMIT`, `DISPATCH_SHADOW_RANKING_VERSION`
- Wallet flags such as `WALLET_ACTIVE_SETTLEMENT_ENABLED`, `WALLET_RIDE_AUTHORIZATION_ENABLED`, `PUBLIC_WALLET_PILOT_ENABLED`
- Payment provider flags and secrets such as `PAYMENTS_PROVIDER_ENABLED`, `ONEMONEY_WEBHOOK_SECRET`, `ECOCASH_WEBHOOK_SECRET`, `INNBUCKS_WEBHOOK_SECRET`, `PAYPAL_WEBHOOK_SECRET`

## Layout

```text
.
├── backend/
│   ├── cmd/
│   ├── internal/
│   ├── go.mod
│   └── go.sum
├── src/
├── supabase/
└── package.json
```

# Welcome to your Lovable project

## Project info

**URL**: https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID

## How can I edit this code?

There are several ways of editing your application.

**Use Lovable**

Simply visit the [Lovable Project](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and start prompting.

Changes made via Lovable will be committed automatically to this repo.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes. Pushed changes will also be reflected in Lovable.

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

## Local requirements

This repo currently expects **Node.js 20 or 22**.

- `npm run test` is not compatible with Node 24 at the moment (Vitest crashes on Node 24).

You can check your current version with:

```sh
node -v
```

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## How can I deploy this project?

Simply open [Lovable](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and click on Share -> Publish.

## Can I connect a custom domain to my Lovable project?

Yes, you can!

To connect a domain, navigate to Project > Settings > Domains and click Connect Domain.

Read more here: [Setting up a custom domain](https://docs.lovable.dev/features/custom-domain#custom-domain)

---

## External Console Checklist

### Google Maps — fix `ApiTargetBlockedMapError`

1. Go to **Google Cloud Console** → [console.cloud.google.com](https://console.cloud.google.com)
2. Select your project (or create one).
3. **Enable APIs** (APIs & Services → Library):
   - Maps JavaScript API
   - Places API (New)
   - Geocoding API
   - Directions API / Routes API
4. **Billing**: ensure a billing account is linked (Maps JS API requires it).
5. **API Key restrictions** (APIs & Services → Credentials → your key):
   - Application restrictions → **HTTP referrers (web sites)**
   - Add these referrers:
     ```
     http://localhost:*
     http://localhost:5173/*
     https://your-production-domain.com/*
     ```
   - API restrictions → **Restrict key** → select the APIs listed above.
6. Copy the key and set it in `.env` (referrer-restricted to your domains only — never commit it):
   ```
   VITE_GOOGLE_MAPS_API_KEY=AIza...yourKeyHere
   ```
7. Restart `npm run dev`. The map should render without errors.

### Supabase Realtime — fix WebSocket failures

1. Go to your **Supabase Dashboard** → [app.supabase.com](https://app.supabase.com)
2. Select project `jidfganntquilvsytslp`.
3. **Database → Replication**:
   - Ensure **Realtime** is enabled for the `live_locations`, `rides`, `offers`, and `messages` tables.
   - For each table: click **Enable** under the "Realtime" column.
4. **Authentication → Policies**:
   - Verify RLS policies allow `SELECT` for the anon/authenticated roles on the tables above.
   - Realtime uses the same permissions as `SELECT`.
5. **Settings → API**:
   - Confirm `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env` match the dashboard values.
6. Restart `npm run dev`. Open the browser console — you should see:
   - `[Supabase] Realtime connected` (no WebSocket errors).
   - Live driver location updates flowing through `live_locations`.
