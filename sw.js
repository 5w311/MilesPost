// Build marker. Bump it on every single deploy, or installed phones will decide they're
// already current and quietly ignore the new build. Keep it "milespost-v" + the app
// version: the update offer names a waiting build by this ("UPDATE AVAILABLE (v5.12)").
const CACHE = "milespost-v5.12";
const ASSETS = [
  "./",
  "./index.html",
  "./lib/logic.js",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-1024.png",
  "./apple-touch-icon.png",
  "./marker.png",
  // Vendored Overpass (see fonts/LICENSE-*): cached like everything else so the
  // Highway signage face works with zero bars, not just the fallback stack.
  "./fonts/overpass-latin-400-normal.woff2",
  "./fonts/overpass-latin-600-normal.woff2",
  "./fonts/overpass-latin-700-normal.woff2",
  "./fonts/overpass-latin-800-normal.woff2",
  "./fonts/overpass-mono-latin-400-normal.woff2",
  "./fonts/overpass-mono-latin-600-normal.woff2",
  "./fonts/overpass-mono-latin-700-normal.woff2",
// rig-ui, from rig-ui/milespost.js — regenerate with `npm run rig:manifest`
  "./rig-ui/rig.css",
  "./rig-ui/milespost.js",
  "./rig-ui/src/data/grid-nav.js",
  "./rig-ui/src/data/menu.js",
  "./rig-ui/src/data/rows.js",
  "./rig-ui/src/data/table.js",
  "./rig-ui/src/display/alert.js",
  "./rig-ui/src/display/badge.js",
  "./rig-ui/src/display/collapsible.js",
  "./rig-ui/src/display/empty.js",
  "./rig-ui/src/display/format.js",
  "./rig-ui/src/display/height.js",
  "./rig-ui/src/display/icons.js",
  "./rig-ui/src/display/item.js",
  "./rig-ui/src/display/progress.js",
  "./rig-ui/src/display/separator.js",
  "./rig-ui/src/forms/button.js",
  "./rig-ui/src/forms/face.js",
  "./rig-ui/src/forms/field-logic.js",
  "./rig-ui/src/forms/field.js",
  "./rig-ui/src/forms/input.js",
  "./rig-ui/src/forms/switch.js",
  "./rig-ui/src/forms/text-field.js",
  "./rig-ui/src/fuzzy.js",
  "./rig-ui/src/genui/dom.js",
  "./rig-ui/src/genui/geo.js",
  "./rig-ui/src/genui/route-map.js",
  "./rig-ui/src/icon-data.js",
  "./rig-ui/src/morph-icon.js",
  "./rig-ui/src/motion.js",
  "./rig-ui/src/navigation/nav-math.js",
  "./rig-ui/src/navigation/tabs.js",
  "./rig-ui/src/overlays/dialog.js",
  "./rig-ui/src/overlays/drawer.js",
  "./rig-ui/src/overlays/layer.js",
  "./rig-ui/src/overlays/modal.js",
  "./rig-ui/src/overlays/overlay-math.js",
  "./rig-ui/src/overlays/tooltip.js",
  "./rig-ui/src/pickers/calendar.js",
  "./rig-ui/src/pickers/combobox.js",
  "./rig-ui/src/pickers/date-grid.js",
  "./rig-ui/src/pickers/date-picker.js",
  "./rig-ui/src/pickers/listbox.js",
  "./rig-ui/src/pickers/pick-logic.js",
  "./rig-ui/src/pickers/select.js",
  "./rig-ui/src/pickers/shared.js",
  "./rig-ui/src/pickers/time-columns.js",
  "./rig-ui/src/pickers/time-logic.js",
  "./rig-ui/src/pickers/time-picker.js",
  "./rig-ui/src/position.js",
  "./rig-ui/src/sound.js",
  "./rig-ui/src/toast.js",
  "./rig-ui/src/util.js"
];

/* Updates wait for the driver. A new build downloads in the background and then WAITS:
   the page puts "UPDATE AVAILABLE — TAP TO RELOAD" on the version footer, and only that
   tap (a "skipWaiting" message, below) lets it take over. Before v4.8 every build took
   over the moment it landed and the page reloaded itself — wiping a load mid-entry.

   TAP_FLAG is how a new build knows the phone is already running this way. A page from
   before v4.8 has no way to send the tap, so until a tap-aware build has actually taken
   over here, a new build still takes over on its own — once, to get the new page onto
   the phone. The flag is an empty cache that build creates as it takes over; its mere
   existence is the flag. It's set only on activation, never on install, so a build
   that lands mid-hand-off can't mistake one still waiting to take over for one in
   charge. If iOS ever clears storage, the next build simply takes over by itself again,
   which the page handles by offering it rather than reloading. */
const TAP_FLAG = "milespost-tap";

/* A copy that no longer remembers it came through a redirect. Cloudflare answers
   /index.html with a redirect to / — and /index.html is the home-screen icon's start_url.
   A response that followed a redirect can't open a page: Safari refuses it ("Response
   served by service worker has redirections") and Chrome fails the load, online or not.
   Before v5.12 the cache stored /index.html exactly as fetched, redirect and all, so on
   that host the icon opened onto an error. Same bytes, same headers, minus the flag. */
const settled = async res => res.redirected
  ? new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers })
  : res;

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // "no-cache": revalidate every file with the server instead of trusting the phone's
    // HTTP cache. A host that sends a max-age (GitHub Pages sent 600) could otherwise
    // seed this build's cache with the previous build's index.html when a deploy lands
    // soon after the last one — a "new" version that is secretly the old one. Unchanged
    // files come back as a 304 and cost next to nothing.
    // All or nothing, like cache.addAll: every file is fetched before any is stored, and
    // one that fails fails the install, leaving the running build in charge.
    const got = await Promise.all(ASSETS.map(async u => {
      const req = new Request(u, { cache: "no-cache" });
      const res = await fetch(req);
      if (!res.ok) throw new TypeError(`${u}: HTTP ${res.status}`);
      return [req, await settled(res)];
    }));
    await Promise.all(got.map(([req, res]) => c.put(req, res)));
    if (!(await caches.has(TAP_FLAG))) await self.skipWaiting();
  })());
});

self.addEventListener("message", e => {
  if (e.data === "skipWaiting") self.skipWaiting();
  // The page asks a waiting build which version it is, so the offer can name it.
  else if (e.data === "version" && e.ports[0]) e.ports[0].postMessage(CACHE.replace(/^milespost-/, ""));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.open(TAP_FLAG)
      .then(() => caches.keys())
      .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== TAP_FLAG).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Cache-first: the app never needs the network, so a dead zone changes nothing.
// Same-origin only — API calls (HERE geocode/routing) must hit the live network every
// time, never a cached quote, and a failed API call must fail, not get index.html back.
// Reads this build's own cache only: with an update downloaded and waiting, a second
// build's files sit alongside, and the running page must never be handed one of them.
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  if (new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(c =>
      c.match(e.request).then(hit =>
        hit ? settled(hit) : fetch(e.request).then(res => {
          // Only clean, whole answers are kept: never an error page, and never a redirect
          // (see `settled`) — a page load would be handed it from then on.
          if (res.ok && !res.redirected) c.put(e.request, res.clone()).catch(() => {});
          return res;
        }).catch(() => c.match("./index.html").then(r => r && settled(r)))
      )
    )
  );
});
