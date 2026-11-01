// <rig-progress> — linear bar, circular ring or segmented steps.
//
//   <rig-progress value="42" label="Uploading BOL"></rig-progress>
//   <rig-progress label="Syncing logs"></rig-progress>               (no value: indeterminate)
//   <rig-progress type="circular" value="72" label="Route driven"></rig-progress>
//   <rig-progress steps="4" value="2" label="Delivery"
//                 labels="Picked up,In transit,At receiver,Delivered"></rig-progress>
//
// Value changes spring to the new position (no overshoot: progress never shows
// more than it has). Under reduced motion they jump.
//
// Attributes: value (omit for indeterminate), max (default 100, or the step
//   count), type ("linear" | "circular"), steps (segmented), labels (comma list
//   under the steps), label (accessible name), show-value (linear: print the
//   percentage), size (circular: "sm" | "md" | "lg" or px), tone ("accent" | "ok" | "warn" | "bad").
// Properties: value (number | null).

import { springDriver, springs } from '../motion.js';
import { define, h } from '../util.js';

const NS = 'http://www.w3.org/2000/svg';
const SIZES = { sm: 32, md: 56, lg: 88 };

function circle(cls) {
  const c = document.createElementNS(NS, 'circle');
  c.setAttribute('cx', '50');
  c.setAttribute('cy', '50');
  c.setAttribute('r', '44');
  c.setAttribute('pathLength', '100');
  c.setAttribute('class', cls);
  return c;
}

class RigProgress extends HTMLElement {
  static observedAttributes = ['value', 'max', 'label', 'steps', 'labels', 'type', 'size', 'show-value'];
  #built = '';
  #driver;
  #fill;
  #bar;
  #text;
  #segments = [];
  #stepLabels = [];

  get value() { return this.hasAttribute('value') ? Number(this.getAttribute('value')) : null; }
  set value(v) { if (v == null) this.removeAttribute('value'); else this.setAttribute('value', String(v)); }

  connectedCallback() {
    this.classList.add('rig-progress');
    this.setAttribute('role', 'progressbar');
    this.#build();
    this.#sync(true);
  }

  attributeChangedCallback(name) {
    if (!this.#built) return;
    if (['steps', 'type', 'labels'].includes(name)) this.#build();
    this.#sync(name !== 'value');
  }

  get #steps() { return Math.max(0, parseInt(this.getAttribute('steps') || '0', 10)); }
  get #max() { return Number(this.getAttribute('max')) || this.#steps || 100; }

  #build() {
    const steps = this.#steps;
    const type = steps ? 'steps' : this.getAttribute('type') === 'circular' ? 'circular' : 'linear';
    const key = `${type}:${steps}:${this.getAttribute('labels') || ''}`;
    if (this.#built === key) return;
    this.#built = key;
    this.dataset.type = type;
    this.#segments = [];
    this.#stepLabels = [];
    if (type === 'linear') {
      this.#fill = h('span', { class: 'rig-progress__fill' });
      this.#text = h('span', { class: 'rig-progress__value', 'aria-hidden': 'true' });
      this.replaceChildren(h('span', { class: 'rig-progress__track' }, this.#fill), this.#text);
    } else if (type === 'circular') {
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 100 100');
      svg.setAttribute('class', 'rig-progress__ring');
      svg.setAttribute('aria-hidden', 'true');
      this.#bar = circle('rig-progress__ring-bar');
      svg.append(circle('rig-progress__ring-track'), this.#bar);
      this.#text = h('span', { class: 'rig-progress__center', 'aria-hidden': 'true' });
      this.replaceChildren(svg, this.#text);
    } else {
      const names = (this.getAttribute('labels') || '').split(',').map((s) => s.trim()).filter(Boolean);
      const row = h('span', { class: 'rig-progress__steps' });
      for (let i = 0; i < steps; i++) {
        const fill = h('span', { class: 'rig-progress__seg-fill' });
        this.#segments.push(fill);
        row.append(h('span', { class: 'rig-progress__seg' }, fill));
      }
      const children = [row];
      if (names.length) {
        const list = h('span', { class: 'rig-progress__labels', 'aria-hidden': 'true' });
        list.style.setProperty('--rig-steps', String(steps));
        for (let i = 0; i < steps; i++) {
          const el = h('span', { class: 'rig-progress__label' }, names[i] ?? '');
          this.#stepLabels.push(el);
          list.append(el);
        }
        children.push(list);
      }
      this.replaceChildren(...children);
    }
    this.#driver?.stop();
    this.#driver = springDriver([this.#fraction() ?? 0], springs.smooth, ([f]) => this.#paint(f));
  }

  #fraction() {
    const v = this.value;
    if (v == null || !Number.isFinite(v)) return null;
    return Math.max(0, Math.min(1, v / this.#max));
  }

  #sync(immediate) {
    const f = this.#fraction();
    const max = this.#max;
    const label = this.getAttribute('label');
    if (label) this.setAttribute('aria-label', label);
    this.setAttribute('aria-valuemin', '0');
    this.setAttribute('aria-valuemax', String(max));
    this.toggleAttribute('data-indeterminate', f == null);
    this.toggleAttribute('data-show-value', this.hasAttribute('show-value'));
    const size = this.getAttribute('size');
    if (size) this.style.setProperty('--rig-progress-size', `${SIZES[size] ?? (Number(size) || SIZES.md)}px`);
    if (f == null) {
      this.removeAttribute('aria-valuenow');
      this.removeAttribute('aria-valuetext');
      if (this.#text) this.#text.textContent = '';
      return;
    }
    const v = Math.min(max, Math.max(0, this.value));
    this.setAttribute('aria-valuenow', String(v));
    if (this.#steps) {
      const names = (this.getAttribute('labels') || '').split(',').map((s) => s.trim());
      const current = Math.min(this.#steps, Math.floor(v));
      const name = names[Math.max(0, current - 1)];
      this.setAttribute('aria-valuetext', `Step ${current} of ${this.#steps}${current && name ? `: ${name}` : ''}`);
      this.#stepLabels.forEach((el, i) => {
        el.classList.toggle('is-done', i < current);
        el.classList.toggle('is-current', i === current - 1);
      });
    } else {
      this.setAttribute('aria-valuetext', `${Math.round(f * 100)}%`);
    }
    this.#driver.to([f], { immediate });
  }

  #paint(f) {
    const type = this.dataset.type;
    const pct = Math.round(Math.max(0, Math.min(1, f)) * 100);
    if (type === 'linear') {
      this.style.setProperty('--rig-progress', Math.max(0, Math.min(1, f)).toFixed(4));
      this.#text.textContent = `${pct}%`;
    } else if (type === 'circular') {
      this.#bar.style.strokeDashoffset = String((100 - Math.max(0, Math.min(1, f)) * 100).toFixed(2));
      this.#text.textContent = `${pct}%`;
    } else {
      const v = f * this.#segments.length;
      this.#segments.forEach((seg, i) => {
        seg.style.transform = `scaleX(${Math.max(0, Math.min(1, v - i)).toFixed(4)})`;
      });
    }
  }
}

define('rig-progress', RigProgress);
export { RigProgress };
