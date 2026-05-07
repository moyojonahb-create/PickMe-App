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