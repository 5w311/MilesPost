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
  const etaClock = (await page.textContent("#etaClock"))?.trim();
  if (!/^\d{2}:\d{2}$/.test(etaClock || "") || etaClock === "--:--")
    fail(`expected a computed arrival clock, got ${JSON.stringify(etaClock)}`);

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
  if (((await page.textContent("#rsClock"))?.trim()) === "--:--")
    fail("committing a shutdown should show the computed legal time");
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
  await livePage.click("#destSet");
  await livePage.click("#tabTuned");
  await livePage.click("#liveBtn");
  await livePage.waitForTimeout(300);
  if (!(await livePage.isVisible("#liveLine")))
    fail("LIVE line should render after a successful mocked HERE fetch");
  const liveText = (await livePage.textContent("#liveLine"))?.trim() || "";
  if (!/^LIVE · \d{2}:\d{2}/.test(liveText))
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
  await livePage.click("#tuneToggle");
  await livePage.waitForTimeout(150);
  if (!(await livePage.isVisible("#tuneGrid"))) fail("tuning grid should open");
  if (await livePage.isVisible("#liveBtn")) fail("LIVE button should be hidden while tuning is open");
  await livePage.click("#tuneToggle");
  await livePage.waitForTimeout(150);
  if (await livePage.isVisible("#tuneGrid")) fail("tuning grid should close again");
  if (!(await livePage.isVisible("#liveBtn"))) fail("LIVE button must come back when tuning closes");
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
  await deniedPage.click("#destSet");
  await deniedPage.click("#tabTuned");
  await deniedPage.click("#liveBtn");
  await deniedPage.waitForTimeout(300);
  if (await deniedPage.isVisible("#liveLine"))
    fail("LIVE line must stay hidden when GPS is denied");
  const noteText = (await deniedPage.textContent("#liveNote"))?.trim() || "";
  if (!/live unavailable/.test(noteText))
    fail(`denied path should show the unobtrusive fallback note, got ${JSON.stringify(noteText)}`);
  const tunedClock = (await deniedPage.textContent("#etaClock"))?.trim();
  if (!/^\d{2}:\d{2}$/.test(tunedClock || "") || tunedClock === "--:--")
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
          // 6h drive, 20min of it traffic, 400 mi (643,738 m)
          { routes: [{ sections: [{ summary: { duration: 21600, baseDuration: 20400, length: 643738 } }] }] })));
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
  await autofillPage.click("#destSet");
  await autofillPage.click("#tabTuned");
  await autofillPage.click("#liveBtn");
  await autofillPage.waitForTimeout(300);
  const filledMiles = await autofillPage.inputValue("#miles");
  if (filledMiles !== "400")
    fail(`blank miles should autofill from the live route distance, got ${JSON.stringify(filledMiles)}`);
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
  await keepPage.click("#destSet");
  await keepPage.click("#tabTuned");
  await keepPage.click("#liveBtn");
  await keepPage.waitForTimeout(300);
  const keptMiles = await keepPage.inputValue("#miles");
  if (keptMiles !== "250")
    fail(`a typed mileage must survive a live fetch untouched, got ${JSON.stringify(keptMiles)}`);
  if (keepErrors.length) fail("keep-miles page errors: " + JSON.stringify(keepErrors, null, 2));
  await keepPage.close();

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

  if (!process.exitCode)
    console.log(`SMOKE OK: arrival ${etaClock}, shift "${shiftText}" (Tuned only), CLEAR empties the load, reset picker stays up until SET/NOW, LIVE renders from mocked HERE + hides on GPS denial, LIVE autofills blank miles but never overwrites a typed one, city suggestions show same-named cities across states + fall back to autosuggest on autocomplete failure, tuning toggle stands the LIVE CTA down and back, help modal opens/stays/dismisses correctly, module loaded, no page errors`);
} finally {
  await browser.close();
  server.close();
}
