// <rig-drawer> — a bottom drawer for phones, with snap points.
//
//   <button data-rig-drawer="stop-details">Stop details</button>
//   <rig-drawer id="stop-details" heading="Lakeside Fuel Plaza, exit 358" snaps="0.4,0.9">
//     ...content...
//   </rig-drawer>
//   <main data-rig-drawer-bg>…</main>   (optional: scales back while the drawer is up)
//
// Drag the handle (or the content) and let go: the drawer projects your flick
// forward and settles on the nearest snap point, or closes if that's nearest.
// Content scrolls inside only at the top snap; below it, dragging the content
// moves the drawer. The handle is a button too: click or press it to step
// between snaps, or use the arrow keys on it.
//
// Attributes: snaps (fractions of the viewport height, e.g. "0.4,0.9"; without
//   it the drawer fits its content up to 90% of the screen), open, heading,
//   label, no-close, role="alertdialog".
// Properties: open, snap (current snap index), returnValue, body, panel.
// Methods: show(trigger?), close(returnValue?), snapTo(index).
// Events: rig-open, rig-close ({ detail: { returnValue } }),
//   snapchange ({ detail: { index, fraction } }).
// Triggers: any element with data-rig-drawer="<id>".
// Background: elements with data-rig-drawer-bg (empty or this drawer's id).

import { springDriver } from '../motion.js';
import { sound } from '../sound.js';
import { clamp, define, h } from '../util.js';
import { onTrigger, trackDrag } from './layer.js';
import { ModalLayer } from './modal.js';
import { pickSnap, rubberband } from './overlay-math.js';

const SETTLE = { duration: 0.46, bounce: 0.14 };
const EXIT = { duration: 0.32, bounce: 0 };

class RigDrawer extends ModalLayer {
  static kind = 'drawer';
  static observedAttributes = [...ModalLayer.observedAttributes, 'snaps'];

  #driver = null;
  #handle = null;
  #fractions = [];
  #snaps = [];
  #height = 0;
  #index = 0;
  #visible = 0;
  #base = 0;
  #bg = [];
  #onResize = () => { if (this.open) this.#layout(true); };

  get snap() { return this.#index; }

  attributeChangedCallback(name, old, value) {
    if (name === 'snaps') {
      if (this.open) this.#layout(true);
      return;
    }
    super.attributeChangedCallback(name, old, value);
  }

  buildParts() {
    this.#handle = h('button', { class: 'rig-drawer__handle', type: 'button', 'aria-label': 'Expand drawer' }, h('span', { class: 'rig-drawer__bar', 'aria-hidden': 'true' }));
    this.panel.prepend(this.#handle);
    this.#driver = springDriver([0], SETTLE, ([v]) => this.#render(v));

    this.#handle.addEventListener('click', () => {
      if (this.#snaps.length < 2) { this.close(''); return; }
      this.snapTo(this.#index < this.#snaps.length - 1 ? this.#index + 1 : 0);
    });
    this.#handle.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const next = this.#index + (e.key === 'ArrowUp' ? 1 : -1);
        if (next >= 0 && next < this.#snaps.length) this.snapTo(next);
      }
    });
    this.body.addEventListener('wheel', (e) => {
      // Scrolling down on a part-open drawer opens it the rest of the way.
      if (e.deltaY > 8 && this.#index < this.#snaps.length - 1 && !this.#dragging) {
        e.preventDefault();
        this.snapTo(this.#snaps.length - 1);
      }
    }, { passive: false });

    const self = this;
    trackDrag(this.panel, {
      axis: 'y',
      shouldStart(target, delta, e) { return self.#canDrag(target, delta, e); },
      onStart() {
        self.#dragging = true;
        self.#driver.stop();
        self.#base = self.#visible;
      },
      onMove(delta) {
        let v = self.#base - delta;
        if (v > self.#height) v = self.#height + rubberband(v - self.#height, self.#height * 0.5);
        self.#driver.to([Math.max(0, v)], { immediate: true });
      },
      onEnd(delta, velocity) {
        self.#dragging = false;
        const up = -velocity;
        const index = pickSnap(self.#visible, up, self.#snaps);
        self.#driver.kick([up]);
        if (index === -1) self.close('');
        else self.snapTo(index);
      },
    });
  }

  #dragging = false;

  #canDrag(target, delta, e) {
    if (!this.open) return false;
    if (target.closest('input, textarea, select, [contenteditable], [data-rig-no-drag], .rig-drawer__close')) return false;
    const chrome = target.closest('.rig-drawer__handle') || this.header.contains(target);
    if (chrome) return true;
    if (e.pointerType === 'mouse') return false;
    if (!this.#atTop) return true;
    return this.body.scrollTop <= 0 && delta > 0;
  }

  get #atTop() { return this.#index === this.#snaps.length - 1; }

  #layout(keep = false) {
    const vh = window.visualViewport?.height ?? window.innerHeight;
    const raw = (this.getAttribute('snaps') || '').split(',').map((s) => parseFloat(s)).filter((n) => n > 0 && n <= 1);
    this.#fractions = [...new Set(raw)].sort((a, b) => a - b);
    if (this.#fractions.length) {
      this.#height = Math.round(this.#fractions[this.#fractions.length - 1] * vh);
      this.panel.style.height = `${this.#height}px`;
      this.#snaps = this.#fractions.map((f) => Math.round(f * vh));
    } else {
      this.panel.style.height = '';
      this.#height = Math.min(this.panel.offsetHeight, Math.round(vh * 0.9));
      this.#snaps = [this.#height];
      this.#fractions = [this.#height / vh];
    }
    this.#index = clamp(this.#index, 0, this.#snaps.length - 1);
    this.#syncState();
    if (keep) this.#driver.to([this.#snaps[this.#index]], { immediate: true });
  }

  /** Move to a snap point by index (0 = lowest). */
  snapTo(index) {
    if (!this.open) return;
    const i = clamp(index, 0, this.#snaps.length - 1);
    const changed = i !== this.#index;
    this.#index = i;
    this.#syncState();
    this.#driver.to([this.#snaps[i]]);
    if (changed) {
      sound.play('tick');
      this.dispatchEvent(new CustomEvent('snapchange', { detail: { index: i, fraction: this.#fractions[i] } }));
    }
  }

  #syncState() {
    const top = this.#atTop;
    this.dialog.classList.toggle('is-full', top);
    if (!top) this.body.scrollTop = 0;
    const multi = this.#snaps.length > 1;
    this.#handle.setAttribute('aria-label', !multi ? 'Close drawer' : top ? 'Collapse drawer' : 'Expand drawer');
  }

  #render(v) {
    this.#visible = v;
    this.panel.style.transform = `translate3d(0, ${(this.#height - v).toFixed(2)}px, 0)`;
    const first = this.#snaps[0] || 1;
    this.overlay.style.opacity = String(clamp(v / first, 0, 1));
    const p = clamp(v / (this.#height || 1), 0, 1);
    for (const { el } of this.#bg) {
      el.style.transform = `translateY(${(p * 14).toFixed(2)}px) scale(${(1 - p * 0.06).toFixed(4)})`;
      el.style.borderRadius = `${(p * 16).toFixed(1)}px`;
    }
  }

  #captureBackground() {
    this.#bg = [...document.querySelectorAll('[data-rig-drawer-bg]')]
      .filter((el) => !el.getAttribute('data-rig-drawer-bg') || el.getAttribute('data-rig-drawer-bg') === this.id)
      .map((el) => ({ el, style: el.getAttribute('style') }));
    for (const { el } of this.#bg) {
      el.style.transformOrigin = '50% 0';
      el.style.overflow = 'hidden';
    }
  }

  #releaseBackground() {
    for (const { el, style } of this.#bg) {
      if (style == null) el.removeAttribute('style');
      else el.setAttribute('style', style);
    }
    this.#bg = [];
  }

  // Autofocus if asked; otherwise the handle, so a phone keyboard never pops
  // up just because the drawer opened over a form.
  initialFocus() {
    if (this.alert) return super.initialFocus();
    return this.panel.querySelector('[autofocus], [data-autofocus]') ?? this.#handle;
  }

  onOpen() {
    this.#index = 0;
    this.#layout();
    this.#captureBackground();
    this.#driver.configure(SETTLE);
    this.#driver.to([0], { immediate: true });
    this.#driver.to([this.#snaps[0]]);
    window.addEventListener('resize', this.#onResize);
  }

  onClose() {
    window.removeEventListener('resize', this.#onResize);
    this.#driver.configure(EXIT);
    this.#driver.to([0]);
    return this.#driver.rested();
  }

  afterClose() {
    window.removeEventListener('resize', this.#onResize);
    this.#driver.stop();
    this.#releaseBackground();
    this.panel.style.transform = '';
    this.overlay.style.opacity = '';
    this.dialog.classList.remove('is-full');
  }
}

define('rig-drawer', RigDrawer);

onTrigger('data-rig-drawer', (trigger, id, e) => {
  const target = id && document.getElementById(id);
  if (!(target instanceof RigDrawer)) return;
  e.preventDefault();
  trigger.setAttribute('aria-haspopup', 'dialog');
  target.show(trigger);
});

export { RigDrawer };
