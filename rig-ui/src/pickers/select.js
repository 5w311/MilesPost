// <rig-select> — a single-choice dropdown.
//
//   <label for="trailer">Trailer</label>
//   <rig-select id="trailer" name="trailer" placeholder="Choose a trailer" required>
//     <optgroup label="Enclosed">
//       <option value="dry53" selected>53′ dry van</option>
//       <option value="reefer" data-hint="−20 °F">Reefer</option>
//     </optgroup>
//     <option value="flat" disabled>Flatbed</option>
//   </rig-select>
//
// Options come from child <option>/<optgroup> elements or the `options`
// property ([{ value, label, group, hint, disabled }] or strings).
//
// Attributes: name, value, placeholder, disabled, required, label (accessible
//   name when there's no <label for>), placement ("bottom-start"), invalid.
// Properties: value, options, selectedOption, open, form, validity.
// Methods: show(), close(), focus(), checkValidity(), reportValidity().
// Events: input, change (value committed), rig-open, rig-close.
//
// Keyboard (WAI-ARIA select-only combobox): ↓/↑/Enter/Space open; ↑↓ move,
// Home/End, PageUp/PageDown, type letters to jump, Enter/Space choose, Esc closes.

import { sound } from '../sound.js';
import { define, h } from '../util.js';
import { Picklist, normalizeItems, readOptions } from './listbox.js';
import { FormElement, createPopup, icon, whenParsed } from './shared.js';

export class RigSelect extends FormElement {
  static observedAttributes = ['placeholder', 'disabled', 'label', 'value'];

  #built = false;
  #items = [];
  #value = '';
  #initial = '';
  #trigger;
  #valueEl;
  #pop;
  #popup;
  #list;
  #keyAt = 0;

  connectedCallback() {
    if (!this.#built) whenParsed(() => this.#build());
    else this._linkLabels(this.#trigger, this.#list?.el);
  }

  disconnectedCallback() {
    this.#popup?.hide({ instant: true });
  }

  attributeChangedCallback(attr, oldValue, newValue) {
    if (!this.#built || oldValue === newValue) return;
    if (attr === 'value') this.value = newValue ?? '';
    else if (attr === 'disabled') this._onDisabledChange(this._isDisabled);
    else this.#renderValue();
  }

  get value() { return this.#value; }
  set value(next) {
    const v = next == null ? '' : String(next);
    if (!this.#built) { this.#initial = v; return; }
    this.#setValue(this.#items.some((i) => i.value === v) ? v : '', { quiet: true });
  }

  get options() { return this.#items.slice(); }
  set options(list) {
    this.#items = normalizeItems(list);
    if (!this.#built) return;
    this.#list.render(this.#items.map((item) => ({ item })));
    if (!this.#items.some((i) => i.value === this.#value)) this.#setValue('', { quiet: true });
    else this.#sync();
  }

  get selectedOption() { return this.#items.find((i) => i.value === this.#value) ?? null; }
  get open() { return Boolean(this.#popup?.open); }

  focus(opts) { this.#trigger?.focus(opts); }
  show() { this.#show(); }
  close() { this.#close(); }

  formResetCallback() { this.#setValue(this.#initial, { quiet: true }); }
  formStateRestoreCallback(state) { if (typeof state === 'string') this.#setValue(state, { quiet: true }); }
  _onDisabledChange(disabled) {
    if (!this.#trigger) return;
    this.#trigger.disabled = disabled;
    if (disabled) this.#close({ focus: false });
  }

  #build() {
    if (this.#built) return;
    this.#built = true;
    this.classList.add('rig-select');
    const declared = readOptions(this);
    if (!this.#items.length) this.#items = normalizeItems(declared.items);
    const attrValue = this.getAttribute('value');
    this.#initial = this.#initial || attrValue || declared.selected[0] || '';

    this.#list = new Picklist({
      label: this.getAttribute('label') || 'Options',
      onPick: (item) => this.#commit(item),
      onActive: (entry) => {
        if (entry && this.open) this.#trigger.setAttribute('aria-activedescendant', entry.el.id);
        else this.#trigger.removeAttribute('aria-activedescendant');
      },
    });
    this.#valueEl = h('span', { class: 'rig-select__value' });
    this.#trigger = h('button', {
      type: 'button',
      class: 'rig-pick-field rig-select__trigger',
      role: 'combobox',
      'aria-haspopup': 'listbox',
      'aria-expanded': 'false',
      'aria-controls': this.#list.id,
      'aria-label': this.getAttribute('label'),
    }, this.#valueEl, icon('chevronUpDown', 16, { className: 'rig-pick-field__chevron' }));
    this.#pop = h('div', { class: 'rig-pick-pop rig-select__pop' }, this.#list.el);
    this.append(this.#trigger, this.#pop);

    this.#popup = createPopup({
      host: this,
      anchor: this.#trigger,
      panel: this.#pop,
      placement: this.getAttribute('placement') || 'bottom-start',
      matchWidth: true,
      onDismiss: (why) => this.#close({ focus: why !== 'blur' && why !== 'outside' }),
    });

    this.#trigger.addEventListener('click', () => {
      // Enter/Space are handled on keydown; ignore the click they synthesize.
      if (performance.now() - this.#keyAt < 400) return;
      if (this._isDisabled) return;
      if (this.open) this.#close(); else this.#show();
    });
    this.#trigger.addEventListener('keydown', (e) => this.#onKey(e));

    this.#list.render(this.#items.map((item) => ({ item })));
    this.#value = '';
    this.#setValue(this.#initial, { quiet: true });
    this._onDisabledChange(this._isDisabled);
    this._linkLabels(this.#trigger, this.#list?.el);
  }

  #renderValue() {
    if (!this.#valueEl) return;
    const item = this.selectedOption;
    this.#valueEl.textContent = item ? item.label : (this.getAttribute('placeholder') || 'Choose an option');
    this.#trigger.classList.toggle('is-placeholder', !item);
    if (this.hasAttribute('label')) this.#trigger.setAttribute('aria-label', this.getAttribute('label'));
  }

  #sync() {
    this.#list.setSelected(this.#value ? [this.#value] : []);
    this.#renderValue();
    this._setForm(this.#value || null, this.#value);
    this._setValidity(this.required && !this.#value, 'Choose an option from the list.', this.#trigger);
  }

  #setValue(value, { quiet = false } = {}) {
    const next = this.#items.some((i) => i.value === value) ? value : '';
    const changed = next !== this.#value;
    this.#value = next;
    this.#sync();
    if (changed) this.removeAttribute('invalid');
    if (changed && !quiet) {
      this._emit('input');
      this._emit('change');
    }
    return changed;
  }

  #commit(item) {
    if (!item || this.#list.isDisabled(item)) return;
    const changed = this.#setValue(item.value);
    sound.play(changed ? 'tap' : 'tick');
    this.#close();
  }

  #show() {
    if (this.open || this._isDisabled) return;
    this.#popup.show();
    this.#trigger.setAttribute('aria-expanded', 'true');
    this.setAttribute('open', '');
    const index = this.#list.indexOf(this.#value);
    this.#list.setActive(index !== -1 ? index : this.#list.edge('first'), { scroll: false, instant: true });
    this.#list.reveal({ scroll: 'center' });
    sound.play('open');
    this._emit('rig-open');
  }

  #close({ focus = true } = {}) {
    if (!this.open) return;
    this.#popup.hide();
    this.#trigger.setAttribute('aria-expanded', 'false');
    this.#trigger.removeAttribute('aria-activedescendant');
    this.removeAttribute('open');
    // Focus normally never leaves the trigger; put it back if it wandered into the popup.
    const active = document.activeElement;
    if (focus && active !== this.#trigger && (this.contains(active) || active === document.body)) this.#trigger.focus({ preventScroll: true });
    this._emit('rig-close');
  }

  #onKey(e) {
    if (this._isDisabled) return;
    const open = this.open;
    const list = this.#list;
    const key = e.key;
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { this.#show(); return; }
      if (key === 'ArrowUp' && e.altKey) { this.#commit(list.activeEntry?.item); return; }
      list.move(key === 'ArrowDown' ? 1 : -1);
      sound.play('tick', { step: -6 });
    } else if (key === 'Home' || key === 'End') {
      e.preventDefault();
      if (!open) this.#show();
      list.edge(key === 'Home' ? 'first' : 'last');
    } else if (key === 'PageUp' || key === 'PageDown') {
      if (!open) return;
      e.preventDefault();
      list.page(key === 'PageDown' ? 1 : -1);
    } else if (key === 'Enter' || key === ' ') {
      if (key === ' ' && open && list.typing) { e.preventDefault(); list.typeahead(' '); return; }
      e.preventDefault();
      this.#keyAt = performance.now();
      if (!open) this.#show();
      else this.#commit(list.activeEntry?.item);
    } else if (key === 'Escape') {
      if (!open) return;
      e.preventDefault();
      e.stopPropagation();
      this.#close();
    } else if (key === 'Tab') {
      if (open) this.#close({ focus: false });
    } else if (key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      if (!open) this.#show();
      list.typeahead(key);
    }
  }
}

define('rig-select', RigSelect);
