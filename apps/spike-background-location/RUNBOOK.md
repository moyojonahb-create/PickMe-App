# Spike: can Expo actually do background location on our drivers' phones?

This spike exists to answer one question before any screen gets built:

> On the handsets our drivers actually carry, with battery optimisation on, does
> background location keep reporting when the screen is locked and after the app
> is swiped away?

If the answer is no, we eject to bare React Native — which invalidates the EAS
Build reasoning that justified choosing Expo in the first place. That is a
platform decision, and it has to happen now, while nothing is built on top of it.

**Background location is the reason this migration exists.** The current
Capacitor app tracks with a JS timer that dies on screen lock. If the replacement
platform cannot do better, the migration has no point.

---

## Rule zero: the pass/fail line is written down before the walk

Filled in below, before any data exists. Do not adjust these after seeing
results — deciding what counts as a pass once you've seen a marginal number is
how a marginal result becomes a green light.

| Metric | Pass | Investigate | Fail |
|---|---|---|---|
| Fix delivery rate (S1, 30 min) | ≥ 95% of expected | 85–95% | < 85% |
| Largest single gap (S1) | ≤ 90s | 90s–5 min | > 5 min |
| Recovery after process kill (S2) | resumes < 60s | 60s–5 min | never resumes |
| Degradation (S1 last 10 min vs first 10 min) | < 25% worse | 25–50% worse | > 50% worse |
| Battery drain | ≤ 10%/hr | 10–15%/hr | > 15%/hr |

Target fix interval is **15s**, so a 30-minute run expects **120 fixes**; 95% is
**114**.

**Why the gap metric exists alongside the rate.** A run can hit 95% of expected
fixes and still contain one ten-minute hole — which, for a driver mid-trip, is
the rider watching a frozen car. Count alone hides that; max-gap catches it.
Both must pass.

---

## Pick the devices from real data, not from a clean reference phone

Budget Android OEMs are aggressive and inconsistent about killing background
services, and the behaviour varies wildly by manufacturer. A pass on one clean
handset tells you close to nothing about another. **We already have the data.**

**Use Google Play Console, not Sentry.** This was checked, and Sentry cannot
answer it:

- Over 90 days, the `cruixe-web` project holds **2 error events**, both Chrome on
  Windows — a developer machine. The other 98 are `cruixe-api`, all
  `os.name: linux`, i.e. Railway containers. **There is no Android data at all.**
- `device.family` is empty on every event regardless, because the app runs
  `@sentry/react` — a *browser* SDK — inside a Capacitor WebView. A browser SDK
  does not populate native device fields. So even once mobile events do arrive,
  this still would not give a model breakdown.

The absence of Android events is itself a live issue — see "Mobile telemetry" in
`MIGRATION_PHASE0_AUDIT.md`. It is being handled separately; do not block the
spike on it.

**Play Console** → *Statistics* / *Android vitals* → break down by **Device
model** and **Android version**, filtered to your closed-testing track. This
works independently of whether our own telemetry reports, which is exactly why
it is the right source here.

With a closed-test cohort this small, **also just ask the testers what they are
carrying.** Two testers answering a message beats any dashboard.

Spike on the **top 2–3 models among your driver testers** — drivers, not riders,
since drivers are the ones running background location for hours.

Record what you actually tested:

| Slot | Model | Android version | OEM battery manager | Source share of driver sessions |
|---|---|---|---|---|
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |

Known-hostile OEM layers to note if they appear: Xiaomi/Redmi (MIUI), Oppo/Realme
(ColorOS), Vivo (Funtouch), Samsung (adaptive battery), Tecno/Infinix/itel
(HiOS/XOS — very common in this market and very aggressive).

---

## Setup, once per device

1. Install the dev-client build (see `README.md` in this folder).
2. Grant location permission — **"Allow all the time"** for S1/S2/S4/S5.
3. **Leave battery optimisation ON.** Do not whitelist the app. It is tempting,
   because whitelisting makes the test pass; your drivers will not do it, so a
   whitelisted pass is a lie. S6 separately measures what whitelisting buys.
4. Disable Wi-Fi. Mobile data only — this is how drivers actually run.
5. Charge to ≥ 80%, then unplug. Charging changes battery-manager behaviour.
6. In the app: **Reset log**, then **Start tracking**. Confirm the notification
   for the foreground service appears.

---

## Platform scope: S1–S6 validate ANDROID ONLY

The app ships to both platforms and the scaffold is configured for both — the
Info.plist background modes, location usage descriptions and motion description
are written alongside the Android manifest entries, so nothing needs retrofitting
later. But **these scenarios exercise Android, and the results do not transfer.**

iOS has a different permission model (`When In Use` vs `Always`, with its own
re-prompting behaviour), different suspension semantics, and no equivalent of a
foreground service — it uses background modes plus significant-change/region
monitoring, which behave differently again. A green Android run says nothing
about whether iOS sustains tracking.

**An equivalent iOS pass is a separate prerequisite before any iOS release
commitment.** Do not let an Android pass become "background location works."

---

## S0 — Desk dry-run (mandatory, five minutes, before S1)

**Run this every time, on every device, before the walking scenarios.**

Phone stationary on a desk, screen locked, five minutes. It is not measuring the
platform — it is verifying the instrument:

- fixes are actually reaching disk
- the log file has the shape `analyze.ts` expects
- the analyzer produces a verdict from real data instead of crashing on it

S1–S6 is three-plus hours of walking per device. Discovering afterwards that the
writer path or the analyzer was broken means redoing all of it, and you cannot
reconstruct the data from memory.

1. Set scenario to `S0`, tap **Start + reset log**.
2. Confirm the foreground-service notification appears.
3. Lock the screen, leave the phone still, wait five minutes.
4. Reopen. **Expect:** a non-zero fix count, mostly heartbeat-sourced, and a
   populated summary card with verdicts rendered.

**A stationary phone produces heartbeat fixes, not movement fixes** — with a
distance filter set, standing still legitimately yields no `onLocation` events,
so the harness logs heartbeats separately. Seeing only heartbeats here is
correct and expected.

**Fail conditions, all of which mean stop and fix the harness:**

| Symptom | Means |
|---|---|
| Fix count stays 0 | Location callbacks not firing, or permission not actually granted |
| Count rises but summary is blank | Analyzer is not reading the log |
| App crashes on reopen | Log format and parser disagree |
| No foreground-service notification | The service never started; every later result would be meaningless |

Only once S0 is clean does the walking start.

---

## Walking is a proxy for driving — confirm with a short drive before deciding

S1–S6 are run on foot because that is what you can do repeatedly and cheaply.
**A pass on foot is necessary but not sufficient**, because the three things
this library reacts to are all different in a car:

- **Motion signature.** Activity recognition classifies `on_foot` and
  `automotive` differently, and the library's stop-detection and accuracy
  tuning branch on that classification. You are exercising a different code
  path walking than driving.
- **Speed.** At walking pace a 10m distance filter fires roughly every 7
  seconds; at 50 km/h it fires under every second. Throttling, batching and
  the OS's own location budgeting behave differently at that rate.
- **Device placement.** A phone in a pocket is body-blocked with a poor sky
  view; a phone in a windscreen mount has a clear view, is often charging, and
  may have the screen on — and charging state alone changes how aggressively
  Android's battery manager intervenes.

So: run S1–S6 on foot to get the answer cheaply, then **confirm with one short
drive (15–20 minutes, phone mounted as a driver would have it, screen locked)
before treating the result as a platform answer.** A foot pass that fails in a
car is the failure mode that reaches drivers.

---

## The scenarios

### S1 — Screen locked, 30 minutes (the headline test)

Start tracking, lock the screen, put the phone in your pocket, walk. Do not wake
it. After 30 minutes, open the app and read the summary.

Walking matters: a stationary device legitimately produces fewer fixes, and
distance-filtered tracking will look broken when it is merely idle. Walk the
whole window.

**Records:** rate, max gap, degradation, battery drain.

> ### Branch rule: if S1 fails, run S6 next — not S2
>
> **S6 is the whitelisted control, and it is the only comparison that tells you
> what kind of problem you have.**
>
> - S1 fails, **S6 passes** → the platform is capable; battery optimisation is
>   killing it. That is an **onboarding problem** — a whitelist prompt in the
>   driver flow — not a reason to abandon Expo.
> - S1 fails, **S6 also fails** → the platform genuinely cannot sustain
>   background location on this device. That is a **platform decision**, and
>   bare RN needs evaluating with this same harness.
>
> S2–S5 characterise *how* it degrades. That detail only earns its time once S1
> and S6 have established *whether* it works at all — otherwise you spend two
> hours describing the failure modes of a configuration you are about to
> abandon.

### S2 — Swiped away from recents (process death)

The one people skip, and the one drivers do constantly.

With tracking running, open the recents switcher and **swipe the app away**. Wait
15 minutes, walking. Reopen the app.

The question is whether the foreground service survived and kept logging while
the JS process was dead. The on-disk log answers it — anything held in memory is
gone with the process, which is exactly why the harness writes every fix to disk
immediately rather than batching.

**Pass:** log contains fixes timestamped during the window the app was not
running. **Fail:** the log stops at the swipe and resumes only on reopen.

### S3 — "While using the app" permission only

Revoke "always" and grant only **"While using the app"**. Start tracking, lock
the screen, wait 10 minutes.

Not primarily a numbers test. The question is: **does it degrade loudly or fail
silently?** Android will legitimately cut background location here. What must not
happen is the driver appearing online, believing they are receiving offers, while
nothing is reported. If the app cannot tell the difference, that is a product
requirement for the real build: detect it and tell the driver.

**Record:** did tracking stop? Did the app detect and surface it?

### S4 — Degradation over time

Not a separate walk — computed from S1. Android throttles background location
progressively, so a 2-minute test is worthless here. The harness compares fix
rate in the **first 10 minutes** against the **last 10 minutes** of the S1 run.

The interval you ask for is not the interval you get.

### S5 — Battery drain

Also from S1. The harness records battery level at start and end and extrapolates
to an hourly figure.

A driver is online for hours. Technically-working-but-burning-20%/hour is a
product failure: drivers will uninstall, or stop going online, and the reason
will never reach you as a bug report.

### S6 — Battery optimisation whitelisted (control, run last)

Repeat S1 with the app whitelisted from battery optimisation.

This does not count toward pass/fail. It tells you **how much of any failure is
recoverable by asking the driver to whitelist** — which is a real, if unpleasant,
onboarding step some ride-hailing apps ship. If S1 fails and S6 passes cleanly,
the platform works and the problem is an onboarding/UX one. If S6 also fails, the
platform genuinely cannot do this and bare RN needs evaluating.

---

## Results

Copy per device.

**Device:** ____________________  **Android:** ______  **Date:** __________

| Scenario | Metric | Result | Verdict |
|---|---|---|---|
| S0 | instrument verified (fixes on disk, verdict renders) | | |
| S1 | fix rate (target ≥114/120) | | |
| S1 | max gap (target ≤90s) | | |
| S2 | fixes during process death | | |
| S2 | recovery time | | |
| S3 | stopped? detected? | | |
| S4 | degradation first vs last 10 min | | |
| S5 | drain %/hr | | |
| S6 | whitelisted rate (control) | | |

**Overall (Android):** PASS / FAIL / MIXED

**iOS:** not covered by this round — separate prerequisite, see "Platform scope".

**Notes** (OEM prompts, notification behaviour, anything surprising):

---

## Deciding

- **Pass on all target devices** → Expo is confirmed. Proceed with the scaffold
  and EAS Build as planned.
- **Fail on S1 but pass on S6** → platform works; the gap is onboarding. Budget
  for a battery-optimisation prompt in the driver flow and re-run.
- **Fail on S1 and S6, on any device with meaningful driver share** → stop.
  Evaluate bare RN with the same harness before committing further. Do not build
  screens on an assumption this test just disproved.

Whatever the outcome, record it in `MIGRATION_PHASE0_AUDIT.md` — the Expo-vs-bare
decision there is currently marked conditional on exactly this result.
