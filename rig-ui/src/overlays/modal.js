// ModalLayer — the shared base of <rig-dialog>, <rig-sheet> and <rig-drawer>.
//
// Each is a native modal <dialog> (top layer, inert page, focus kept inside)
// that fills the viewport and holds its own overlay element plus a panel. The
// overlay is a real element rather than ::backdrop so its opacity can follow a
// drag in every browser.
//
// Subclasses set `static kind` (class prefix) and may override:
//   buildParts()        add DOM to this.panel before the content
//   onOpen(trigger)     enter motion
//   onClose()           exit motion; return a promise that settles when done
//   afterClose()        cleanup once the dialog is closed
//   initialFocus()      element to focus when opened
//
// Shared attributes: open, heading, label, no-close, role="alertdialog".
// Shared API: show(trigger?), close(returnValue?), returnValue, open, body, panel.
// Shared events: rig-open, rig-close ({ detail: { returnValue } }).

import { animate, reducedMotion } from '../motion.js';
import { sound } from '../sound.js';
import { h, paths, svgIcon, uid } from '../util.js';
import { focusables, lockScroll, whenParsed } from './layer.js';

export class ModalLayer extends HTMLElement {
  static kind = 'dialog';
  static observedAttributes = ['open', 'heading', 'label', 'role'];

  dialog = null;
  overlay = null;
  panel = null;
  body = null;
  header = null;
  footer = null;
  returnValue = '';
  trigger = null;

  #built = false;
  #open = false;
  #closing = false;
  #syncing = false;
  #alert = false;
  #unlock = null;
  #returnFocus = null;
  #downOnOverlay = false;
  #titleEl = null;
  #closeBtn = null;

  connectedCallback() {
    if (!this.#built) whenParsed(() => this.#build());
  }

  disconnectedCallback() {
    if (this.#open && !this.isConnected) {
      this.#unlock?.();
      this.#unlock = null;
      this.#open = false;
      this.#closing = false;
    }
  }

  attributeChangedCallback(name, old, value) {
    if (name === 'role') {
      if (value === 'none' || value === null) return;
      this.#alert = value === 'alertdialog';
      if (this.dialog) this.#applyRole();
      // The role belongs on the <dialog>; the host is only a wrapper.
      this.setAttribute('role', 'none');
      return;
    }
    if (!this.#built) return;
    if (name === 'open') {
      if (this.#syncing) return;
      if (value !== null) this.show();
      else this.close();
    } else if (name === 'heading' || name === 'label') {
      this.#applyLabel();
    }
  }

  get open() { return this.#open; }
  set open(value) { if (value) this.show(); else this.close(); }
  /** True for the confirmation variant (role="alertdialog"). */
  get alert() { return this.#alert; }
  get kind() { return this.constructor.kind; }

  #build() {
    if (this.#built) return;
    this.#built = true;
    const k = this.kind;
    const content = [...this.childNodes];
    const footer = content.find((n) => n.nodeType === 1 && n.classList.contains(`rig-${k}__footer`));

    this.overlay = h('div', { class: `rig-${k}__overlay`, 'aria-hidden': 'true' });
    this.panel = h('div', { class: `rig-${k}__panel`, tabindex: '-1' });
    this.body = h('div', { class: `rig-${k}__body`, id: uid(`rig-${k}-body`) });
    this.dialog = h('dialog', { class: `rig-${k}` }, this.overlay, this.panel);

    this.#titleEl = h('h2', { class: `rig-${k}__title`, id: uid(`rig-${k}-title`) });
    this.#closeBtn = h('button', { class: `rig-${k}__close`, type: 'button', 'aria-label': 'Close', 'data-rig-close': '' }, svgIcon(paths.close, { size: 16 }));
    this.header = h('div', { class: `rig-${k}__header` }, this.#titleEl, this.#closeBtn);

    for (const node of content) if (node !== footer) this.body.append(node);
    this.buildParts();
    this.panel.append(this.header, this.body);
    if (footer) {
      this.footer = footer;
      this.panel.append(footer);
    }
    this.append(this.dialog);
    this.#applyRole();
    this.#applyLabel();
    this.#wire();
    if (this.hasAttribute('open')) queueMicrotask(() => { this.#syncing = true; this.removeAttribute('open'); this.#syncing = false; this.show(); });
  }

  #applyRole() {
    if (this.#alert) {
      this.dialog.setAttribute('role', 'alertdialog');
      this.dialog.setAttribute('aria-describedby', this.body.id);
    } else {
      this.dialog.removeAttribute('role');
      this.dialog.removeAttribute('aria-describedby');
    }
    this.#closeBtn.hidden = this.#alert || this.hasAttribute('no-close');
    this.#syncHeader();
  }

  #applyLabel() {
    const heading = this.getAttribute('heading');
    if (heading) {
      this.#titleEl.textContent = heading;
      this.#titleEl.hidden = false;
      this.dialog.setAttribute('aria-labelledby', this.#titleEl.id);
      this.dialog.removeAttribute('aria-label');
    } else {
      this.#titleEl.textContent = '';
      this.#titleEl.hidden = true;
      this.dialog.removeAttribute('aria-labelledby');
      const label = this.getAttribute('label');
      if (label) this.dialog.setAttribute('aria-label', label);
      else this.dialog.removeAttribute('aria-label');
    }
    this.#syncHeader();
  }

  #syncHeader() {
    if (!this.header) return;
    const empty = this.#titleEl.hidden && this.#closeBtn.hidden;
    this.header.hidden = empty;
    this.header.classList.toggle('is-bare', this.#titleEl.hidden);
  }

  #wire() {
    const d = this.dialog;
    d.addEventListener('cancel', (e) => {
      e.preventDefault();
      this.requestDismiss('escape');
    });
    d.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // A light-dismiss popover inside closes first (natively).
      if (d.querySelector(':popover-open')) return;
      e.preventDefault();
      this.requestDismiss('escape');
    });
    d.addEventListener('close', () => {
      // Closed by something other than close() (e.g. the browser ignoring a
      // repeated cancel): tidy up without motion.
      if (this.#open && !this.#closing) this.#finish();
    });
    // Remember where each press started. (A touch click arrives a task after
    // pointerup, so the flag can't be cleared on release.) A press that starts
    // in the panel and ends on the overlay doesn't dismiss.
    d.addEventListener('pointerdown', (e) => { this.#downOnOverlay = e.target === this.overlay; }, true);
    this.overlay.addEventListener('click', () => {
      if (this.#downOnOverlay) this.requestDismiss('backdrop');
    });
    d.addEventListener('click', (e) => {
      const btn = e.target instanceof Element ? e.target.closest('[data-rig-close]') : null;
      if (!btn || !d.contains(btn)) return;
      e.preventDefault();
      const value = btn.getAttribute('data-rig-close') || btn.value || '';
      this.close(value);
    });
    d.addEventListener('submit', (e) => {
      const form = e.target;
      if (!(form instanceof HTMLFormElement) || form.method !== 'dialog') return;
      e.preventDefault();
      this.close(e.submitter?.value ?? '');
    });
  }

  /** Escape or a backdrop click. The confirmation variant refuses with a small pulse. */
  requestDismiss(reason) {
    if (this.#alert) {
      this.rejectDismiss(reason);
      return;
    }
    this.close('');
  }

  rejectDismiss() {
    if (reducedMotion()) return;
    animate(this.panel, [
      { scale: '1' },
      { scale: '1.025' },
      { scale: '0.995' },
      { scale: '1' },
    ], { spring: null, duration: 280, easing: 'ease-out', fill: 'none' });
  }

  show(trigger = null) {
    if (!this.#built) this.#build();
    if (this.#closing) this.#finish();
    if (this.#open) return;
    this.#open = true;
    this.trigger = trigger instanceof Element ? trigger : null;
    this.#returnFocus = this.trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    this.#unlock = lockScroll();
    try {
      this.dialog.showModal();
    } catch {
      this.dialog.setAttribute('open', '');
    }
    this.#reflect(true);
    this.onOpen(this.trigger);
    const target = this.initialFocus();
    (target ?? this.panel).focus?.({ preventScroll: true });
    sound.play('open');
    this.dispatchEvent(new CustomEvent('rig-open', { detail: { trigger: this.trigger } }));
  }

  close(returnValue = '') {
    if (!this.#open || this.#closing) return;
    this.#closing = true;
    this.returnValue = String(returnValue ?? '');
    sound.play('close');
    const done = () => { if (this.#closing) this.#finish(); };
    let result;
    try { result = this.onClose(); } catch { result = null; }
    Promise.resolve(result).then(done, done);
  }

  #finish() {
    if (!this.#open) return;
    this.#open = false;
    this.#closing = false;
    if (this.dialog.open) this.dialog.close(this.returnValue);
    this.#unlock?.();
    this.#unlock = null;
    this.#reflect(false);
    this.afterClose();
    const back = this.#returnFocus;
    this.#returnFocus = null;
    if (back && back.isConnected && back !== document.body) back.focus?.({ preventScroll: true });
    this.dispatchEvent(new CustomEvent('rig-close', { detail: { returnValue: this.returnValue } }));
  }

  #reflect(on) {
    this.#syncing = true;
    this.toggleAttribute('open', on);
    this.#syncing = false;
  }

  /* ---------- hooks ---------- */

  buildParts() {}
  onOpen() {}
  onClose() { return null; }
  afterClose() {}

  /** Autofocus, else the least destructive action of a confirmation, else the first control in the content. */
  initialFocus() {
    const root = this.panel;
    const auto = root.querySelector('[autofocus], [data-autofocus]');
    if (auto) return auto;
    if (this.#alert) {
      const buttons = focusables(root).filter((el) => el.matches('button, [role="button"], a[href]'));
      const safe = buttons.find((b) => b.value === 'cancel' || b.hasAttribute('data-rig-close') && !b.matches('.rig-btn--accent, .rig-btn--danger, [data-danger]'))
        ?? buttons.find((b) => !b.matches('.rig-btn--accent, .rig-btn--danger, [data-danger]'))
        ?? buttons[0];
      if (safe) return safe;
    }
    const list = focusables(root);
    return list.find((el) => !this.header.contains(el)) ?? list[0] ?? root;
  }
}
