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

export function resolvePlace(raw){
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
  if(STATE_TZ[st]) return {tz:Z[STATE_TZ[st]], place:label};
  const sp = SPLIT[st];
  if(sp){
    if(city && sp.cities[city]) return {tz:Z[sp.cities[city]], place:label};
    if(sp.def) return {tz:Z[sp.def], place:label};
  }
  return null;
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

/* ======================= ETA ======================= */
export const RATE = 50;                      // dispatch always plans at miles ÷ 50
// swapMin: flat 30 all presets. fuelMin varies. dotMin: the DOT-break duration
// (floor 30, see dotDuration). dotAt: hours into each shift the DOT break lands.
export const PRESETS = {
  Conservative:{mph:64,fuelEvery:500,fuelMin:25,swapMin:30,dotMin:30,dotAt:4},
  Realistic:{mph:65,fuelEvery:650,fuelMin:20,swapMin:30,dotMin:30,dotAt:5},
  Push:{mph:68,fuelEvery:800,fuelMin:15,swapMin:30,dotMin:30,dotAt:6}
};
/* What the app actually seeds tuning from since v4.1, when the preset chooser was
   removed: the old Realistic values (the middle preset, and the app's default) minus
   mph. Live routing supplies drive time now, so a cruise speed has nothing to drive —
   but the stop rules below are team-driver behavior no router knows about, so they
   stay, editable under "+ TUNE TO YOUR TRUCK". PRESETS itself is kept as the fixture
   solveEta's own tests are written against. */
export const STOP_DEFAULTS = { fuelEvery:650, fuelMin:20, swapMin:30, dotMin:30, dotAt:5 };
export const PRESET_VERSION = 5;             // bump when PRESETS change, or saved copies override them
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
export function overlayStops({ driveH, miles, p, swap, startMs }){
  const start = new Date(startMs);
  const fuelStops = Math.max(0, Math.ceil(miles/(Number(p.fuelEvery)||9999))-1);
  const dotMin = dotDuration(p.dotMin);        // clamped to the 30-min floor

  let totalH = driveH, swaps = [], dots = [], stopH = 0;
  for(let i=0;i<8;i++){
    const endMs = startMs + totalH*3600e3;
    swaps = swapTimes(start, new Date(endMs), swap.tz, swap.times);
    dots = dotBreaks(startMs, endMs, swap, p.dotAt);
    stopH = (swaps.length*(Number(p.swapMin)||0)
           + fuelStops*(Number(p.fuelMin)||0)
           + dots.length*dotMin) / 60;
    const next = driveH + stopH;
    if(Math.abs(next-totalH) < 1e-4){ totalH = next; break; }
    totalH = next;
  }
  return { driveH, fuelStops, swaps, dots, dotMin, stopH, totalH };
}

/* Tuned-model arrival: drive time is the driver's own governed pace (miles/mph), then the
   team overlay on top. Also returns the dispatch-style quick ETA (miles ÷ 50). Same return
   shape it has always had, so index.html and the suite need no changes. */
export function solveEta({ miles, p, swap, startMs }){
  const mph = Number(p.mph) || 1;
  const driveH = miles / mph;
  const core = overlayStops({ driveH, miles, p, swap, startMs });
  const tunedEta = new Date(startMs + core.totalH*3600e3);
  const quickH = miles / RATE;
  const quickEta = new Date(startMs + quickH*3600e3);
  return { ...core, tunedEta, quickH, quickEta };
}

/* Live-model arrival: drive time and distance come from the routing API (HERE truck
   profile, traffic-aware) instead of miles/mph, then the SAME team overlay. driveSeconds
   and meters are exactly what the API returned. The preset's mph is deliberately ignored
   here — HERE already modeled truck speed, grades, road mix, and current traffic — but the
   preset's stop rules (fuel spacing/length, swap and DOT timing/length) still apply, since
   those are team-driver behavior the router knows nothing about. Returns miles (derived
   from meters) so the caller can show real road distance and count fuel stops off it. */
export function metersToMiles(meters){ return (Number(meters) || 0) / 1609.344; }

export function solveEtaLive({ driveSeconds, meters, p, swap, startMs }){
  const miles = metersToMiles(meters);
  const driveH = (Number(driveSeconds) || 0) / 3600;
  const core = overlayStops({ driveH, miles, p, swap, startMs });
  const liveEta = new Date(startMs + core.totalH*3600e3);
  return { ...core, miles, liveEta };
}

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
