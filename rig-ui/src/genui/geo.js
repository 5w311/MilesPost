// Geo math for route cards. No DOM.
//
//   haversine(a, b)                 great-circle distance in km between { lat, lon }
//   cumulativeDistances(points)     running km totals along a route
//   mercator(lat, lon)              Web Mercator in unit space (0..1, y down)
//   fitView(points, { width, height, padding })  -> { project, invert, scale }
//   niceStep(spanDeg), graticule(view, step), formatCoord(value, axis, step)
//   smoothPath(points)              SVG path through points (Catmull-Rom)
//   placeLabels(items, { width, height, lines })      first-fit label placement
//   routeGeometry(stops)            stops + per-leg road paths -> drawn line and distances
//   normalizeSummary(o), simplifyPath(points, tolerance), segmentHitsBox(seg, box)
//   formatDistance(km, unit), formatDuration(minutes), driveMinutes(km, kmh)

export const EARTH_RADIUS_KM = 6371.0088;
export const KM_PER_MI = 1.609344;
export const MAX_LAT = 85.05112878;

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** Great-circle distance in kilometres. */
export function haversine(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** [0, d01, d01 + d12, ...] in km. */
export function cumulativeDistances(points) {
  const out = [0];
  for (let i = 1; i < points.length; i++) out.push(out[i - 1] + haversine(points[i - 1], points[i]));
  return out;
}

export function routeDistance(points) {
  const c = cumulativeDistances(points);
  return c[c.length - 1] ?? 0;
}

/** Web Mercator in unit space: x 0..1 west to east, y 0..1 north to south. */
export function mercator(lat, lon) {
  const phi = rad(clamp(lat, -MAX_LAT, MAX_LAT));
  return {
    x: (lon + 180) / 360,
    y: (1 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / Math.PI) / 2,
  };
}

export function inverseMercator(x, y) {
  return { lat: deg(Math.atan(Math.sinh(Math.PI * (1 - 2 * y)))), lon: x * 360 - 180 };
}

/**
 * Fit points into a width x height box with padding (number or { top, right, bottom, left }).
 * Returns project(lat, lon) -> [x, y] and invert(x, y) -> { lat, lon }.
 */
export function fitView(points, { width, height, padding = 24, minSpanKm = 4 } = {}) {
  const pad = typeof padding === 'number'
    ? { top: padding, right: padding, bottom: padding, left: padding }
    : { top: 0, right: 0, bottom: 0, left: 0, ...padding };
  const proj = points.map((p) => mercator(p.lat, p.lon));
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  for (const p of proj) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  if (!proj.length) { minX = maxX = 0.5; minY = maxY = 0.5; }
  // A single point (or a very short hop) still gets a sensible zoom.
  const minSpan = minSpanKm / (2 * Math.PI * EARTH_RADIUS_KM);
  const spanX = Math.max(maxX - minX, minSpan);
  const spanY = Math.max(maxY - minY, minSpan);
  const innerW = Math.max(1, width - pad.left - pad.right);
  const innerH = Math.max(1, height - pad.top - pad.bottom);
  const scale = Math.min(innerW / spanX, innerH / spanY);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const ox = pad.left + innerW / 2;
  const oy = pad.top + innerH / 2;
  return {
    scale,
    project(lat, lon) {
      const m = mercator(lat, lon);
      return [ox + (m.x - cx) * scale, oy + (m.y - cy) * scale];
    },
    invert(x, y) {
      return inverseMercator(cx + (x - ox) / scale, cy + (y - oy) / scale);
    },
  };
}

const STEPS = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 15, 30, 45, 90];

/** A round graticule step so roughly `target` lines fit across `spanDeg`. */
export function niceStep(spanDeg, target = 5) {
  const span = Math.abs(spanDeg) || 1;
  return STEPS.find((s) => span / s <= target) ?? 90;
}

/** Lines of latitude and longitude at multiples of `step` inside the view. */
export function graticule({ north, south, east, west }, step) {
  const lats = [];
  const lons = [];
  const eps = step * 1e-6;
  for (let v = Math.ceil((south - eps) / step) * step; v <= north + eps; v += step) lats.push(round(v, 6));
  for (let v = Math.ceil((west - eps) / step) * step; v <= east + eps; v += step) lons.push(round(v, 6));
  return { lats, lons };
}

/** 30.5 -> "30.5°N", -81 -> "81°W" */
export function formatCoord(value, axis, step = 1) {
  const decimals = step >= 1 ? 0 : step >= 0.1 ? (Number.isInteger(step * 10) ? 1 : 2) : 2;
  const v = Math.abs(value).toFixed(decimals).replace(/\.0+$/, '');
  const hemi = axis === 'lat' ? (value >= 0 ? 'N' : 'S') : (value >= 0 ? 'E' : 'W');
  return Math.abs(value) < 1e-9 ? `0°` : `${v}°${hemi}`;
}

function round(n, places) {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/** Smooth SVG path through [x, y] points using a Catmull-Rom spline. */
export function smoothPath(points, tension = 0.5) {
  if (!points.length) return '';
  const f = (n) => Math.round(n * 10) / 10;
  if (points.length < 3) return points.map(([x, y], i) => `${i ? 'L' : 'M'}${f(x)} ${f(y)}`).join(' ');
  const k = tension / 3;
  let d = `M${f(points[0][0])} ${f(points[0][1])}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) * k, p1[1] + (p2[1] - p0[1]) * k];
    const c2 = [p2[0] - (p3[0] - p1[0]) * k, p2[1] - (p3[1] - p1[1]) * k];
    d += ` C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d;
}

function overlap(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function outside(box, width, height) {
  const inside = overlap(box, { x: 0, y: 0, w: width, h: height });
  return box.w * box.h - inside;
}

const SIDES = ['right', 'left', 'top', 'bottom', 'top-right', 'bottom-right', 'top-left', 'bottom-left'];

/** True when segment [x1, y1, x2, y2] touches the box { x, y, w, h }. */
export function segmentHitsBox([x1, y1, x2, y2], box) {
  const minX = box.x;
  const maxX = box.x + box.w;
  const minY = box.y;
  const maxY = box.y + box.h;
  if (Math.max(x1, x2) < minX || Math.min(x1, x2) > maxX || Math.max(y1, y2) < minY || Math.min(y1, y2) > maxY) return false;
  const inside = (x, y) => x >= minX && x <= maxX && y >= minY && y <= maxY;
  if (inside(x1, y1) || inside(x2, y2)) return true;
  // Liang–Barsky clip: does any part of the segment fall inside the box?
  const dx = x2 - x1;
  const dy = y2 - y1;
  let t0 = 0;
  let t1 = 1;
  const edges = [[-dx, x1 - minX], [dx, maxX - x1], [-dy, y1 - minY], [dy, maxY - y1]];
  for (const [p, q] of edges) {
    if (p === 0) { if (q < 0) return false; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return t0 <= t1;
}

function candidate(side, it, gap) {
  const { x, y, w, h } = it;
  const r = it.r ?? 6;
  const d = r * 0.72 + gap * 0.6;
  switch (side) {
    case 'right': return { x: x + r + gap, y: y - h / 2 };
    case 'left': return { x: x - r - gap - w, y: y - h / 2 };
    case 'top': return { x: x - w / 2, y: y - r - gap - h };
    case 'bottom': return { x: x - w / 2, y: y + r + gap };
    case 'top-right': return { x: x + d, y: y - d - h };
    case 'bottom-right': return { x: x + d, y: y + d };
    case 'top-left': return { x: x - d - w, y: y - d - h };
    default: return { x: x - d - w, y: y + d };
  }
}

/**
 * Place a label next to each marker. Candidates are tried in order (right, left,
 * above, below, then the diagonals, first close to the marker and then a step
 * further out) and the first one that stays inside the box and touches no other
 * label, no other marker and no route segment wins. If none is clear, the label
 * may cross the route line (it has a halo) but never another label or marker;
 * only when that fails too is it hidden.
 *
 * items: [{ x, y, w, h, r?, priority? }] (x, y = marker centre; w, h = label size)
 * options.lines: route segments [[x1, y1, x2, y2], ...]; options.obstacles: points [[x, y], ...]
 * Returns, in input order: [{ x, y, side, hidden, crossesLine }] with x, y the label's top-left.
 */
export function placeLabels(items, { width, height, gap = 6, obstacles = [], lines = [] } = {}) {
  const order = items.map((it, i) => i).sort((a, b) => (items[b].priority ?? 0) - (items[a].priority ?? 0) || a - b);
  const markers = items.map((it) => {
    const r = (it.r ?? 6) + 2;
    return { x: it.x - r, y: it.y - r, w: r * 2, h: r * 2 };
  });
  const placed = [];
  const out = new Array(items.length);
  for (const i of order) {
    const it = items[i];
    const candidates = [];
    for (const reach of [gap, gap * 2.5 + (it.r ?? 6)]) {
      for (const side of SIDES) {
        const p = candidate(side, it, reach);
        candidates.push({ side, x: p.x, y: p.y, w: it.w, h: it.h });
      }
    }
    const clearOfLabels = (box) => outside(box, width, height) === 0
      && !placed.some((other) => overlap(box, other) > 0)
      && !markers.some((m, j) => j !== i && overlap(box, m) > 0);
    const lineHits = (box) => {
      const pad = { x: box.x - 1, y: box.y - 1, w: box.w + 2, h: box.h + 2 };
      let n = 0;
      for (const seg of lines) if (segmentHitsBox(seg, pad)) n++;
      for (const [ox, oy] of obstacles) if (ox >= pad.x && ox <= pad.x + pad.w && oy >= pad.y && oy <= pad.y + pad.h) n++;
      return n;
    };
    let chosen = candidates.find((box) => clearOfLabels(box) && lineHits(box) === 0);
    let crossesLine = false;
    if (!chosen) {
      // Second pass: crossing the line is acceptable, colliding with text is not.
      let fewest = Infinity;
      for (const box of candidates) {
        if (!clearOfLabels(box)) continue;
        const hits = lineHits(box);
        if (hits < fewest) { fewest = hits; chosen = box; }
      }
      crossesLine = Boolean(chosen);
    }
    if (chosen) {
      placed.push(chosen);
      out[i] = { x: chosen.x, y: chosen.y, side: chosen.side, hidden: false, crossesLine };
    } else {
      const c = candidates[0];
      out[i] = { x: c.x, y: c.y, side: c.side, hidden: true, crossesLine: false };
    }
  }
  return out;
}

/* ---------- route data from routing APIs ---------- */

function toLatLon(p) {
  if (Array.isArray(p) && p.length >= 2) return { lat: Number(p[0]), lon: Number(p[1]) };
  if (p && typeof p === 'object') return { lat: Number(p.lat), lon: Number(p.lon ?? p.lng) };
  return null;
}
const valid = (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon);
const same = (a, b) => a && b && Math.abs(a.lat - b.lat) < 1e-7 && Math.abs(a.lon - b.lon) < 1e-7;

/**
 * Expand stops into the line that gets drawn. A stop may carry `path`, the road
 * geometry of the leg that ends at it ([[lat, lon], ...] or [{ lat, lon }]),
 * for example from a routing API; legs without one are straight.
 * Returns { points, stopAt, cumKm, legKm, road, anyPath, pathSegment }:
 *   points      every point of the line, stops included
 *   stopAt      index into points for each stop
 *   cumKm       distance along the line to each stop
 *   road        true when every leg has a path, so the total is a road distance
 *   pathSegment pathSegment[k] is true when the segment ending at points[k] follows a path
 */
export function routeGeometry(stops) {
  const points = [];
  const stopAt = [];
  const pathSegment = [];
  let legs = 0;
  let legsWithPath = 0;
  stops.forEach((s, i) => {
    const here = toLatLon(s);
    if (i > 0) {
      legs++;
      const path = (Array.isArray(s.path) ? s.path : []).map(toLatLon).filter(valid);
      if (path.length) legsWithPath++;
      for (const p of path) {
        if (same(p, points[points.length - 1])) continue;
        points.push(p);
        pathSegment.push(true);
      }
      if (!same(here, points[points.length - 1])) {
        points.push(here);
        pathSegment.push(path.length > 0);
      }
    } else {
      points.push(here);
      pathSegment.push(false);
    }
    stopAt.push(points.length - 1);
  });
  const along = cumulativeDistances(points);
  const cumKm = stopAt.map((k) => along[k]);
  const legKm = cumKm.map((d, i) => (i ? d - cumKm[i - 1] : 0));
  return { points, stopAt, cumKm, legKm, road: legs > 0 && legsWithPath === legs, anyPath: legsWithPath > 0, pathSegment };
}

/**
 * Normalise a routing summary to { km, minutes } (either may be null).
 * Accepts distanceKm | distanceMi | distanceMeters and durationMinutes | durationSeconds.
 */
export function normalizeSummary(o) {
  if (!o || typeof o !== 'object') return { km: null, minutes: null };
  const num = (v) => (v == null || v === '' ? NaN : Number(v));
  let km = num(o.distanceKm);
  if (!Number.isFinite(km)) km = num(o.distanceMi) * KM_PER_MI;
  if (!Number.isFinite(km)) km = num(o.distanceMeters) / 1000;
  let minutes = num(o.durationMinutes);
  if (!Number.isFinite(minutes)) minutes = num(o.durationSeconds) / 60;
  return {
    km: Number.isFinite(km) && km >= 0 ? km : null,
    minutes: Number.isFinite(minutes) && minutes >= 0 ? minutes : null,
  };
}

/**
 * Drop points closer than `tolerance` (in the same units, e.g. px) to the last
 * kept point, so a dense road geometry draws cheaply. Keeps the first and last
 * points and any index listed in `keep`.
 */
export function simplifyPath(points, tolerance = 1.5, keep = []) {
  if (points.length <= 2) return points.map((p, i) => ({ p, i }));
  const must = new Set(keep);
  const out = [{ p: points[0], i: 0 }];
  const t2 = tolerance * tolerance;
  for (let i = 1; i < points.length - 1; i++) {
    const [x, y] = points[i];
    const [lx, ly] = out[out.length - 1].p;
    if (must.has(i) || (x - lx) ** 2 + (y - ly) ** 2 >= t2) out.push({ p: points[i], i });
  }
  out.push({ p: points[points.length - 1], i: points.length - 1 });
  return out;
}

/** Minutes of driving at an average speed. */
export function driveMinutes(km, speedKmh = 88) {
  if (!(speedKmh > 0)) return 0;
  return (km / speedKmh) * 60;
}

/** 412.3 km -> "256 mi" (unit 'mi') or "412 km". Short hops keep one decimal. */
export function formatDistance(km, unit = 'mi', locale) {
  const v = unit === 'mi' ? km / KM_PER_MI : km;
  const digits = v < 10 ? 1 : 0;
  const n = new Intl.NumberFormat(locale, { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(v);
  return `${n} ${unit}`;
}

/** 292 -> "4 h 52 min", 45 -> "45 min", 120 -> "2 h" */
export function formatDuration(minutes) {
  const total = Math.max(0, Math.round(minutes));
  const hr = Math.floor(total / 60);
  const min = total % 60;
  if (!hr) return `${min} min`;
  return min ? `${hr} h ${min} min` : `${hr} h`;
}
