/* MilesPost — pure logic, extracted from index.html so it can be unit-tested.
   Nothing in here touches the DOM. index.html imports these; tests import them too,
   so the app and the suite exercise the exact same code. */

/* ======================= timezone resolver ======================= */
export const Z = { E:"America/New_York", C:"America/Chicago", M:"America/Denver",
  P:"America/Los_Angeles", AZ:"America/Phoenix", AK:"America/Anchorage", HI:"Pacific/Honolulu" };

export const STATE_TZ = {
  CT:"E",DE:"E",DC:"E",GA:"E",ME:"E",MD:"E",MA:"E",NH:"E",NJ:"E",NY:"E",NC:"E",OH:"E",
  PA:"E",RI:"E",SC:"E",VT:"E",VA:"E",WV:"E",
  AL:"C",AR:"C",IL:"C",IA:"C",LA:"C",MN:"C",MS:"C",MO:"C",OK:"C",WI:"C",
  CO:"M",MT:"M",NM:"M",UT:"M",WY:"M",
  CA:"P",WA:"P",NV:"P",
  AZ:"AZ",AK:"AK",HI:"HI"
};
export const SPLIT = {
  TX:{def:"C",cities:{"el paso":"M",socorro:"M","horizon city":"M",anthony:"M",fabens:"M",
      "van horn":"M","sierra blanca":"M"}},
  FL:{def:"E",cities:{pensacola:"C","panama city":"C","fort walton beach":"C",destin:"C",
      crestview:"C",milton:"C",niceville:"C",marianna:"C",chipley:"C","de funiak springs":"C",
      "defuniak springs":"C",bonifay:"C","gulf breeze":"C",navarre:"C"}},
  TN:{def:null,cities:{nashville:"C",memphis:"C",jackson:"C",clarksville:"C",murfreesboro:"C",
      franklin:"C",cookeville:"C",dickson:"C",columbia:"C","spring hill":"C",lebanon:"C",
      smyrna:"C",gallatin:"C",hendersonville:"C",knoxville:"E",chattanooga:"E","johnson city":"E",
      kingsport:"E",bristol:"E",cleveland:"E",morristown:"E",crossville:"E",athens:"E",
      sevierville:"E","oak ridge":"E",maryville:"E",greeneville:"E"}},
  KY:{def:null,cities:{louisville:"E",lexington:"E",covington:"E",florence:"E",frankfort:"E",
      richmond:"E",georgetown:"E",elizabethtown:"E",london:"E",corbin:"E",danville:"E",
      winchester:"E",somerset:"E","mount sterling":"E",ashland:"E","bowling green":"C",
      paducah:"C",owensboro:"C",hopkinsville:"C",henderson:"C",madisonville:"C",
      "central city":"C",cadiz:"C"}},
  IN:{def:"E",cities:{gary:"C",hammond:"C",evansville:"C",merrillville:"C",portage:"C",
      valparaiso:"C","michigan city":"C",jasper:"C"}},
  ND:{def:"C",cities:{dickinson:"M",bowman:"M",beach:"M",hettinger:"M"}},
  SD:{def:"C",cities:{"rapid city":"M",spearfish:"M",sturgis:"M","belle fourche":"M",
      "hot springs":"M",custer:"M",pierre:"C"}},
  NE:{def:"C",cities:{scottsbluff:"M",sidney:"M",chadron:"M",kimball:"M",alliance:"M",
      ogallala:"M","north platte":"C"}},
  KS:{def:"C",cities:{goodland:"M","sharon springs":"M",colby:"C"}},
  ID:{def:"M",cities:{"coeur d'alene":"P","coeur dalene":"P","post falls":"P",sandpoint:"P",
      moscow:"P",lewiston:"P","bonners ferry":"P"}},
  OR:{def:"P",cities:{ontario:"M"}},
  MI:{def:"E",cities:{menominee:"C","iron mountain":"C",ironwood:"C",escanaba:"E"}}
};
export const STATE_NAMES = {alabama:"AL",alaska:"AK",arizona:"AZ",arkansas:"AR",california:"CA",
  colorado:"CO",connecticut:"CT",delaware:"DE",florida:"FL",georgia:"GA",hawaii:"HI",idaho:"ID",
  illinois:"IL",indiana:"IN",iowa:"IA",kansas:"KS",kentucky:"KY",louisiana:"LA",maine:"ME",
  maryland:"MD",massachusetts:"MA",michigan:"MI",minnesota:"MN",mississippi:"MS",missouri:"MO",
  montana:"MT",nebraska:"NE",nevada:"NV","new hampshire":"NH","new jersey":"NJ","new mexico":"NM",
  "new york":"NY","north carolina":"NC","north dakota":"ND",ohio:"OH",oklahoma:"OK",oregon:"OR",
  pennsylvania:"PA","rhode island":"RI","south carolina":"SC","south dakota":"SD",tennessee:"TN",
  texas:"TX",utah:"UT",vermont:"VT",virginia:"VA",washington:"WA","west virginia":"WV",
  wisconsin:"WI",wyoming:"WY","district of columbia":"DC"};

export const ZONE_LIST = ["America/New_York","America/Chicago","America/Denver","America/Phoenix",
  "America/Los_Angeles","America/Anchorage","Pacific/Honolulu"];

export const titleCase = s => s.split(" ").map(w => w ? w[0].toUpperCase()+w.slice(1) : w).join(" ");

/* The state and city an entry names, or null if no state can be found in it. Split out so
   resolvePlace() and splitStateNeedingZone() can never disagree about what a given string
   means — they have to answer about the same parse. */
function parsePlace(raw){
  const norm = raw.toLowerCase().replace(/[.,]/g," ").replace(/\s+/g," ").trim();
  if(!norm) return null;
  const words = norm.split(" ");
  let st=null, cityWords=words;
  for(const n of [3,2,1]){
    if(words.length>=n){
      const cand = words.slice(-n).join(" ");
      if(STATE_NAMES[cand]){ st=STATE_NAMES[cand]; cityWords=words.slice(0,-n); break; }
    }
  }
  if(!st){
    const last = words[words.length-1].toUpperCase();
    if(last.length===2 && (STATE_TZ[last]||SPLIT[last])){ st=last; cityWords=words.slice(0,-1); }
  }
  if(!st) return null;
  const city = cityWords.join(" ").trim();
  const label = city ? titleCase(city)+", "+st
    : titleCase(Object.keys(STATE_NAMES).find(k=>STATE_NAMES[k]===st)||st);
  return { st, city, label };
}

export function resolvePlace(raw){
  const p = parsePlace(raw);
  if(!p) return null;
  const { st, city, label } = p;
  if(STATE_TZ[st]) return {tz:Z[STATE_TZ[st]], place:label};
  const sp = SPLIT[st];
  if(sp){
    if(city && sp.cities[city]) return {tz:Z[sp.cities[city]], place:label};
    if(sp.def) return {tz:Z[sp.def], place:label};
  }
  return null;
}

/* WHY resolvePlace() gave up, when the reason is "this state runs on two clocks and I can't
   tell which side of the line this town is on" rather than "I don't know this place at all".

   Kentucky and Tennessee are the only split states with no default zone, and that is
   deliberate: both are cut roughly in half, so defaulting would silently put an appointment
   an hour out. The cost is that an unlisted town in either — "Independence, KY" — comes back
   null exactly like gibberish does, and the driver gets told to add the state they just
   typed. This lets the caller tell the two apart, ask the right question, and offer only the
   zones that state actually spans instead of all thirty.

   Null for anything resolvePlace() can place, and for input naming no state we know. */
export function splitStateNeedingZone(raw){
  const p = parsePlace(raw);
  if(!p) return null;
  const sp = SPLIT[p.st];
  if(!sp || sp.def) return null;                 // not split, or it has a default to fall back on
  if(p.city && sp.cities[p.city]) return null;   // the town itself is in the table
  return {
    st: p.st,
    state: titleCase(Object.keys(STATE_NAMES).find(k => STATE_NAMES[k] === p.st) || p.st),
    place: p.label,
    // Derived from the table rather than hardcoded, so it stays right if a state's cities change.
    zones: [...new Set(Object.values(sp.cities))].map(c => Z[c])
  };
}

/* ======================= time helpers ======================= */
export const deviceTz = () => { try{ return Intl.DateTimeFormat().resolvedOptions().timeZone; }
  catch{ return "America/New_York"; } };
export const tzTag = tz => { try{
  return new Intl.DateTimeFormat("en-US",{timeZone:tz,timeZoneName:"short"})
    .formatToParts(new Date()).find(p=>p.type==="timeZoneName").value;
} catch { return tz; } };
export const offsetMs = (date,tz) => {
  const p = new Intl.DateTimeFormat("en-US",{timeZone:tz,hour12:false,year:"numeric",month:"2-digit",
    day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit"})
    .formatToParts(date).reduce((a,x)=>(a[x.type]=x.value,a),{});
  return Date.UTC(+p.year,p.month-1,+p.day,p.hour%24,+p.minute,+p.second) - date.getTime();
};
export const fromWall = (wall,tz) => {
  if(!wall) return null;
  const naive = Date.parse((wall.length===16 ? wall+":00" : wall)+"Z");
  if(isNaN(naive)) return null;
  let ts = naive - offsetMs(new Date(naive),tz);
  ts = naive - offsetMs(new Date(ts),tz);
  return new Date(ts);
};
export const toWall = (date,tz) => {
  const p = new Intl.DateTimeFormat("en-CA",{timeZone:tz,hour12:false,year:"numeric",month:"2-digit",
    day:"2-digit",hour:"2-digit",minute:"2-digit"})
    .formatToParts(date).reduce((a,x)=>(a[x.type]=x.value,a),{});
  const h = p.hour%24===0 ? "00" : p.hour;
  return `${p.year}-${p.month}-${p.day}T${h}:${p.minute}`;
};
export const clockOf = (d,tz) => new Intl.DateTimeFormat("en-US",{timeZone:tz,hour:"2-digit",
  minute:"2-digit",hour12:false}).format(d);
export const dayOf = (d,tz) => new Intl.DateTimeFormat("en-US",{timeZone:tz,weekday:"short",
  month:"short",day:"numeric"}).format(d);
export const hm = h => { const s=Math.round(Math.abs(h)*60);
  return Math.floor(s/60)+"h "+String(s%60).padStart(2,"0")+"m"; };
export const hms = ms => {
  const t = Math.max(0, Math.floor(ms/1000));
  return Math.floor(t/3600)+"h "+String(Math.floor(t%3600/60)).padStart(2,"0")+"m "+
    String(t%60).padStart(2,"0")+"s";
};

export const RATE = 50;                      // dispatch always plans at miles ÷ 50

/* ======================= the tank =======================
   Adapted from FuelPost's lib/gauge.js, which solved this properly first.

   The old model was one number — "fuel every N miles" — doing two different jobs: how
   far the tank goes (a truck fact) and how far you'll run before stopping (a decision).
   Conflating them left nowhere to say "I'm rolling out on a half tank", so every plan
   assumed a full one and put the first fuel stop a tank's worth down the road.

   Three numbers instead. The driver sets the most miles they'll run between fuel stops
   (fuelMax, 900) — what a full tank plans, the way FuelPost's gauge reads "F — 900 mi" —
   the gauge says what is aboard right now, and TWO floors say what may be spent, because
   "don't plan on it" and "can't use it" are different claims:

     reserveTicks (2, a quarter)   what a normal plan may not touch
     backupTicks  (1, an eighth)   what NOTHING may touch, ever — the limp band

   Everything the app shows about fuel comes off these, so the whole model moves together. */
export const TICKS = 8;                        // eighths, E(0) to F(8)
const clampTick = t => Math.max(0, Math.min(TICKS, Math.round(Number(t) || 0)));

// fuelMax is the PLANNABLE span of a full tank — the eighths above the reserve floor — so
// one eighth is fuelMax over those, and the physical tank is eight of them (900 -> 150 a
// tick -> 1200 full to empty).
export const milesPerTick = p =>
  Math.max(0, Number(p.fuelMax) || 0) / Math.max(1, TICKS - (Number(p.reserveTicks) || 0));
export const fullRange   = p => milesPerTick(p) * TICKS;

export const plannableMiles = (tick, p) =>
  Math.max(0, (clampTick(tick) - (Number(p.reserveTicks) || 0)) * milesPerTick(p));
export const backupMiles = (tick, p) =>
  Math.max(0, (clampTick(tick) - (Number(p.backupTicks) || 0)) * milesPerTick(p));

/* The one question worth asking a gauge reading: how far can this plan, and does that dip
   into the backup? Above the floor it's ordinary plannable range. At or under it the plan
   may reach into the backup band — flagged, so the driver is told — because refusing to
   plan and refusing to look are different things, and a driver on a quarter tank is
   exactly who needs to see what's in reach. At the limp band it returns 0: there really
   is nothing to plan with. */
export function rangeForTick(tick, p){
  const normal = plannableMiles(tick, p);
  if(normal > 0) return { miles:normal, backup:false };
  const b = backupMiles(tick, p);
  return { miles:b, backup:b > 0 };
}

/* Where the fuel stops land, by odometer. The first is however far the fuel aboard can
   carry the plan; every one after it is a full tank's plannable range, since you leave a
   fuel stop full. A reading with nothing plannable puts the first stop at mile 0 — fuel
   before you roll, which is worth knowing at the yard rather than at 2am. */
export function fuelStopMiles(miles, tick, p){
  const out = [];
  const m = Number(miles) || 0;
  const leg = plannableMiles(TICKS, p);
  if(!(m > 0) || !(leg > 0)) return out;       // no run, or no usable range configured
  let n = Math.max(0, rangeForTick(tick, p).miles);
  while(n < m){ out.push(n); n += leg; }
  return out;
}

/* What the app seeds tuning from. The stop rules are team-driver behavior no router
   knows about, so they stay editable under "+ TUNE TO YOUR TRUCK". Fuel is the tank
   model above: the most miles between fuel stops (a full tank's plannable range), and
   the two floors that say what a plan may spend. 900 matches FuelPost — 150 a tick,
   1200 full to empty. */
export const STOP_DEFAULTS = {
  fuelMax:900, reserveTicks:2, backupTicks:1,
  fuelMin:20, swapMin:30, dotMin:30, dotAt:5
};
export const PRESET_VERSION = 7;             // bumped: gallons x mpg gave way to fuelMax
export const SWAP_DEFAULT = { times:["06:00","18:00"], tz:"America/New_York" };

// A DOT break is the federal 30-min break, so its duration never drops below 30.
export const DOT_MIN_FLOOR = 30;
export const dotDuration = v => Math.max(DOT_MIN_FLOOR, Number(v) || 0);

// Every instant in (start, end] where the wall clock in `tz` hits one of `times`.
export function swapTimes(start, end, tz, times){
  const out = [];
  if(!(end > start)) return out;
  let [Y,Mo,D] = toWall(start, tz).slice(0,10).split("-").map(Number);
  for(let guard=0; guard<400; guard++){
    const ds = Y+"-"+String(Mo).padStart(2,"0")+"-"+String(D).padStart(2,"0");
    for(const hhmm of times){
      const t = fromWall(ds+"T"+hhmm, tz);
      if(t && t > start && t <= end) out.push(t);
    }
    const nx = new Date(Date.UTC(Y, Mo-1, D+1));   // calendar math, DST-proof
    Y=nx.getUTCFullYear(); Mo=nx.getUTCMonth()+1; D=nx.getUTCDate();
    const dayStart = fromWall(Y+"-"+String(Mo).padStart(2,"0")+"-"+String(D).padStart(2,"0")+"T00:00", tz);
    if(dayStart > end) break;
  }
  return out.sort((a,b)=>a-b);
}

/* One DOT break per driving shift, placed `dotAtHours` into that shift. Shifts are the
   windows between swaps, so a shift begins at each swap instant (and the run's first shift
   began at the last swap on/before departure). A shift's break counts only if its mark
   (shiftStart + dotAt) lands inside the run (start, end] — so a run that ends before the
   mark, or departs after it, takes zero for that shift. This mirrors swap counting: one
   break per shift-window the run actually drives through and reaches the mark of. Returns
   the break instants, sorted. */
export function dotBreaks(startMs, endMs, swap, dotAtHours){
  const out = [];
  if(!(endMs > startMs)) return out;
  const start = new Date(startMs), end = new Date(endMs);
  const dotMs = (Number(dotAtHours) || 0) * 3600e3;
  // The shift containing departure began at the last swap on/before start (look back a day+,
  // enough to cover any shift length). Fall back to start itself if the schedule has no swaps.
  const before = swapTimes(new Date(startMs - 25*3600e3), start, swap.tz, swap.times);
  const s0 = before.length ? before[before.length-1] : start;
  const shiftStarts = [s0, ...swapTimes(start, end, swap.tz, swap.times)];
  for(const s of shiftStarts){
    const mark = s.getTime() + dotMs;
    if(mark > startMs && mark <= endMs) out.push(new Date(mark));
  }
  return out.sort((a,b)=>a-b);
}

/* Which driver is up at a given instant, given the fixed-clock swap schedule.
   The day shift starts at the earlier swap time (default 06:00), the night shift at
   the later (default 18:00). Day runs [dayStart, nightStart); everything else is night,
   so the night shift wraps midnight. At an exact swap instant the incoming driver is up
   (arrival exactly at nightStart -> "night"). Keyed off the schedule's own wall-clock
   times in its own zone via clockOf, so it's inherently DST-safe. Returns "day"|"night". */
export function shiftAtArrival(arrivalInstant, swapSchedule){
  const toMin = hhmm => {
    const [h, m] = hhmm.split(":").map(Number);
    return (h % 24) * 60 + m;   // clockOf can render midnight as "24:00" -> normalize
  };
  const [dayStart, nightStart] = [...swapSchedule.times].sort().map(toMin);
  const a = toMin(clockOf(arrivalInstant, swapSchedule.tz));
  return (a >= dayStart && a < nightStart) ? "day" : "night";
}

/* The team-driver overlay: given a raw drive time (hours) and the road distance, layer
   on the fixed-clock swaps, the per-shift DOT breaks, and the odometer fuel stops. Both
   ETA models feed through this one function — the tuned line derives driveH from
   miles/mph, the live line takes driveH straight from the routing API — so the swap/DOT/
   fuel math lives in exactly one place and the two lines stay directly comparable.
   Swaps land on a fixed clock, so their count depends on the arrival time, which depends
   on how many swaps we took: iterate to a fixed point (each pass only adds stops, so it
   converges in 2-3). Pure: no DOM, no shared state. */
export function overlayStops({ driveH, miles, p, swap, startMs, fuelAt }){
  const start = new Date(startMs);
  // Fuel stops arrive as explicit odometer positions from fuelStopMiles() — the tank
  // model decides where they land, not a bare interval, because where the first one
  // falls depends on what's already aboard.
  const fuel = Array.isArray(fuelAt) ? fuelAt : [];
  const dotMin = dotDuration(p.dotMin);        // clamped to the 30-min floor

  let totalH = driveH, swaps = [], dots = [], stopH = 0;
  for(let i=0;i<8;i++){
    const endMs = startMs + totalH*3600e3;
    swaps = swapTimes(start, new Date(endMs), swap.tz, swap.times);
    dots = dotBreaks(startMs, endMs, swap, p.dotAt);
    stopH = (swaps.length*(Number(p.swapMin)||0)
           + fuel.length*(Number(p.fuelMin)||0)
           + dots.length*dotMin) / 60;
    const next = driveH + stopH;
    if(Math.abs(next-totalH) < 1e-4){ totalH = next; break; }
    totalH = next;
  }
  return { driveH, fuelAt:fuel, fuelStops:fuel.length, swaps, dots, dotMin, stopH, totalH };
}

/* The run as an ordered list of stops — what, when, and at what mile.

   The pieces come from two different clocks and have to be merged to be read: swaps and
   DOT breaks are fixed by the wall clock and already solved above, while fuel is fixed by
   the odometer, so when a fuel stop happens depends on how much stopped time precedes it.
   Walking the run once, taking whichever comes first, is what puts a mile marker on a swap
   and a clock time on a fuel stop — the two facts a driver plans against and the app has
   never shown. Pure: same inputs, same list. */
export function runSchedule({ core, miles, p, startMs }){
  const m = Number(miles) || 0;
  const fixed = [
    ...core.swaps.map(d => ({ kind:"swap", atMs:d.getTime(), min:Number(p.swapMin)||0 })),
    ...core.dots .map(d => ({ kind:"dot",  atMs:d.getTime(), min:core.dotMin }))
  ].sort((a,b) => a.atMs - b.atMs);
  const fuelMin = Number(p.fuelMin) || 0;
  if(!(m > 0) || !(core.driveH > 0)) return [];
  const msPerMile = core.driveH*3600e3 / m;

  const out = [];
  let fi = 0, ti = 0, mile = 0, t = startMs;
  let guard = 0;
  while((fi < core.fuelAt.length || ti < fixed.length) && guard++ < 200){
    // When each candidate would happen: fuel is however far it still is from here,
    // fixed stops are already absolute instants.
    const fuelMs  = fi < core.fuelAt.length
      ? t + Math.max(0, core.fuelAt[fi] - mile) * msPerMile : Infinity;
    const fixedMs = ti < fixed.length ? fixed[ti].atMs : Infinity;
    if(fuelMs <= fixedMs){
      mile = core.fuelAt[fi]; t = fuelMs;
      out.push({ kind:"fuel", atMs:t, mile, min:fuelMin });
      t += fuelMin*60e3; fi++;
    } else {
      // Miles only advance while rolling; a fixed stop landing inside another stop's
      // duration must not wind the odometer backwards.
      mile += Math.max(0, (fixedMs - t)) / msPerMile;
      t = fixedMs;
      out.push({ kind:fixed[ti].kind, atMs:t, mile, min:fixed[ti].min });
      t += fixed[ti].min*60e3; ti++;
    }
  }
  return out;
}

/* Live-model arrival: drive time and distance come from the routing API, the tank model
   says where fuel lands, and the same team overlay goes on top. `tick` is the gauge
   reading in eighths — see the tank section above. */
export function solveEtaLive({ driveSeconds, meters, p, swap, startMs, tick }){
  const miles = metersToMiles(meters);
  const driveH = (Number(driveSeconds) || 0) / 3600;
  const fuelAt = fuelStopMiles(miles, tick, p);
  const core = overlayStops({ driveH, miles, p, swap, startMs, fuelAt });
  const liveEta = new Date(startMs + core.totalH*3600e3);
  return { ...core, miles, liveEta, tank: rangeForTick(tick, p),
           schedule: runSchedule({ core, miles, p, startMs }) };
}

export function metersToMiles(meters){ return (Number(meters) || 0) / 1609.344; }

/* A cached live result describes traffic and position at the moment it was fetched. Once
   the truck has moved on, a stale result is worse than none — so the UI shows the live
   line only while the fetch is fresh, and silently falls back to the tuned model otherwise
   (offline, permission denied, request failed, or simply too old). Pure so the fallback is
   testable without a network or GPS. */
export const LIVE_MAX_AGE_MS = 10 * 60 * 1000;   // a live quote older than this is stale
export function liveFresh(fetchedAtMs, nowMs, maxAgeMs = LIVE_MAX_AGE_MS){
  if(fetchedAtMs == null) return false;
  const age = nowMs - fetchedAtMs;
  return age >= 0 && age <= maxAgeMs;
}

/* HERE Autosuggest's items[] mixes result types — city/town results (resultType
   "locality") alongside businesses, categories, and other place kinds that aren't
   useful here. Keep only locality items, format them as the plain "City, ST" string
   resolvePlace() already expects (no changes needed there), and dedupe. Pure: no DOM,
   no network — the fetch and debounce live in index.html.

   This account's plan returns locality items with only a flat address.label (e.g.
   "Chattanooga, TN, United States") — no structured address.city/stateCode fields,
   despite HERE's own docs showing them. Prefer the structured fields when present
   (future-proof if a plan/response ever includes them), and fall back to parsing the
   first two comma-separated segments of the label (or title, if label is missing)
   otherwise. The second segment may carry a ZIP ("TN 37402") — the state code is
   still extracted, so postal-code localities resolve to their city too. Drops
   anything where a usable city + 2-letter state can't be found either way.

   The caller now requests up to 20 results from HERE (cities compete with streets
   and businesses in autosuggest ranking, so a small request quota starves out all
   but the biggest cities); `max` caps how many make it into the dropdown. */
export function formatPlaceSuggestions(items, max = 5){
  const out = [];
  const seen = new Set();
  for(const it of (items || [])){
    if(out.length >= max) break;
    if(!it || it.resultType !== "locality") continue;
    const addr = it.address || {};
    let city = addr.city, st = addr.stateCode;
    if(!city || !st){
      const parts = String(addr.label || it.title || "").split(",").map(s => s.trim());
      if(!city) city = parts[0] || "";
      if(!st && parts[1]){
        const m = /^([A-Za-z]{2})(?:\s+\d{5}(?:-\d{4})?)?$/.exec(parts[1]);
        if(m) st = m[1];
      }
    }
    if(!city || !st) continue;
    const label = city + ", " + String(st).toUpperCase();
    if(seen.has(label)) continue;
    seen.add(label);
    out.push(label);
  }
  return out;
}

/* ======================= 34-hour reset ======================= */
export const RESET_HOURS = 34;

// A completed 34 auto-clears itself this long after it finishes.
export const AUTO_CLEAR_MS = 10 * 60 * 1000;   // 10 minutes

/* Has the auto-clear window elapsed for a reset that shut down at shutMs?
   Keys off the completion timestamp (shutMs + 34h), not a live timer, so it stays
   correct across app closes: reopen >10 min after completion and it reads true, never a
   negative countdown. Returns false while pending, running, or still inside the window. */
export function autoClearElapsed(shutMs, nowMs){
  if(shutMs == null) return false;
  const completionMs = shutMs + RESET_HOURS * 3600e3;
  return nowMs >= completionMs + AUTO_CLEAR_MS;
}

/* ======================= ICS ======================= */
export const icsStamp = d => d.toISOString().replace(/[-:]/g,"").split(".")[0]+"Z";
export const esc = s => s.replace(/([,;\\])/g,"\\$1");
