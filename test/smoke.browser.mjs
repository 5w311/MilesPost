// End-to-end smoke test: serve the app over HTTP (ES modules need it) and drive it
// in a real browser. Catches the integration the Vitest unit suite can't — that
// index.html actually loads ./lib/logic.js and renders a computed arrival.
//
//   npm run test:browser
//
// Not a *.test.js file, so `vitest run` ignores it; it runs on its own script.
// Browser binary: PLAYWRIGHT_EXECUTABLE_PATH overrides; otherwise Playwright's
// managed download is used (what CI installs via `playwright install chromium`).
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TYPES = { ".html":"text/html", ".js":"text/javascript",
  ".webmanifest":"application/manifest+json", ".png":"image/png" };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  fs.readFile(path.join(ROOT, p), (err, data) => {
    if (err) { res.writeHead(404); res.end("not found"); return; }
    res.writeHead(200, { "content-type": TYPES[path.extname(p)] || "application/octet-stream" });
    res.end(data);
  });
});

const fail = msg => { console.error("SMOKE FAIL:", msg); process.exitCode = 1; };

await new Promise(r => server.listen(0, r));
const port = server.address().port;

const launch = {};
if (process.env.PLAYWRIGHT_EXECUTABLE_PATH) launch.executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
const browser = await chromium.launch(launch);
const page = await browser.newPage();

const errors = [];
// Ignore the browser's automatic /favicon.ico probe — the app never references it.
page.on("pageerror", e => errors.push("pageerror: " + e.message));
page.on("response", r => {
  if (r.status() >= 400 && !r.url().endsWith("/favicon.ico"))
    errors.push(`http ${r.status()} ${r.url()}`);
});

try {
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "networkidle" });

  // The module must have loaded and be importable in-page.
  const moduleOk = await page.evaluate(async () => {
    const m = await import("./lib/logic.js");
    return typeof m.solveEta === "function" && typeof m.resolvePlace === "function";
  });
  if (!moduleOk) fail("./lib/logic.js did not load as a module in the page");

  // Opening state must be the clean empty state (no phantom 1200-mile calc): miles empty,
  // placeholder readout, CLEAR inert — identical to the post-CLEAR state asserted below.
  if ((await page.inputValue("#miles")) !== "")
    fail("miles should start empty on first load");
  if (((await page.textContent("#etaClock"))?.trim()) !== "--:--")
    fail("readout should start at the placeholder on first load");
  if (!(await page.isDisabled("#etaClear")))
    fail("CLEAR should start inert on first load");

  // No-destination arrival label is the simplified form — no "your clock", no tz tag.
  const label = (await page.textContent("#etaLabel"))?.trim();
  if (label !== "Arrival · set a destination below")
    fail(`unexpected no-destination label: ${JSON.stringify(label)}`);

  // Drive the ETA tool and expect a real arrival clock, not the placeholder.
  await page.fill("#miles", "1300");
  await page.fill("#depart", "2026-06-15T08:00");
  await page.dispatchEvent("#miles", "input");
  await page.dispatchEvent("#depart", "input");
  await page.waitForTimeout(150);
  // Every clock in the app carries its own tz suffix now (etaClock/rsClock via a smaller
  // "big-tz" span) — HH:MM followed by a space and a timezone code, not bare HH:MM alone.
  const etaClock = (await page.textContent("#etaClock"))?.trim();
  if (!/^\d{2}:\d{2} \S+$/.test(etaClock || "") || etaClock === "--:--")
    fail(`expected a computed arrival clock with its own tz suffix, got ${JSON.stringify(etaClock)}`);
  // Simple ETA's "Tuned model says HH:MM (...)" comparison line needed its own tz code too.
  const quickNoteText = (await page.textContent("#quickNote")) || "";
  if (!/Tuned model says \d{2}:\d{2} [A-Z]{2,6} \(/.test(quickNoteText))
    fail(`quickNote's tuned-model time should carry its own tz code, got ${JSON.stringify(quickNoteText)}`);

  // The "who's driving on arrival" line: hidden on Estimated (default), shown on Tuned.
  if (await page.isVisible("#etaShift"))
    fail("shift line should be hidden on the Estimated sub-tab");
  await page.click("#tabTuned");
  await page.waitForTimeout(100);
  if (!(await page.isVisible("#etaShift")))
    fail("shift line should be visible on the Tuned sub-tab");
  const shiftText = (await page.textContent("#etaShift"))?.trim();
  if (!/^(day|night) shift driving$/.test(shiftText || ""))
    fail(`expected a shift readout, got ${JSON.stringify(shiftText)}`);
  await page.click("#tabQuick");
  await page.waitForTimeout(100);
  if (await page.isVisible("#etaShift"))
    fail("shift line should hide again when switching back to Estimated");

  // CLEAR button: enabled once there's a load, two-tap arm/confirm empties the load
  // and returns the readout to its placeholder.
  if (await page.isDisabled("#etaClear"))
    fail("CLEAR should be enabled while a load is entered");
  await page.click("#etaClear");                 // arm
  await page.click("#etaClear");                 // confirm
  await page.waitForTimeout(100);
  const milesAfter = await page.inputValue("#miles");
  const clockAfter = (await page.textContent("#etaClock"))?.trim();
  if (milesAfter !== "") fail(`CLEAR should empty miles, got ${JSON.stringify(milesAfter)}`);
  if (clockAfter !== "--:--") fail(`CLEAR should reset the readout, got ${JSON.stringify(clockAfter)}`);
  if (!(await page.isDisabled("#etaClear")))
    fail("CLEAR should be inert again once the load is empty");

  // 34 Reset tab: choosing a date must NOT start the reset (picker-lockout regression).
  await page.click("#tabReset");
  await page.waitForTimeout(100);
  if (!(await page.isVisible("#rsInputCard")))
    fail("shutdown input should be visible in the empty reset state");

  // A future shutdown (planned ahead), so committing it starts a live reset rather than
  // tripping the auto-clear that a long-past date would.
  const soon = new Date(Date.now() + 2 * 24 * 3600e3);
  const pad = n => String(n).padStart(2, "0");
  const wall = `${soon.getFullYear()}-${pad(soon.getMonth() + 1)}-${pad(soon.getDate())}T08:00`;

  // Setting the field value fires input/change — as the native picker does on open/scroll.
  // The input must stay up: a reset starts only on an explicit commit.
  await page.fill("#shut", wall);
  await page.dispatchEvent("#shut", "change");
  await page.waitForTimeout(100);
  if (!(await page.isVisible("#rsInputCard")))
    fail("choosing a date must not start the reset or hide the input");

  // Commit the chosen date with SET — now the reset starts and the input collapses.
  await page.click("#rsSetShut");
  await page.waitForTimeout(100);
  if (await page.isVisible("#rsInputCard"))
    fail("shutdown input should collapse once a chosen date is committed with SET");
  const rsClockText = (await page.textContent("#rsClock"))?.trim() || "";
  if (rsClockText === "--:--")
    fail("committing a shutdown should show the computed legal time");
  if (!/^\d{2}:\d{2} \S+$/.test(rsClockText))
    fail(`rsClock should carry its own tz suffix, got ${JSON.stringify(rsClockText)}`);
  // A future (planned-ahead) shutdown shows the "Clock starts in ... · HH:MM Day" preview —
  // that preview time needed its own tz code too.
  const rsCountText = (await page.textContent("#rsCount")) || "";
  if (!/Clock starts in .+ · \d{2}:\d{2} [A-Z]{2,6} /.test(rsCountText))
    fail(`rsCount's pending-preview time should carry its own tz code, got ${JSON.stringify(rsCountText)}`);
  await page.click("#rsClear");                  // arm
  await page.click("#rsClear");                  // confirm CLEAR TIMER
  await page.waitForTimeout(100);
  if (!(await page.isVisible("#rsInputCard")))
    fail("shutdown input should return after CLEAR TIMER");

  // NOW is unchanged: it starts a reset from now and collapses the input.
  await page.click("#rsNow");
  await page.waitForTimeout(100);
  if (await page.isVisible("#rsInputCard"))
    fail("NOW should start a reset and hide the input");
  await page.click("#rsClear");
  await page.click("#rsClear");
  await page.waitForTimeout(100);

  // Auto-clear edge case: a reset that completed over 10 min ago must open in the clean
  // empty state (never a stale "Complete" screen or a negative countdown). Seed a stale
  // completed reset into storage, reload, and confirm the app clears it on open.
  await page.evaluate(() => {
    const shutMs = Date.now() - 35 * 3600e3;     // finished ~1h ago, past the 10-min window
    localStorage.setItem("milespost.reset",
      JSON.stringify({ shutMs, tz: "America/New_York", tzName: "Test" }));
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.click("#tabReset");
  await page.waitForTimeout(100);
  if (!(await page.isVisible("#rsInputCard")))
    fail("a long-completed reset should auto-clear to the empty state on open");
  if (((await page.textContent("#rsClock"))?.trim()) !== "--:--")
    fail("auto-cleared reset should show the placeholder readout, not a stale time");

  if (errors.length) fail("page errors: " + JSON.stringify(errors, null, 2));

  // ---- LIVE ETA wiring: mocked HERE fetch + mocked geolocation. No real key, no network.
  // Happy path: GPS ok, geocode + truck route answer -> LIVE line renders with the arrival.
  const livePage = await browser.newPage();
  const liveErrors = [];
  livePage.on("pageerror", e => liveErrors.push("pageerror: " + e.message));
  await livePage.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", { value: {
      getCurrentPosition: ok => ok({ coords: { latitude: 41.8781, longitude: -87.6298 } })
    }});
    const realFetch = window.fetch.bind(window);
    window.__hereUrls = [];
    window.fetch = (url, ...rest) => {
      const u = String(url);
      if (u.includes("hereapi.com")) window.__hereUrls.push(u);
      if (u.includes("geocode.search.hereapi.com"))
        return Promise.resolve(new Response(JSON.stringify(
          { items: [{ position: { lat: 36.1627, lng: -86.7816 } }] })));
      if (u.includes("router.hereapi.com"))
        return Promise.resolve(new Response(JSON.stringify(
          // 6h drive, 20min of it traffic, 400 mi (643,738 m)
          { routes: [{ sections: [{ summary: { duration: 21600, baseDuration: 20400, length: 643738 } }] }] })));
      return realFetch(url, ...rest);
    };
  });
  await livePage.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "networkidle" });
  await livePage.fill("#miles", "400");
  await livePage.dispatchEvent("#miles", "input");
  await livePage.fill("#destIn", "Nashville TN");
  await livePage.press("#destIn", "Enter");
  await livePage.click("#tabTuned");
  await livePage.click("#liveBtn");
  await livePage.waitForTimeout(300);
  if (!(await livePage.isVisible("#liveLine")))
    fail("LIVE line should render after a successful mocked HERE fetch");
  const liveText = (await livePage.textContent("#liveLine"))?.trim() || "";
  if (!/^LIVE \d{2}:\d{2}/.test(liveText))
    fail(`LIVE line should lead with an arrival clock, got ${JSON.stringify(liveText)}`);
  if (!liveText.includes("400 mi")) fail(`LIVE line should show the route miles, got ${JSON.stringify(liveText)}`);
  if (!liveText.includes("traffic +20m")) fail(`LIVE line should show the traffic cost, got ${JSON.stringify(liveText)}`);
  // Route params sanity: the request must be truck mode with the vehicle[...] dimensions —
  // never a silent fall-back to car routing.
  const routeUrl = await livePage.evaluate(() =>
    (window.__hereUrls || []).find(u => u.includes("router.hereapi.com")) || "");
  if (!routeUrl.includes("transportMode=truck")) fail("routing request must use transportMode=truck");
  for (const p of ["vehicle%5BgrossWeight%5D=36287", "vehicle%5Bheight%5D=412",
                   "vehicle%5BaxleCount%5D=5", "vehicle%5BtrailerCount%5D=1"])
    if (!routeUrl.includes(p)) fail(`routing request missing truck param ${decodeURIComponent(p)}`);
  // v8 is traffic-aware by OMITTING departureTime (defaults to now). The v7 literal
  // departureTime=now gets a 400 "Malformed request" — keep it out.
  if (routeUrl.includes("departureTime")) fail("routing request must omit departureTime (v8 defaults to now; the literal 400s)");
  await livePage.click("#tabQuick");
  await livePage.waitForTimeout(100);
  if (await livePage.isVisible("#liveLine")) fail("LIVE line must not show on the Estimated tab");
  // Opening the tuning grid stands the LIVE CTA down, so the fields sit directly under the
  // toggle that revealed them; closing it must bring the button back. A one-way hide here
  // would strand the driver with no way to refresh a live ETA.
  await livePage.click("#tabTuned");
  await livePage.waitForTimeout(100);
  if (!(await livePage.isVisible("#liveBtn"))) fail("LIVE button should be visible with tuning closed");
  if (!(await livePage.isVisible("#overrideRow"))) fail("override row should be visible with tuning closed");
  // Turn override on before opening tuning, so hiding the row can be checked against
  // actually losing the driver's choice — a hide that also resets E.liveOverride would
  // be a worse bug than the row simply staying on screen.
  if ((await livePage.textContent("#overrideState"))?.trim() !== "OFF")
    fail("override indicator should read OFF before it's ever been toggled");
  await livePage.click("#overrideBtn");
  if ((await livePage.textContent("#overrideState"))?.trim() !== "ON")
    fail("override indicator should flip to ON as soon as the switch is toggled");
  await livePage.click("#tuneToggle");
  await livePage.waitForTimeout(150);
  if (!(await livePage.isVisible("#tuneGrid"))) fail("tuning grid should open");
  if (await livePage.isVisible("#liveBtn")) fail("LIVE button should be hidden while tuning is open");
  if (await livePage.isVisible("#overrideRow")) fail("override row should be hidden while tuning is open");
  await livePage.click("#tuneToggle");
  await livePage.waitForTimeout(150);
  if (await livePage.isVisible("#tuneGrid")) fail("tuning grid should close again");
  if (!(await livePage.isVisible("#liveBtn"))) fail("LIVE button must come back when tuning closes");
  if (!(await livePage.isVisible("#overrideRow"))) fail("override row must come back when tuning closes");
  if ((await livePage.getAttribute("#overrideBtn", "aria-checked")) !== "true")
    fail("override state must survive being hidden behind tuning, not reset");
  if (liveErrors.length) fail("live page errors: " + JSON.stringify(liveErrors, null, 2));
  await livePage.close();

  // Denied path: GPS permission refused -> LIVE line stays hidden, tuned readout intact,
  // unobtrusive note shown. The UI must never block or error.
  const deniedPage = await browser.newPage();
  const deniedErrors = [];
  deniedPage.on("pageerror", e => deniedErrors.push("pageerror: " + e.message));
  await deniedPage.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", { value: {
      getCurrentPosition: (_ok, err) => err({ code: 1, message: "denied" })
    }});
  });
  await deniedPage.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "networkidle" });
  await deniedPage.fill("#miles", "400");
  await deniedPage.dispatchEvent("#miles", "input");
  await deniedPage.fill("#destIn", "Nashville TN");
  await deniedPage.press("#destIn", "Enter");
  await deniedPage.click("#tabTuned");
  await deniedPage.click("#liveBtn");
  await deniedPage.waitForTimeout(300);
  if (await deniedPage.isVisible("#liveLine"))
    fail("LIVE line must stay hidden when GPS is denied");
  const noteText = (await deniedPage.textContent("#liveNote"))?.trim() || "";
  if (!/live unavailable/.test(noteText))
    fail(`denied path should show the unobtrusive fallback note, got ${JSON.stringify(noteText)}`);
  const tunedClock = (await deniedPage.textContent("#etaClock"))?.trim();
  if (!/^\d{2}:\d{2} \S+$/.test(tunedClock || "") || tunedClock === "--:--")
    fail("tuned readout must stay intact when live is unavailable");
  if (deniedErrors.length) fail("denied page errors: " + JSON.stringify(deniedErrors, null, 2));
  await deniedPage.close();

  // Shared mock for the autofill cases below: same geocode/route responses as the happy path.
  const mockHere = page => page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", { value: {
      getCurrentPosition: ok => ok({ coords: { latitude: 41.8781, longitude: -87.6298 } })
    }});
    const realFetch = window.fetch.bind(window);
    window.fetch = (url, ...rest) => {
      const u = String(url);
      if (u.includes("geocode.search.hereapi.com"))
        return Promise.resolve(new Response(JSON.stringify(
          { items: [{ position: { lat: 36.1627, lng: -86.7816 } }] })));
      if (u.includes("router.hereapi.com"))
        return Promise.resolve(new Response(JSON.stringify(
          // 6h drive, 20min of it traffic, 400 mi (643,738 m). Length is overridable via
          // window.__routeMeters so a test can simulate re-quoting a different destination.
          { routes: [{ sections: [{ summary: { duration: 21600, baseDuration: 20400,
            length: window.__routeMeters || 643738 } }] }] })));
      return realFetch(url, ...rest);
    };
  });

  // Autofill, blank-field path: miles left untouched -> UPDATE LIVE ETA fills it from the
  // route's real road distance (400 mi from the mocked response).
  const autofillPage = await browser.newPage();
  const autofillErrors = [];
  autofillPage.on("pageerror", e => autofillErrors.push("pageerror: " + e.message));
  await mockHere(autofillPage);
  await autofillPage.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "networkidle" });
  await autofillPage.fill("#destIn", "Nashville TN");
  await autofillPage.press("#destIn", "Enter");
  await autofillPage.click("#tabTuned");
  await autofillPage.click("#liveBtn");
  await autofillPage.waitForTimeout(300);
  const filledMiles = await autofillPage.inputValue("#miles");
  if (filledMiles !== "400")
    fail(`blank miles should autofill from the live route distance, got ${JSON.stringify(filledMiles)}`);
  // The autofill runs the field through repaintField(), which drops it out of layout and
  // restores it to force Mobile Safari to redraw. The redraw itself can't be observed in
  // Chromium, but the cleanup can: if the restore is ever dropped the field stays
  // display:none and vanishes outright, which is far worse than the bug being fixed.
  const milesBox = await autofillPage.evaluate(() => {
    const el = document.getElementById("miles");
    return { inline: el.style.display, computed: getComputedStyle(el).display,
             visible: el.getBoundingClientRect().height > 0 };
  });
  if (milesBox.inline !== "" || milesBox.computed === "none" || !milesBox.visible)
    fail(`miles field must be left visible after the repaint, got ${JSON.stringify(milesBox)}`);
  // Re-quoting for a different destination must REFRESH a mileage we filled in ourselves —
  // a blank-only guard can't tell its own number from a typed one, and used to strand the
  // previous city's distance in the field. (The typed-mileage case is covered separately
  // below and must still be left alone.)
  await autofillPage.evaluate(() => { window.__routeMeters = 1207008; });   // 750 mi
  await autofillPage.fill("#destIn", "Laredo TX");
  await autofillPage.press("#destIn", "Enter");
  await autofillPage.click("#liveBtn");
  await autofillPage.waitForTimeout(300);
  const requoted = await autofillPage.inputValue("#miles");
  if (requoted !== "750")
    fail(`re-quoting a new destination should refresh our own autofilled mileage, got ${JSON.stringify(requoted)}`);
  if (autofillErrors.length) fail("autofill page errors: " + JSON.stringify(autofillErrors, null, 2));
  await autofillPage.close();

  // Autofill, pre-filled path: a mileage already typed (dispatch's own figure, say) must
  // never be overwritten by the live route's distance, even though it differs from it.
  const keepPage = await browser.newPage();
  const keepErrors = [];
  keepPage.on("pageerror", e => keepErrors.push("pageerror: " + e.message));
  await mockHere(keepPage);
  await keepPage.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "networkidle" });
  await keepPage.fill("#miles", "250");
  await keepPage.dispatchEvent("#miles", "input");
  await keepPage.fill("#destIn", "Nashville TN");
  await keepPage.press("#destIn", "Enter");
  await keepPage.click("#tabTuned");
  await keepPage.click("#liveBtn");
  await keepPage.waitForTimeout(300);
  const keptMiles = await keepPage.inputValue("#miles");
  if (keptMiles !== "250")
    fail(`a typed mileage must survive a live fetch untouched, got ${JSON.stringify(keptMiles)}`);
  if (keepErrors.length) fail("keep-miles page errors: " + JSON.stringify(keepErrors, null, 2));
  await keepPage.close();

  // LIVE line timezone: the leading clock is destination-local (same tz the main arrival
  // number uses) already, by virtue of using showTz — nothing to change there. What's new
  // is a muted "current device timezone" addendum, mirroring etaYours, when the driver's
  // own origin tz differs from the destination's. Force a real tz mismatch via a fresh
  // context (device clock in LA, destination in Nashville/Central) rather than trusting
  // the code reads right without ever actually observing two different clocks.
  const tzCtx = await browser.newContext({ timezoneId: "America/Los_Angeles" });
  const tzPage = await tzCtx.newPage();
  const tzErrors = [];
  tzPage.on("pageerror", e => tzErrors.push("pageerror: " + e.message));
  await mockHere(tzPage);
  await tzPage.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "networkidle" });
  await tzPage.fill("#destIn", "Nashville TN");
  await tzPage.press("#destIn", "Enter");
  await tzPage.click("#tabTuned");
  await tzPage.click("#liveBtn");
  await tzPage.waitForTimeout(300);
  const mismatchLine = (await tzPage.textContent("#liveLine"))?.trim() || "";
  if (!/current device timezone$/.test(mismatchLine))
    fail(`LIVE line should append a current-device-timezone addendum when origin/destination tz differ, got ${JSON.stringify(mismatchLine)}`);
  if (!mismatchLine.includes("PDT") && !mismatchLine.includes("PST"))
    fail(`current-device-timezone addendum should be in the origin's (Pacific) tz, got ${JSON.stringify(mismatchLine)}`);
  if (tzErrors.length) fail("tz-mismatch page errors: " + JSON.stringify(tzErrors, null, 2));
  await tzCtx.close();

  // Same-tz case: no addendum should appear at all — a driver whose origin and
  // destination share a timezone doesn't need to be told their own clock twice.
  const sameTzCtx = await browser.newContext({ timezoneId: "America/Los_Angeles" });
  const sameTzPage = await sameTzCtx.newPage();
  const sameTzErrors = [];
  sameTzPage.on("pageerror", e => sameTzErrors.push("pageerror: " + e.message));
  await mockHere(sameTzPage);
  await sameTzPage.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "networkidle" });
  await sameTzPage.fill("#destIn", "Los Angeles CA");
  await sameTzPage.press("#destIn", "Enter");
  await sameTzPage.click("#tabTuned");
  await sameTzPage.click("#liveBtn");
  await sameTzPage.waitForTimeout(300);
  const sameTzLine = (await sameTzPage.textContent("#liveLine"))?.trim() || "";
  if (/current device timezone$/.test(sameTzLine))
    fail(`LIVE line should NOT show a current-device-timezone addendum when origin and destination share a tz, got ${JSON.stringify(sameTzLine)}`);
  if (sameTzErrors.length) fail("same-tz page errors: " + JSON.stringify(sameTzErrors, null, 2));
  await sameTzCtx.close();

  // Override ON: the driver has opted in, so live now wins even over a typed mileage —
  // the exact opposite of the keepPage case above, which is the default (override off).
  const overridePage = await browser.newPage();
  const overrideErrors = [];
  overridePage.on("pageerror", e => overrideErrors.push("pageerror: " + e.message));
  await mockHere(overridePage);
  await overridePage.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "networkidle" });
  await overridePage.fill("#miles", "250");
  await overridePage.dispatchEvent("#miles", "input");
  await overridePage.fill("#destIn", "Nashville TN");
  await overridePage.press("#destIn", "Enter");
  await overridePage.click("#tabTuned");
  await overridePage.click("#overrideBtn");
  await overridePage.click("#liveBtn");
  await overridePage.waitForTimeout(300);
  const overriddenMiles = await overridePage.inputValue("#miles");
  if (overriddenMiles === "250" || overriddenMiles === "")
    fail(`override on should overwrite a typed mileage with the live distance, got ${JSON.stringify(overriddenMiles)}`);
  if (overrideErrors.length) fail("override page errors: " + JSON.stringify(overrideErrors, null, 2));
  await overridePage.close();

  // CLEAR after a live quote: LIVE.res/at/note must be invalidated, not just the fields.
  // Note this ISN'T visible as "the LIVE line disappears right after tapping CLEAR" — it
  // already does, simply because miles goes to 0 and renderEta() bails out early before
  // ever reaching the liveOn check. The actual bug is subtler and only shows up one step
  // later: if a stale LIVE.res/at survive the clear, entering a BRAND NEW destination
  // afterwards (one that was never live-quoted) would still show a fresh-looking "LIVE"
  // line — for the OLD destination's route, mislabeled onto the new one. Reproduce that
  // exact sequence: quote live for Nashville, CLEAR, then set a new destination (Laredo)
  // and miles WITHOUT tapping UPDATE LIVE ETA again — the LIVE line must stay hidden.
  // Tuning (preset/tuned values/swap schedule) must be untouched throughout — CLEAR
  // empties the load, not the truck.
  const clearLivePage = await browser.newPage();
  const clearLiveErrors = [];
  clearLivePage.on("pageerror", e => clearLiveErrors.push("pageerror: " + e.message));
  await mockHere(clearLivePage);
  await clearLivePage.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "networkidle" });
  await clearLivePage.fill("#destIn", "Nashville TN");
  await clearLivePage.press("#destIn", "Enter");
  await clearLivePage.click("#tabTuned");
  await clearLivePage.locator("#presets button").nth(2).click();   // Push — distinct from the default Realistic
  await clearLivePage.click("#liveBtn");
  await clearLivePage.waitForTimeout(300);
  if (!(await clearLivePage.isVisible("#liveLine")))
    fail("LIVE line should be showing before CLEAR (setup check)");
  const tuneBefore = await clearLivePage.evaluate(() => ({
    preset: [...document.getElementById("presets").children].find(b => b.getAttribute("aria-selected") === "true")?.textContent,
    tune: ["mph","fuelEvery","fuelMin","swapMin","dotMin","dotAt"].map(id => document.getElementById(id).value),
    swap: ["swapA","swapB","swapTz"].map(id => document.getElementById(id).value),
  }));
  await clearLivePage.click("#etaClear");                   // arm
  await clearLivePage.click("#etaClear");                   // confirm
  await clearLivePage.waitForTimeout(150);
  if (await clearLivePage.isVisible("#liveLine"))
    fail("CLEAR should hide a showing LIVE line immediately (miles is 0, so this is the easy part)");
  // Now the real check: a new destination, never live-quoted, must not inherit Nashville's
  // stale LIVE.res — set miles directly (bypassing UPDATE LIVE ETA) so only a leftover
  // LIVE.res/at could possibly make the line reappear.
  await clearLivePage.fill("#destIn", "Laredo TX");
  await clearLivePage.press("#destIn", "Enter");
  await clearLivePage.fill("#miles", "900");
  await clearLivePage.dispatchEvent("#miles", "input");
  await clearLivePage.waitForTimeout(150);
  if (await clearLivePage.isVisible("#liveLine"))
    fail("a brand-new destination must not inherit a stale LIVE quote left over from before CLEAR");
  const tuneAfter = await clearLivePage.evaluate(() => ({
    preset: [...document.getElementById("presets").children].find(b => b.getAttribute("aria-selected") === "true")?.textContent,
    tune: ["mph","fuelEvery","fuelMin","swapMin","dotMin","dotAt"].map(id => document.getElementById(id).value),
    swap: ["swapA","swapB","swapTz"].map(id => document.getElementById(id).value),
  }));
  if (JSON.stringify(tuneBefore) !== JSON.stringify(tuneAfter))
    fail(`CLEAR must not touch tuning/preset/swap, got ${JSON.stringify(tuneBefore)} -> ${JSON.stringify(tuneAfter)}`);
  if (clearLiveErrors.length) fail("clear-live page errors: " + JSON.stringify(clearLiveErrors, null, 2));
  await clearLivePage.close();

  // GET MILEAGE: Simple-tab-only convenience button. Destination set, miles blank ->
  // button appears; click it -> miles fills from the same mocked HERE route (400 mi) AND
  // the app must not have produced anything resembling a live/traffic-aware quote — that's
  // the whole point of this button being narrower than UPDATE LIVE ETA.
  const getMiPage = await browser.newPage();
  const getMiErrors = [];
  getMiPage.on("pageerror", e => getMiErrors.push("pageerror: " + e.message));
  await mockHere(getMiPage);
  await getMiPage.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "networkidle" });
  if (await getMiPage.isVisible("#getMiBtn"))
    fail("#getMiBtn should start hidden with no destination set");
  await getMiPage.fill("#destIn", "Nashville TN");
  await getMiPage.press("#destIn", "Enter");
  await getMiPage.waitForTimeout(100);
  if (!(await getMiPage.isVisible("#getMiBtn")))
    fail("#getMiBtn should appear once a destination is set and miles is blank, on the Simple tab");
  await getMiPage.click("#getMiBtn");
  await getMiPage.waitForTimeout(300);
  const getMiMiles = await getMiPage.inputValue("#miles");
  if (getMiMiles !== "400")
    fail(`GET MILEAGE should fill miles from the real road distance, got ${JSON.stringify(getMiMiles)}`);
  if (await getMiPage.isVisible("#getMiBtn"))
    fail("#getMiBtn should hide itself once miles has a value");
  // The actual boundary this button exists to respect: no live/traffic-aware quote. LIVE
  // isn't exposed on window, so infer through the same UI a real live quote would show —
  // the LIVE line — both immediately and after switching to the tab that would display it.
  if (await getMiPage.isVisible("#liveLine"))
    fail("GET MILEAGE must never produce a visible LIVE line on the Simple tab");
  await getMiPage.click("#tabTuned");
  await getMiPage.waitForTimeout(150);
  if (await getMiPage.isVisible("#liveLine"))
    fail("GET MILEAGE must not have produced a live quote at all — still absent after switching to Tuned");
  if (getMiErrors.length) fail("getMi page errors: " + JSON.stringify(getMiErrors, null, 2));
  await getMiPage.close();

  // Negative case: same destination-set/miles-blank state, but on the Tuned tab — the
  // Tuned tab already has UPDATE LIVE ETA for this, so GET MILEAGE must never show there.
  const getMiTunedPage = await browser.newPage();
  const getMiTunedErrors = [];
  getMiTunedPage.on("pageerror", e => getMiTunedErrors.push("pageerror: " + e.message));
  await mockHere(getMiTunedPage);
  await getMiTunedPage.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "networkidle" });
  await getMiTunedPage.fill("#destIn", "Nashville TN");
  await getMiTunedPage.press("#destIn", "Enter");
  await getMiTunedPage.click("#tabTuned");
  await getMiTunedPage.waitForTimeout(150);
  if (await getMiTunedPage.isVisible("#getMiBtn"))
    fail("#getMiBtn must never appear on the Tuned tab — UPDATE LIVE ETA already covers this");
  if (getMiTunedErrors.length) fail("getMi-tuned page errors: " + JSON.stringify(getMiTunedErrors, null, 2));
  await getMiTunedPage.close();

  // Per-field "×" buttons: each clears only its own field, leaving the other field (and
  // tuning) untouched. Miles first, then destination, on two independent fresh pages so
  // one test can't mask the other.
  const milesClearPage = await browser.newPage();
  const milesClearErrors = [];
  milesClearPage.on("pageerror", e => milesClearErrors.push("pageerror: " + e.message));
  await milesClearPage.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "networkidle" });
  await milesClearPage.fill("#miles", "500");
  await milesClearPage.dispatchEvent("#miles", "input");
  await milesClearPage.fill("#destIn", "Nashville TN");
  await milesClearPage.press("#destIn", "Enter");
  await milesClearPage.waitForTimeout(100);
  if (!(await milesClearPage.isVisible("#milesClear")))
    fail("#milesClear should be visible once miles has content");
  await milesClearPage.click("#milesClear");
  await milesClearPage.waitForTimeout(100);
  if ((await milesClearPage.inputValue("#miles")) !== "")
    fail("#milesClear should empty the miles field");
  if (await milesClearPage.isVisible("#milesClear"))
    fail("#milesClear should hide itself once its field is empty");
  if ((await milesClearPage.inputValue("#destIn")) !== "Nashville TN")
    fail("#milesClear must not touch the destination field");
  if (!(await milesClearPage.isVisible("#destMeta")))
    fail("#milesClear must not un-resolve an already-set destination");
  if (milesClearErrors.length) fail("milesClear page errors: " + JSON.stringify(milesClearErrors, null, 2));
  await milesClearPage.close();

  const destClearPage = await browser.newPage();
  const destClearErrors = [];
  destClearPage.on("pageerror", e => destClearErrors.push("pageerror: " + e.message));
  await destClearPage.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "networkidle" });
  await destClearPage.fill("#miles", "500");
  await destClearPage.dispatchEvent("#miles", "input");
  await destClearPage.fill("#destIn", "Nashville TN");
  await destClearPage.press("#destIn", "Enter");
  await destClearPage.waitForTimeout(100);
  if (!(await destClearPage.isVisible("#destClear")))
    fail("#destClear should be visible once destIn has content");
  await destClearPage.click("#destClear");
  await destClearPage.waitForTimeout(100);
  if ((await destClearPage.inputValue("#destIn")) !== "")
    fail("#destClear should empty the destination field");
  if (await destClearPage.isVisible("#destMeta"))
    fail("#destClear should un-resolve the destination (destMeta hidden)");
  if ((await destClearPage.inputValue("#miles")) !== "500")
    fail("#destClear must not touch the miles field");
  if (destClearErrors.length) fail("destClear page errors: " + JSON.stringify(destClearErrors, null, 2));
  await destClearPage.close();

  // ---- City suggestions (destIn/origIn/rsIn share one mechanism — test destIn as the
  // representative case). The primary source is HERE Autocomplete (types=city), which
  // returns cities only — including same-named cities in different states. Mocked items
  // mirror what this account's plan actually returns: locality items with only a flat
  // address.label — no structured city/stateCode fields (confirmed via an on-device
  // diagnostic build) — proving the label-parsing fallback runs through end-to-end.
  const suggestPage = await browser.newPage();
  const suggestErrors = [];
  suggestPage.on("pageerror", e => suggestErrors.push("pageerror: " + e.message));
  await suggestPage.addInitScript(() => {
    const realFetch = window.fetch.bind(window);
    window.fetch = (url, ...rest) => {
      const u = String(url);
      if (u.includes("autocomplete.search.hereapi.com"))
        return Promise.resolve(new Response(JSON.stringify({ items: [
          { resultType: "locality", title: "Nashville, TN, United States",
            address: { label: "Nashville, TN, United States" } },
          { resultType: "locality", title: "Nashville, GA, United States",
            address: { label: "Nashville, GA, United States" } },
        ]})));
      return realFetch(url, ...rest);
    };
  });
  await suggestPage.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "networkidle" });
  await suggestPage.fill("#destIn", "Nash");
  // Wait for the debounced (300ms) mocked fetch to land, rather than a fixed sleep —
  // more reliable under variable CI/sandbox load than guessing the round-trip time.
  try{ await suggestPage.waitForSelector("#destSuggest button", { timeout: 5000 }); }
  catch{ fail("suggestion dropdown should appear after typing 3+ characters"); }
  if (!(await suggestPage.isVisible("#destSuggest")))
    fail("suggestion dropdown should appear after typing 3+ characters");
  const suggestButtons = await suggestPage.locator("#destSuggest button").allTextContents();
  if (JSON.stringify(suggestButtons) !== JSON.stringify(["Nashville, TN", "Nashville, GA"]))
    fail(`suggestion list should show both same-named cities, got ${JSON.stringify(suggestButtons)}`);
  // The dropdown must OVERLAY the fields below it, not push them around. This also guards
  // the stylesheet itself: a CSS syntax error upstream silently drops the .suggest rule,
  // and every behavioural assertion here still passes while the layout is wrecked.
  const suggestPos = await suggestPage.locator("#destSuggest")
    .evaluate(el => getComputedStyle(el).position);
  if (suggestPos !== "absolute")
    fail(`#destSuggest must be absolutely positioned (CSS may have failed to parse), got ${suggestPos}`);
  await suggestPage.click("#destSuggest button");
  await suggestPage.waitForTimeout(150);
  if (await suggestPage.isVisible("#destSuggest")) fail("clicking a suggestion should close the dropdown");
  if ((await suggestPage.inputValue("#destIn")) !== "Nashville, TN")
    fail("clicking a suggestion should fill the input with the picked 'City, ST'");
  // The real proof this isn't just a text fill: doDest() must actually have run and
  // resolved the place (destChip appears with the picked destination).
  if (!(await suggestPage.isVisible("#destChip")))
    fail("picking a suggestion should resolve the destination (destChip should appear)");
  const chipText = (await suggestPage.textContent("#destChip"))?.trim() || "";
  if (!chipText.includes("Nashville, TN"))
    fail(`destChip should show the resolved destination, got ${JSON.stringify(chipText)}`);
  // Picking a suggestion dispatches a synthetic "input" event on the field (a WebKit
  // repaint fix), which is the SAME event the field's own debounced-suggestion listener
  // is watching — that listener schedules a fresh fetch for the just-picked text, which
  // would silently reopen this exact dropdown ~300ms later if not cancelled. Outlive the
  // debounce and confirm it stays shut.
  await suggestPage.waitForTimeout(350);
  if (await suggestPage.isVisible("#destSuggest"))
    fail("dropdown must not reopen after the debounce window from picking a suggestion");
  if (suggestErrors.length) fail("suggest page errors: " + JSON.stringify(suggestErrors, null, 2));
  await suggestPage.close();

  // ---- Suggestion fallback: if the Autocomplete endpoint fails (plan limits, outage),
  // the old Autosuggest call must silently take over so suggestions degrade, not vanish.
  const fbPage = await browser.newPage();
  const fbErrors = [];
  fbPage.on("pageerror", e => fbErrors.push("pageerror: " + e.message));
  await fbPage.addInitScript(() => {
    const realFetch = window.fetch.bind(window);
    window.fetch = (url, ...rest) => {
      const u = String(url);
      if (u.includes("autocomplete.search.hereapi.com"))
        return Promise.resolve(new Response("nope", { status: 500 }));
      if (u.includes("autosuggest.search.hereapi.com"))
        return Promise.resolve(new Response(JSON.stringify({ items: [
          { resultType: "locality", title: "Nashville, TN, United States",
            address: { label: "Nashville, TN, United States" } },
          { resultType: "place", title: "Nashville Zoo",
            address: { label: "Nashville Zoo, Nashville, TN, United States" } },
        ]})));
      return realFetch(url, ...rest);
    };
  });
  await fbPage.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "networkidle" });
  await fbPage.fill("#destIn", "Nash");
  try{ await fbPage.waitForSelector("#destSuggest button", { timeout: 5000 }); }
  catch{ fail("suggestions should fall back to autosuggest when autocomplete fails"); }
  const fbButtons = await fbPage.locator("#destSuggest button").allTextContents();
  if (JSON.stringify(fbButtons) !== JSON.stringify(["Nashville, TN"]))
    fail(`fallback list should show the filtered autosuggest locality, got ${JSON.stringify(fbButtons)}`);
  if (fbErrors.length) fail("fallback page errors: " + JSON.stringify(fbErrors, null, 2));
  await fbPage.close();

  // ---- Help modal: shared by all four "?" buttons. Light smoke — one button proves the
  // mechanism (open with real content, panel-tap doesn't dismiss, backdrop-tap does).
  // Uses #rsHelp since the main page is currently on the 34 Reset tab.
  if (await page.isVisible("#helpBackdrop")) fail("help modal should start hidden");
  await page.click("#rsHelp");
  await page.waitForTimeout(100);
  if (!(await page.isVisible("#helpBackdrop"))) fail("help modal should open on '?' click");
  const helpTitle = (await page.textContent("#helpTitle"))?.trim();
  const helpBody = (await page.textContent("#helpBody"))?.trim();
  if (!helpTitle) fail("help modal should show a non-empty title");
  if (!helpBody) fail("help modal should show non-empty body text");
  await page.click("#helpTitle");                 // tap inside the panel
  await page.waitForTimeout(100);
  if (!(await page.isVisible("#helpBackdrop"))) fail("tapping inside the panel must not close it");
  await page.click("#helpBackdrop", { position: { x: 5, y: 5 } });  // tap the backdrop itself
  await page.waitForTimeout(100);
  if (await page.isVisible("#helpBackdrop")) fail("tapping the backdrop should close the help modal");

  // overrideHelp is new — confirm ITS specific wiring (not just that some help button
  // works), since a copy-paste of the shared pattern is exactly where a wrong HELP key
  // would slip through unnoticed. #tabTuned lives inside #viewEta, hidden while the main
  // page is on the Reset view (see the comment above) — switch back first.
  await page.click("#tabEta"); await page.click("#tabTuned"); await page.waitForTimeout(100);
  await page.click("#overrideHelp");
  await page.waitForTimeout(100);
  if ((await page.textContent("#helpTitle"))?.trim() !== "Override")
    fail(`overrideHelp should open the Override help entry, got ${JSON.stringify((await page.textContent("#helpTitle"))?.trim())}`);
  await page.click("#helpBackdrop", { position: { x: 5, y: 5 } });
  await page.waitForTimeout(100);
  if (await page.isVisible("#helpBackdrop")) fail("tapping the backdrop should close the override help modal");

  if (!process.exitCode)
    console.log(`SMOKE OK: arrival ${etaClock}, shift "${shiftText}" (Tuned only), CLEAR empties the load, reset picker stays up until SET/NOW, LIVE renders from mocked HERE + hides on GPS denial, LIVE autofills blank miles but never overwrites a typed one (override off) but always overwrites when override is on, live re-quote refreshes its own autofilled miles, CLEAR invalidates a stale LIVE quote without touching tuning, GET MILEAGE fills miles on Simple tab only without ever producing a live quote, per-field × buttons clear independently, city suggestions show same-named cities across states + fall back to autosuggest on autocomplete failure, tuning toggle stands the LIVE CTA down and back, help modal opens/stays/dismisses correctly, module loaded, no page errors`);
} finally {
  await browser.close();
  server.close();
}
