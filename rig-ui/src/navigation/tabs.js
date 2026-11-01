// <rig-tabs> — tabs with a sliding indicator and cross-fading panels.
//
//   <rig-tabs value="stops" variant="underline" label="Load details">
//     <rig-tab value="overview">Overview</rig-tab>
//     <rig-tab value="stops">Stops</rig-tab>
//     <rig-tab value="docs" disabled>Documents</rig-tab>
//     <rig-tab-panel value="overview">…</rig-tab-panel>
//     <rig-tab-panel value="stops">…</rig-tab-panel>
//     <rig-tab-panel value="docs">…</rig-tab-panel>
//   </rig-tabs>
//
// Tabs and panels pair up by `value` (or by order when values are missing).
// The indicator springs to the chosen tab, its leading edge a touch ahead of
// the trailing one. The outgoing panel fades away while the new one slides in
// from the direction you moved, and the panel area springs to the new height.
// On narrow screens the tab row scrolls sideways and keeps the chosen tab in view.
//
// Keyboard: Left/Right move between tabs (wrapping, skipping disabled ones),
// Home/End jump to the ends. With activation="manual", arrows only move focus
// and Enter or Space selects.
//
// Attributes: value, variant ("underline" | "segmented"), activation
//   ("auto" | "manual"), label (names the tab list).
// Properties: value, tabs, panels.
// Methods: select(value).
// Events: change ({ detail: { value, previous } }) when the person picks a tab.

import { animate, reducedMotion, springDriver, springs } from '../motion.js';
import { sound } from '../sound.js';
import { define, h, uid } from '../util.js';
import { whenParsed } from '../overlays/layer.js';
import { edgeIndex, stepIndex } from './nav-math.js';

const LEAD = springs.snappy;
const TRAIL = { duration: 0.4, bounce: 0.06 };
const SLIDE = 14;

class RigTabs extends HTMLElement {
  static observedAttributes = ['value', 'variant', 'label'];

  #built = false;
  #syncing = false;
  #list = null;
  #indicator = null;
  #panelsWrap = null;
  #tabs = [];
  #panels = [];
  #current = null;
  #left = 0;
  #right = 0;
  #leftDriver = null;
  #rightDriver = null;
  #shown = false;
  #heightAnim = null;
  #ro = null;

  connectedCallback() {
    if (!this.#built) whenParsed(() => this.#build());
    else { this.#ro.observe(this.#list); this.#tabs.forEach((t) => this.#ro.observe(t)); }
  }

  disconnectedCallback() {
    this.#ro?.disconnect();
  }

  attributeChangedCallback(name, old, value) {
    if (!this.#built) return;
    if (name === 'value' && !this.#syncing) this.select(value, { instant: false });
    if (name === 'label') this.#list.setAttribute('aria-label', value || 'Tabs');
    if (name === 'variant') requestAnimationFrame(() => this.#placeIndicator(true));
  }

  get value() { return this.#current ? this.#valueOf(this.#current) : null; }
  set value(v) { this.select(v); }
  get tabs() { return this.#tabs.slice(); }
  get panels() { return this.#panels.slice(); }

  #valueOf(tab) { return tab.getAttribute('value') ?? String(this.#tabs.indexOf(tab)); }
  #disabled(tab) { return tab.hasAttribute('disabled'); }

  #build() {
    if (this.#built) return;
    this.#built = true;
    this.classList.add('rig-tabs');
    this.#tabs = [...this.querySelectorAll(':scope > rig-tab')];
    this.#panels = [...this.querySelectorAll(':scope > rig-tab-panel')];
    this.#indicator = h('span', { class: 'rig-tabs__indicator', 'aria-hidden': 'true' });
    this.#list = h('div', { class: 'rig-tabs__list', role: 'tablist', 'aria-label': this.getAttribute('label') || 'Tabs' }, this.#indicator);
    const bar = h('div', { class: 'rig-tabs__bar' }, this.#list);
    this.#panelsWrap = h('div', { class: 'rig-tabs__panels' });

    this.#tabs.forEach((tab, i) => {
      const value = this.#valueOf(tab);
      const panel = this.#panels.find((p) => p.getAttribute('value') === value) ?? this.#panels[i];
      tab.id ||= uid('rig-tab');
      tab.classList.add('rig-tabs__tab');
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', 'false');
      tab.tabIndex = -1;
      if (this.#disabled(tab)) tab.setAttribute('aria-disabled', 'true');
      if (panel) {
        panel.id ||= uid('rig-tabpanel');
        tab.setAttribute('aria-controls', panel.id);
        panel.setAttribute('aria-labelledby', tab.id);
      }
      this.#list.append(tab);
    });
    for (const panel of this.#panels) {
      panel.classList.add('rig-tabs__panel');
      panel.setAttribute('role', 'tabpanel');
      panel.tabIndex = 0;
      panel.hidden = true;
      this.#panelsWrap.append(panel);
    }
    this.prepend(bar, this.#panelsWrap);

    this.#leftDriver = springDriver([0], LEAD, ([x]) => { this.#left = x; this.#paint(); });
    this.#rightDriver = springDriver([0], LEAD, ([x]) => { this.#right = x; this.#paint(); });

    this.#list.addEventListener('click', (e) => {
      const tab = e.target instanceof Element ? e.target.closest('.rig-tabs__tab') : null;
      if (!tab || this.#disabled(tab)) return;
      tab.focus({ preventScroll: true });
      this.#choose(tab);
    });
    this.#list.addEventListener('keydown', (e) => this.#onKey(e));
    this.#list.addEventListener('scroll', () => this.#syncFades(), { passive: true });
    this.#ro = new ResizeObserver(() => { this.#placeIndicator(true); this.#syncFades(); });
    this.#ro.observe(this.#list);
    this.#tabs.forEach((t) => this.#ro.observe(t));
    document.fonts?.ready.then(() => this.#placeIndicator(true));

    const initial = this.#tabs.find((t) => this.#valueOf(t) === this.getAttribute('value') && !this.#disabled(t))
      ?? this.#tabs[edgeIndex(this.#tabs.length, 1, (i) => this.#disabled(this.#tabs[i]))];
    if (initial) this.#activate(initial, { instant: true });
  }

  /** Select a tab by value (no change event). */
  select(value, { instant = false } = {}) {
    if (!this.#built) { this.setAttribute('value', value); return; }
    const tab = this.#tabs.find((t) => this.#valueOf(t) === String(value));
    if (tab && !this.#disabled(tab)) this.#activate(tab, { instant });
  }

  #choose(tab) {
    if (tab === this.#current) return;
    const previous = this.value;
    this.#activate(tab);
    sound.play('tick');
    this.dispatchEvent(new CustomEvent('change', { bubbles: true, detail: { value: this.value, previous } }));
  }

  #activate(tab, { instant = false } = {}) {
    const prev = this.#current;
    if (prev === tab) return;
    const dir = prev ? Math.sign(this.#tabs.indexOf(tab) - this.#tabs.indexOf(prev)) || 1 : 0;
    this.#current = tab;
    for (const t of this.#tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      t.classList.toggle('is-active', on);
    }
    this.#syncing = true;
    this.setAttribute('value', this.#valueOf(tab));
    this.#syncing = false;
    this.#placeIndicator(instant || !prev, dir);
    this.#swapPanels(prev && this.#panelFor(prev), this.#panelFor(tab), dir, instant || !prev);
    this.#reveal(tab, instant || !prev);
  }

  #panelFor(tab) {
    const id = tab.getAttribute('aria-controls');
    return id ? this.#panels.find((p) => p.id === id) : null;
  }

  #onKey(e) {
    const tab = e.target instanceof Element ? e.target.closest('.rig-tabs__tab') : null;
    if (!tab) return;
    const n = this.#tabs.length;
    const i = this.#tabs.indexOf(tab);
    const disabled = (k) => this.#disabled(this.#tabs[k]);
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = stepIndex(n, i, 1, disabled);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = stepIndex(n, i, -1, disabled);
    else if (e.key === 'Home') next = edgeIndex(n, 1, disabled);
    else if (e.key === 'End') next = edgeIndex(n, -1, disabled);
    else if ((e.key === 'Enter' || e.key === ' ') && !this.#disabled(tab)) {
      e.preventDefault();
      this.#choose(tab);
      return;
    } else return;
    e.preventDefault();
    if (next < 0) return;
    const target = this.#tabs[next];
    target.focus({ preventScroll: true });
    this.#reveal(target);
    if (this.getAttribute('activation') !== 'manual') this.#choose(target);
  }

  #paint() {
    const w = Math.max(0, this.#right - this.#left);
    this.#indicator.style.transform = `translateX(${this.#left.toFixed(2)}px)`;
    this.#indicator.style.width = `${w.toFixed(2)}px`;
  }

  #placeIndicator(immediate = false, dir = 0) {
    const tab = this.#current;
    if (!tab || !tab.offsetWidth) return;
    const left = tab.offsetLeft;
    const right = left + tab.offsetWidth;
    if (!this.#shown || immediate) {
      this.#shown = true;
      this.#leftDriver.to([left], { immediate: true });
      this.#rightDriver.to([right], { immediate: true });
      this.#indicator.style.opacity = '1';
      return;
    }
    // The edge in the direction of travel leads; the other follows a little later.
    this.#leftDriver.configure(dir < 0 ? LEAD : TRAIL);
    this.#rightDriver.configure(dir < 0 ? TRAIL : LEAD);
    this.#leftDriver.to([left]);
    this.#rightDriver.to([right]);
  }

  #swapPanels(from, to, dir, instant) {
    if (!to) { if (from) from.hidden = true; return; }
    const wrap = this.#panelsWrap;
    for (const p of this.#panels) {
      if (p !== from && p !== to) {
        p.getAnimations().forEach((a) => a.cancel());
        p.classList.remove('is-leaving');
        p.hidden = true;
      }
    }
    to.getAnimations().forEach((a) => a.cancel());
    to.classList.remove('is-leaving');
    if (instant || !from || reducedMotion()) {
      if (from) { from.getAnimations().forEach((a) => a.cancel()); from.classList.remove('is-leaving'); from.hidden = true; }
      to.hidden = false;
      return;
    }
    const startHeight = wrap.offsetHeight;
    this.#heightAnim?.cancel();
    from.classList.add('is-leaving');
    to.hidden = false;
    const endHeight = wrap.offsetHeight;
    from.getAnimations().forEach((a) => a.cancel());
    const out = animate(from, [
      { opacity: 1, transform: 'translateX(0)' },
      { opacity: 0, transform: `translateX(${-dir * SLIDE}px)` },
    ], { spring: null, duration: 140, easing: 'ease-in', fill: 'forwards' });
    out.finished.then(() => {
      if (from === this.#panelFor(this.#current)) return;
      from.hidden = true;
      from.classList.remove('is-leaving');
      out.cancel();
    }, () => {});
    animate(to, [
      { opacity: 0, transform: `translateX(${dir * SLIDE}px)` },
      { opacity: 1, transform: 'translateX(0)' },
    ], { spring: springs.smooth, delay: 50, fill: 'backwards' });
    if (Math.abs(endHeight - startHeight) > 1) {
      wrap.classList.add('is-resizing');
      const anim = animate(wrap, [{ height: `${startHeight}px` }, { height: `${endHeight}px` }], { spring: springs.smooth, fill: 'none' });
      this.#heightAnim = anim;
      const done = () => { if (this.#heightAnim === anim) { wrap.classList.remove('is-resizing'); this.#heightAnim = null; } };
      anim.finished.then(done, done);
    }
  }

  #reveal(tab, instant = false) {
    const list = this.#list;
    if (list.scrollWidth <= list.clientWidth) return;
    const pad = 28;
    const left = tab.offsetLeft - pad;
    const right = tab.offsetLeft + tab.offsetWidth + pad;
    let target = null;
    if (left < list.scrollLeft) target = left;
    else if (right > list.scrollLeft + list.clientWidth) target = right - list.clientWidth;
    if (target !== null) list.scrollTo({ left: Math.max(0, target), behavior: instant || reducedMotion() ? 'auto' : 'smooth' });
  }

  #syncFades() {
    const list = this.#list;
    const max = list.scrollWidth - list.clientWidth;
    this.classList.toggle('can-scroll-start', list.scrollLeft > 2);
    this.classList.toggle('can-scroll-end', max > 2 && list.scrollLeft < max - 2);
  }
}

define('rig-tabs', RigTabs);
export { RigTabs };
