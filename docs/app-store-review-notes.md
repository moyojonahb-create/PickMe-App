# App Store Connect — review notes (CruiXe iOS)

**How to use this file:** paste the *Review notes* section below into App Store
Connect → your build → **App Review Information → Notes** at submission. Fill in
the demo credentials first. Keep this file updated when the permission set or
the background behaviour changes, so the argument does not have to be
reconstructed from memory the night before a submission.

**Why this file exists.** The `Info.plist` usage descriptions in
`apps/mobile/app.json` are written for the **driver**, in a system alert, at the
moment they decide whether to grant. They are deliberately short: a paragraph in
that alert risks truncation and depresses the grant rate, and a driver who taps
"Don't Allow" costs live dispatch positions for that entire shift. The **full
operational justification belongs here**, where the reviewer will read it and
there is no length pressure. Two audiences, two artifacts.

---

## Submission checklist — do these before pasting anything

### 1. Credentials are never committed to this repo

**Do not put real demo credentials in this file, or anywhere in git.** Git
history is permanent — a later deletion does not remove them — and this is not
a throwaway login: the demo driver account can go **online against production
dispatch** and receive real ride requests from real riders.

- Keep the actual values in the team password manager.
- Enter them in App Store Connect → **App Review Information → Sign-in
  required → Demo Account** (the dedicated username/password fields), not in the
  free-text notes.
- **Verify the login works immediately before every submission.** A lapsed demo
  account is the single most likely rejection path here: the reviewer lands in
  the rider flow, never sees background location used, and rejects under 2.5.4
  having technically reached the app.
- Rotate the password after each review cycle.

### 2. Demo video recorded, hosted and reachable

Apple accepts demo videos specifically for flows a single reviewer cannot
reproduce alone, which is exactly this case — CruiXe is two-sided, and a
reviewer working solo can go online as a driver but cannot then request a ride
as a rider to trigger a trip.

**Hosting requirements — these fail submissions more often than the content:**

- The URL must be **publicly reachable without a login**. A Google Drive or
  Dropbox link that prompts for sign-in counts as inaccessible.
- It must stay live for the **entire review period**, including re-reviews after
  a rejection. Do not delete it when the build goes live.
- Keep it **under about three minutes**. A reviewer is looking to answer one
  question, not watch a product tour.

**Shot list — every row of the verification table must appear on camera:**

| # | Shot | Proves |
|---|---|---|
| 1 | Driver signs in, taps **Go online**; status shows online | Driver reaches the gated flow |
| 2 | Rider on a second device requests a ride; driver receives it and sends an offer; rider accepts | The loop a solo reviewer cannot produce |
| 3 | Rider's map showing the driver's car moving, both screens visible | Location drives a real user-facing feature |
| 4 | **Driver's screen locks** (show the lock clearly), then hold on the rider's screen while the car keeps moving | **The whole 2.5.4 argument** — this is the shot that matters |
| 5 | Driver switches to a navigation app; rider's map still updating | Why "While Using" is insufficient in practice |
| 6 | Rider uses *Share trip*; the shared link opens and tracks | Third-party live tracking |
| 7 | Driver toggles **Offline**; reporting stops | The stated data boundary is real |

Record both devices in one frame, or screen-record each and place them
side by side. Shot 4 is the one that answers the reviewer's actual question —
give it real time on screen, with visible movement, rather than a two-second cut.

Update the timestamps in the verification table to match the finished video.

### 3. Placeholders replaced

Search the pasted text for `<` before submitting — the video URL is the only
placeholder that should remain in this file, and it must be filled in the
pasted copy.

---

## Review notes — paste from here

### Demo account

CruiXe is a two-sided ride-hailing app. **The background-location behaviour only
appears on the driver side, and only once a driver is online with an accepted
trip.** Please use the pre-approved driver credentials supplied in the *Sign-in
required → Demo Account* fields of this submission rather than creating a new
account — a self-registered account lands in the rider flow and never reaches
the screens described here.

Driver accounts require document approval before they can go online; the supplied
account is already approved. A second set of rider credentials is included so the
full loop can be reproduced.

**We recognise a single reviewer cannot easily drive both sides at once.** A
demo video of the complete loop is linked below for that reason.

### What the app does

CruiXe connects riders and drivers in Zimbabwe. A rider requests a ride, nearby
drivers receive the request and send a fare offer, the rider accepts one, and the
driver then drives to the pickup point and completes the trip.

### Why the app needs Always-on location (background)

**The rider is watching the driver's car move on a live map for the entire
journey** — first as it approaches the pickup point, then throughout the trip.
That map is fed by the driver app reporting position continuously.

"While Using the App" is not sufficient for this, for a concrete reason:

> A driver mounts the phone on the windscreen and follows turn-by-turn
> directions **in a separate navigation app**, with CruiXe in the background and
> often with the screen off. Under "While Using", location reporting stops the
> moment CruiXe leaves the foreground — which is essentially the whole trip.

The user-visible consequences if this were foreground-only:

1. **The rider's map freezes** while they are waiting on a street corner, with
   no way to tell whether the car is still coming.
2. **Arrival estimates go stale**, because they are computed from the driver's
   current position.
3. **Trip sharing breaks.** A rider can share a live trip link with someone else
   (a family member following them home); that link goes blank.
4. **Emergency response degrades.** The in-app emergency button attaches the
   driver's current position to the alert. Without background location, an alert
   raised while the screen is off carries a stale position.

### Demo video of the full loop

**`<VIDEO URL — see submission checklist>`**

The behaviour being justified requires both sides of the marketplace at once: a
driver alone on one device can go online, but no trip starts until a rider
requests one, so background location never gets the chance to demonstrate
itself. The linked video records the complete loop end to end, including the
moment the driver's screen locks and the rider's map continues updating.

### How to verify each claim in the build

Each row can be reproduced with the supplied credentials and a second device, or
watched at the timestamp given in the video.

| Claim | How to see it | In the video |
|---|---|---|
| Rider watches driver move | Sign in as the rider on a second device or the web app, request a ride, accept the driver's offer, watch the map | 0:00–0:40 |
| Background reporting (the 2.5.4 question) | With a trip accepted, lock the driver's phone or switch to another app, then watch the rider's map keep updating | 0:40–1:20 |
| Live trip sharing | On the rider side, use *Share trip* during an active trip and open the link | 1:20–1:45 |
| Emergency button | Driver screen → safety control; the alert includes the current position | 1:45–2:05 |
| Nothing collected offline | Toggle the driver **Offline**; position reporting stops | 2:05–2:25 |

### Motion & Fitness

Used for stop detection only. The location library reads motion activity to tell
"the car is moving" from "the car is parked", and reduces location accuracy while
stationary. **This is a battery measure** — drivers are online for hours, and
sampling at full accuracy while parked drains the device materially. No motion
data is stored or transmitted; it is consumed on-device to modulate sampling.

### Data handling boundaries

- Location is collected **only while the driver is online**. Going offline stops
  collection.
- Location is not collected on the rider side outside of an active trip.
- The app does not sell location data or share it with third parties for
  advertising.
- Session replay masks all text by default, so typed values are not captured.

## Review notes — paste to here

---

## Permission-by-permission mapping

The short strings ship in the dialog; the long reasoning stays here.

### `NSLocationAlwaysAndWhenInUseUsageDescription`

**Ships to the driver:**
> Riders watch your car approach on their map, so CruiXe needs your location
> while you are online — including when your screen is off or you are using a
> navigation app. With "While Using" only, your rider's map freezes mid-trip.
> CruiXe never uses your location when you are offline.

Three short sentences, each doing one job: the mechanism (rider watches the car),
the failure case (map freezes mid-trip), and the boundary (nothing while
offline). The boundary sentence is kept despite the length pressure because a
stated limit measurably improves willingness to grant, and grant rate on this
permission is what determines whether dispatch has live positions at all.

**Full justification:** see "Why the app needs Always-on location" above.

### `NSLocationWhenInUseUsageDescription`

**Ships to the driver:**
> CruiXe uses your location to match you with riders nearby and show them where
> your car is. It is only used while you are signed in and online.

Covers the foreground case: matching and the rider-facing map.

### `NSLocationAlwaysUsageDescription`

Legacy key for iOS 10 and earlier. Same substance, shorter; retained so the
justification is present if an older OS or tooling path reads it.

### `NSMotionUsageDescription`

**Ships to the driver:**
> CruiXe uses motion activity to tell whether your car is moving or parked, so
> it can save battery while you are stopped.

Framed as a benefit to the driver, because it is one — battery over a long shift
is a real driver concern, and a permission that visibly serves the person
granting it is more likely to be granted.

---

## Known review risks

1. **Background location draws extra scrutiny for ride-hailing.** Guideline
   2.5.4 requires that background location be integral to the app, not
   incidental. The demo account and the verification table above exist so a
   reviewer can *see* the rider-side map updating, rather than taking the claim
   on trust. A reviewer who cannot reproduce the behaviour will reject it.
2. **A reviewer who cannot get online as a driver sees none of this.** Driver
   accounts are gated behind document approval. If the demo account lapses, the
   app looks like it requests Always-on location for no visible reason — the
   single most likely rejection path. **Verify the demo login works immediately
   before every submission.**
3. **iOS background behaviour is unvalidated as of this writing.** The
   background-location spike (`apps/spike-background-location/RUNBOOK.md`)
   covers Android only. An equivalent iOS pass is a prerequisite before an iOS
   release commitment — do not submit on the strength of Android results.
