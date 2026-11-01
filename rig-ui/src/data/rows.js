// Row logic for the data tables. No DOM.
//
//   detectType(values)                         → 'number' | 'date' | 'string'
//   sortRows(rows, { key, dir, type, value })  → new array, stable, nulls last
//   filterRows(rows, query, keys)              → rows whose fields contain every word
//   groupRows(rows, by, order?)                → [{ key, rows }] in first-seen (or given) order
//   aggregate(rows, { rate: 'sum', miles: 'avg' }) → { count, rate, miles }
//   toCSV(rows, columns)                       → RFC 4180 text, spreadsheet-safe

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const NUMERIC = /^[-+]?[$€£¥]?\s*[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*%?$/;

const isEmpty = (v) => v == null || v === '' || (typeof v === 'number' && Number.isNaN(v));

/** "$1,240.50" → 1240.5, "-3%" → -3. Returns NaN for anything else. */
export function toNumber(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value !== 'string') return NaN;
  const s = value.trim();
  if (!NUMERIC.test(s)) return NaN;
  const negative = /^-|^[$€£¥]\s*-/.test(s);
  const n = Number(s.replace(/[^\d.]/g, ''));
  return negative ? -n : n;
}

/** Date, timestamp-free ISO string or ISO date-time → epoch ms, else NaN. */
export function toTime(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string' && ISO_DATE.test(value.trim())) return Date.parse(value.trim());
  return NaN;
}

/** Guess a column's type from its values, ignoring blanks. */
export function detectType(values) {
  let numbers = 0;
  let dates = 0;
  let seen = 0;
  for (const v of values) {
    if (isEmpty(v)) continue;
    seen++;
    if (v instanceof Date || (typeof v === 'string' && ISO_DATE.test(v.trim()))) dates++;
    else if (!Number.isNaN(toNumber(v))) numbers++;
  }
  if (!seen) return 'string';
  if (dates === seen) return 'date';
  if (numbers === seen) return 'number';
  return 'string';
}

const collator = typeof Intl !== 'undefined'
  ? new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
  : { compare: (a, b) => (a < b ? -1 : a > b ? 1 : 0) };

/** Compare two values of a type, ascending. Blanks are not handled here. */
export function compareValues(a, b, type = 'string') {
  if (type === 'number') return toNumber(a) - toNumber(b);
  if (type === 'date') return toTime(a) - toTime(b);
  return collator.compare(String(a), String(b));
}

/**
 * Sort rows by one field. Stable: equal rows keep their order. Blank values sort
 * last in both directions, so flipping direction never buries real data.
 * `value(row)` overrides how the sort value is read; `type` skips detection.
 */
export function sortRows(rows, { key, dir = 'asc', type, value } = {}) {
  if (!key && !value) return rows.slice();
  if (dir !== 'asc' && dir !== 'desc') return rows.slice();
  const read = value ?? ((row) => row?.[key]);
  const decorated = rows.map((row, index) => ({ row, index, v: read(row) }));
  const kind = type ?? detectType(decorated.map((d) => d.v));
  const sign = dir === 'desc' ? -1 : 1;
  decorated.sort((a, b) => {
    const ea = isEmpty(a.v) || (kind === 'number' && Number.isNaN(toNumber(a.v))) || (kind === 'date' && Number.isNaN(toTime(a.v)));
    const eb = isEmpty(b.v) || (kind === 'number' && Number.isNaN(toNumber(b.v))) || (kind === 'date' && Number.isNaN(toTime(b.v)));
    if (ea || eb) return ea === eb ? a.index - b.index : ea ? 1 : -1;
    return sign * compareValues(a.v, b.v, kind) || a.index - b.index;
  });
  return decorated.map((d) => d.row);
}

/** Lowercase and strip accents so "José" matches "jose". */
export function fold(text) {
  return String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Rows where every word of the query appears in at least one of the keys. */
export function filterRows(rows, query, keys) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return rows.slice();
  return rows.filter((row) => {
    const hay = keys.map((k) => fold(typeof k === 'function' ? k(row) : row?.[k])).join('\u0000');
    return words.every((w) => hay.includes(w));
  });
}

/**
 * Group rows by a key or function. Groups come out in `order` when given
 * (unknown keys after it, first-seen), otherwise in first-seen order. Rows keep
 * their order inside each group.
 */
export function groupRows(rows, by, order = []) {
  const read = typeof by === 'function' ? by : (row) => row?.[by];
  const map = new Map();
  for (const row of rows) {
    const k = read(row) ?? '';
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(row);
  }
  const keys = [...map.keys()];
  const rank = new Map(order.map((k, i) => [k, i]));
  keys.sort((a, b) => (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity) || 0);
  return keys.map((key) => ({ key, rows: map.get(key) }));
}

/**
 * Summaries over rows. `specs` maps a field to 'sum' | 'avg' | 'min' | 'max' |
 * 'count' (count of non-blank values), or to a function(values, rows).
 * Non-numeric values are skipped; an empty avg/min/max is null.
 */
export function aggregate(rows, specs = {}) {
  const out = { count: rows.length };
  for (const [field, fn] of Object.entries(specs)) {
    const raw = rows.map((r) => r?.[field]).filter((v) => !isEmpty(v));
    if (typeof fn === 'function') { out[field] = fn(raw, rows); continue; }
    const nums = raw.map(toNumber).filter((n) => Number.isFinite(n));
    if (fn === 'count') out[field] = raw.length;
    else if (fn === 'sum') out[field] = round(nums.reduce((s, n) => s + n, 0));
    else if (fn === 'avg') out[field] = nums.length ? round(nums.reduce((s, n) => s + n, 0) / nums.length) : null;
    else if (fn === 'min') out[field] = nums.length ? Math.min(...nums) : null;
    else if (fn === 'max') out[field] = nums.length ? Math.max(...nums) : null;
    else throw new RangeError(`Unknown aggregate "${fn}" for ${field}. Use sum, avg, min, max or count.`);
  }
  return out;
}

// Trim binary float noise (0.1 + 0.2) without hiding real precision.
const round = (n) => Math.round(n * 1e9) / 1e9;

/** "rate:sum miles:avg" → { rate: 'sum', miles: 'avg' } */
export function parseAggregates(text) {
  const out = {};
  for (const part of String(text ?? '').split(/[\s,]+/).filter(Boolean)) {
    const [field, fn = 'sum'] = part.split(':');
    out[field] = fn;
  }
  return out;
}

/**
 * CSV for a set of rows. `columns` are { key, label, value?(row), csv?(value,row) }.
 * Cells starting with = + - @ get a leading apostrophe so spreadsheets don't run
 * them as formulas (negative numbers are left alone).
 */
export function toCSV(rows, columns) {
  const cell = (v) => {
    let s = v == null ? '' : v instanceof Date ? v.toISOString() : String(v);
    if (/^[=+\-@\t\r]/.test(s) && Number.isNaN(Number(s))) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = columns.map((c) => cell(c.label ?? c.key)).join(',');
  const body = rows.map((row) => columns.map((c) => {
    const v = c.value ? c.value(row) : row?.[c.key];
    return cell(c.csv ? c.csv(v, row) : v);
  }).join(','));
  return [head, ...body].join('\r\n');
}
