// <rig-route-map> — a route card an assistant can draw from a list of stops.
// No map tiles and no network: stops are projected with Web Mercator into an
// SVG fitted to the route, over a light graticule. The line draws itself in the
// first time the card scrolls into view; markers pop in as the line reaches them.
//
//   <rig-route-map units="mi" speed="55"></rig-route-map>
//   map.stops = [
//     { name: 'Ocala, FL', lat: 29.187, lon: -82.140, eta: '6:00 AM', kind: 'start', note: 'Loaded at the DC' },
//     { lat: 29.652, lon: -82.325, kind: 'via' },                     // shapes the line, no marker
//     { name: 'Lake City, FL', lat: 30.19, lon: -82.64, eta: '7:20 AM', kind: 'fuel', note: 'Diesel and DEF', dwell: 20 },
//     { name: 'Savannah, GA', lat: 32.08, lon: -81.09, eta: '12:40 PM', kind: 'end' },
//   ]
//   map.here = { lat: 30.33, lon: -81.66 }      // or here="30.33,-81.66": pulsing "you are here" dot
//
// Real routing data, when the agent has it:
//   - give a stop `path`: [[lat, lon], ...], the road geometry of the leg that ends at that stop
//     (e.g. a decoded polyline from a routing API). It's drawn instead of the straight leg, and when
//     every leg has one the summary reports a road distance instead of a straight-line estimate.
//   - set map.summary = { distanceMi | distanceKm | distanceMeters, durationMinutes | durationSeconds }
//     to show the routing service's own totals. Leave out either one to keep the estimate for it.
//
// Stop kinds: start | stop | fuel | rest | end, plus via (a shaping point with no marker).
// Hover, focus or tap a stop for its details. Arrow keys move between stops; Enter pins the card.
//
// Attributes: units (mi | km, default mi), speed (average driving speed in units per hour,
//             default 55 mph or 90 km/h), here ("lat,lon"), label (accessible name and title)
// Properties: stops, here, summary (set: routing totals as above; get: { distanceKm, driveMinutes,
//             dwellMinutes, stops, distanceSource: 'routing' | 'road' | 'estimate', durationSource })
// Events: rig-select ({ detail: { index, stop } }) when a stop is chosen with click or Enter.

import { animate, reducedMotion, simulateSpring, springEasing, springs } from '../motion.js';
import { follow } from '../position.js';
import { sound } from '../sound.js';
import { define, h, uid } from '../util.js';
import { s } from './dom.js';
import {
  KM_PER_MI, driveMinutes, fitView, formatCoord, formatDistance, formatDuration, graticule, mercator, niceStep,
  normalizeSummary, placeLabels, routeGeometry, simplifyPath, smoothPath,
} from './geo.js';

const KIND_LABEL = { start: 'Start', stop: 'Stop', fuel: 'Fuel stop', rest: 'Break', end: 'Destination' };
const DRAW = { duration: 1.6, bounce: 0 };

function glyph(kind) {
  switch (kind) {
    case 'fuel': return s('path', { class: 'rig-route__glyph', d: 'M0-4.6C2.4-1.6 3.3 0 3.3 1.3a3.3 3.3 0 0 1-6.6 0C-3.3 0-2.4-1.6 0-4.6z' });
    case 'rest': return s('path', { class: 'rig-route__glyph is-stroke', d: 'M-1.8-3.4v6.8M1.8-3.4v6.8' });
    case 'end': return s('path', { class: 'rig-route__glyph is-stroke', d: 'M-2.6 4.6v-9.2h5.8l-1.6 2.3 1.6 2.3h-5.8' });
    case 'start': return s('circle', { class: 'rig-route__glyph', r: 2.6 });
    default: return null;
  }
}

function parseHere(text) {
  const m = String(text ?? '').split(',').map(Number);
  return m.length === 2 && m.every(Number.isFinite) ? { lat: m[0], lon: m[1] } : null;
}

class RigRouteMap extends HTMLElement {
  static observedAttributes = ['units', 'speed', 'here', 'label'];
  #built = false;
  #stops = [];
  #geo = routeGeometry([]);
  #overrides = { km: null, minutes: null };
  #here = null;
  #head;
  #mapBox;
  #svg;
  #card;
  #summary;
  #note;
  #markers = []; // { g, hit, index (into stops), data }
  #active = -1;
  #pinned = false;
  #stopFollow = null;
  #hideTimer = 0;
  #width = 0;
  #drawn = false;
  #io;
  #ro;
  #id = uid('rig-route');

  connectedCallback() {
    if (!this.#built) {
      this.#built = true;
      this.classList.add('rig-route');
      const ease = springEasing(springs.lively);
      this.style.setProperty('--_spring', ease.easing);
      this.style.setProperty('--_spring-ms', `${ease.duration}ms`);
      this.#head = h('div', { class: 'rig-route__head' });
      this.#mapBox = h('div', { class: 'rig-route__map' });
      this.#card = h('div', { class: 'rig-route__card', popover: 'manual', role: 'tooltip', id: `${this.#id}-card` });
      this.#summary = h('dl', { class: 'rig-route__summary' });
      this.#note = h('p', { class: 'rig-route__note' });
      this.replaceChildren(this.#head, this.#mapBox, this.#summary, this.#note, this.#card);
      this.#card.addEventListener('pointerenter', () => clearTimeout(this.#hideTimer));
      this.#card.addEventListener('pointerleave', () => { if (!this.#pinned) this.#scheduleHide(); });
      if (this.hasAttribute('here')) this.#here = parseHere(this.getAttribute('here'));
    }
    document.addEventListener('pointerdown', this.#onOutside, true);
    this.#ro = new ResizeObserver(() => {
      const w = Math.round(this.#mapBox.clientWidth);
      if (w && Math.abs(w - this.#width) > 1) this.#render(false);
    });
    this.#ro.observe(this.#mapBox);
    this.#io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !this.#drawn && this.#stops.length) this.#drawIn();
    }, { threshold: 0.35 });
    this.#io.observe(this.#mapBox);
  }

  disconnectedCallback() {
    document.removeEventListener('pointerdown', this.#onOutside, true);
    this.#ro?.disconnect();
    this.#io?.disconnect();
    this.#stopFollow?.();
  }

  attributeChangedCallback(name, oldValue, value) {
    if (oldValue === value) return;
    if (name === 'here') this.#here = parseHere(value);
    if (this.#built) this.#render(false);
  }

  get stops() { return this.#stops.map((x) => ({ ...x })); }
  set stops(list) {
    this.#stops = (list ?? []).filter((x) => Number.isFinite(Number(x.lat)) && Number.isFinite(Number(x.lon)))
      .map((x) => ({ ...x, lat: Number(x.lat), lon: Number(x.lon), kind: x.kind || 'stop' }));
    this.#geo = routeGeometry(this.#stops);
    this.#drawn = false;
    if (this.#built) this.#render(false);
    // If already on screen, draw in now.
    requestAnimationFrame(() => {
      const r = this.getBoundingClientRect();
      if (!this.#drawn && r.top < innerHeight && r.bottom > 0 && r.width) this.#drawIn();
    });
  }

  get here() { return this.#here ? { ...this.#here } : null; }
  set here(v) {
    this.#here = v && Number.isFinite(v.lat) && Number.isFinite(v.lon) ? { lat: v.lat, lon: v.lon } : null;
    if (this.#built) this.#render(false);
  }

  get #units() { return this.getAttribute('units') === 'km' ? 'km' : 'mi'; }
  get #speedKmh() {
    const v = parseFloat(this.getAttribute('speed'));
    if (this.#units === 'km') return v > 0 ? v : 90;
    return (v > 0 ? v : 55) * KM_PER_MI;
  }

  get summary() {
    const along = this.#geo.cumKm[this.#geo.cumKm.length - 1] ?? 0;
    const o = this.#overrides;
    const km = o.km ?? along;
    const dwell = this.#stops.reduce((t, x) => t + (Number(x.dwell) || 0), 0);
    return {
      distanceKm: km,
      driveMinutes: o.minutes ?? driveMinutes(km, this.#speedKmh),
      dwellMinutes: dwell,
      stops: this.#stops.filter((x) => x.kind !== 'via').length,
      distanceSource: o.km != null ? 'routing' : this.#geo.road ? 'road' : 'estimate',
      durationSource: o.minutes != null ? 'routing' : 'estimate',
    };
  }
  /** Totals from a routing service: { distanceMi | distanceKm | distanceMeters, durationMinutes | durationSeconds }. */
  set summary(value) {
    this.#overrides = normalizeSummary(value);
    if (this.#built) this.#renderSummary();
  }

  #onOutside = (e) => {
    if (!this.#card.matches(':popover-open')) return;
    if (this.#card.contains(e.target) || this.#svg?.contains(e.target)) return;
    this.#hideCard();
  };

  #named() { return this.#stops.map((x, i) => ({ ...x, i })).filter((x) => x.kind !== 'via'); }

  #render(animateIn) {
    const width = Math.round(this.#mapBox.clientWidth);
    this.#width = width;
    const named = this.#named();
    const first = named[0];
    const last = named[named.length - 1];
    const title = this.getAttribute('label') || (first && last && first !== last ? `${first.name} to ${last.name}` : first?.name || 'Route');
    this.#head.replaceChildren(
      h('p', { class: 'rig-route__title' }, first && last && first !== last && !this.getAttribute('label')
        ? [h('span', {}, first.name), h('span', { class: 'rig-route__arrow', 'aria-hidden': 'true' }, '→'), h('span', {}, last.name)]
        : title),
      h('span', { class: 'rig-route__count' }, `${named.length} stop${named.length === 1 ? '' : 's'}`));
    this.#renderSummary();
    if (!width || !this.#stops.length) { this.#mapBox.replaceChildren(); this.#svg = null; return; }

    // Height follows the route's shape, within limits.
    const geo = this.#geo;
    const proj = geo.points.map((p) => mercator(p.lat, p.lon));
    const spanX = Math.max(...proj.map((p) => p.x)) - Math.min(...proj.map((p) => p.x)) || 1e-6;
    const spanY = Math.max(...proj.map((p) => p.y)) - Math.min(...proj.map((p) => p.y)) || 1e-6;
    const aspect = Math.min(1.05, Math.max(0.5, spanY / spanX));
    const height = Math.round(Math.min(width < 520 ? 400 : 440, Math.max(240, width * aspect)));
    const padX = Math.min(90, Math.max(36, width * 0.14));
    const view = fitView(geo.points, { width, height, padding: { top: 34, bottom: 34, left: padX, right: padX } });
    const linePts = geo.points.map((p) => view.project(p.lat, p.lon));
    const pts = geo.stopAt.map((k) => linePts[k]);

    const svg = s('svg', {
      class: 'rig-route__svg', width, height, viewBox: `0 0 ${width} ${height}`, role: 'group',
      'aria-label': `Route map: ${title}. Use arrow keys to move between stops.`,
    });

    // Graticule.
    const nw = view.invert(0, 0);
    const se = view.invert(width, height);
    const box = { north: nw.lat, south: se.lat, west: nw.lon, east: se.lon };
    const step = niceStep(Math.max(box.north - box.south, box.east - box.west), width < 520 ? 4 : 6);
    const grat = graticule(box, step);
    const grid = s('g', { class: 'rig-route__grid', 'aria-hidden': 'true' });
    for (const lat of grat.lats) {
      const [, y] = view.project(lat, box.west);
      grid.append(s('line', { x1: 0, x2: width, y1: y, y2: y }), s('text', { x: 6, y: y - 4, class: 'rig-route__gridlabel' }, formatCoord(lat, 'lat', step)));
    }
    for (const lon of grat.lons) {
      const [x] = view.project(box.north, lon);
      grid.append(s('line', { x1: x, x2: x, y1: 0, y2: height }), s('text', { x: x + 4, y: height - 6, class: 'rig-route__gridlabel' }, formatCoord(lon, 'lon', step)));
    }
    svg.append(grid);

    // Route line: a soft casing under the coloured line. Road geometry is drawn as
    // given (thinned to about a pixel); straight legs through via points are smoothed.
    const d = geo.anyPath
      ? simplifyPath(linePts, 1.2, geo.stopAt).map(({ p }, k) => `${k ? 'L' : 'M'}${Math.round(p[0] * 10) / 10} ${Math.round(p[1] * 10) / 10}`).join(' ')
      : smoothPath(linePts, 0.45);
    const casing = s('path', { d, class: 'rig-route__casing', 'aria-hidden': 'true' });
    const line = s('path', { d, class: 'rig-route__line', pathLength: '1', 'aria-hidden': 'true' });
    svg.append(casing, line);

    // Markers.
    this.#markers = [];
    const markerLayer = s('g', { class: 'rig-route__markers' });
    const labelLayer = s('g', { class: 'rig-route__labels', 'aria-hidden': 'true' });
    named.forEach((stop, k) => {
      const [x, y] = pts[stop.i];
      const big = stop.kind === 'start' || stop.kind === 'end';
      const r = big ? 9 : 8;
      const shape = s('g', { class: 'rig-route__pin' }, s('circle', { r, class: 'rig-route__dot' }), glyph(stop.kind));
      const hit = s('circle', { r: 18, class: 'rig-route__hit' });
      const label = [KIND_LABEL[stop.kind] || 'Stop', stop.name, stop.eta ? `ETA ${stop.eta}` : '', stop.note || ''].filter(Boolean).join('. ');
      const g = s('g', {
        class: `rig-route__stop is-${stop.kind}`, transform: `translate(${x} ${y})`, tabindex: k === 0 ? '0' : '-1', role: 'button',
        'aria-label': `${k + 1} of ${named.length}. ${label}`, 'aria-describedby': this.#card.id,
      }, hit, shape);
      markerLayer.append(g);
      this.#markers.push({ g, shape, x, y, r, stop, k });
      g.addEventListener('pointerenter', (e) => { if (e.pointerType !== 'touch') this.#activate(k, { pin: false }); });
      g.addEventListener('pointerleave', () => { if (!this.#pinned) this.#scheduleHide(); });
      g.addEventListener('click', () => this.#choose(k));
      g.addEventListener('focus', () => this.#activate(k, { pin: false, fromFocus: true }));
      g.addEventListener('blur', (e) => { if (!this.#svg?.contains(e.relatedTarget) && !this.#pinned) this.#hideCard(); });
      g.addEventListener('keydown', (e) => this.#onKey(e, k));
    });

    // "You are here".
    if (this.#here) {
      const [hx, hy] = view.project(this.#here.lat, this.#here.lon);
      svg.append(s('g', { class: 'rig-route__here', transform: `translate(${hx} ${hy})`, role: 'img', 'aria-label': 'You are here' },
        s('circle', { r: 7, class: 'rig-route__ring' }), s('circle', { r: 6.5, class: 'rig-route__heredot' })));
    }

    // Labels: measure, then place so they avoid each other, markers and the line.
    svg.append(markerLayer, labelLayer);
    this.#mapBox.replaceChildren(svg);
    this.#svg = svg;
    const texts = this.#markers.map((m) => {
      const t = s('text', { class: `rig-route__label${m.stop.kind === 'start' || m.stop.kind === 'end' ? ' is-strong' : ''}` }, m.stop.name || '');
      labelLayer.append(t);
      let w = 0;
      try { w = t.getComputedTextLength(); } catch { w = 0; }
      if (!w) w = (m.stop.name || '').length * 6.6;
      return { t, w: w + 6, h: 16 };
    });
    // The drawn line, as short segments, so labels can stay off it.
    const segments = [];
    const pathLen = line.getTotalLength ? line.getTotalLength() : 0;
    let prev = null;
    if (pathLen) {
      for (let l = 0; l <= pathLen + 5; l += 5) {
        const p = line.getPointAtLength(Math.min(l, pathLen));
        if (prev) segments.push([prev.x, prev.y, p.x, p.y]);
        prev = p;
      }
    }
    const placed = placeLabels(this.#markers.map((m, i) => ({
      x: m.x, y: m.y, w: texts[i].w, h: texts[i].h, r: m.r + 1,
      priority: m.stop.kind === 'start' || m.stop.kind === 'end' ? 2 : 1,
    })), { width, height, gap: 5, lines: segments });
    const taken = [];
    placed.forEach((p, i) => {
      const { t, w, h: ht } = texts[i];
      t.setAttribute('x', String(p.x + 3));
      t.setAttribute('y', String(p.y + ht / 2 + 4));
      if (p.hidden) t.remove();
      else taken.push({ x: p.x, y: p.y, w, h: ht });
      this.#markers[i].labelEl = p.hidden ? null : t;
    });
    for (const m of this.#markers) taken.push({ x: m.x - m.r - 3, y: m.y - m.r - 3, w: m.r * 2 + 6, h: m.r * 2 + 6 });
    // Grid labels give way to stop labels and markers, and never get clipped at the edge.
    for (const g of grid.querySelectorAll('.rig-route__gridlabel')) {
      const x = Number(g.getAttribute('x'));
      const y = Number(g.getAttribute('y'));
      const w = g.textContent.length * 6;
      const box = { x: x - 2, y: y - 10, w: w + 4, h: 13 };
      const hits = taken.some((b) => box.x < b.x + b.w && b.x < box.x + box.w && box.y < b.y + b.h && b.y < box.y + box.h);
      if (hits || x + w > width - 4 || y < 12) g.remove();
    }

    if (this.#active >= 0 && this.#markers[this.#active]) this.#markers[this.#active].g.classList.add('is-active');
    if (!this.#drawn && !animateIn) {
      // Hidden until the draw-in runs (unless motion is reduced).
      if (reducedMotion()) this.#drawn = true;
      else {
        line.style.strokeDasharray = '1';
        line.style.strokeDashoffset = '1';
        for (const m of this.#markers) { m.shape.style.opacity = '0'; if (m.labelEl) m.labelEl.style.opacity = '0'; }
      }
    }
    if (this.#card.matches(':popover-open') && this.#active >= 0) this.#activate(this.#active, { pin: this.#pinned, quiet: true });
  }

  #drawIn() {
    if (!this.#svg) return;
    this.#drawn = true;
    const line = this.#svg.querySelector('.rig-route__line');
    if (reducedMotion()) {
      line.style.strokeDasharray = '';
      line.style.strokeDashoffset = '';
      for (const m of this.#markers) { m.shape.style.opacity = ''; if (m.labelEl) m.labelEl.style.opacity = ''; }
      return;
    }
    line.style.strokeDasharray = '1';
    const anim = animate(line, [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { spring: DRAW });
    anim.finished.then(() => { line.style.strokeDashoffset = '0'; line.style.strokeDasharray = ''; anim.cancel(); }).catch(() => {});
    // When does the line reach each stop? Invert the spring's progress curve.
    const { samples } = simulateSpring(DRAW, { fps: 60 });
    const duration = anim.effect.getTiming().duration;
    const total = Math.max(1e-9, line.getTotalLength());
    const cum = this.#lengthsAlong(line);
    for (const m of this.#markers) {
      const frac = cum[m.stop.i] / total;
      const idx = samples.findIndex((v) => v >= frac - 0.002);
      const at = idx < 0 ? 1 : idx / (samples.length - 1);
      const delay = Math.max(0, at * duration - 40);
      m.shape.style.opacity = '';
      // fill: backwards, so the CSS hover/active scale takes over afterwards.
      animate(m.shape, [{ transform: 'scale(0)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { spring: springs.lively, delay, fill: 'backwards' });
      if (m.labelEl) {
        m.labelEl.style.opacity = '';
        animate(m.labelEl, [{ opacity: 0, transform: 'translateY(3px)' }, { opacity: 1, transform: 'translateY(0)' }], { spring: springs.smooth, delay: delay + 80, fill: 'backwards' });
      }
    }
  }

  // Path length from the start to each marker, found by sampling the drawn curve.
  #lengthsAlong(line) {
    const total = line.getTotalLength();
    const out = new Array(this.#stops.length).fill(0);
    const samples = [];
    for (let l = 0; l <= total; l += 2) samples.push([l, line.getPointAtLength(l)]);
    let from = 0;
    for (const m of this.#markers) {
      let best = from;
      let bestD = Infinity;
      for (let k = from; k < samples.length; k++) {
        const p = samples[k][1];
        const dd = (p.x - m.x) ** 2 + (p.y - m.y) ** 2;
        if (dd < bestD) { bestD = dd; best = k; }
      }
      out[m.stop.i] = samples[best]?.[0] ?? 0;
      from = best;
    }
    return out;
  }

  #renderSummary() {
    const sum = this.summary;
    const unit = this.#units;
    const named = this.#named();
    const end = named[named.length - 1];
    const estimate = sum.distanceSource === 'estimate';
    const items = [
      [estimate ? 'Straight-line est.' : 'Road distance', `${estimate ? '≈ ' : ''}${formatDistance(sum.distanceKm, unit)}`],
      ['Driving', `${sum.durationSource === 'estimate' ? '≈ ' : ''}${formatDuration(sum.driveMinutes)}`],
    ];
    if (sum.dwellMinutes) items.push(['Stopped', formatDuration(sum.dwellMinutes)]);
    if (end?.eta && end.kind === 'end') items.push(['Arrive', end.eta]);
    this.#summary.replaceChildren(...items.map(([k, v]) => h('div', { class: 'rig-route__fact' }, h('dt', {}, k), h('dd', {}, v))));
    const speed = unit === 'km' ? Math.round(this.#speedKmh) : Math.round(this.#speedKmh / KM_PER_MI);
    const pace = `Driving time assumes ${speed} ${unit === 'km' ? 'km/h' : 'mph'}.`;
    const distanceNote = {
      routing: 'Road distance from the routing data.',
      road: 'Road distance measured along the route geometry.',
      estimate: 'Straight-line estimate between points; road miles run longer.',
    }[sum.distanceSource];
    this.#note.textContent = sum.durationSource === 'routing'
      ? `${distanceNote.replace(/\.$/, '')}; driving time from the routing data.`
      : `${distanceNote} ${pace}`;
  }

  #legText(stop) {
    const cum = this.#geo.cumKm;
    const named = this.#named();
    const idx = named.findIndex((x) => x.i === stop.i);
    const prev = named[idx - 1];
    const unit = this.#units;
    const parts = [];
    if (prev) parts.push(`${formatDistance(cum[stop.i] - cum[prev.i], unit)} from ${prev.name}`);
    if (idx > 0) parts.push(`${unit === 'mi' ? 'mile' : 'km'} ${Math.round(unit === 'mi' ? cum[stop.i] / KM_PER_MI : cum[stop.i])}`);
    return parts.join(' · ');
  }

  #fillCard(m) {
    const { stop } = m;
    const leg = this.#legText(stop);
    this.#card.replaceChildren(...[
      h('div', { class: 'rig-route__cardhead' },
        h('span', { class: `rig-route__kind is-${stop.kind}` }, KIND_LABEL[stop.kind] || 'Stop'),
        stop.eta ? h('span', { class: 'rig-route__eta' }, stop.eta) : null),
      h('p', { class: 'rig-route__cardname' }, stop.name || 'Unnamed stop'),
      stop.note ? h('p', { class: 'rig-route__cardnote' }, stop.note) : null,
      stop.dwell ? h('p', { class: 'rig-route__cardmeta' }, `${formatDuration(stop.dwell)} stop`) : null,
      leg ? h('p', { class: 'rig-route__cardmeta' }, leg) : null,
    ].filter(Boolean));
  }

  #activate(k, { pin = false, fromFocus = false, quiet = false } = {}) {
    clearTimeout(this.#hideTimer);
    const m = this.#markers[k];
    if (!m) return;
    if (this.#pinned && !pin && this.#active !== k && !fromFocus) return;
    const prev = this.#markers[this.#active];
    if (prev && prev !== m) prev.g.classList.remove('is-active');
    this.#active = k;
    this.#pinned = pin;
    m.g.classList.add('is-active'); // CSS springs the pin up
    this.#fillCard(m);
    const wasOpen = this.#card.matches(':popover-open');
    if (!wasOpen) { try { this.#card.showPopover(); } catch { return; } }
    this.#stopFollow?.();
    this.#stopFollow = follow(m.g.querySelector('.rig-route__dot'), this.#card, { placement: 'top', offset: 12 });
    if (!wasOpen && !quiet) {
      if (!reducedMotion()) animate(this.#card, [{ opacity: 0, transform: 'translateY(4px) scale(0.96)' }, { opacity: 1, transform: 'none' }], { spring: springs.snappy, fill: 'none' });
    }
    this.#markers.forEach((mk, i) => mk.g.setAttribute('tabindex', i === k ? '0' : '-1'));
  }

  #choose(k) {
    const m = this.#markers[k];
    if (!m) return;
    if (this.#pinned && this.#active === k) { this.#hideCard(); return; }
    this.#activate(k, { pin: true });
    sound.play('pop');
    this.dispatchEvent(new CustomEvent('rig-select', { bubbles: true, detail: { index: m.stop.i, stop: { ...this.#stops[m.stop.i] } } }));
  }

  #scheduleHide() {
    clearTimeout(this.#hideTimer);
    this.#hideTimer = setTimeout(() => this.#hideCard(), 160);
  }

  #hideCard() {
    clearTimeout(this.#hideTimer);
    this.#pinned = false;
    this.#stopFollow?.();
    this.#stopFollow = null;
    this.#markers[this.#active]?.g.classList.remove('is-active');
    try { this.#card.hidePopover(); } catch { /* not open */ }
  }

  #onKey(e, k) {
    const n = this.#markers.length;
    let next = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (k + 1) % n;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (k - 1 + n) % n;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.#choose(k); return; }
    else if (e.key === 'Escape') { e.preventDefault(); this.#hideCard(); return; }
    if (next == null) return;
    e.preventDefault();
    this.#pinned = false;
    this.#markers[next].g.focus();
    sound.play('tick');
  }
}

define('rig-route-map', RigRouteMap);
export { RigRouteMap };
