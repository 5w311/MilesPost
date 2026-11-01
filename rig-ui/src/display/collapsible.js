// <rig-collapsible> — show and hide one region, or clamp long text to a few
// lines with a "Show more" button that only appears when the text overflows.
//
//   <rig-collapsible>
//     <button slot="trigger" class="rig-btn rig-btn--sm">Stop details</button>
//     <div>Dock 14, check in at the guard shack…</div>
//   </rig-collapsible>
//
//   <rig-collapsible lines="3">A long dispatch note…</rig-collapsible>
//
// Attributes: open (reflects state), lines (clamp mode: number of lines shown
//   while collapsed), more-label / less-label (clamp button text, default
//   "Show more" / "Show less").
// Properties: open (boolean). Methods: show(), hide(), toggle().
// Event: openchange ({ detail: { open } }).
// In trigger mode the first child with slot="trigger" controls the rest. A
// collapsed region is hidden from the tab order and from screen readers.

import { sound } from '../sound.js';
import { define, h, uid } from '../util.js';
import { icon } from './icons.js';
import { releaseHeight, springHeight } from './height.js';

class RigCollapsible extends HTMLElement {
  static observedAttributes = ['open', 'more-label', 'less-label'];
  #built = false;
  #trigger;
  #region;
  #clamp;
  #toggleBtn;
  #ro;
  #syncing = false;

  get open() { return this.hasAttribute('open'); }
  set open(v) { this.toggleAttribute('open', Boolean(v)); }

  show() { this.open = true; }
  hide() { this.open = false; }
  toggle() { this.open = !this.open; }

  connectedCallback() {
    if (this.#built) return;
    this.#built = true;
    this.classList.add('rig-collapsible');
    const lines = parseInt(this.getAttribute('lines') || '0', 10);
    if (lines > 0) this.#buildClamp(lines); else this.#buildRegion();
  }

  disconnectedCallback() { this.#ro?.disconnect(); }

  attributeChangedCallback(name, oldValue, value) {
    if (!this.#built || this.#syncing) return;
    if (name === 'open' && (oldValue === null) !== (value === null)) this.#apply(value !== null, true);
    else if (name !== 'open') this.#labels();
  }

  // ---------- trigger + region ----------

  #buildRegion() {
    const trigger = [...this.children].find((el) => el.getAttribute('slot') === 'trigger');
    const rest = [...this.childNodes].filter((n) => n !== trigger);
    const id = uid('collapsible');
    this.#region = h('div', { class: 'rig-collapsible__region', id }, h('div', { class: 'rig-collapsible__inner' }, rest));
    this.#trigger = trigger || h('button', { class: 'rig-btn rig-btn--sm', type: 'button' }, 'Show details');
    this.#trigger.classList.add('rig-collapsible__trigger');
    if (!this.#trigger.querySelector('svg, rig-icon')) this.#trigger.append(h('span', { class: 'rig-collapsible__chev', 'aria-hidden': 'true' }, icon('chevronDown', { size: 16 })));
    if (this.#trigger.tagName !== 'BUTTON') {
      this.#trigger.setAttribute('role', 'button');
      this.#trigger.tabIndex = 0;
      this.#trigger.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.#trigger.click(); }
      });
    }
    this.#trigger.setAttribute('aria-controls', id);
    this.#trigger.addEventListener('click', () => this.#userToggle());
    this.replaceChildren(this.#trigger, this.#region);
    this.#apply(this.open, false);
  }

  // ---------- clamp ----------

  #buildClamp(lines) {
    const id = uid('clamp');
    this.classList.add('rig-collapsible--clamp');
    this.style.setProperty('--rig-clamp-lines', String(lines));
    this.#clamp = h('div', { class: 'rig-collapsible__clamp', id }, [...this.childNodes]);
    this.#toggleBtn = h('button', { class: 'rig-collapsible__more', type: 'button', 'aria-controls': id, hidden: true });
    this.#toggleBtn.addEventListener('click', () => this.#userToggle());
    this.replaceChildren(this.#clamp, this.#toggleBtn);
    this.#ro = new ResizeObserver(() => this.#measure());
    this.#ro.observe(this.#clamp);
    this.#apply(this.open, false);
  }

  #measure() {
    if (!this.#clamp || this.open || this.#clamp.style.height) return;
    const overflowing = this.#clamp.scrollHeight > this.#clamp.clientHeight + 1;
    this.#toggleBtn.hidden = !overflowing;
    this.classList.toggle('is-overflowing', overflowing);
  }

  #clampedHeight() {
    const cs = getComputedStyle(this.#clamp);
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5;
    const lines = parseInt(this.getAttribute('lines') || '3', 10);
    return lh * lines + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  }

  // ---------- shared ----------

  #userToggle() {
    const next = !this.open;
    this.#syncing = true;
    this.toggleAttribute('open', next);
    this.#syncing = false;
    this.#apply(next, true);
    sound.play('toggle', { on: next });
    this.dispatchEvent(new CustomEvent('openchange', { detail: { open: next } }));
  }

  #labels() {
    if (this.#toggleBtn) this.#toggleBtn.textContent = this.open ? (this.getAttribute('less-label') || 'Show less') : (this.getAttribute('more-label') || 'Show more');
  }

  #apply(open, animated) {
    if (this.#clamp) {
      const el = this.#clamp;
      this.#toggleBtn.setAttribute('aria-expanded', String(open));
      this.#labels();
      if (!animated) { el.classList.toggle('is-expanded', open); this.#measure(); return; }
      const from = el.getBoundingClientRect().height;
      if (open) {
        el.classList.add('is-expanded');
        el.style.height = 'auto';
        const to = el.scrollHeight;
        springHeight(el, to, { from, onDone: () => releaseHeight(el) });
      } else {
        springHeight(el, this.#clampedHeight(), {
          from,
          onDone: () => { el.classList.remove('is-expanded'); releaseHeight(el); this.#measure(); },
        });
      }
      return;
    }
    const region = this.#region;
    this.#trigger.setAttribute('aria-expanded', String(open));
    this.classList.toggle('is-open', open);
    if (!animated) {
      region.hidden = !open;
      return;
    }
    const from = region.hidden ? 0 : region.getBoundingClientRect().height;
    if (open) {
      region.hidden = false;
      region.style.height = 'auto';
      const to = region.getBoundingClientRect().height;
      springHeight(region, to, { from, onDone: () => releaseHeight(region) });
    } else {
      springHeight(region, 0, { from, onDone: () => { region.hidden = true; releaseHeight(region); } });
    }
  }
}

define('rig-collapsible', RigCollapsible);
export { RigCollapsible };
