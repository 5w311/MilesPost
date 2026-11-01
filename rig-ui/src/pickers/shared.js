// Shared DOM plumbing for the pickers: a form-associated base class, the
// popover controller every picker popup uses, and a few small helpers.
//
// Deliberate limit: popups need the popover API and ElementInternals
// (Chrome/Edge 114+, Safari 17+, Firefox 125+); there's no fallback layer.

import { animate, reducedMotion, springs } from '../motion.js';
import { follow } from '../position.js';
import { svgIcon } from '../util.js';

/** Run `fn` once the element's children have been parsed. */
export function whenParsed(fn) {
  if (typeof document !== 'undefined' && document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fn, { once: true });
  } else {
    fn();
  }
}

/**
 * Stop native events from inner parts (an inner <input>'s `input` and
 * `change`) escaping through the host, where they'd be mistaken for the
 * component's own value events.
 */
export function contain(el, ...types) {
  for (const type of types) el.addEventListener(type, (e) => e.stopPropagation());
}

/**
 * Base for value-holding pickers. Subclasses call `this._setForm(value)` and
 * `this._setValidity(missing, message, anchor)`, and may override
 * `_onDisabledChange(disabled)` and `formResetCallback()`.
 */
export class FormElement extends HTMLElement {
  static formAssociated = true;

  constructor() {
    super();
    try { this._internals = this.attachInternals(); } catch { this._internals = null; }
    this._formDisabled = false;
    // A failed submit marks the field so styles can show it.
    this.addEventListener('invalid', () => this.setAttribute('invalid', ''));
  }

  get form() { return this._internals?.form ?? null; }
  get name() { return this.getAttribute('name'); }
  set name(v) { this.setAttribute('name', v); }
  get type() { return this.localName; }
  get labels() { return this._internals?.labels ?? []; }
  get validity() { return this._internals?.validity; }
  get validationMessage() { return this._internals?.validationMessage ?? ''; }
  get willValidate() { return this._internals?.willValidate ?? false; }
  checkValidity() { return this._internals?.checkValidity() ?? true; }
  reportValidity() { return this._internals?.reportValidity() ?? true; }

  get disabled() { return this.hasAttribute('disabled'); }
  set disabled(v) { this.toggleAttribute('disabled', Boolean(v)); }
  get required() { return this.hasAttribute('required'); }
  set required(v) { this.toggleAttribute('required', Boolean(v)); }

  /** Own `disabled` attribute or a disabled <fieldset> ancestor. */
  get _isDisabled() { return this.hasAttribute('disabled') || this._formDisabled; }

  formDisabledCallback(disabled) {
    this._formDisabled = disabled;
    this._onDisabledChange?.(this._isDisabled);
  }

  _setForm(value, state = value) {
    try { this._internals?.setFormValue(value, state); } catch { /* detached */ }
  }

  _setValidity(missing, message, anchor) {
    if (!this._internals) return;
    try {
      if (missing) this._internals.setValidity({ valueMissing: true }, message, anchor);
      else this._internals.setValidity({});
    } catch { /* anchor not yet connected */ }
  }

  /**
   * Point <label for=…> at the inner control: name it, and focus it on click.
   * `alsoName` (e.g. the popup listbox) gets the same accessible name.
   */
  _linkLabels(control, alsoName = null) {
    const labels = [...this.labels];
    if (!labels.length) return;
    const ids = labels.map((label) => {
      if (!label.id) label.id = `${this.id || 'rig-pick'}-label-${Math.random().toString(36).slice(2, 7)}`;
      if (!label.dataset.rigLinked) {
        label.dataset.rigLinked = '';
        label.addEventListener('click', (e) => {
          e.preventDefault();
          if (!this._isDisabled) control.focus();
        });
      }
      return label.id;
    });
    const own = control.getAttribute('aria-labelledby');
    control.setAttribute('aria-labelledby', [...new Set([...ids, ...(own ? own.split(' ') : [])])].join(' '));
    if (alsoName && !this.hasAttribute('label')) alsoName.setAttribute('aria-labelledby', ids.join(' '));
  }

  _emit(type = 'change', detail) {
    const event = detail === undefined ? new Event(type, { bubbles: true }) : new CustomEvent(type, { bubbles: true, detail });
    this.dispatchEvent(event);
  }
}

/**
 * The popup controller: popover="manual" in the top layer, positioned with
 * follow(), springs in from the anchor, and dismisses on outside press or
 * when focus leaves the host. (Manual rather than auto so a press on the
 * trigger toggles cleanly instead of light-dismissing and reopening.)
 *
 *   const pop = createPopup({ host, anchor, panel, onDismiss: () => close() })
 *   pop.show(); pop.hide()
 */
export function createPopup({ host, anchor, panel, placement = 'bottom-start', offset = 6, onDismiss, matchWidth = false }) {
  panel.setAttribute('popover', 'manual');
  const native = typeof panel.showPopover === 'function';
  let stop = null;
  let open = false;
  let anim = null;

  const inside = (node) => node && (host.contains(node) || panel.contains(node));
  const onPointerDown = (e) => {
    if (!open) return;
    const path = e.composedPath();
    if (path.includes(host) || path.includes(panel)) return;
    onDismiss?.('outside');
  };
  const onFocusOut = (e) => {
    if (!open || !e.relatedTarget || inside(e.relatedTarget)) return;
    onDismiss?.('blur');
  };

  const isShowing = () => {
    try { return panel.matches(':popover-open'); } catch { return panel.classList.contains('is-open'); }
  };

  return {
    get open() { return open; },
    show() {
      if (open) return;
      open = true;
      anim?.cancel();
      stop?.();
      if (matchWidth) panel.style.setProperty('--rig-pick-anchor-w', `${Math.round(anchor.getBoundingClientRect().width)}px`);
      if (native && !isShowing()) panel.showPopover();
      panel.classList.add('is-open');
      stop = follow(anchor, panel, { placement, offset });
      const dy = panel.dataset.side === 'top' ? 6 : -6;
      anim = animate(panel, [
        { opacity: 0, transform: `translateY(${dy}px) scale(0.97)` },
        { opacity: 1, transform: 'none' },
      ], { spring: springs.snappy, fill: 'none' });
      document.addEventListener('pointerdown', onPointerDown, true);
      host.addEventListener('focusout', onFocusOut);
    },
    hide({ instant = false } = {}) {
      if (!open) return;
      open = false;
      document.removeEventListener('pointerdown', onPointerDown, true);
      host.removeEventListener('focusout', onFocusOut);
      anim?.cancel();
      const done = () => {
        stop?.();
        stop = null;
        panel.classList.remove('is-open');
        if (native && isShowing()) panel.hidePopover();
      };
      if (instant || reducedMotion()) { done(); return; }
      const current = animate(panel, [
        { opacity: 1, transform: 'none' },
        { opacity: 0, transform: 'scale(0.98)' },
      ], { spring: null, duration: 120, easing: 'ease-in', fill: 'forwards' });
      anim = current;
      current.finished.then(() => {
        if (open || anim !== current) return;
        done();
        current.cancel();
      }, () => {});
    },
    /** Re-measure (after the panel's content changed size a lot). */
    reposition() {
      if (!open) return;
      stop?.();
      stop = follow(anchor, panel, { placement, offset });
    },
    destroy() {
      this.hide({ instant: true });
    },
  };
}

/**
 * FLIP: record positions of `els`, run `mutate`, then spring every element
 * that moved from its old place to its new one.
 */
export function flip(els, mutate, spring = springs.snappy) {
  const before = new Map(els.map((el) => [el, el.getBoundingClientRect()]));
  mutate();
  if (reducedMotion()) return;
  for (const [el, a] of before) {
    if (!el.isConnected) continue;
    const b = el.getBoundingClientRect();
    const dx = a.left - b.left;
    const dy = a.top - b.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
    animate(el, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { spring, fill: 'none' });
  }
}

/** Highlight fuzzy-matched characters with <mark>. */
export function markText(target, text, indices) {
  if (!indices || !indices.length) { target.textContent = text; return; }
  const set = new Set(indices);
  const frag = document.createDocumentFragment();
  let run = '';
  let marked = false;
  const flush = () => {
    if (!run) return;
    if (marked) {
      const m = document.createElement('mark');
      m.textContent = run;
      frag.append(m);
    } else {
      frag.append(document.createTextNode(run));
    }
    run = '';
  };
  for (let i = 0; i < text.length; i++) {
    const hit = set.has(i);
    if (hit !== marked) { flush(); marked = hit; }
    run += text[i];
  }
  flush();
  target.replaceChildren(frag);
}

/** Picker-specific icon paths (24x24 stroke). */
export const pickPaths = {
  chevronUpDown: ['m8 9.5 4-4 4 4', 'm8 14.5 4 4 4-4'],
  calendar: ['M4.5 6.5h15v13h-15z', 'M4.5 10.5h15', 'M8.5 4v4', 'M15.5 4v4'],
  eyedropper: ['m14.5 4.5 5 5', 'M17 7l-9.5 9.5L5 19l2.5-2.5', 'M12.5 6.5l5 5', 'M7.5 16.5 5 19'],
  upload: ['M12 15.5V4.5', 'm7.5 9 4.5-4.5L16.5 9', 'M4.5 15v4.5h15V15'],
  image: ['M4.5 5.5h15v13h-15z', 'm4.5 16 4.5-4.5 3.5 3.5 2.5-2.5 4.5 4.5', 'M15.2 9.3v.1'],
  file: ['M6.5 3.5h7l4 4v13h-11z', 'M13.5 3.5v4h4'],
  trash: ['M5 7h14', 'M9.5 7V4.5h5V7', 'M7 7l1 12.5h8L17 7'],
  sync: ['M5 12a7 7 0 0 1 12-4.9L19 9', 'M19 4.5V9h-4.5'],
};

export const icon = (name, size = 16, opts = {}) => svgIcon(pickPaths[name] ?? [], { size, ...opts });
