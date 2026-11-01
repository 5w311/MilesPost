// Shared base for <rig-input> and <rig-textarea>: label, description, the
// inline error, the character counter and self-validation when the field is
// used outside <rig-form>. Subclasses build the box and call _assemble().

import { counterState } from './field-logic.js';
import { controlMessage, ensureId, errorNode, inRigForm, renderError, springVars, takeSlot, addDescribedBy } from './field.js';
import { h } from '../util.js';

export class RigTextField extends HTMLElement {
  static observedAttributes = ['label', 'description'];

  _built = false;
  #control = null;
  #labelText = null;
  #labelEl = null;
  #desc = null;
  #foot = null;
  #error = null;
  #count = null;
  #live = null;
  #checking = null;
  #override = '';
  #level = 'ok';
  #touched = false;

  get control() { return this.#control; }
  get label() { return this.getAttribute('label') || this.#control?.getAttribute('aria-label') || ''; }
  get value() { return this.#control?.value ?? ''; }
  set value(v) {
    if (!this.#control) return;
    this.#control.value = v ?? '';
    this._sync();
  }
  /** Message from a slot="error" child: used whenever native validation fails. */
  get errorOverride() { return this.#override; }
  get error() { return this.#error && !this.#error.hidden ? this.#error.textContent : ''; }

  focus(options) { this.#control?.focus(options); }

  /** Show (or clear with '') the inline message. Called by <rig-form>. */
  setError(message) {
    if (!this.#error) return;
    renderError(this.#error, message, [this.#control]);
    this.toggleAttribute('invalid', Boolean(message));
    this.#syncFoot();
  }

  /**
   * Quiet "Checking…" state while an async validator runs (called by
   * <rig-form>). It sits inside the field box, so it never shifts the layout.
   */
  setChecking(on) {
    if (!this.#control) return;
    if (!this.#checking) {
      this.#checking = h('span', { class: 'rig-field__checking', hidden: true },
        h('span', { class: 'rig-spinner', 'aria-hidden': 'true' }), h('span', {}, 'Checking…'));
      this.#control.after(this.#checking);
    }
    this.#checking.hidden = !on;
    this.toggleAttribute('checking', Boolean(on));
  }

  /** Validate now and show the result. Returns true when valid. */
  validate() {
    this.#touched = true;
    const msg = controlMessage(this.#control, { label: this.label, override: this.#override });
    this.setError(msg);
    return !msg;
  }

  attributeChangedCallback(attr) {
    if (!this._built) return;
    if (attr === 'label' && this.#labelText) this.#labelText.textContent = this.getAttribute('label') || '';
    if (attr === 'description' && this.#desc) this.#desc.textContent = this.getAttribute('description') || '';
  }

  /** Build label/description/foot around `box` (which already holds `control`). */
  _assemble(control, box) {
    this._built = true;
    this.#control = control;
    springVars(this);
    const id = ensureId(control, `${this.localName}-control`);

    const errorSlot = takeSlot(this, 'error');
    this.#override = errorSlot ? errorSlot.textContent.trim() : '';
    const descSlot = takeSlot(this, 'description');

    const labelAttr = this.getAttribute('label');
    if (labelAttr != null) {
      this.#labelText = h('span', {}, labelAttr);
      this.#labelEl = h('label', { class: 'rig-field__label', for: id }, this.#labelText,
        control.required ? h('span', { class: 'rig-field__req', 'aria-hidden': 'true' }, '*') : null);
    }
    const descText = this.getAttribute('description');
    if (descSlot || descText) {
      this.#desc = descSlot ?? h('p', {}, descText);
      this.#desc.classList.add('rig-field__desc');
      addDescribedBy(control, ensureId(this.#desc, 'rig-desc'));
    }

    this.#error = errorNode();
    if (this.hasAttribute('counter')) {
      this.#count = h('span', { class: 'rig-field__count', 'aria-hidden': 'true' });
      this.#live = h('span', { class: 'rig-visually-hidden', 'aria-live': 'polite' });
    }
    this.#foot = h('div', { class: 'rig-field__foot' }, this.#error, this.#count, this.#live);

    this.replaceChildren(...[this.#labelEl, this.#desc, box, this.#foot].filter(Boolean));

    control.addEventListener('input', () => this._sync());
    control.addEventListener('change', () => this._sync());
    control.addEventListener('focusout', (e) => {
      if (this.contains(e.relatedTarget)) return; // moving to our own clear/reveal button
      this.#touched = true;
      if (!inRigForm(this)) this.validate();
    });
    control.addEventListener('input', () => {
      if (!inRigForm(this) && this.error) this.validate();
    });
    // Native validation (a plain <form> without novalidate): show our message
    // instead of the browser bubble, and focus the first invalid field.
    control.addEventListener('invalid', (e) => {
      if (inRigForm(this)) return;
      e.preventDefault();
      this.validate();
      const form = control.form;
      const first = form && [...form.elements].find((el) => el.willValidate && !el.validity.valid);
      if (first === control) {
        control.focus({ preventScroll: true });
        this.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    });
    control.form?.addEventListener('reset', () => {
      this.#touched = false;
      requestAnimationFrame(() => { this.setError(''); this._sync(); });
    });
    this._sync();
  }

  /** Re-read the value: counter, has-value state, subclass extras. */
  _sync() {
    const control = this.#control;
    if (!control) return;
    this.classList.toggle('has-value', control.value.length > 0);
    if (this.#count) {
      const max = control.maxLength > 0 ? control.maxLength : 0;
      const state = counterState(control.value.length, max);
      this.#count.textContent = state.text;
      this.#count.dataset.level = state.level;
      // Speak only when crossing into the warning zone, at the limit, or over it.
      if (state.level !== this.#level || (state.remaining === 0 && this.#live.textContent !== state.spoken)) {
        this.#live.textContent = state.level === 'ok' ? '' : state.spoken;
      }
      this.#level = state.level;
    }
    this.#syncFoot();
  }

  #syncFoot() {
    if (this.#foot) this.#foot.hidden = !this.#count && this.#error.hidden;
  }
}
