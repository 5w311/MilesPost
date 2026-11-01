// Pure math for overlays: pointer geometry, drag physics and typeahead.
// No DOM access, so it runs (and is tested) in Node.
//
//   inTriangle(p, a, b, c)            point-in-triangle, edges count as inside
//   safeTriangle(apex, rect, side)    the "safe zone" between a pointer and a submenu
//   velocityFrom(samples, now)        px/s from recent { t, p } drag samples
//   rubberband(distance, dimension)   resistance when dragging past a limit
//   pickSnap(current, velocity, snaps) where a released drawer or sheet should rest
//   typeahead(labels, query, start)   next label that starts with what was typed

const cross = (p, a, b) => (p.x - b.x) * (a.y - b.y) - (a.x - b.x) * (p.y - b.y);

/** True when point p lies inside (or on an edge of) triangle abc. Points are { x, y }. */
export function inTriangle(p, a, b, c) {
  const d1 = cross(p, a, b);
  const d2 = cross(p, b, c);
  const d3 = cross(p, c, a);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

/**
 * The triangle a pointer may cross on its way from a submenu trigger to the
 * submenu without the submenu closing. `apex` is where the pointer last was on
 * the trigger; `rect` is the submenu's box; `side` is the side of the parent
 * the submenu opened on ('right' or 'left'). The apex is nudged back a couple
 * of pixels so the starting point itself counts as inside.
 */
export function safeTriangle(apex, rect, side, pad = 8) {
  const towardLeft = side === 'left';
  const edge = towardLeft ? rect.left + rect.width : rect.left;
  const nudge = towardLeft ? 3 : -3;
  return [
    { x: apex.x + nudge, y: apex.y },
    { x: edge, y: rect.top - pad },
    { x: edge, y: rect.top + rect.height + pad },
  ];
}

/**
 * Velocity in px/s from drag samples [{ t (ms), p (px) }], using only the last
 * `window` ms. A pointer that stopped before release has no velocity.
 */
export function velocityFrom(samples, now = samples.length ? samples[samples.length - 1].t : 0, window = 100) {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  if (now - last.t > 60) return 0;
  let first = last;
  for (let i = samples.length - 1; i >= 0; i--) {
    if (last.t - samples[i].t > window) break;
    first = samples[i];
  }
  const dt = last.t - first.t;
  if (dt <= 0) return 0;
  return ((last.p - first.p) / dt) * 1000;
}

/** Rubber-band a drag past its limit: the further you pull, the less it moves. */
export function rubberband(distance, dimension, constant = 0.55) {
  if (!distance || !dimension) return 0;
  const sign = Math.sign(distance);
  const d = Math.abs(distance);
  return sign * (1 - 1 / ((d * constant) / dimension + 1)) * dimension;
}

/**
 * Choose where a released drawer rests.
 * @param {number} current   visible size now, px (0 = closed)
 * @param {number} velocity  px/s, positive = growing (dragged open)
 * @param {number[]} snaps   visible sizes in px, ascending
 * @param {{ dismissible?: boolean, projection?: number, flick?: number }} options
 *   projection: seconds of travel to project the flick forward
 *   flick: px/s above which a release always moves at least one step
 * @returns {number} index into snaps, or -1 to dismiss
 */
export function pickSnap(current, velocity, snaps, { dismissible = true, projection = 0.2, flick = 700 } = {}) {
  if (!snaps.length) return -1;
  const stops = dismissible ? [0, ...snaps] : snaps.slice();
  const nearest = (value) => {
    let best = 0;
    for (let i = 1; i < stops.length; i++) {
      if (Math.abs(stops[i] - value) < Math.abs(stops[best] - value)) best = i;
    }
    return best;
  };
  const here = nearest(current);
  let pick = nearest(current + velocity * projection);
  // A quick flick never settles back where it started.
  if (Math.abs(velocity) > flick && pick === here) {
    const step = Math.sign(velocity);
    const moved = here + step;
    // Only step if the flick points away from the current stop.
    if (moved >= 0 && moved < stops.length && Math.sign(stops[moved] - current) === step) pick = moved;
  }
  return dismissible ? pick - 1 : pick;
}

/**
 * Typeahead for menus and lists. Returns the index of the next label that
 * starts with `query` (case-insensitive), searching after `start`. Typing the
 * same letter repeatedly cycles through matches. `null` labels are skipped
 * (disabled items). Returns -1 when nothing matches.
 */
export function typeahead(labels, query, start = -1) {
  const n = labels.length;
  const q = String(query).toLowerCase();
  if (!n || !q) return -1;
  const repeated = q.length > 1 && [...q].every((ch) => ch === q[0]);
  const needle = repeated ? q[0] : q;
  // A single letter moves past the current item; a longer query may stay on it.
  const from = start < 0 ? 0 : start + (needle.length === 1 ? 1 : 0);
  for (let i = 0; i < n; i++) {
    const idx = (from + i) % n;
    const label = labels[idx];
    if (label != null && String(label).trim().toLowerCase().startsWith(needle)) return idx;
  }
  return -1;
}
