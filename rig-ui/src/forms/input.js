// <rig-input> — a labelled text field around a real <input>.
//
//   <rig-input label="Trailer number" description="On the nose of the trailer" prefix="#" clearable counter>
//     <input name="trailer" required maxlength="8" inputmode="numeric" pattern="[0-9]{5,8}">
//     <span slot="error">Trailer numbers are 5 to 8 digits.</span>
//   </rig-input>
//
// The <input> stays the form control, so submission, autofill and screen
// readers behave natively. If there's no child input, one is created from the
// host's type/name/placeholder/required attributes.
//
// Attributes: label, description, size ("sm" | "md" | "lg"), prefix, suffix,
//   clearable (clear button; Esc clears too), counter (shows length/maxlength),
//   invalid (reflected while an error shows).
// Slots (children with slot="..."): prefix, suffix (text or <rig-icon>),
//   description, error (message used whenever native validation fails).
// type="password" inputs get a show/hide toggle.
// Properties: control (the <input>), value, error, errorOverride,
//   setError(message), setChecking(on) (quiet "Checking…" line, used by
//   <rig-form> async validators), validate(), focus().
// Right-to-left: prefix, suffix and the clear/reveal buttons mirror with the
//   nearest dir (all spacing uses logical properties).
// Events: native input/change from the inner <input>.
// Outside <rig-form> it validates itself on blur; inside, the form does.

import { define, h, uid } from '../util.js';
import { ensureId, addDescribedBy } from './field.js';
import { RigTextField } from './text-field.js';

const NS = 'http://www.w3.org/2000/svg';

function eyeIcon() {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'rig-input__eye');
  const add = (d, cls) => {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    if (cls) {
      p.setAttribute('class', cls);
      p.setAttribute('pathLength', '1');
    }
    svg.append(p);
  };
  add('M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z');
  add('M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'rig-input__pupil');
  add('M4 4l16 16', 'rig-input__slash');
  return svg;
}

function clearIcon() {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.2');
  svg.setAttribute('stroke-linecap', 'round');
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', 'M8 8l8 8M16 8l-8 8');
  svg.append(p);
  return svg;
}

class RigInput extends RigTextField {
  static observedAttributes = ['label', 'description', 'prefix', 'suffix'];

  #input;
  #clear = null;
  #reveal = null;
  #prefix = null;
  #suffix = null;

  connectedCallback() {
    if (this._built) return;
    this.classList.add('rig-field', 'rig-input');

    let input = this.querySelector('input');
    if (!input) {
      input = h('input', {
        type: this.getAttribute('type') || 'text',
        name: this.getAttribute('name'),
        placeholder: this.getAttribute('placeholder'),
        autocomplete: this.getAttribute('autocomplete'),
        value: this.getAttribute('value'),
        required: this.hasAttribute('required'),
      });
    }
    this.#input = input;
    input.classList.add('rig-input__control');
    if (!this.getAttribute('label') && this.getAttribute('aria-label')) input.setAttribute('aria-label', this.getAttribute('aria-label'));

    this.#prefix = this.#affix('prefix');
    this.#suffix = this.#affix('suffix');

    if (this.hasAttribute('clearable')) {
      this.#clear = h('button', {
        class: 'rig-input__btn rig-input__clear',
        type: 'button',
        tabindex: '-1',
        'aria-label': 'Clear',
        hidden: true,
        onclick: () => this.clear(),
      }, clearIcon());
    }
    if (input.type === 'password') {
      this.#reveal = h('button', {
        class: 'rig-input__btn rig-input__reveal',
        type: 'button',
        'aria-label': 'Show password',
        'aria-pressed': 'false',
        'aria-controls': ensureId(input, 'rig-input-control'),
        onclick: () => this.#toggleReveal(),
      }, eyeIcon());
      // Mouse clicks leave focus (and the caret) in the field.
      this.#reveal.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && document.activeElement === input) e.preventDefault();
      });
    }

    const box = h('div', { class: 'rig-input__box' }, this.#prefix, input, this.#clear, this.#reveal, this.#suffix);
    // Clicking the frame (padding, affixes) focuses the input.
    box.addEventListener('pointerdown', (e) => {
      if (e.target === input || e.target.closest('button') || input.disabled) return;
      e.preventDefault();
      input.focus();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.#clear && input.value && !input.readOnly) {
        e.preventDefault();
        e.stopPropagation();
        this.clear();
      }
    });

    this._assemble(input, box);
    if (this.#clear && this.getAttribute('label')) this.#clear.setAttribute('aria-label', `Clear ${this.getAttribute('label')}`);
  }

  attributeChangedCallback(attr, oldValue, newValue) {
    super.attributeChangedCallback(attr);
    if (!this._built) return;
    if (attr === 'prefix' && this.#prefix) this.#prefix.textContent = newValue ?? '';
    if (attr === 'suffix' && this.#suffix) this.#suffix.textContent = newValue ?? '';
  }

  /** Empty the field (fires input and change, keeps focus in the field). */
  clear() {
    const input = this.#input;
    if (!input || input.disabled || input.readOnly) return;
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.focus();
  }

  _sync() {
    super._sync();
    if (this.#clear) this.#clear.hidden = !this.#input.value || this.#input.disabled || this.#input.readOnly;
  }

  #affix(side) {
    const slotted = this.querySelector(`:scope > [slot="${side}"]`);
    const text = this.getAttribute(side);
    if (!slotted && !text) return null;
    const el = h('span', { class: `rig-input__affix rig-input__affix--${side}`, id: uid(`rig-${side}`) });
    if (slotted) {
      slotted.removeAttribute('slot');
      el.append(slotted);
    } else {
      el.textContent = text;
    }
    // Text affixes ("$", "gal") are part of what the value means.
    if (el.textContent.trim()) addDescribedBy(this.#input, el.id);
    else el.setAttribute('aria-hidden', 'true');
    return el;
  }

  #toggleReveal() {
    const input = this.#input;
    const show = input.type === 'password';
    const start = input.selectionStart;
    const end = input.selectionEnd;
    input.type = show ? 'text' : 'password';
    try { if (start != null) input.setSelectionRange(start, end); } catch { /* type without selection */ }
    this.#reveal.setAttribute('aria-pressed', String(show));
    this.#reveal.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  }
}

define('rig-input', RigInput);
export { RigInput };
