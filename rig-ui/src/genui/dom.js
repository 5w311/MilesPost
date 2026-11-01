// DOM helpers shared by the genui components (SVG builder, morphing check icon,
// polite announcements). Not part of the public API.

import { animate, reducedMotion, springs } from '../motion.js';
import { h } from '../util.js';

const NS = 'http://www.w3.org/2000/svg';

/** SVG element builder: s('circle', { cx: 4, r: 2 }) */
export function s(tag, attrs = {}, ...children) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** A 24x24 stroke icon SVG from path data. */
export function icon(paths, { size = 16, stroke = 2, className = '' } = {}) {
  return s('svg', {
    viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': stroke,
    'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: className || null,
  }, paths.map((d) => s('path', { d })));
}

export const glyphs = {
  copy: ['M9 9h10v10H9z', 'M5 15V5h10'],
  check: ['M5 12.5 10 17.5 19.5 7'],
  wrap: ['M4 6h16', 'M4 12h13a3 3 0 0 1 0 6h-4', 'm14.5 15.5-2.5 2.5 2.5 2.5', 'M4 18h5'],
  file: ['M6 3h8l4 4v14H6z', 'M14 3v4h4'],
  cart: ['M3 4h2.2l2.3 11h10.3l2-8H7', 'M9.5 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2z', 'M17 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2z'],
  paperclip: ['M20 11.5 12.2 19.3a5 5 0 0 1-7.1-7.1l8.3-8.3a3.4 3.4 0 0 1 4.8 4.8l-8.3 8.3a1.7 1.7 0 0 1-2.4-2.4l7.6-7.6'],
  close: ['M6 6l12 12', 'M18 6 6 18'],
  chevronDown: ['m6 9 6 6 6-6'],
  swap: ['M7 4 3 8l4 4', 'M3 8h14', 'm17 20 4-4-4-4', 'M21 16H7'],
  retry: ['M4 12a8 8 0 0 1 13.7-5.6L20 9', 'M20 4v5h-5', 'M20 12a8 8 0 0 1-13.7 5.6L4 15', 'M4 20v-5h5'],
  external: ['M14 4h6v6', 'M20 4 11 13', 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'],
  doc: ['M6 3h8l4 4v14H6z', 'M14 3v4h4', 'M9 12h6', 'M9 16h6'],
  alert: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7.5v5.5', 'M12 16.4v.1'],
  sparkle: ['M12 3.5 13.8 9 19.5 10.5 13.8 12 12 17.5 10.2 12 4.5 10.5 10.2 9z'],
  image: ['M4 5h16v14H4z', 'm4 16 5-5 4 4 2-2 5 5', 'M15.5 9.5v.1'],
};

/**
 * An icon that morphs into a check mark and back: the original strokes shrink
 * away while the check draws itself in.
 *   const m = morphIcon(glyphs.copy); button.append(m.el); m.set(true)
 */
export function morphIcon(paths, { size = 16 } = {}) {
  const from = s('g', { class: 'rig-morph__from' }, paths.map((d) => s('path', { d })));
  const check = s('path', { d: 'M5 12.5 10 17.5 19.5 7', pathLength: '1', class: 'rig-morph__check' });
  const el = s('svg', {
    viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': 2,
    'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: 'rig-morph',
  }, from, check);
  check.style.strokeDasharray = '1';
  check.style.strokeDashoffset = '1';
  let done = false;
  return {
    el,
    get done() { return done; },
    set(on) {
      if (on === done) return;
      done = on;
      const shown = { opacity: 1, transform: 'scale(1) rotate(0deg)' };
      const gone = { opacity: 0, transform: 'scale(0.4) rotate(-25deg)' };
      animate(from, on ? [shown, gone] : [gone, shown], { spring: on ? springs.snappy : springs.lively, commit: true });
      animate(check, on ? [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }] : [{ strokeDashoffset: 0 }, { strokeDashoffset: 1 }],
        { spring: on ? springs.smooth : springs.snappy, delay: on ? 60 : 0, commit: true });
    },
  };
}

/** A visually hidden polite live region; returns a function that announces text. */
export function announcer(host) {
  const region = h('span', { class: 'rig-visually-hidden', 'aria-live': 'polite', 'aria-atomic': 'true' });
  host.append(region);
  let timer = 0;
  const say = (text) => {
    clearTimeout(timer);
    region.textContent = '';
    // A fresh node each time so repeated messages are read again.
    timer = setTimeout(() => { region.textContent = text; }, 40);
  };
  say.el = region;
  return say;
}

/** A quick spring "press" on an element, e.g. to acknowledge a click. */
export function pulse(el, scale = 0.94) {
  if (reducedMotion()) return;
  animate(el, [{ transform: 'scale(1)' }, { transform: `scale(${scale})` }, { transform: 'scale(1)' }], { spring: springs.lively, fill: 'none' });
}

/** Escape text for innerHTML. */
export function esc(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Scroll `scroller` just enough to show `el`, without ever scrolling the page. */
export function revealIn(scroller, el, axis = 'x', pad = 8) {
  if (!scroller || !el) return;
  const s = scroller.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  if (axis === 'x') {
    if (r.left < s.left) scroller.scrollLeft -= s.left - r.left + pad;
    else if (r.right > s.right) scroller.scrollLeft += r.right - s.right + pad;
  } else if (r.top < s.top) scroller.scrollTop -= s.top - r.top + pad;
  else if (r.bottom > s.bottom) scroller.scrollTop += r.bottom - s.bottom + pad;
}
