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
  // Predicted's cross-model comparison is live-sourced now, so with no quote in hand the
  // comparison board must be absent entirely — never a stale or fabricated comparison.
  // (The present-after-a-quote half is asserted on livePage, which has one.)
  const quickNoteText = (await page.textContent("#quickNote")) || "";
  if (!/÷ 50 =/.test(quickNoteText))
    fail(`quickNote should still show dispatch's own math, got ${JSON.stringify(quickNoteText)}`);
  if (await page.isVisible("#quickLive"))
    fail("the Predicted comparison board must be hidden with no fresh quote");
  // Dispatch's own ÷50 math is not live-sourced and must stay out of the board.
  if (/dispatch\)?$/.test(quickNoteText.trim()) && /LIVE/.test(quickNoteText))
    fail(`the comparison must not be inside #quickNote any more, got ${JSON.stringify(quickNoteText)}`);

  // The Live tab is strictly live: with no quote it shows the empty state, not an offline
  // model. Miles and a departure are entered, so the old build would have had a full run
  // on screen here — arrival clock, shift line, strip, chips and stat line all populated.
  if (await page.isVisible("#etaShift"))
    fail("shift line should be hidden on the Predicted sub-tab");
  await page.click("#tabTuned");
  await page.waitForTimeout(100);
  const dryClock = (await page.textContent("#etaClock"))?.trim();
  if (dryClock !== "--:--")
    fail(`Live tab with no quote should show the placeholder, got ${JSON.stringify(dryClock)}`);
  const dryDay = (await page.textContent("#etaDay"))?.trim() || "";
  if (!/UPDATE LIVE ETA/.test(dryDay) || !/signal/i.test(dryDay))
    fail(`Live tab with no quote should explain what to do, got ${JSON.stringify(dryDay)}`);
  for (const id of ["etaShift", "strip", "stripKey", "legend", "etaExit", "liveLine"])
    if (await page.isVisible(`#${id}`))
      fail(`#${id} must be hidden on the Live tab with no fresh quote`);
  await page.click("#tabQuick");
  await page.waitForTimeout(100);
  // Predicted still computes offline, so switching back must restore a real arrival.
  const backClock = (await page.textContent("#etaClock"))?.trim();
  if (!/^\d{2}:\d{2} \S+$/.test(backClock || "") || backClock === "--:--")
    fail(`Predicted tab should still compute offline, got ${JSON.stringify(backClock)}`);

  // The preset chooser is gone — its six-values-at-once shortcut no longer has an mph to
  // set, and the remaining five are edited individually under "+ TUNE TO YOUR TRUCK".
  if ((await page.locator("#presets").count()) !== 0)
    fail("the preset chooser must no longer exist in the DOM");
  if ((await page.locator("#mph").count()) !== 0)
    fail("the cruise-speed field must no longer exist in the DOM");
  for (const id of ["fuelEvery", "fuelMin", "swapMin", "dotMin", "dotAt"])
    if ((await page.locator(`#${id}`).count()) !== 1)
      fail(`#${id} must survive the preset removal — it's a stop rule, not a preset`);

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
  // The board carries only what isn't already on screen: that this is truck routing, and
  // what traffic costs. The arrival clock, its date, the mileage and the device-clock tail
  // all live elsewhere on the same panel and were dropped from here.
  const liveText = (await livePage.textContent("#liveLine"))?.trim() || "";
  if (liveText !== "LIVE truck route · traffic +20m")
    fail(`unexpected LIVE board copy: ${JSON.stringify(liveText)}`);
  // Guard the separator specifically: dropping the leading pieces must not strand a "·"
  // against the badge, which is what naive concatenation of " · "-prefixed fragments does.
  if (/LIVE\s+·/.test(liveText))
    fail(`the LIVE badge must not be followed by a dangling separator: ${JSON.stringify(liveText)}`);
  // With a fresh quote the Live tab is a full run again: the arrival is the quote's own
  // arrival, and the strip/chips/stat line that the empty state suppressed all come back.
  const liveClock = (await livePage.textContent("#etaClock"))?.trim();
  if (!/^\d{2}:\d{2} \S+$/.test(liveClock || "") || liveClock === "--:--")
    fail(`Live tab should show the quote's arrival, got ${JSON.stringify(liveClock)}`);
  for (const id of ["strip", "stripKey", "legend", "etaShift", "etaExit"])
    if (!(await livePage.isVisible(`#${id}`)))
      fail(`#${id} should be visible on the Live tab once a quote lands`);
  const shiftText = (await livePage.textContent("#etaShift"))?.trim();
  if (!/^(day|night) shift driving$/.test(shiftText || ""))
    fail(`expected a shift readout, got ${JSON.stringify(shiftText)}`);
  // Rolling + stopped now visibly sum to the third cell, which is the point of showing a
  // total instead of an average speed.
  const legendText = (await livePage.textContent("#legend")) || "";
  const cells = legendText.match(/ROLLING (\d+)h (\d+)m.*STOPPED (\d+)h (\d+)m.*TOTAL (\d+)h (\d+)m/);
  if (!cells) fail(`the stat line should read ROLLING / STOPPED / TOTAL, got ${JSON.stringify(legendText)}`);
  else {
    const mins = (h, m) => Number(h) * 60 + Number(m);
    if (mins(cells[1], cells[2]) + mins(cells[3], cells[4]) !== mins(cells[5], cells[6]))
      fail(`rolling + stopped must add up to the total, got ${JSON.stringify(legendText)}`);
  }
  // The Live tab is labelled for what it is; the shared label follows the mode.
  if ((await livePage.textContent("#etaLabel"))?.trim().startsWith("Live Arrival ·") !== true)
    fail(`the Live tab label should read "Live Arrival", got ${JSON.stringify(await livePage.textContent("#etaLabel"))}`);
  // The run panel describes the stop rules on every pass, and appends this run's counts
  // only when a quote backs them — no cruise speed anywhere, it isn't a setting anymore.
  const runNoteText = (await livePage.textContent("#runNote")) || "";
  if (/mph cruise/.test(runNoteText))
    fail(`the run note must not mention a cruise speed, got ${JSON.stringify(runNoteText)}`);
  if (!/This run:/.test(runNoteText))
    fail(`the run note should append this run's stop counts, got ${JSON.stringify(runNoteText)}`);
  // Predicted's comparison line is present now, sourced from that same quote.
  await livePage.click("#tabQuick");
  await livePage.waitForTimeout(100);
  if (!(await livePage.isVisible("#quickLive")))
    fail("the Predicted comparison board should appear once a quote backs it");
  const liveQuickNote = (await livePage.textContent("#quickLive")) || "";
  if (!/^LIVE \d{2}:\d{2} [A-Z]{2,6} · \d+h \d+m (ahead of|behind) dispatch$/.test(liveQuickNote.trim()))
    fail(`unexpected Predicted comparison board copy: ${JSON.stringify(liveQuickNote)}`);
  // Dispatch's own ÷50 math is not live-sourced, so it stays out of the board and keeps
  // its plain note styling next door.
  const dispatchNote = (await livePage.textContent("#quickNote")) || "";
  if (!/÷ 50 =/.test(dispatchNote) || /dispatch$/.test(dispatchNote.trim()))
    fail(`#quickNote should hold only dispatch's own math, got ${JSON.stringify(dispatchNote)}`);
  // Cross-check that the Live tab's big number really is the quote's own liveEta — this
  // board is the other reading of LIVE.res.liveEta on screen, so the two must agree.
  if (!liveQuickNote.includes("LIVE " + liveClock.split(" ")[0]))
    fail(`the Live arrival and the comparison board must be the same quote: ${JSON.stringify(liveClock)} vs ${JSON.stringify(liveQuickNote)}`);
  // The board must not fuse with the note above it — .liveLine joins to a FOLLOWING .note,
  // and #quickLive's next sibling is #strip, so it stays a panel of its own.
  const fused = await livePage.evaluate(() => {
    const q = document.getElementById("quickLive");
    return { next: q.nextElementSibling?.id, radius: getComputedStyle(q).borderBottomLeftRadius };
  });
  if (fused.next !== "strip")
    fail(`#quickLive must sit directly before #strip, not a .note — next sibling is ${JSON.stringify(fused.next)}`);
  if (fused.radius === "0px")
    fail("#quickLive should keep its own rounded bottom, not fuse into a following panel");
  // Same shared label, other tab: Predicted's flat ÷50 is not a live arrival.
  const quickLabel = (await livePage.textContent("#etaLabel"))?.trim() || "";
  if (!quickLabel.startsWith("Arrival ·"))
    fail(`the Predicted tab label should stay "Arrival", got ${JSON.stringify(quickLabel)}`);
  // The gap must be run-time vs run-time. Dispatch's number departs from the typed
  // "rolling out"; the quote departs from when it was fetched. Push the typed departure
  // months out — differencing the two ARRIVALS would fold that separation into the answer
  // and report a gap in the thousands of hours. 400 mi ÷ 50 is 8h against a 6h drive plus
  // stops, so the honest gap stays inside a single-digit hour count either way.
  await livePage.fill("#depart", "2027-01-20T08:00");
  await livePage.dispatchEvent("#depart", "input");
  await livePage.waitForTimeout(150);
  const skewNote = (await livePage.textContent("#quickLive")) || "";
  const gap = skewNote.match(/(\d+)h (\d+)m (ahead of|behind) dispatch/);
  if (!gap) fail(`the comparison board should still carry a gap, got ${JSON.stringify(skewNote)}`);
  else if (Number(gap[1]) > 24)
    fail(`the dispatch gap must compare run times, not arrival clocks — a far-off departure leaked in: ${JSON.stringify(skewNote)}`);
  await livePage.click("#tabTuned");
  await livePage.waitForTimeout(100);
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


  // Denied path: GPS permission refused -> LIVE line stays hidden and the fetch explains
  // itself in #liveNote. The Live tab has no offline model to fall back to, so the arrival
  // is the placeholder — and the generic "tap UPDATE LIVE ETA" prompt stands down rather
  // than stacking a second, vaguer explanation under the real one. Never blocks or errors.
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
  if (tunedClock !== "--:--")
    fail(`Live arrival must be the placeholder when live is unavailable, got ${JSON.stringify(tunedClock)}`);
  if (await deniedPage.isVisible("#etaDay"))
    fail("the generic empty-state prompt must stand down while #liveNote is explaining a real failure");
  // Predicted is unaffected — it never needed signal.
  await deniedPage.click("#tabQuick");
  await deniedPage.waitForTimeout(100);
  const deniedQuick = (await deniedPage.textContent("#etaClock"))?.trim();
  if (!/^\d{2}:\d{2} \S+$/.test(deniedQuick || "") || deniedQuick === "--:--")
    fail("Predicted must still compute with GPS denied");
  if (deniedErrors.length) fail("denied page errors: " + JSON.stringify(deniedErrors, null, 2));
  await deniedPage.close();

  // Shared mock for the autofill cases below: same geocode/route responses as the happy path.
  // Every call is tallied in window.__hereCalls so a test can assert not just what the app
  // rendered but how many transactions it spent getting there.
  const mockHere = page => page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", { value: {
      getCurrentPosition: ok => ok({ coords: { latitude: 41.8781, longitude: -87.6298 } })
    }});
    window.__hereCalls = { geocode: 0, route: 0, total: 0 };
    const realFetch = window.fetch.bind(window);
    window.fetch = (url, ...rest) => {
      const u = String(url);
      window.__hereCalls.total++;
      if (u.includes("geocode.search.hereapi.com")) window.__hereCalls.geocode++;
      if (u.includes("router.hereapi.com")) window.__hereCalls.route++;
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

  // Light traffic: the traffic segment is conditional, so the board is down to one piece.
  // It must read cleanly on its own — no trailing separator, no invented filler.
  const calmPage = await browser.newPage();
  const calmErrors = [];
  calmPage.on("pageerror", e => calmErrors.push("pageerror: " + e.message));
  await calmPage.addInitScript(() => {
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
        // duration === baseDuration: a clear road, so no traffic segment at all.
        return Promise.resolve(new Response(JSON.stringify(
          { routes: [{ sections: [{ summary: { duration: 21600, baseDuration: 21600,
            length: 643738 } }] }] })));
      return realFetch(url, ...rest);
    };
  });
  await calmPage.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "networkidle" });
  await calmPage.fill("#destIn", "Nashville TN");
  await calmPage.press("#destIn", "Enter");
  await calmPage.click("#tabTuned");
  await calmPage.click("#liveBtn");
  await calmPage.waitForTimeout(300);
  const calmLine = (await calmPage.textContent("#liveLine"))?.trim() || "";
  if (calmLine !== "LIVE truck route")
    fail(`with no traffic the board should read exactly "LIVE truck route", got ${JSON.stringify(calmLine)}`);
  if (calmErrors.length) fail("calm-traffic page errors: " + JSON.stringify(calmErrors, null, 2));
  await calmPage.close();

  // Device-timezone reading: a driver whose own zone differs from the destination's still
  // gets their arrival in their own clock. It reads off #etaYours — the board used to
  // repeat it and no longer does, since that line sits directly above it. Force a real tz
  // mismatch via a fresh context (device clock in LA, destination in Nashville/Central)
  // rather than trusting the code reads right without ever observing two different clocks.
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
  if (!(await tzPage.isVisible("#etaYours")))
    fail("a driver in a different tz should get their own clock reading on the Live tab");
  const mismatchLine = (await tzPage.textContent("#etaYours"))?.trim() || "";
  if (!/current device timezone$/.test(mismatchLine))
    fail(`the device-clock line should be labelled as such when origin/destination tz differ, got ${JSON.stringify(mismatchLine)}`);
  if (!mismatchLine.includes("PDT") && !mismatchLine.includes("PST"))
    fail(`the device-clock reading should be in the origin's (Pacific) tz, got ${JSON.stringify(mismatchLine)}`);
  // And the board must not say it a second time an inch below.
  if (/current device timezone/.test((await tzPage.textContent("#liveLine")) || ""))
    fail("the LIVE board must not repeat the device-clock reading that sits above it");
  if (tzErrors.length) fail("tz-mismatch page errors: " + JSON.stringify(tzErrors, null, 2));
  await tzCtx.close();

  // Same-tz case: no second clock at all — a driver whose origin and destination share a
  // timezone doesn't need to be told their own clock twice.
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
  if (await sameTzPage.isVisible("#etaYours"))
    fail("no device-clock line should appear when origin and destination share a tz");
  const sameTzLine = (await sameTzPage.textContent("#liveLine"))?.trim() || "";
  if (/current device timezone/.test(sameTzLine))
    fail(`the LIVE board should carry no device-clock reading at all, got ${JSON.stringify(sameTzLine)}`);
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
  // Tuning (stop rules/swap schedule) must be untouched throughout — CLEAR empties the
  // load, not the truck.
  const clearLivePage = await browser.newPage();
  const clearLiveErrors = [];
  clearLivePage.on("pageerror", e => clearLiveErrors.push("pageerror: " + e.message));
  await mockHere(clearLivePage);
  await clearLivePage.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "networkidle" });
  await clearLivePage.fill("#destIn", "Nashville TN");
  await clearLivePage.press("#destIn", "Enter");
  await clearLivePage.click("#tabTuned");
  // Move a stop rule off its default so "CLEAR didn't touch tuning" is a real check and
  // not just two identical default snapshots. The preset shortcut used to do this.
  await clearLivePage.click("#tuneToggle");
  await clearLivePage.fill("#fuelEvery", "500");
  await clearLivePage.dispatchEvent("#fuelEvery", "input");
  await clearLivePage.click("#tuneToggle");
  await clearLivePage.waitForTimeout(100);
  await clearLivePage.click("#liveBtn");
  await clearLivePage.waitForTimeout(300);
  if (!(await clearLivePage.isVisible("#liveLine")))
    fail("LIVE line should be showing before CLEAR (setup check)");
  const tuneBefore = await clearLivePage.evaluate(() => ({
    tune: ["fuelEvery","fuelMin","swapMin","dotMin","dotAt"].map(id => document.getElementById(id).value),
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
    tune: ["fuelEvery","fuelMin","swapMin","dotMin","dotAt"].map(id => document.getElementById(id).value),
    swap: ["swapA","swapB","swapTz"].map(id => document.getElementById(id).value),
  }));
  if (JSON.stringify(tuneBefore) !== JSON.stringify(tuneAfter))
    fail(`CLEAR must not touch tuning/preset/swap, got ${JSON.stringify(tuneBefore)} -> ${JSON.stringify(tuneAfter)}`);
  if (clearLiveErrors.length) fail("clear-live page errors: " + JSON.stringify(clearLiveErrors, null, 2));
  await clearLivePage.close();

  // GET MILEAGE: convenience button on either tab. Destination set, miles blank ->
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

  // Same destination-set/miles-blank state on the Tuned tab: GET MILEAGE shows there too,
  // deliberately sitting alongside UPDATE LIVE ETA as the quicker, narrower action. The
  // boundary that matters most here is that using it from Tuned still can't fabricate a
  // live quote — on this tab a set LIVE.res would render the LIVE line, so its continued
  // absence right where it would appear is the check.
  const getMiTunedPage = await browser.newPage();
  const getMiTunedErrors = [];
  getMiTunedPage.on("pageerror", e => getMiTunedErrors.push("pageerror: " + e.message));
  await mockHere(getMiTunedPage);
  await getMiTunedPage.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "networkidle" });
  await getMiTunedPage.click("#tabTuned");
  await getMiTunedPage.waitForTimeout(100);
  if (await getMiTunedPage.isVisible("#getMiBtn"))
    fail("#getMiBtn should start hidden on the Tuned tab with no destination set");
  await getMiTunedPage.fill("#destIn", "Nashville TN");
  await getMiTunedPage.press("#destIn", "Enter");
  await getMiTunedPage.waitForTimeout(150);
  if (!(await getMiTunedPage.isVisible("#getMiBtn")))
    fail("#getMiBtn should appear on the Tuned tab too, once a destination is set and miles is blank");
  await getMiTunedPage.click("#getMiBtn");
  await getMiTunedPage.waitForTimeout(300);
  const getMiTunedMiles = await getMiTunedPage.inputValue("#miles");
  if (getMiTunedMiles !== "400")
    fail(`GET MILEAGE on the Tuned tab should fill miles from the real road distance, got ${JSON.stringify(getMiTunedMiles)}`);
  if (await getMiTunedPage.isVisible("#getMiBtn"))
    fail("#getMiBtn should hide itself once miles has a value, on the Tuned tab as well");
  if (await getMiTunedPage.isVisible("#liveLine"))
    fail("GET MILEAGE from the Tuned tab must not produce a live quote — LIVE line appeared");
  if (getMiTunedErrors.length) fail("getMi-tuned page errors: " + JSON.stringify(getMiTunedErrors, null, 2));
  await getMiTunedPage.close();

  // RUNNING: keeps the departure clock and the arrival current, and must do it entirely
  // offline. The clock is driven by a controllable Date so a minute of wall time can pass
  // in a tick — #depart is minute-precision, so a real-time test could only watch it sit
  // still. Patching Date rather than just Date.now() because toWall() reads `new Date()`.
  const runPage = await browser.newPage();
  const runErrors = [];
  runPage.on("pageerror", e => runErrors.push("pageerror: " + e.message));
  await runPage.addInitScript(() => {
    const RealDate = Date;
    window.__skewMs = 0;
    class FakeDate extends RealDate {
      constructor(...a){ if (a.length === 0) super(RealDate.now() + window.__skewMs); else super(...a); }
      static now(){ return RealDate.now() + window.__skewMs; }
    }
    window.Date = FakeDate;
  });
  await mockHere(runPage);
  await runPage.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "networkidle" });
  await runPage.fill("#destIn", "Nashville TN");
  await runPage.press("#destIn", "Enter");
  await runPage.click("#tabTuned");
  await runPage.click("#liveBtn");
  await runPage.waitForTimeout(300);
  if (!(await runPage.isVisible("#liveLine")))
    fail("RUNNING setup: a live quote should be in hand before switching it on");
  // Session mode: off on load, and both departure controls are the driver's until it's on.
  if ((await runPage.getAttribute("#runningBtn", "aria-checked")) !== "false")
    fail("RUNNING must start OFF — it's a session mode, never restored");
  if (await runPage.isDisabled("#depart")) fail("#depart should be the driver's while RUNNING is off");
  await runPage.click("#runningBtn");
  await runPage.waitForTimeout(100);
  if ((await runPage.textContent("#runningState"))?.trim() !== "ON")
    fail("the RUNNING indicator should read ON once switched");
  if (!(await runPage.isDisabled("#depart")))
    fail("#depart must be disabled while RUNNING drives it");
  if (!(await runPage.isDisabled("#nowBtn")))
    fail("NOW must be disabled while RUNNING drives the departure");

  // The assertion this whole feature is built around: ticking costs nothing. Let several
  // ticks land and confirm not one of them reached the network — HERE or anything else.
  const callsBefore = await runPage.evaluate(() => ({ ...window.__hereCalls }));
  const departBefore = await runPage.inputValue("#depart");
  await runPage.evaluate(() => { window.__skewMs = 3 * 60 * 1000; });   // three minutes on
  await runPage.waitForTimeout(2500);
  const callsAfter = await runPage.evaluate(() => ({ ...window.__hereCalls }));
  if (callsAfter.total !== callsBefore.total)
    fail(`RUNNING must never re-fetch: ${callsBefore.total} calls before ticking, ${callsAfter.total} after`);
  const departRunning = await runPage.inputValue("#depart");
  if (departRunning === departBefore)
    fail(`RUNNING should move the departure clock on its own, still ${JSON.stringify(departBefore)}`);
  // Still a live arrival on screen — re-solved locally, not re-fetched.
  if (!(await runPage.isVisible("#liveLine")))
    fail("the LIVE line should survive ticking (the quote is still fresh)");

  // Leaving the Live tab stops the clock; coming back resumes it. The switch itself stays on.
  await runPage.click("#tabQuick");
  await runPage.waitForTimeout(100);
  const departOnQuick = await runPage.inputValue("#depart");
  await runPage.evaluate(() => { window.__skewMs = 6 * 60 * 1000; });
  await runPage.waitForTimeout(1600);
  if ((await runPage.inputValue("#depart")) !== departOnQuick)
    fail("the RUNNING clock must stop while the Predicted tab is in front");
  await runPage.click("#tabTuned");
  await runPage.waitForTimeout(1600);
  if ((await runPage.inputValue("#depart")) === departOnQuick)
    fail("the RUNNING clock must resume on returning to the Live tab");
  if ((await runPage.getAttribute("#runningBtn", "aria-checked")) !== "true")
    fail("switching tabs must stop the timer without flipping the switch off");

  // Backgrounding does the same. visibilityState is read-only, so stub the getter.
  await runPage.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const departHidden = await runPage.inputValue("#depart");
  // Each jump is whole minutes clear of the last: #depart is minute-precision, so a
  // smaller bump could leave the field unchanged and pass a paused check by luck.
  await runPage.evaluate(() => { window.__skewMs = 12 * 60 * 1000; });
  await runPage.waitForTimeout(1600);
  if ((await runPage.inputValue("#depart")) !== departHidden)
    fail("the RUNNING clock must pause while the app is backgrounded");
  await runPage.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await runPage.waitForTimeout(1600);
  if ((await runPage.inputValue("#depart")) === departHidden)
    fail("the RUNNING clock must resume when the app comes back to the foreground");

  // Switching off freezes the clock where it stopped and hands both controls back.
  await runPage.click("#runningBtn");
  await runPage.waitForTimeout(100);
  const departOff = await runPage.inputValue("#depart");
  if (await runPage.isDisabled("#depart")) fail("#depart must be editable again once RUNNING is off");
  if (await runPage.isDisabled("#nowBtn")) fail("NOW must be usable again once RUNNING is off");
  await runPage.evaluate(() => { window.__skewMs = 20 * 60 * 1000; });
  await runPage.waitForTimeout(1600);
  if ((await runPage.inputValue("#depart")) !== departOff)
    fail("the departure must stay frozen at its last value once RUNNING is off");
  if (runErrors.length) fail("running page errors: " + JSON.stringify(runErrors, null, 2));
  await runPage.close();

  // Geocode caching: a town's coordinates don't move between refreshes, so re-quoting the
  // same destination should spend a routing call and nothing else. Changing the destination
  // must miss the cache — routing a new city against the old city's position would be far
  // worse than the lookup it saves.
  const geoPage = await browser.newPage();
  const geoErrors = [];
  geoPage.on("pageerror", e => geoErrors.push("pageerror: " + e.message));
  await mockHere(geoPage);
  await geoPage.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "networkidle" });
  await geoPage.fill("#destIn", "Nashville TN");
  await geoPage.press("#destIn", "Enter");
  await geoPage.click("#tabTuned");
  await geoPage.click("#liveBtn");
  await geoPage.waitForTimeout(300);
  await geoPage.click("#liveBtn");
  await geoPage.waitForTimeout(300);
  const sameDest = await geoPage.evaluate(() => ({ ...window.__hereCalls }));
  if (sameDest.route !== 2)
    fail(`two refreshes should cost two routing calls, got ${sameDest.route}`);
  if (sameDest.geocode !== 1)
    fail(`re-quoting the same destination should geocode once, got ${sameDest.geocode}`);
  // A different city must re-geocode rather than reuse Nashville's position.
  await geoPage.fill("#destIn", "Laredo TX");
  await geoPage.press("#destIn", "Enter");
  await geoPage.waitForTimeout(100);
  await geoPage.click("#liveBtn");
  await geoPage.waitForTimeout(300);
  const newDest = await geoPage.evaluate(() => ({ ...window.__hereCalls }));
  if (newDest.geocode !== 2)
    fail(`a new destination must re-geocode, got ${newDest.geocode} geocode calls`);
  if (newDest.route !== 3) fail(`the new destination should also route, got ${newDest.route}`);
  if (geoErrors.length) fail("geocode-cache page errors: " + JSON.stringify(geoErrors, null, 2));
  await geoPage.close();

  // Resume re-render: a LIVE quote that went stale while the app was backgrounded must be
  // gone on the first frame after resume, not left showing this morning's arrival. The
  // quote is aged by moving Date.now() forward past LIVE_MAX_AGE_MS rather than waiting
  // ten real minutes — renderEta() gates the line on liveFresh(LIVE.at, Date.now()), so
  // that's the same condition a real backgrounded hour produces.
  // Deliberately asserting the line is STILL visible after aging but before the resume
  // event: that isolates the visibilitychange listener as the thing that cleared it,
  // instead of some unrelated render happening to fire in between and passing by luck.
  const resumePage = await browser.newPage();
  const resumeErrors = [];
  resumePage.on("pageerror", e => resumeErrors.push("pageerror: " + e.message));
  await mockHere(resumePage);
  await resumePage.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "networkidle" });
  await resumePage.fill("#miles", "400");
  await resumePage.dispatchEvent("#miles", "input");
  await resumePage.fill("#destIn", "Nashville TN");
  await resumePage.press("#destIn", "Enter");
  await resumePage.click("#tabTuned");
  await resumePage.click("#liveBtn");
  await resumePage.waitForTimeout(300);
  if (!(await resumePage.isVisible("#liveLine")))
    fail("LIVE line should be showing before the resume check (setup)");
  await resumePage.evaluate(() => {
    const realNow = Date.now.bind(Date);
    const skew = 11 * 60 * 1000;            // past LIVE_MAX_AGE_MS (10 min)
    Date.now = () => realNow() + skew;
  });
  if (!(await resumePage.isVisible("#liveLine")))
    fail("aging the clock alone must not clear the LIVE line — nothing has re-rendered yet");
  await resumePage.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await resumePage.waitForTimeout(100);
  if (await resumePage.isVisible("#liveLine"))
    fail("returning to the foreground must drop a LIVE quote that went stale while backgrounded");
  // And the whole tab goes back to its empty state with it — a stale quote must not leave
  // an arrival on screen just because the LIVE line beneath it disappeared.
  const staleClock = (await resumePage.textContent("#etaClock"))?.trim();
  if (staleClock !== "--:--")
    fail(`a stale quote should clear the Live arrival, got ${JSON.stringify(staleClock)}`);
  if (!/UPDATE LIVE ETA/.test((await resumePage.textContent("#etaDay")) || ""))
    fail("a stale quote should return the Live tab to its empty-state prompt");
  for (const id of ["strip", "stripKey", "legend", "etaShift"])
    if (await resumePage.isVisible(`#${id}`))
      fail(`#${id} must clear along with a stale quote`);
  // Predicted's comparison board is gated on freshness, not merely on a quote having once
  // existed — a ten-minute-old read compared against dispatch is exactly the fabricated
  // comparison the board is supposed to avoid.
  await resumePage.click("#tabQuick");
  await resumePage.waitForTimeout(100);
  if (await resumePage.isVisible("#quickLive"))
    fail("a stale quote must not feed the Predicted comparison board");
  const staleQuickNote = (await resumePage.textContent("#quickNote")) || "";
  if (/dispatch/.test(staleQuickNote))
    fail(`a stale quote must not leave a comparison in #quickNote either, got ${JSON.stringify(staleQuickNote)}`);
  if (resumeErrors.length) fail("resume page errors: " + JSON.stringify(resumeErrors, null, 2));
  await resumePage.close();

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

  // ---- Version footer: manual update check. Real service worker lifecycle timing (an
  // actual new sw.js installing) isn't something this suite can fabricate, so — as the
  // brief for this feature calls for — the registration itself is mocked: the app's own
  // navigator.serviceWorker.register(...) call is intercepted (before the page's script
  // runs) and handed a plain EventTarget standing in for a ServiceWorkerRegistration.
  // That's enough to drive the app's REAL click handler through both branches.

  // No update available: update() resolves, no "updatefound" ever fires.
  const verNoUpdatePage = await browser.newPage();
  const verNoUpdateErrors = [];
  verNoUpdatePage.on("pageerror", e => verNoUpdateErrors.push("pageerror: " + e.message));
  await verNoUpdatePage.addInitScript(() => {
    window.__updateCalls = 0;
    const fakeReg = new EventTarget();
    fakeReg.update = () => { window.__updateCalls++; return Promise.resolve(); };
    navigator.serviceWorker.register = () => Promise.resolve(fakeReg);
  });
  await verNoUpdatePage.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "networkidle" });
  await verNoUpdatePage.waitForTimeout(200);   // let the mocked registration resolve into swReg
  const verFootDefault = (await verNoUpdatePage.textContent("#verFoot"))?.trim();
  await verNoUpdatePage.click("#verFoot");
  await verNoUpdatePage.waitForTimeout(100);
  if ((await verNoUpdatePage.textContent("#verFoot"))?.trim() !== "CHECKING FOR UPDATES…")
    fail(`tapping the version footer should show a checking state immediately, got ${JSON.stringify((await verNoUpdatePage.textContent("#verFoot"))?.trim())}`);
  if ((await verNoUpdatePage.evaluate(() => window.__updateCalls)) !== 1)
    fail("tapping the version footer should call registration.update() exactly once");
  await verNoUpdatePage.waitForTimeout(1700);   // past the 1500ms found/not-found window
  if ((await verNoUpdatePage.textContent("#verFoot"))?.trim() !== "YOU'RE UP TO DATE")
    fail(`no updatefound within the window should show the up-to-date message, got ${JSON.stringify((await verNoUpdatePage.textContent("#verFoot"))?.trim())}`);
  await verNoUpdatePage.waitForTimeout(2200);   // past the 2000ms revert-to-default timer
  if ((await verNoUpdatePage.textContent("#verFoot"))?.trim() !== verFootDefault)
    fail(`the footer should revert to its version stamp, got ${JSON.stringify((await verNoUpdatePage.textContent("#verFoot"))?.trim())}`);
  if (verNoUpdateErrors.length) fail("verFoot (no-update) page errors: " + JSON.stringify(verNoUpdateErrors, null, 2));
  await verNoUpdatePage.close();

  // Update found: "updatefound" fires on the mocked registration — the footer must show
  // "UPDATING…" and, critically, STAY there — the up-to-date fallback (on its own timer)
  // must not clobber it once a real update is in progress.
  const verUpdatePage = await browser.newPage();
  const verUpdateErrors = [];
  verUpdatePage.on("pageerror", e => verUpdateErrors.push("pageerror: " + e.message));
  await verUpdatePage.addInitScript(() => {
    const fakeReg = new EventTarget();
    fakeReg.update = () => Promise.resolve();
    window.__fireUpdateFound = () => fakeReg.dispatchEvent(new Event("updatefound"));
    navigator.serviceWorker.register = () => Promise.resolve(fakeReg);
  });
  await verUpdatePage.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "networkidle" });
  await verUpdatePage.waitForTimeout(200);
  await verUpdatePage.click("#verFoot");
  await verUpdatePage.waitForTimeout(50);
  await verUpdatePage.evaluate(() => window.__fireUpdateFound());
  await verUpdatePage.waitForTimeout(100);
  if ((await verUpdatePage.textContent("#verFoot"))?.trim() !== "UPDATING…")
    fail(`updatefound should switch the footer to an updating state, got ${JSON.stringify((await verUpdatePage.textContent("#verFoot"))?.trim())}`);
  await verUpdatePage.waitForTimeout(1800);   // past the 1500ms window AND the 2000ms revert
  if ((await verUpdatePage.textContent("#verFoot"))?.trim() !== "UPDATING…")
    fail(`the updating state must not be overwritten by the up-to-date fallback, got ${JSON.stringify((await verUpdatePage.textContent("#verFoot"))?.trim())}`);
  if (verUpdateErrors.length) fail("verFoot (update-found) page errors: " + JSON.stringify(verUpdateErrors, null, 2));
  await verUpdatePage.close();

  // A check that never comes back. Both cases above use an update() that resolves at once,
  // which is precisely why they could not see this: the fallback used to be scheduled AFTER
  // `await swReg.update()`, so a call that never settled meant the fallback was never even
  // created and the label sat on "CHECKING FOR UPDATES…" indefinitely. That is what a dead
  // URL or a captive portal actually looks like on the road, and the driver got no reason.
  const verHangPage = await browser.newPage();
  const verHangErrors = [];
  verHangPage.on("pageerror", e => verHangErrors.push("pageerror: " + e.message));
  await verHangPage.addInitScript(() => {
    const fakeReg = new EventTarget();
    fakeReg.update = () => new Promise(() => {});     // never settles, ever
    navigator.serviceWorker.register = () => Promise.resolve(fakeReg);
  });
  await verHangPage.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "networkidle" });
  await verHangPage.waitForTimeout(200);
  const hangDefault = (await verHangPage.textContent("#verFoot"))?.trim();
  await verHangPage.click("#verFoot");
  await verHangPage.waitForTimeout(100);
  if ((await verHangPage.textContent("#verFoot"))?.trim() !== "CHECKING FOR UPDATES…")
    fail("a hung check should still show the checking state first");
  // Tapping again mid-check must not stack a second check on top of the first.
  await verHangPage.click("#verFoot");
  await verHangPage.waitForTimeout(8600);            // past the 8s check deadline
  const hangText = (await verHangPage.textContent("#verFoot"))?.trim();
  if (hangText === "CHECKING FOR UPDATES…")
    fail("a check that never settles must not leave the footer stuck on the checking state");
  if (hangText !== "COULDN'T CHECK — NO SIGNAL?")
    fail(`a failed check should say so rather than claim you're up to date, got ${JSON.stringify(hangText)}`);
  await verHangPage.waitForTimeout(2700);
  if ((await verHangPage.textContent("#verFoot"))?.trim() !== hangDefault)
    fail("the footer should return to its version stamp after a failed check");
  if (verHangErrors.length) fail("verFoot (hung-check) page errors: " + JSON.stringify(verHangErrors, null, 2));
  await verHangPage.close();

  // A check that outright rejects — the site's URL is gone, the server refused. Same
  // honest answer, and specifically NOT "YOU'RE UP TO DATE", which would be a lie about
  // an app that is in fact stale.
  const verFailPage = await browser.newPage();
  const verFailErrors = [];
  verFailPage.on("pageerror", e => verFailErrors.push("pageerror: " + e.message));
  await verFailPage.addInitScript(() => {
    const fakeReg = new EventTarget();
    fakeReg.update = () => Promise.reject(new Error("404"));
    navigator.serviceWorker.register = () => Promise.resolve(fakeReg);
  });
  await verFailPage.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "networkidle" });
  await verFailPage.waitForTimeout(200);
  await verFailPage.click("#verFoot");
  await verFailPage.waitForTimeout(400);
  const failText = (await verFailPage.textContent("#verFoot"))?.trim();
  if (failText !== "COULDN'T CHECK — NO SIGNAL?")
    fail(`a rejected check should report the failure, got ${JSON.stringify(failText)}`);
  if (verFailErrors.length) fail("verFoot (failed-check) page errors: " + JSON.stringify(verFailErrors, null, 2));
  await verFailPage.close();

  /* ---- Real service-worker update, end to end. No fake registration: a second server
     that can change what it serves, a genuine install, a genuine deploy, and the reload
     the driver is actually waiting for.

     The case that matters is the one that shipped broken. `hadController` exists to skip
     the reload on the first handover — a worker claiming a page that just downloaded the
     newest content has nothing to reload for — but as a parse-time snapshot it swallowed
     every later handover on that same page too. So a page that installed the worker on
     THIS load (a first launch, or after iOS evicted the worker) would install and activate
     a new version while continuing to show the old one, with the footer stuck on
     "UPDATING…". Exactly the state a driver would describe as the updater not working. */
  let swVersion = "0.0.1";
  const swServer = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p === "/") p = "/index.html";
    fs.readFile(path.join(ROOT, p), (err, data) => {
      if (err) { res.writeHead(404); res.end("not found"); return; }
      let body = data;
      // Restamp the two files that carry a version so "deploying" is a one-line change.
      if (p === "/index.html" || p === "/sw.js")
        body = data.toString().replace(/(MilesPost v|milespost-v)[0-9][0-9.]*/g, "$1" + swVersion);
      res.writeHead(200, { "content-type": TYPES[path.extname(p)] || "application/octet-stream" });
      res.end(body);
    });
  });
  await new Promise(r => swServer.listen(0, r));
  const swPort = swServer.address().port;
  try {
    const swCtx = await browser.newContext();
    const swPage = await swCtx.newPage();
    // Deliberately NOT reloading after the first install: this page is uncontrolled at
    // parse time and becomes controlled during the load, which is the broken path.
    await swPage.goto(`http://127.0.0.1:${swPort}/index.html`, { waitUntil: "networkidle" });
    await swPage.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15000 })
      .catch(() => fail("the service worker never took control on first load"));
    if ((await swPage.textContent("#verFoot"))?.trim() !== "MilesPost v0.0.1")
      fail(`SW test setup: expected the v0.0.1 stamp, got ${JSON.stringify((await swPage.textContent("#verFoot"))?.trim())}`);

    swVersion = "0.0.2";                                  // deploy
    const reloaded = swPage.waitForNavigation({ timeout: 15000 }).then(() => true).catch(() => false);
    await swPage.click("#verFoot");
    if (!(await reloaded))
      fail("tapping check-for-update with a new version deployed must reload the page — "
         + "the new worker activates either way, so without this the app keeps showing the old version");
    await swPage.waitForLoadState("networkidle");
    const afterUpdate = (await swPage.textContent("#verFoot"))?.trim();
    if (afterUpdate !== "MilesPost v0.0.2")
      fail(`after updating, the app should be running the new version, got ${JSON.stringify(afterUpdate)}`);
    // And the old cache is gone, so nothing can serve the previous build back.
    const swCaches = await swPage.evaluate(() => caches.keys());
    if (!swCaches.includes("milespost-v0.0.2") || swCaches.includes("milespost-v0.0.1"))
      fail(`activate should leave only the new cache, got ${JSON.stringify(swCaches)}`);

    // Second update on the same page, now controlled from parse time — the path that was
    // already working, kept honest so a fix to one case can't regress the other.
    swVersion = "0.0.3";
    const reloadedAgain = swPage.waitForNavigation({ timeout: 15000 }).then(() => true).catch(() => false);
    await swPage.click("#verFoot");
    if (!(await reloadedAgain)) fail("a second update on the same page must also reload");
    await swPage.waitForLoadState("networkidle");
    if ((await swPage.textContent("#verFoot"))?.trim() !== "MilesPost v0.0.3")
      fail("the second update should land too");

    // Nothing new deployed: an honest "up to date", and no reload.
    let bounced = false;
    swPage.once("framenavigated", () => { bounced = true; });
    await swPage.click("#verFoot");
    await swPage.waitForTimeout(1400);
    const idle = (await swPage.textContent("#verFoot"))?.trim();
    if (idle !== "YOU'RE UP TO DATE")
      fail(`with nothing deployed the check should report up to date, got ${JSON.stringify(idle)}`);
    if (bounced) fail("an up-to-date check must not reload the page");
    await swCtx.close();
  } finally {
    swServer.close();
  }

  if (!process.exitCode)
    console.log(`SMOKE OK: arrival ${etaClock}, shift "${shiftText}" (Live only), Live tab is strictly live (empty state with no/denied/stale quote, full run once one lands), preset chooser and cruise-speed field gone, CLEAR empties the load, reset picker stays up until SET/NOW, LIVE renders from mocked HERE + hides on GPS denial, LIVE autofills blank miles but never overwrites a typed one (override off) but always overwrites when override is on, live re-quote refreshes its own autofilled miles, CLEAR invalidates a stale LIVE quote without touching tuning, GET MILEAGE fills miles on both tabs without ever producing a live quote, per-field × buttons clear independently, city suggestions show same-named cities across states + fall back to autosuggest on autocomplete failure, tuning toggle stands the LIVE CTA down and back, help modal opens/stays/dismisses correctly, module loaded, no page errors`);
} finally {
  await browser.close();
  server.close();
}
