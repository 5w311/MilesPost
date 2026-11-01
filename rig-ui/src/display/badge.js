// <rig-badge> — a short status label, or a count that rolls like an odometer.
//
//   <rig-badge variant="ok" dot>On time</rig-badge>
//   <rig-badge variant="bad" count="3" label="unread dispatch messages"></rig-badge>
//   badge.count = 4   // the changed digits roll up (or down when it drops)
//
// Attributes: variant ("neutral" | "accent" | "ok" | "warn" | "bad"), dot,
//   count (switches to a count badge), max (default 99, shows "99+"),
//   label (what the count counts, read after the number), live (announce changes).
// Properties: count (number).

import { animate, reducedMotion, springs } from '../motion.js';
import { define, h } from '../util.js';
import { digitColumns, formatCount } from './format.js';

class RigBadge extends HTMLElement {
  static observedAttributes = ['count', 'max', 'label', 'dot', 'live'];
  #built = false;
  #digits;
  #sr;
  #dot;
  #text = '';
  #value = null;

  get count() { return this.#value; }
  set count(n) { this.setAttribute('count', String(n)); }

  connectedCallback() {
    if (this.#built) return;
    this.#built = true;
    this.classList.add('rig-badge');
    this.#dot = h('span', { class: 'rig-badge__dot', 'aria-hidden': 'true' });
    if (this.hasAttribute('count')) {
      this.#digits = h('span', { class: 'rig-badge__digits', 'aria-hidden': 'true' });
      this.#sr = h('span', { class: 'rig-visually-hidden' });
      this.replaceChildren(this.#digits, this.#sr);
      this.classList.add('rig-badge--count');
    }
    this.#sync(false);
  }

  attributeChangedCallback(name, oldValue, value) {
    if (!this.#built || oldValue === value) return;
    if (name === 'count' && !this.#digits) {
      this.#built = false;
      this.connectedCallback();
      return;
    }
    this.#sync(name === 'count');
  }

  #sync(animated) {
    if (this.hasAttribute('dot')) { if (!this.#dot.isConnected) this.prepend(this.#dot); } else this.#dot.remove();
    if (this.hasAttribute('live')) this.setAttribute('aria-live', 'polite'); else this.removeAttribute('aria-live');
    if (!this.#digits) return;
    const raw = Number(this.getAttribute('count'));
    const prev = this.#value;
    this.#value = Number.isFinite(raw) ? raw : 0;
    const next = formatCount(this.#value, this.getAttribute('max') || 99);
    const label = this.getAttribute('label');
    this.#sr.textContent = label ? `${next} ${label}` : next;
    if (next === this.#text) return;
    const up = prev == null || this.#value >= prev;
    this.#roll(this.#text, next, up, animated && !reducedMotion());
    this.#text = next;
  }

  #roll(from, to, up, animated) {
    const before = this.getBoundingClientRect().width;
    const cols = digitColumns(from, to);
    const n = cols.length;
    const els = cols.map((c, i) => {
      const col = h('span', { class: 'rig-badge__col' });
      if (!animated || !c.changed) { col.textContent = c.to; return col; }
      const oldRow = h('span', { class: 'rig-badge__row' }, c.from || '​');
      const newRow = h('span', { class: 'rig-badge__row' }, c.to);
      const reel = h('span', { class: 'rig-badge__reel' }, ...(up ? [oldRow, newRow] : [newRow, oldRow]));
      col.append(reel);
      // The rightmost digit turns first, like a real odometer.
      const delay = (n - 1 - i) * 45;
      const frames = up
        ? [{ transform: 'translateY(0)' }, { transform: 'translateY(-50%)' }]
        : [{ transform: 'translateY(-50%)' }, { transform: 'translateY(0)' }];
      const anim = animate(reel, frames, { spring: springs.lively, delay });
      if (!c.from) animate(newRow, [{ opacity: 0 }, { opacity: 1 }], { spring: springs.smooth, delay });
      anim.finished.then(() => { if (col.isConnected) col.textContent = c.to; }).catch(() => {});
      return col;
    });
    this.#digits.replaceChildren(...els);
    if (!animated) return;
    const after = this.getBoundingClientRect().width;
    if (Math.abs(after - before) > 0.5 && before > 0) {
      animate(this, [{ width: `${before}px` }, { width: `${after}px` }], { spring: springs.snappy, commit: false, fill: 'none' });
    }
    animate(this, [{ transform: 'scale(1)' }, { transform: 'scale(1.12)', offset: 0.35 }, { transform: 'scale(1)' }], { spring: null, duration: 320, easing: 'ease-out', fill: 'none' });
  }
}

define('rig-badge', RigBadge);
export { RigBadge };
