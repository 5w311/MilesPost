// <rig-switch> — an on/off switch that submits like a checkbox.
//
//   <rig-switch name="hazmat" label="Hazmat placards" description="Required for this load"></rig-switch>
//   <rig-switch name="share" label="Share location with dispatch" checked label-position="start"></rig-switch>
//
// Form-associated: when on it submits `value` (default "on") under `name`;
// when off it submits nothing. The thumb stretches while pressed and springs
// across when released. You can also drag it (mouse or touch). Space or
// Enter toggles, and so does clicking the label text. In right-to-left
// layouts (nearest dir) "on" is at the left and drags follow the screen.
//
// Attributes: name, value, checked (current state; the initial one is what a
//   form reset returns to), label, description, required, disabled,
//   label-position ("end" | "start": label first, switch pushed to the end),
//   invalid (reflected while an error shows).
// Properties: checked, value, form, validity, label, toggle(), setError(msg),
//   setCustomValidity(msg), checkValidity(), reportValidity(), focus().
// Events: input, change (bubbling, from the host).

import { springDriver, springs } from '../motion.js';
import { sound } from '../sound.js';
import { define, h } from '../util.js';
import { validityMessage } from './field-logic.js';
import { ensureId, addDescribedBy, isRtl } from './field.js';
import { RigFormControl } from './face.js';

const STRETCH = 0.32; // extra thumb width while pressed, as a share of its size

class RigSwitch extends RigFormControl {
  static observedAttributes = ['checked', 'disabled', 'label', 'description', 'required', 'value'];

  #built = false;
  #track;
  #thumb;
  #labelEl;
  #desc = null;
  #driver;
  #checked = false;
  #initial = false;
  #reflecting = false;
  #geom = { travel: 0, base: 0 };
  #press = null;
  #suppressClickUntil = 0;
  #spaceDown = false;
  #rtl = false;

  connectedCallback() {
    if (this.#built) return;
    this.#built = true;
    this.classList.add('rig-switch');
    this.#checked = this.#initial = this.hasAttribute('checked');

    const leftovers = [...this.childNodes];
    this.#labelEl = h('span', { class: 'rig-switch__label' });
    if (this.hasAttribute('label')) this.#labelEl.textContent = this.getAttribute('label');
    else this.#labelEl.append(...leftovers);
    const descText = this.getAttribute('description');
    if (descText) this.#desc = h('span', { class: 'rig-switch__desc' }, descText);

    this.#thumb = h('span', { class: 'rig-switch__thumb', 'aria-hidden': 'true' });
    this.#track = h('span', {
      class: 'rig-switch__track',
      role: 'switch',
      tabindex: '0',
      'aria-labelledby': ensureId(this.#labelEl, 'rig-switch-label'),
    }, this.#thumb);
    if (this.#desc) addDescribedBy(this.#track, ensureId(this.#desc, 'rig-desc'));
    this.replaceChildren(h('span', { class: 'rig-switch__row' },
      this.#track,
      h('span', { class: 'rig-switch__text' }, this.#labelEl, this.#desc)));

    this.#driver = springDriver([0, 0], springs.lively, ([x, s]) => this.#render(x, s));
    new ResizeObserver(() => this.#measure()).observe(this.#track);
    this.#wire();
    this.#apply({ quiet: true });
    this._disabledChanged();
  }

  attributeChangedCallback(attr, oldValue, newValue) {
    if (!this.#built || this.#reflecting) return;
    if (attr === 'checked') this.#set(newValue !== null, { user: false });
    if (attr === 'disabled') this._disabledChanged();
    if (attr === 'label') this.#labelEl.textContent = newValue ?? '';
    if (attr === 'description' && this.#desc) this.#desc.textContent = newValue ?? '';
    if (attr === 'required' || attr === 'value') this.#apply({ quiet: true });
  }

  get checked() { return this.#checked; }
  set checked(v) { this.#set(Boolean(v), { user: false }); }
  get value() { return this.getAttribute('value') ?? 'on'; }
  set value(v) { this.setAttribute('value', v); }
  get label() { return this.#labelEl?.textContent.trim() || this.getAttribute('label') || ''; }

  toggle(force) {
    this.#set(force === undefined ? !this.#checked : Boolean(force), { user: false });
  }

  formResetCallback() { this.#set(this.#initial, { user: false }); }
  formStateRestoreCallback(state) { this.#set(state === 'on', { user: false }); }

  _focusTarget() { return this.#track; }
  _describeTargets() { return [this.#track]; }
  _disabledChanged() {
    if (!this.#track) return;
    const off = this.disabled;
    this.#track.tabIndex = off ? -1 : 0;
    if (off) this.#track.setAttribute('aria-disabled', 'true');
    else this.#track.removeAttribute('aria-disabled');
    this.classList.toggle('is-disabled', off);
  }

  #set(next, { user }) {
    if (next === this.#checked && !user) {
      this.#apply({ quiet: true });
      return;
    }
    this.#checked = next;
    this.#apply({ quiet: !user });
  }

  #apply({ quiet }) {
    const on = this.#checked;
    this.#track.setAttribute('aria-checked', String(on));
    this.classList.toggle('is-on', on);
    this.#reflecting = true;
    this.toggleAttribute('checked', on);
    this.#reflecting = false;
    this._setFormValue(on ? this.value : null, on ? 'on' : 'off');
    if (this.required && !on) {
      this._setValidity({ valueMissing: true }, validityMessage({ valueMissing: true }, { kind: 'switch' }));
    } else {
      this._setValidity({});
    }
    if (!this.#press) {
      this.#rtl = isRtl(this);
      this.#driver.to([on ? this.#geom.travel : 0, 0]);
    }
    if (!quiet) {
      sound.play('toggle', { on });
      this._emit('change');
    }
  }

  #measure() {
    if (this.#press) return;
    const thumb = this.#thumb;
    thumb.style.width = '';
    this.#rtl = isRtl(this);
    const base = thumb.offsetWidth;
    // offsetLeft ignores transforms; in RTL the resting gap is on the right.
    const pad = this.#rtl ? this.#track.clientWidth - thumb.offsetLeft - base : thumb.offsetLeft;
    const travel = Math.max(0, this.#track.clientWidth - base - pad * 2);
    if (!base) return;
    this.#geom = { travel, base };
    this.#driver.to([this.#checked ? travel : 0, 0], { immediate: true });
  }

  #render(x, s) {
    const { travel, base } = this.#geom;
    if (!base) return;
    const p = travel ? Math.min(1, Math.max(0, x / travel)) : 0;
    const stretch = Math.max(0, s);
    this.#thumb.style.width = `${(base + stretch).toFixed(2)}px`;
    // Grow toward the middle of the track: inward from whichever end it rests
    // at. The thumb is anchored at the inline start, so RTL travels leftward.
    const along = x - stretch * p;
    this.#thumb.style.transform = `translateX(${(this.#rtl ? -along : along).toFixed(2)}px)`;
  }

  #stretch(on) {
    const [x] = this.#driver.value;
    this.#driver.to([this.#press?.x ?? x, on ? this.#geom.base * STRETCH : 0]);
  }

  #wire() {
    const track = this.#track;

    track.addEventListener('pointerdown', (e) => {
      if (this.disabled || e.button !== 0) return;
      this.#rtl = isRtl(this);
      const [x] = this.#driver.value;
      this.#press = { id: e.pointerId, startX: e.clientX, from: this.#checked ? this.#geom.travel : 0, x, moved: false };
      try { track.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
      this.#stretch(true);
    });
    track.addEventListener('pointermove', (e) => {
      const press = this.#press;
      if (!press || e.pointerId !== press.id) return;
      const dx = (e.clientX - press.startX) * (this.#rtl ? -1 : 1);
      if (!press.moved && Math.abs(dx) < 5) return;
      press.moved = true;
      press.x = Math.min(this.#geom.travel, Math.max(0, press.from + dx));
      this.#driver.to([press.x, this.#geom.base * STRETCH], { immediate: true });
    });
    const release = (e, cancelled) => {
      const press = this.#press;
      if (!press || (e && e.pointerId !== press.id)) return;
      this.#press = null;
      if (press.moved && !cancelled) {
        // A drag decides by where the thumb was let go. A mouse still fires a
        // click after it (ignored); a touch drag doesn't, so this expires.
        this.#suppressClickUntil = performance.now() + 400;
        const next = press.x > this.#geom.travel / 2;
        if (next !== this.#checked) {
          this.#checked = next;
          this.#apply({ quiet: false });
          return;
        }
      }
      this.#driver.to([this.#checked ? this.#geom.travel : 0, 0]);
    };
    track.addEventListener('pointerup', (e) => release(e, false));
    track.addEventListener('pointercancel', (e) => release(e, true));
    track.addEventListener('lostpointercapture', (e) => release(e, false));

    this.addEventListener('click', (e) => {
      if (this.disabled || !e.target.closest('.rig-switch__row')) return;
      if (performance.now() < this.#suppressClickUntil) { this.#suppressClickUntil = 0; return; }
      if (!track.contains(e.target)) track.focus({ preventScroll: true });
      this.#checked = !this.#checked;
      this.#apply({ quiet: false });
    });

    track.addEventListener('keydown', (e) => {
      if (this.disabled) return;
      if (e.key === ' ') {
        e.preventDefault();
        if (!e.repeat && !this.#spaceDown) { this.#spaceDown = true; this.#stretch(true); }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        this.#checked = !this.#checked;
        this.#apply({ quiet: false });
      }
    });
    track.addEventListener('keyup', (e) => {
      if (e.key !== ' ' || !this.#spaceDown) return;
      this.#spaceDown = false;
      this.#checked = !this.#checked;
      this.#apply({ quiet: false });
    });
    track.addEventListener('blur', () => {
      if (this.#spaceDown) { this.#spaceDown = false; this.#stretch(false); }
    });
  }
}

define('rig-switch', RigSwitch);
export { RigSwitch };
