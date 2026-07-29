# MilesPost

Team-driver tools. Two questions, two tabs:

**ETA** — when do I get there? Dispatch's `miles ÷ 50`, and a tuned model built from your
real cruise speed, fuel stops, and the fixed-clock driver swap.

**34 RESET** — when am I legal? Set the moment you shut down, get the moment your 70 comes
back, and hand a real alarm to your phone's Calendar.

Resolves timezones from a town name. Day and night modes. **Runs 100% offline** — no server,
no API, no signal required. The one exception is the optional **LIVE** ETA line, which needs
signal to ask HERE for a traffic-aware truck route; with no signal it simply isn't shown and
everything else works as always.

**Current version: v3.0.4**

## Files

| File | What it is |
|---|---|
| `index.html` | The app — markup, styles, and all the DOM wiring. Loads `lib/logic.js`. |
| `lib/logic.js` | The pure logic — timezone resolver, ETA solver, 34-reset and ICS math. No DOM, no dependencies. Imported by the app and covered by the test suite. |
| `sw.js` | Service worker. Caches everything so it works with zero bars. |
| `manifest.webmanifest` | Makes it installable to the home screen. |
| `icon-192.png` `icon-512.png` `apple-touch-icon.png` | App icons. |
| `.nojekyll` | Tells GitHub Pages to serve the files as-is. Don't delete it. |

## Install it to the home screen

**iPhone:** open the link in Safari → Share → *Add to Home Screen*.
**Android:** open in Chrome → menu → *Install app* / *Add to Home Screen*.

Own icon, fullscreen, no browser bars, and it works in a dead zone because the service
worker cached it on first load.

## Notes

- Settings persist per-device via `localStorage`.
- Timezone resolution is a lookup table covering all 50 states, with per-city handling for
  the split states (TX, TN, KY, FL, IN, ND, SD, NE, KS, ID, OR, MI). Unknown towns fall back
  to a manual zone picker.
- **Swaps run on a fixed clock**, not on mileage — 06:00 / 18:00 Eastern by default, anchored
  to a zone so the schedule doesn't drift west as the truck moves. Fuel is on the odometer.
  They're separate stops because they're separate things.
- The 34 counts **34 real elapsed hours**, so it stays correct across a DST change. Naive
  wall-clock math would cost you an hour in the fall and hand you an illegal 33 in the spring.
- No web app can fire a notification while it's closed. That's why the reset hands the alarm
  to your Calendar instead of pretending to have a timer.
- **HOS is not modeled.** No 10-hour reset is built into the ETA — the math assumes the truck
  keeps rolling through driver swaps. The 11/14 and the 70-hour cycle are still on you.

## Version history

### v3.0.4

- **Fix: re-quoting a live ETA for a different city left the old city's mileage in the
  field.** The autofill guard was blank-only, which can't tell a number the driver typed
  from one the app filled in itself — so once a mileage was there for any reason, every
  later quote refused to touch it. The first city worked; the second silently kept the
  first one's distance.
- The app now remembers the exact mileage it last wrote. If the field still reads exactly
  that, it's the app's own number and a new quote replaces it. The moment it reads
  anything else, the driver has taken the field over and it's never touched again — so
  **dispatch's contractual number is still safe**, which is the whole reason the guard
  existed. CLEAR drops the record along with the value.

### v3.0.3

- **Actually fix the live mileage autofill not appearing until the field is tapped.**
  v3.0.2's fix was aimed at the wrong thing: it dispatched a synthetic `input` event,
  but an event is a JS-level notification to listeners and never touches rendering, so
  it could not have fixed a paint bug. Confirmed still broken on-device at v3.0.2.
- The screen recording pinned it down: the arrival clock, LIVE line and run strip all
  updated in the same pass — and `renderEta()` only computes an arrival at all when
  `Number($("miles").value) > 0`. So the value was genuinely in the DOM; only the
  `<input>`'s own rendered text was stale. That rules out a general compositing problem
  and points squarely at WebKit's input renderer.
- New `repaintField()` forces the element's renderer to be torn down and rebuilt: drop
  it out of layout, read a layout property to force a synchronous reflow, restore it.
  All in one task, so the browser never paints the intermediate state — no flicker.
  It skips focused fields (`display:none` would blur them and drop the keyboard
  mid-type) and restores scroll position (removing the field shortens the document for
  the duration of the reflow, which could otherwise clamp a scroll near the bottom).
- The repaint itself can't be observed from Chromium, so it needs on-device
  confirmation. What *is* covered by the smoke suite: the field is left visible
  afterwards — if the restore is ever dropped, the field vanishes outright, which would
  be far worse than the original bug.

### v3.0.2

- **Fix: the live mileage autofill didn't visibly appear until you tapped the field.**
  Mobile Safari doesn't always repaint an input's text after a bare JS `.value`
  assignment while it's unfocused — the number was correct underneath the whole time,
  tapping in just forced a repaint that revealed it. `updateLive()` now dispatches a
  real `input` event right after setting the value, which forces WebKit to reconcile
  the display. Applied the same fix preventively to the city-suggestion tap-to-select
  handler (same shape, never reported broken).
- That second fix uncovered a real bug while it was being verified: dispatching the
  event re-triggers the field's own debounced-suggestion listener, which was about to
  silently reopen the dropdown ~300ms after picking, showing fresh results for the
  city name you'd just chosen. The picker now cancels that scheduled fetch and
  invalidates its in-flight token in the same handler, so a pick closes the dropdown
  and keeps it closed.
- This is a WebKit rendering-timing quirk that Chromium (what the automated suite runs
  in) won't reliably reproduce either way — verify the mileage fix on an actual iPhone.
  The suggestion regression, being a real DOM/timing bug rather than a paint quirk, has
  smoke coverage instead.

### v3.0.1

- **The tier-1 glass chrome now actually reads as glass.** Two changes, and the second one
  was the real cause:
  - Pushed the material further: fill `.55` → `.38`, blur 18px → 22px, saturate 160% →
    180%, and the pane border up to `.14` so its edge stays defined as the fill thins out.
    The specular hairline came up a touch to match (`.42` night / `.24` day).
  - **Gave the blur something to bend.** The canvas was a single flat colour, and
    `backdrop-filter` over a flat surface has nothing to diffract — it just reads as a
    tint no matter how transparent it gets. There's now a barely-perceptible radial
    gradient behind everything, built from each theme's own `--panel` / `--line`, so the
    chrome picks up real gradation as you scroll past it.
- The opaque base layer is unchanged, so the app still can't show a host page through:
  `body::before` keeps painting solid `--asphalt`, and the gradient sits on top of it,
  where every transparent stop reveals only that base.
- Tab and preset labels were re-measured against the thinner glass from real rendered
  pixels, not arithmetic: **5.35:1** night and **5.80:1** day, both clear of 4.5:1.
- **UPDATE LIVE ETA is now a full-width amber pill button** instead of small underlined
  link text sharing a row with the tuning toggle. It reuses the same `.primary` class as
  ADD ALARM TO CALENDAR, so the pill shape, sheen and dimmed disabled state all come for
  free. "+ TUNE TO YOUR TRUCK" moved to its own line, centered, just above the button —
  still a plain link. The button's id, its click handler, and the "UPDATING LIVE…" pending
  swap are untouched.
- **Opening the tuning panel stands the LIVE button down** until you close it again, so the
  tuning fields sit directly under the toggle that revealed them instead of being split off
  below a full-width button. A live fetch that finishes while the button is hidden still
  comes back in the right state.

### v3.0

- **New visual direction: Liquid Glass, applied in three deliberate tiers.** Floating
  translucent chrome, pill shapes, and a soft specular hairline on surface edges — but
  *not* everywhere. This app gets read one-handed, at a glance, in a moving truck and
  sometimes in direct sun, so the glass is tiered by what a surface is for:
  - **Chrome** (tab rows, sub-tabs, presets, the day/night switch, the help modal's
    backdrop) gets the real material: blur, saturation, translucency. It's navigation,
    not data.
  - **Solid pill buttons** (SET, CLEAR, BROKE THE 34, UPDATE LIVE ETA, the "?" circles)
    get the pill shape and a subtle sheen but stay fully **opaque**. A translucent SET
    button floating over other content is exactly the ambiguity a high-stakes one-handed
    tap can't afford.
  - **Data surfaces** (every card, the help sheet, the city dropdown) stay near-opaque
    with no blur. Contrast beats material on anything carrying a number.
  - **Inputs and selects** are untouched apart from the new corner radius — no blur, no
    translucency, ever, where real numbers get typed.
- One radius scale (`--r-sm` / `--r-card` / `--r-sheet` / `--r-pill`) replaces the old
  scattered values, and new RGB-triplet tokens let a translucent background be written
  once and stay correct in both themes.
- **Restrained motion:** 200ms tab/preset transitions, a small scale on button press, a
  quick fade-and-rise on the help sheet. All of it disabled under
  `prefers-reduced-motion`, and the glass falls back to near-opaque with no blur under
  `prefers-reduced-transparency`.
- Status signals are untouched: the Arrival/Legal-at accent border still switches amber →
  green exactly as before, and DOT / Fuel / Swap keep their existing colours (their
  swatches just became rounded pill chips instead of squares).
- Contrast was re-checked in both themes after the tint change — body text 15:1 (night) /
  18:1 (day), the amber readout 9.7:1 / 5.8:1, the green "legal" state 5.0:1 in day. The
  day theme's amber gradient tops out at 5.05:1 on white, still clear of 4.5:1 in glare.
- **"Estimated ETA" is now "Simple ETA"** — the old name expanded to "Estimated Estimated
  Time of Arrival." Label only; nothing under the hood changed.

### v2.4.4

- **Same-named cities in other states now show up.** Suggestions switched from HERE
  Autosuggest to HERE **Autocomplete restricted to cities** (`types=city`) — every
  result slot is a city, so typing "cypress" now offers Cypress, TX *and* Cypress, CA
  instead of only the nearby one (autosuggest mixed streets and businesses into the
  ranking and localized hard). The dropdown now shows up to 8 suggestions (it scrolls).
  If the autocomplete call ever fails, the previous autosuggest request silently takes
  over, so suggestions degrade rather than vanish.

### v2.4.3

- **City suggestions now find far more cities — including small towns.** The app was
  asking HERE for only 5 autosuggest results, and cities compete with streets and
  businesses in that ranking, so all but the biggest cities got crowded out (a typical
  query returned just 1–2 usable cities). It now requests 20 results and shows the top
  5 cities from them. Labels that carry a ZIP code (e.g. "Chattanooga, TN 37402") are
  also parsed now, so postal-code localities resolve to their city instead of being
  dropped.

### v2.4.2

- **Fix: city suggestions (v2.4.1) weren't showing any results.** HERE's Autosuggest
  response, on this account's plan, returns locality (city) results with only a flat
  `address.label` (e.g. "Chattanooga, TN, United States") — not the structured
  `address.city`/`address.stateCode` fields the original filter required. It now falls
  back to parsing the city and state straight out of the label (or title) when those
  fields are missing, while still preferring them if a response ever does include them.

### v2.4.1

- **City suggestions while typing** a destination, an origin change, or a 34-reset
  shutdown location — a small dropdown of "City, ST" matches from HERE Autosuggest,
  debounced (300ms, 3+ characters). Tap one and it fills the field and resolves it
  immediately, same as typing the full thing and hitting SET. No signal, no results, or
  a failed request and the dropdown just doesn't appear — typing and SET/Enter keep
  working exactly as before, fully offline.

### v2.4

- **"?" help buttons** on the four main cards (Arrival, Your Load, How You Run, 34-reset
  readout) open a short plain-English explainer with a couple of practical tips — the
  Arrival one is mode-aware (Estimated vs Tuned). One shared bottom-sheet panel, no close
  button — dismiss by tapping outside it. Purely informational: no logic, state, or math
  touched.

### v2.3.1

- **UPDATE LIVE ETA now fills in miles when the field is blank**, using the real road
  distance from HERE's route — type a destination, tap the button, done. It never
  overwrites a mileage you've already entered (dispatch's number is often contractual and
  differs from the real road distance on purpose), and typing mid-fetch still wins.

### v2.3

- **LIVE ETA line** on the Tuned Model tab, alongside Estimated and Tuned. Tap UPDATE LIVE
  ETA and the app asks HERE Routing (truck profile — 13'6", 8'6" wide, ~72 ft, 80,000 lb,
  5 axles, 1 trailer) for a traffic-aware drive time from your GPS position to the
  destination you already typed, then runs the **same** team overlay (swaps, DOT break,
  fuel) on top. Shows the arrival, real road miles, and the current traffic cost.
- **Honest caveat, in the UI too:** live traffic reflects conditions *right now* — on a
  multi-day team run it mainly shapes the next few hours. The truck-legal routing (real
  road speeds, truck-legal path) is what helps the whole run.
- **Fails soft, always:** no GPS permission, no signal, a HERE error, or a quote older
  than 10 minutes and the LIVE line simply isn't shown — the app behaves exactly as
  before, with a small "live unavailable — showing tuned" note. Nothing blocks, nothing
  errors. Refreshes on demand only (button or reopening the tab), never on a timer.
- The service worker now handles only same-origin requests, so API calls always hit the
  live network and can never be served a stale cached quote.
- The HERE key is domain-locked to this app's origin and lives in one named const
  (`HERE_API_KEY`) for easy rotation. Presets unchanged — saved tuning is preserved.

### v2.2.1

- Added a small colour key under the run strip (DOT / Fuel / Swap) so the notch colours are
  labelled, and recoloured the DOT notch green so it no longer reads like the brown fuel notch.

### v2.2

- **DOT break replaces the "stretch" stop in the Tuned Model.** Instead of a recurring
  every-N-hours stretch, the model now takes the federal 30-minute break **once per driving
  shift**, a set number of hours into that shift. A run gets one DOT break per shift it drives
  through and reaches the mark of — a run that ends before the mark takes none, mirroring how
  swaps are counted. DOT duration is editable but never drops below 30 min; DOT timing (hours
  into shift) is editable per preset (Conservative 4h, Realistic 5h, Push 6h).
- **Stop durations retuned:** swap is now a flat **30 min** on every preset; fuel is
  **25 / 20 / 15 min** (Conservative / Realistic / Push). Cruise speeds and fuel intervals are
  unchanged.
- Bumping the preset version means **saved custom tuning resets to the new defaults** — your
  **swap schedule and theme are preserved**.

### v2.1.9

- Centered the amber "It has to be 34 consecutive hours off duty…" warning on the 34 Reset
  tab, to match the now-centered footers and calendar note.

### v2.1.8

- Follow-up to v2.1.7 centering: the swap-timezone select now also centers on Safari/WebKit
  (which ignores `text-align` on a `<select>` — `text-align-last` fixes it), and the stacked
  footer/note lines are centered on the paragraph itself rather than by inheritance.

### v2.1.7

- Presentational tidy-up: centered the ETA and 34 Reset footers, the calendar note, and the
  swap-timezone select, and split each two-sentence footer/note into two stacked lines.

### v2.1.6

- Reworded the ETA tab footer to "Assumes nonstop team running. Doesn't track HOS — check
  your clocks."

### v2.1.5

- **Fix: the 34 Reset date picker no longer locks you out.** Tapping the shutdown date box
  used to hide the input the instant the picker opened — the native picker's default "now"
  value fired the "reset started" rule before you'd chosen anything, so only the NOW button
  worked. A reset now starts only on an explicit commit: **NOW**, or a new **SET** button
  next to the field. Opening or scrolling the picker never starts the reset, so the field
  stays up the whole time you're choosing a date.

### v2.1.4

- **34 Reset tab tidied while a reset runs.** Once a shutdown time is set, the input card
  collapses so only the countdown shows; it returns only when you CLEAR TIMER. (BROKE THE 34
  restarts to now, so it stays running and the input stays hidden.)
- **Auto-clear 10 minutes after completion.** A finished 34 shows "Complete … clearing in
  M:SS" and clears itself to the empty state at zero. The check keys off the completion
  timestamp (`autoClearElapsed` in `lib/logic.js`, with tests), so reopening the app past the
  window lands on the clean empty state — never a negative countdown.

### v2.1.3

- Simplified the no-destination arrival label to "Arrival · set a destination below",
  dropping the confusing "your clock" phrasing and the timezone tag in that state.

### v2.1.2

- The ETA tab now opens with miles empty instead of a pre-filled 1200, so first load
  shows the clean "Enter miles and a departure time." state — identical to post-CLEAR.

### v2.1.1

- **CLEAR button on the ETA tab**, mirroring the 34 Reset tab's. Clears the *load* —
  miles, destination, and appointment — and resets departure to now; it leaves the truck
  setup (presets, tuning, swap schedule, origin timezone, theme) alone. Same two-tap
  arm/confirm guard as the reset tab, and inert until there's a load to clear.

### v2.1

- **"Who's driving on arrival."** The Tuned Model view now shows *day shift driving* or
  *night shift driving* under the arrival time — which team driver is behind the wheel when
  you roll in, read off the fixed-clock swap schedule. Display-only, no new inputs. Not shown
  on Estimated, which has no swap concept. The `shiftAtArrival` logic lives in `lib/logic.js`
  with its own tests, including exact-swap boundaries and custom (non-06/18) schedules.

### v2.0.2

- No user-facing changes. Internal only: the DOM-free logic (timezone resolver, ETA solver,
  swap schedule, 34-reset and ICS math) moved out of `index.html` into `lib/logic.js`, and a
  test suite now covers it. Behavior is unchanged and verified — see [Tests](#tests).

### v2.0.1

- The 34-reset calendar event is now a single point in time (zero-length) instead of a
  15-minute block. The two alarms — 30 minutes out and the moment itself — are unchanged;
  they were always the part that pings you. The 15-minute span was only there to give the
  event a visible length, which isn't needed.

### v2.0 — MilesPost

Renamed from Team ETA. The old name only described half of what the app does.

- **34-hour reset timer**, merged in as a second tab. Shutdown time (now, or planned ahead),
  live countdown, one bar per hour, and a calendar handoff with two alarms — 30 minutes out
  and the moment itself.
- **Day / night modes.** Night is the Cascadia dash. Day is a cool ground with a darkened
  amber (`#A8490A`) that clears 4.5:1 contrast in glare — raw amber on white is 1.8:1 and
  vanishes in exactly the sunlight you'd need it in. Follows your phone, then remembers your
  choice.
- Background is painted on a layer the app owns, so a host page can't force it transparent
  and show its own dark canvas through.
- Nav restructured: **ETA** and **34 RESET** are two tools; *Estimated* and *Tuned Model* are
  two views of one calculation, so they nest under ETA.
- New icon and identity.

### v1.1.1

- **Tabs:** *Simple ETA* (fixed `miles ÷ 50`) and *Tuned Model ETA*. The ÷50 is hardcoded.
- **Swaps and fuel stops modeled separately.** They were lumped into one mileage-based stop,
  which was wrong: fuel is on the odometer, a swap is on the clock. Arrival is now solved
  iteratively, because the number of swaps depends on when you arrive and when you arrive
  depends on how many swaps you took.
- Short runs that finish inside one shift correctly take **zero** swaps.
- Run strip colour-codes stops: **blue = swap**, **dark amber = fuel**, **slate = stretch**.

### v1.1

Presets retuned to real team numbers:

| Preset | Cruise | Fuel | Swap | Stretch |
|---|---|---|---|---|
| Conservative | 64 mph | every 500 mi, 15 min | 40 min | every 4 h, 20 min |
| Realistic | 65 mph | every 650 mi, 15 min | 35 min | every 5 h, 20 min |
| Push | 68 mph | every 800 mi, 20 min | 30 min | every 6 h, 15 min |

- Saved settings are versioned (`PRESET_VERSION`), so new defaults actually reach phones that
  already had the app instead of being overridden by `localStorage`.
- App auto-reloads when a new version is deployed.

### v1.0

Initial release. Two models, offline timezone resolver, appointment cushion, installable PWA.

## Tests

The correctness-critical logic — timezone math, the iterative ETA solver, the swap
schedule, and the DST-proof 34-hour reset — lives in `lib/logic.js` with no DOM
dependencies, so it runs under [Vitest](https://vitest.dev/) in plain Node.

```
npm install
npm test              # one-shot unit run (Vitest)
npm run test:watch
npm run test:browser  # end-to-end smoke test in a real browser (Playwright)
```

Tests live in `test/`. The Vitest suite covers the `(start, end]` swap boundaries and DST
edge cases, the fixed-point ETA (including the zero-swap short run and the fuel
off-by-one), `fromWall`/`toWall` round-trips, the full split-state city table, and the
claim that the 34 counts 34 *real* elapsed hours across both DST transitions. The browser
smoke test (`test/smoke.browser.mjs`) serves the app over HTTP and confirms `index.html`
loads `lib/logic.js` as a module and renders a computed arrival. CI runs both on every push
(`.github/workflows/test.yml`).

## Updating the app

Three things have to happen or the update won't reach phones that already installed it:

1. **Bump `CACHE` in `sw.js`.** It's a *build* marker, not a version number — change it on
   every single deploy, even if the app version stays the same. Skip it and nothing changes
   for anyone, and you'll waste an hour wondering why.
2. **Bump `PRESET_VERSION` in `index.html`** — but *only* if you changed the presets.
   Otherwise saved settings will override your new defaults.
3. **Update the version stamp** at the bottom of `index.html`.
