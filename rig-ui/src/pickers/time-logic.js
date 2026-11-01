// Time-of-day logic for <rig-time-picker>: parsing what people type, steps,
// allowed windows (including overnight ones), durations and formatting.
// No DOM. Times are whole minutes after midnight (0–1439); values on the wire
// are 24-hour "HH:MM" strings, the same as <input type="time">.

export const DAY = 1440;

const pad = (n) => String(n).padStart(2, '0');
const mod = (n, m) => ((n % m) + m) % m;

/** Steps must divide an hour evenly so every hour shows the same minutes. */
export const STEPS = [1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30, 60];

/** A usable step: the largest divisor of 60 that's not above `raw` (default 5). */
export function normalizeStep(raw, fallback = 5) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  let best = 1;
  for (const s of STEPS) if (s <= n) best = s;
  return best;
}

/** "14:30" (or "14:30:00") → 870. Anything else → null. */
export function parseTimeValue(text) {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(String(text ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** 870 → "14:30". */
export function toTimeValue(minutes) {
  if (minutes == null || !Number.isFinite(minutes)) return '';
  const t = mod(Math.round(minutes), DAY);
  return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
}

/** "06:00/14:00" → { start: 360, end: 840 }; missing or bad parts are null. */
export function parseTimeRange(text) {
  const [a = '', b = ''] = String(text ?? '').split('/');
  return { start: parseTimeValue(a), end: parseTimeValue(b) };
}

/**
 * Read a time the way people type it: "2p", "2:30 pm", "230p", "1430",
 * "14.30", "14h30", "9", "noon", "midnight".
 *
 * Without am/pm, 12-hour mode needs a guess for hours 1–12. In order, it
 * keeps `prefer` ("am" or "pm", usually the half of the day already chosen),
 * then takes whichever half `isAllowed` accepts if only one of them fits,
 * and otherwise reads it as morning, like the browser's own time field.
 *
 * Returns minutes after midnight, or null when it isn't a time.
 */
export function parseTypedTime(text, { hourCycle = 24, prefer = null, isAllowed = null } = {}) {
  let s = String(text ?? '').trim().toLowerCase();
  if (!s) return null;
  if (s === 'noon' || s === 'midday') return 720;
  if (s === 'midnight') return 0;
  s = s.replace(/\s+/g, '').replace(/\./g, (dot, i, all) => (/\d/.test(all[i - 1] ?? '') && /\d/.test(all[i + 1] ?? '') ? ':' : ''));
  const m = /^(\d{1,4})(?:[:h](\d{1,2})?)?(a|am|p|pm)?$/.exec(s);
  if (!m) return null;
  let digits = m[1];
  let minuteText = m[2];
  const half = m[3] ? m[3][0] : null;
  if (minuteText == null && digits.length > 2) {
    // "930" → 9:30, "1430" → 14:30
    minuteText = digits.slice(-2);
    digits = digits.slice(0, -2);
  }
  if (minuteText != null && minuteText.length !== 2) return null;
  let hour = Number(digits);
  const minute = minuteText == null ? 0 : Number(minuteText);
  if (minute > 59 || hour > 23 || digits.length > 2) return null;

  if (half) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (half === 'p' ? 12 : 0);
    return hour * 60 + minute;
  }
  if (hourCycle === 24 || hour === 0 || hour > 12) return hour * 60 + minute;

  // 12-hour mode, no am/pm: choose a half of the day.
  const am = (hour % 12) * 60 + minute;
  const pm = am + 720;
  if (prefer === 'pm') return pm;
  if (prefer === 'am') return am;
  if (typeof isAllowed === 'function') {
    const okAm = isAllowed(am);
    const okPm = isAllowed(pm);
    if (okPm && !okAm) return pm;
  }
  return am;
}

/** Round to the nearest step without crossing midnight. */
export function snapToStep(minutes, step = 1) {
  const s = normalizeStep(step, 1);
  let t = Math.round(minutes / s) * s;
  if (t >= DAY) t = Math.floor(minutes / s) * s;
  return mod(t, DAY);
}

/**
 * Whether `t` falls in the window [min, max]. A window whose min is after its
 * max runs overnight (22:00 → 06:00). Missing ends are open.
 */
export function inWindow(t, min = null, max = null) {
  if (min == null && max == null) return true;
  if (min == null) return t <= max;
  if (max == null) return t >= min;
  return min <= max ? t >= min && t <= max : t >= min || t <= max;
}

/** Every allowed time on the step grid. */
export function allowedTimes({ step = 5, min = null, max = null, isAllowed = null } = {}) {
  const s = normalizeStep(step);
  const out = [];
  for (let t = 0; t < DAY; t += s) {
    if (inWindow(t, min, max) && (!isAllowed || isAllowed(t))) out.push(t);
  }
  return out;
}

/** The allowed time closest to `t` around the clock (ties go later). Null if nothing is allowed. */
export function nearestAllowed(t, opts = {}) {
  const all = allowedTimes(opts);
  let best = null;
  let bestGap = Infinity;
  for (const a of all) {
    const fwd = mod(a - t, DAY);
    const gap = Math.min(fwd, DAY - fwd);
    if (gap < bestGap || (gap === bestGap && fwd <= DAY / 2)) { best = a; bestGap = gap; }
  }
  return best;
}

/** Move `count` allowed steps from `t`, wrapping around midnight. From null, start at `from`. */
export function stepTime(t, count, opts = {}) {
  const all = allowedTimes(opts);
  if (!all.length) return null;
  if (t == null) return nearestAllowed(opts.from ?? 0, opts) ?? all[0];
  let i = all.indexOf(t);
  if (i < 0) {
    // Not on the grid: the first move lands on the neighbor in that direction.
    i = count > 0 ? all.findIndex((a) => a > t) - 1 : all.findIndex((a) => a >= t);
    if (count > 0 && i === -2) i = all.length - 1;
    if (count < 0 && i === -1) i = all.length;
  }
  return all[mod(i + count, all.length)];
}

/** Minutes from start to end; an end before the start is the next day. */
export function spanMinutes(start, end) {
  if (start == null || end == null) return null;
  return mod(end - start, DAY);
}

/** 510 → "8 h 30 min", 45 → "45 min", 480 → "8 h". */
export function formatDuration(minutes) {
  if (minutes == null) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** 12 or 24, from the locale's own clock. */
export function hourCycleFor(locale) {
  try {
    const cycle = new Intl.DateTimeFormat(locale || undefined, { hour: 'numeric' }).resolvedOptions().hourCycle;
    return cycle === 'h11' || cycle === 'h12' ? 12 : 24;
  } catch {
    return 24;
  }
}

/** 870 → "2:30 PM" (12) or "14:30" (24), worded for the locale. */
export function formatTime(minutes, { locale = 'en', hourCycle = 24 } = {}) {
  if (minutes == null) return '';
  const date = new Date(Date.UTC(2000, 0, 1, Math.floor(minutes / 60), minutes % 60));
  const opts = { hour: hourCycle === 12 ? 'numeric' : '2-digit', minute: '2-digit', hourCycle: hourCycle === 12 ? 'h12' : 'h23', timeZone: 'UTC' };
  try {
    return new Intl.DateTimeFormat(locale, opts).format(date);
  } catch {
    return new Intl.DateTimeFormat('en', opts).format(date);
  }
}

/** The locale's words for morning and afternoon, e.g. ["AM", "PM"]. */
export function dayPeriods(locale = 'en') {
  const word = (h) => {
    const opts = { hour: 'numeric', hourCycle: 'h12', timeZone: 'UTC' };
    let parts;
    try { parts = new Intl.DateTimeFormat(locale, opts).formatToParts(new Date(Date.UTC(2000, 0, 1, h))); } catch { parts = []; }
    return parts.find((p) => p.type === 'dayPeriod')?.value;
  };
  return [word(9) || 'AM', word(15) || 'PM'];
}

/** Local wall-clock minutes now. */
export function nowMinutes(date = new Date()) {
  return date.getHours() * 60 + date.getMinutes();
}
