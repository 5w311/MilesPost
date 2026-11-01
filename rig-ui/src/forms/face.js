// Base class for the form-associated controls in this folder (<rig-switch>,
// <rig-slider>, <rig-toggle-group>, <rig-filter-chips>): ElementInternals,
// name/form/validity plumbing that mirrors native inputs, setCustomValidity,
// and the inline error message. Subclasses call the underscore methods.

import { errorNode, renderError } from './field.js';

export class RigFormControl extends HTMLElement {
  static formAssociated = true;

  #internals = null;
  #custom = '';
  #flags = {};
  #message = '';
  #formDisabled = false;
  #error = null;

  constructor() {
    super();
    try { this.#internals = this.attachInternals(); } catch { this.#internals = null; }
  }

  get form() { return this.#internals?.form ?? null; }
  get name() { return this.getAttribute('name') ?? ''; }
  set name(v) { this.setAttribute('name', v); }
  get type() { return this.localName; }
  get labels() { return this.#internals?.labels ?? []; }
  get disabled() { return this.hasAttribute('disabled') || this.#formDisabled; }
  set disabled(v) { this.toggleAttribute('disabled', Boolean(v)); }
  get required() { return this.hasAttribute('required'); }
  set required(v) { this.toggleAttribute('required', Boolean(v)); }
  get validity() { return this.#internals?.validity ?? { valid: true }; }
  get validationMessage() { return this.#internals?.validationMessage ?? ''; }
  get willValidate() { return this.#internals?.willValidate ?? false; }
  /** Text of the visible label, used in messages and error summaries. */
  get label() { return this.getAttribute('label') || this.getAttribute('aria-label') || ''; }

  checkValidity() { return this.#internals ? this.#internals.checkValidity() : true; }
  reportValidity() {
    const ok = this.checkValidity();
    this.setError(ok ? '' : this.validationMessage);
    if (!ok) this.focus();
    return ok;
  }
  setCustomValidity(message) {
    this.#custom = String(message || '');
    this._refreshValidity();
  }

  /** Show (or clear with '') the inline message under the control. */
  setError(message) {
    if (!this.#error) {
      this.#error = errorNode();
      this.append(this.#error);
    }
    renderError(this.#error, message, this._describeTargets());
    this.toggleAttribute('invalid', Boolean(message));
  }
  get error() { return this.#error && !this.#error.hidden ? this.#error.textContent : ''; }

  focus(options) {
    const target = this._focusTarget();
    if (target && target !== this) target.focus(options);
    else HTMLElement.prototype.focus.call(this, options);
  }

  formDisabledCallback(disabled) {
    this.#formDisabled = disabled;
    this._disabledChanged?.();
  }

  // ---- for subclasses ----

  /** Elements that should carry aria-describedby / aria-invalid. */
  _describeTargets() { return []; }
  /** Element that receives focus. */
  _focusTarget() { return null; }

  _setFormValue(value, state) {
    this.#internals?.setFormValue(value, state ?? value);
  }

  /** Report the control's own constraint state (valueMissing etc.). */
  _setValidity(flags = {}, message = '') {
    this.#flags = flags;
    this.#message = message;
    this._refreshValidity();
  }

  _refreshValidity() {
    if (!this.#internals) return;
    const anchor = this._focusTarget() ?? undefined;
    const anchorOk = anchor && this.contains(anchor) ? anchor : undefined;
    if (this.#custom) {
      this.#internals.setValidity({ customError: true }, this.#custom, anchorOk);
    } else if (Object.values(this.#flags).some(Boolean)) {
      this.#internals.setValidity(this.#flags, this.#message || 'Check this field.', anchorOk);
    } else {
      this.#internals.setValidity({});
    }
  }

  _emit(type = 'change') {
    this.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    if (type === 'change') this.dispatchEvent(new Event('change', { bubbles: true }));
    // Outside <rig-form>, keep a visible message in step with the value.
    if (this.error && !this.closest('rig-form')) this.setError(this.checkValidity() ? '' : this.validationMessage);
  }
}
