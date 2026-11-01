// Pure calendar math for <rig-calendar> and <rig-date-picker>. No DOM.
//
// A calendar day is an ISO string, "yyyy-mm-dd", meaning that day on the
// wall calendar wherever the person is. Arithmetic goes through integer day
// numbers computed with civil-calendar formulas (no Date objects, no time of
// day), so daylight-saving changes and time zones can never shift a day.
//
//   addDays('2026-03-07', 1)          -> '2026-03-08'
//   addMonths('2026-01-31', 1)        -> '2026-02-28'
//   monthGrid(2026, 11, 1).weeks      -> 6 rows of 7 { iso, inMonth, weekday }

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const pad = (n, width = 2) => String(n).padStart(width, '0');

/** True for leap years in the proleptic Gregorian calendar. */
export function isLeapYear(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** Days in month `m` (1-12) of year `y`. */
export function daysInMonth(y, m) {
  return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

/** Build an ISO day from parts (month is 1-12). */
export function makeISO(y, m, d) {
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
}

/** "2026-11-03" -> { y: 2026, m: 11, d: 3 } (no validation). */
export function toParts(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d };
}

/** Validate and normalize. Returns the ISO string, or null for anything that isn't a real day. */
export function parseISO(value) {
  const match = ISO_RE.exec(String(value ?? '').trim());
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (y < 1 || m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return makeISO(y, m, d);
}

/** Days since 1970-01-01 (negative before). Howard Hinnant's days_from_civil. */
export function dayNumber(iso) {
  let { y, m, d } = toParts(iso);
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** Inverse of dayNumber. */
export function fromDayNumber(n) {
  const z = n + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  return makeISO(y, m, d);
}

export const addDays = (iso, n) => fromDayNumber(dayNumber(iso) + n);

/** Move by whole months, keeping the day where possible (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(iso, n) {
  const { y, m, d } = toParts(iso);
  const index = y * 12 + (m - 1) + n;
  const ny = Math.floor(index / 12);
  const nm = index - ny * 12 + 1;
  return makeISO(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

export const addYears = (iso, n) => addMonths(iso, n * 12);

/** 0 = Sunday ... 6 = Saturday. 1970-01-01 was a Thursday. */
export function weekday(iso) {
  return (((dayNumber(iso) + 4) % 7) + 7) % 7;
}

/** First day of the week that contains `iso`, for a week starting on `weekStart` (0 = Sunday). */
export function startOfWeek(iso, weekStart = 0) {
  return addDays(iso, -((weekday(iso) - weekStart + 7) % 7));
}

export const endOfWeek = (iso, weekStart = 0) => addDays(startOfWeek(iso, weekStart), 6);

export function startOfMonth(iso) {
  const { y, m } = toParts(iso);
  return makeISO(y, m, 1);
}

export function endOfMonth(iso) {
  const { y, m } = toParts(iso);
  return makeISO(y, m, daysInMonth(y, m));
}

/** "yyyy-mm" of a day, handy for comparing months. */
export const monthKey = (iso) => iso.slice(0, 7);

/** Whole months from `a`'s month to `b`'s month. */
export function monthDiff(a, b) {
  const pa = toParts(a);
  const pb = toParts(b);
  return (pb.y - pa.y) * 12 + (pb.m - pa.m);
}

/** ISO strings with 4-digit years sort lexically, so this is a plain string compare. */
export const compareISO = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Keep a day inside optional bounds (either bound may be empty). */
export function clampISO(iso, min, max) {
  if (min && iso < min) return min;
  if (max && iso > max) return max;
  return iso;
}

/** Inclusive, in either order. */
export function isBetween(iso, a, b) {
  if (!a || !b) return false;
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  return iso >= lo && iso <= hi;
}

export const orderRange = (a, b) => (a <= b ? [a, b] : [b, a]);

/** Inclusive day count of a range: same day = 1. */
export const rangeDays = (a, b) => Math.abs(dayNumber(b) - dayNumber(a)) + 1;

/** Weekday indexes in display order, e.g. weekStart 1 -> [1,2,3,4,5,6,0]. */
export function weekdayOrder(weekStart = 0) {
  return Array.from({ length: 7 }, (_, i) => (weekStart + i) % 7);
}

/**
 * The month as 6 weeks of 7 days (always 6, so the grid never changes height).
 * `m` is 1-12. Days from the neighbouring months have inMonth: false.
 */
export function monthGrid(y, m, weekStart = 0) {
  const first = makeISO(y, m, 1);
  let day = startOfWeek(first, weekStart);
  const weeks = [];
  for (let w = 0; w < 6; w++) {
    const row = [];
    for (let i = 0; i < 7; i++) {
      const p = toParts(day);
      row.push({ iso: day, day: p.d, inMonth: p.m === m && p.y === y, weekday: weekday(day) });
      day = addDays(day, 1);
    }
    weeks.push(row);
  }
  return { first, last: makeISO(y, m, daysInMonth(y, m)), weeks };
}

/** Today on the local wall clock (the caller's time zone, which is what a person means by "today"). */
export function todayISO(now = new Date()) {
  return makeISO(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/**
 * A Date at UTC midnight of the day, for Intl formatting with timeZone: 'UTC'.
 * Formatting this way shows the same calendar day in every time zone.
 */
export function utcDate(iso) {
  const { y, m, d } = toParts(iso);
  const date = new Date(0);
  date.setUTCFullYear(y, m - 1, d); // setUTCFullYear keeps years < 100 literal
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

/**
 * Which month should a `count`-month view start on so that `focus` is visible?
 * Keeps `first` when the focus is already showing; otherwise moves just far
 * enough (back: focus month first; forward: focus month last).
 */
export function shiftWindow(first, focus, count = 1) {
  const start = startOfMonth(first);
  const target = startOfMonth(focus);
  const d = monthDiff(start, target);
  if (d < 0) return target;
  if (d >= count) return addMonths(target, -(count - 1));
  return start;
}

/** The decade page a year sits on: 12 years, the decade plus one either side. */
export function yearPage(year) {
  const start = Math.floor(year / 10) * 10;
  return { start, end: start + 9, years: Array.from({ length: 12 }, (_, i) => start - 1 + i) };
}

/** Does any day of month `m` (1-12) of year `y` fall inside [min, max]? Empty bounds are open. */
export function monthAvailable(y, m, min = '', max = '') {
  const first = makeISO(y, m, 1);
  const last = makeISO(y, m, daysInMonth(y, m));
  return !(min && last < min) && !(max && first > max);
}

/** Does any day of year `y` fall inside [min, max]? */
export function yearAvailable(y, min = '', max = '') {
  return !(min && makeISO(y, 12, 31) < min) && !(max && makeISO(y, 1, 1) > max);
}

/** Same day in another month and year, clamped to that month's length. */
export function withMonth(iso, y, m) {
  const { d } = toParts(iso);
  return makeISO(y, m, Math.min(d, daysInMonth(y, m)));
}

/** "2026-11-03/2026-11-06" -> { start, end } (ordered; invalid parts become ''). */
export function parseRange(value) {
  const [a = '', b = ''] = String(value ?? '').split('/');
  const start = parseISO(a) ?? '';
  const end = parseISO(b) ?? '';
  if (start && end && end < start) return { start: end, end: start };
  return { start, end: start ? end : '' };
}

export function formatRangeValue(start, end) {
  if (!start) return '';
  return end ? `${start}/${end}` : start;
}
