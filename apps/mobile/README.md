# CruiXe mobile — scaffold + spike

Expo SDK **57.0.19**, React Native **0.86.3**, React **19.2.3**.

This is the `apps/mobile` scaffold with two things running in one dev-client
build:

- **Location spike** — the S1–S6 harness. See [`../spike-background-location/RUNBOOK.md`](../spike-background-location/RUNBOOK.md).
- **Core check** — proves `@cruixe/core` works against the live backend from a
  real device.

The web app at the repo root is untouched and keeps its own copy of the ported
logic in `src/lib/`. Nothing here can affect it.

---

## 0. Prerequisites (assume nothing is installed)

Everything below runs in **PowerShell** on Windows, from `apps\mobile`.

| Need | Check | If missing |
|---|---|---|
| **Node 20 or 22** | `node --version` | Install from nodejs.org. Expo SDK 57 does not support Node 23+; verified working on **v22.23.2** |
| **npm** | `npm --version` | Ships with Node. Verified on **10.9.8** |
| **Expo account** | — | Sign up free at [expo.dev](https://expo.dev). Needed before any EAS command |
| **An Android phone** | — | Physical device. An emulator cannot answer the background-location question |
| **Same Wi-Fi** | — | Phone and laptop must share a network for the Metro bundler |

**No global installs required.** `npx` fetches `eas-cli` per invocation, which
avoids a stale global copy — the most common source of confusing EAS errors.
If you'd rather install it once: `npm install -g eas-cli`, then drop the
`npx eas-cli@latest` prefix and just use `eas` below.

**Not needed:** Android Studio, a JDK, or Watchman. EAS compiles in the cloud.
You only need those for the local-build alternative at the very end.

**Not needed for Android:** an Apple Developer account. That is only required
for the iOS profiles in `eas.json` (see *Building for iOS* at the end).

Dependencies are already installed (`node_modules` is present). If you ever need
to reinstall, use `npx expo install --fix` rather than `npm install` — it
resolves against the installed SDK.

---

## 1. Configure

```powershell
cd apps\mobile
Copy-Item .env.example .env
```

Fill in `.env` from the web app's values (`EXPO_PUBLIC_*` is Metro's equivalent
of Vite's `VITE_*`):

| `.env` key | Where to get it |
|---|---|
| `EXPO_PUBLIC_GO_BACKEND_URL` | The Railway host the web app's `VITE_GO_BACKEND_URL` points at |
| `EXPO_PUBLIC_WS_URL` | Same host, `wss://…/ws` — the web app's `VITE_WS_URL` |
| `EXPO_PUBLIC_SUPABASE_URL` | Web `.env` → `VITE_SUPABASE_URL` |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Web `.env` → `VITE_SUPABASE_PUBLISHABLE_KEY` |

These are inlined into the bundle at build time. **Publishable values only** —
nothing here that you wouldn't ship inside an APK.

> Note: the web app's dev build points `VITE_GO_BACKEND_URL` at the Vite proxy
> path `/go-api`. That is meaningless on a device. Use the **real** Railway
> host here.

## 2. Build a dev client — exact sequence (Windows)

`react-native-background-geolocation` ships native code, so **Expo Go will not
work.** You need a dev client, built once per device. EAS builds in the cloud, so
you do **not** need Android Studio or a JDK.

Run everything from `apps\mobile` in PowerShell.

### Step 1 — account

```powershell
npx eas-cli@latest login
```

Prompts for your Expo email and password. If you have no account, create one
free at expo.dev first. Verify:

```powershell
npx eas-cli@latest whoami
```

**Expect:** your username printed. If it says you are not logged in, the login
silently failed — repeat before continuing.

### Step 2 — link the project

```powershell
npx eas-cli@latest init
```

**Expect:** a prompt to create a project on your Expo account; accept. It writes
`extra.eas.projectId` into `app.json`. If it asks to overwrite an existing id,
say no unless you know why.

### Step 3 — build profiles (already done, just verify)

`eas.json` is **committed in this folder**, so there is nothing to generate and
no prompts to answer. Confirm it is there:

```powershell
Get-Content eas.json
```

**Expect:** a `development` profile with `"developmentClient": true` and
`"buildType": "apk"` for Android. That flag is the one that matters — without
it you get a standalone build that cannot connect to your Metro bundler, and
you find out ~25 minutes later at the end of a build.

> Do **not** run `eas build:configure`. It would overwrite this file with an
> interactive default that drops the iOS profiles.

### Step 4 — build

```powershell
npx eas-cli@latest build --profile development --platform android
```

- First run asks to generate a new Android keystore — **yes**. It is a throwaway
  debug signing key for this spike; it has nothing to do with the Play Store key
  that signs the Capacitor release.
- Uploads the project, queues, then builds. **Expect 10–25 minutes**, longer on
  the free tier. It prints a build URL you can watch or close.
- **Expect at the end:** a `.apk` download link (the `development` profile builds
  APK, not AAB, precisely so you can sideload it).

**Config-plugin failure looks different from a code failure.** It fails during
*Prebuild* or *Gradle*, early, with a message naming the plugin — e.g.
`react-native-background-geolocation` failing to apply, or a manifest merger
conflict on a permission. That means the native config is wrong (`app.json`
permissions or plugin list), not your JavaScript. A JS mistake will build fine
and fail on the device instead. Read *which phase* failed before changing
anything.

### Step 5 — get the artifact onto the phone

**Where the artifact lives:** EAS keeps it in the cloud, not on your laptop. When
the build finishes the terminal prints a URL like
`https://expo.dev/accounts/<you>/projects/cruixe-mobile/builds/<id>`. The same
build is listed under **Builds** on expo.dev. The `development` profile produces
an **`.apk`** (not an `.aab`) precisely so it can be sideloaded.

Three ways to install, easiest first:

1. **QR code** — the terminal prints one at the end of the build. Scan it with
   the phone's camera; it opens the download page directly.
2. **Open the build URL on the phone** and tap **Install**.
3. **From the laptop over USB**, with the phone in developer mode:
   ```powershell
   npx eas-cli@latest build:run --platform android --latest
   ```

Android will warn about installing from an unknown source — allow it. The app
installs as **CruiXe Mobile**.

### Step 6 — start the bundler and launch

```powershell
npx expo start --dev-client
```

Phone and laptop must be on the **same network**. Scan the QR with the dev-client
app, or press `a`.

**A successful first launch, in order:**

1. The dev client app opens to a screen listing your development server.
2. Tapping it shows a bundling progress bar (first bundle takes 30–60s).
3. The app renders: a **red header area** with two tabs — **Location spike** and
   **Core check** — on a light grey background.
4. **Location spike** tab shows `Tracking: no`, `Fixes logged: 0`, and
   **Start + reset log** / **Stop** buttons. Your device model appears under the
   title, which confirms `expo-device` linked natively.
5. Switch to **Core check**: check **1. Config resolves** is already **green**,
   and the log names your backend URL. Checks 2–5 sit grey until you run them.

If you see all five of those, the native side compiled, the JS bundle loaded,
the config plugins applied, and `@cruixe/core` resolved through Metro. That is
the whole build chain verified.

**A config-plugin failure at runtime instead** looks like a red error screen
naming a native module — typically `Cannot read property 'ready' of null` or
`Native module RNBackgroundGeolocation not found`. That means the JS bundle
loaded but the native side was not compiled in: you are running the wrong build
(Expo Go, or a dev client built before the library was added). Rebuild from
step 4 rather than debugging the JavaScript.

If check 1 is **red**, `.env` is wrong — the log names every missing key at once.
Fix `.env`, then shake the phone and choose Reload; no rebuild needed for env
changes as long as you restart the bundler.

> **Diagnostic: check 1 fails but 2–5 pass → suspect a BOM, not the backend.**
>
> If `.env` is ever regenerated on Windows, do **not** write it with
> `Set-Content -Encoding utf8`. Windows PowerShell 5.1 — the default blue-icon
> shell — writes UTF-8 **with a BOM** under that flag. (PowerShell 7 changed
> `utf8` to mean BOM-less; 5.1 is the one that bites.)
>
> A BOM makes the first variable parse as `﻿EXPO_PUBLIC_GO_BACKEND_URL`,
> which matches nothing, so `apiBaseUrl` is undefined while every later line
> loads fine. The file looks perfect when printed. Write it BOM-free instead:
>
> ```powershell
> [System.IO.File]::WriteAllLines("$PWD\.env", $lines)
> ```
>
> Verify with `head -c 3 .env | od -An -tx1` — you want `45 58 50` (`EXP`),
> not `ef bb bf`.

### Building locally instead

Only if you already have Android Studio and a JDK set up:

```powershell
npx expo run:android
```

### Building for iOS (not today)

`eas.json` carries iOS profiles so the config is ready, but **iOS is not part of
this spike round** and needs things Android does not:

- A **paid Apple Developer account** (~$99/yr) for a device build. Without one
  you can still build for the Simulator:
  `npx eas-cli@latest build --profile development-simulator --platform ios`
  — but a simulator cannot answer a background-location question, so it proves
  only that the app compiles for iOS.
- The `Info.plist` entries are already configured (`UIBackgroundModes`, the
  three location usage descriptions, and `NSMotionUsageDescription`), so nothing
  needs retrofitting when iOS does get validated.

**Android results do not transfer to iOS** — different permission model,
different suspension behaviour, no foreground-service equivalent. See the
Platform scope section in the RUNBOOK.

## 3. Run the core check first — it takes two minutes

Open the app, tap **Core check**. This has to pass before the location spike
tells you anything useful, because a failure here is a wiring problem, not a
platform one.

Five checks, each independently green or red.

1. **Config resolves** — green on launch. Red means a missing `.env` key; the
   log names every missing one at once.
2. **Supabase auth** — sign in with a real driver account.
3. **Go backend call** — issues `GET /api/rides/open` against the deployed
   Railway backend through the ported `goBackendClient`.
   - Green → HTTPS egress, auth header and response parsing all work on a real
     device network.
   - `code=UNAUTHENTICATED` → you reached the backend, the token was rejected.
     **Still proves connectivity.**
   - `code=NETWORK_ERROR` → you did not reach it. Check the URL, and that you
     are not pointing at the Vite proxy path.
4. **Socket connect + ping/pong** — needs nobody else. Opening the socket only
   proves the handshake; the ping round trip proves the Supabase token was
   accepted and traffic flows both ways under Hermes. Green on its own.
5. **Room broadcast** — the only check needing a second party, and no second
   phone: log into the **web app on your laptop as a rider**, paste that ride's
   id into *Join ride room*, then request the ride. Same backend, same rooms.
   The log prints `EVENT <type> ride=<id>`.

Checks 4 and 5 are separate deliberately. They prove different things at very
different setup costs, and bundling them meant one ambiguous red light — a
failed broadcast looking identical to a dead socket.

**Check 5 is the one worth doing properly.** The migration brief calls the
socket the piece most likely to differ subtly on React Native, and one real
event received on device is the only thing that settles it.

## 4. Then run the location spike

Switch to the **Location spike** tab and follow
[`RUNBOOK.md`](../spike-background-location/RUNBOOK.md) — it has the six
scenarios, the setup rules (battery optimisation **on**, mobile data, ≥80%
charge), and the pass/fail thresholds, which are fixed before the walk.

Short version of the walk itself:

1. Pick devices from **Play Console** (Statistics → device model), not Sentry —
   there is no Android data in Sentry. Ask the testers too.
2. **`S0` desk dry-run first — mandatory, five minutes.** Phone stationary,
   screen locked. It verifies the *instrument*, not the platform: fixes reaching
   disk, log shape as expected, analyzer producing a verdict from real data.
   S1–S6 is 3+ hours of walking per device; finding out afterwards that the
   writer path was broken means redoing all of it. A stationary phone yields
   heartbeat fixes rather than movement fixes — that is correct here.
3. Per device: set scenario to `S1`, tap **Start + reset log**, confirm the
   foreground-service notification, lock the screen, pocket it, **walk 30
   minutes**. Do not wake it.
4. Reopen, read the verdicts, copy them into the runbook's results table.
5. **If S1 fails, run `S6` next — not S2.** S6 is S1 with battery optimisation
   whitelisted. S1 fail + S6 pass = an onboarding problem (add a whitelist
   prompt). S1 fail + S6 fail = a platform problem (evaluate bare RN). S2–S5
   only earn their time once S1/S6 have answered *whether* it works.
6. `S2`: start again, then **swipe the app out of recents** and walk 15 minutes.
   Reopen. Fixes timestamped while the app was dead = the foreground service
   survived. The scenario most people skip and drivers do constantly.
7. `S3`: permission set to "While using the app" only — does it stop *loudly* or
   silently?

**These scenarios validate Android only.** iOS has a different permission model
and different suspension behaviour, so the results do not transfer — an
equivalent iOS pass is a separate prerequisite before any iOS release
commitment. The scaffold is already configured for both platforms so nothing
needs retrofitting.

**Export log** writes the raw NDJSON out via the share sheet — attach it to the
decision rather than retyping numbers.

## 5. Record the outcome

The Expo-vs-bare-RN decision in `MIGRATION_PHASE0_AUDIT.md` §5 is currently
**provisional on this result**. Write the answer there.

---

## Notes for whoever picks this up

- **`expo install`, never `npm install`**, for anything Expo-adjacent. It
  resolves against the installed SDK; `npm install` does not and will silently
  pull an incompatible version.
- `react-native-background-geolocation` is **v5**, which restructured `Config`
  from v4's flat object into nested domains (`geolocation` / `app` / `http` /
  `logger`) and moved constants into enums (`DesiredAccuracy.High`,
  `LogLevel.Warning`). A v4-shaped flat config will not type-check — and if
  forced through with `as any` it is silently ignored at runtime, which on this
  spike would look identical to the platform failing.
- `expo-file-system` v57 has a new `File`/`Directory` API; the harness uses
  `expo-file-system/legacy` deliberately. The real app should use the new API —
  its `FileHandle` supports true append, which would remove the
  read-modify-write in `src/fixLog.ts`.
- Metro resolves `@cruixe/core` via `extraNodeModules` in `metro.config.js`;
  `tsc` resolves it via `paths` in `tsconfig.json`. **Both must stay in step.**
- A release build of `react-native-background-geolocation` needs a Transistor
  licence. Debug/dev-client builds do not. Confirm that cost before adopting it
  for production.
