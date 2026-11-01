// <rig-time-picker> — a time field you can type into, with hour and minute
// columns in a popover. Range mode picks a start and an end, such as a
// receiving window, and handles windows that run past midnight.
//
//   <rig-time-picker name="appt" step="15" placeholder="Appointment"></rig-time-picker>
//   <rig-time-picker name="dock" mode="range" min="06:00" max="18:00" step="30"></rig-time-picker>
//   <rig-time-picker name="night" mode="range" value="22:00/06:00" hour-cycle="24"></rig-time-picker>
//
// Typing: "2p", "2:30 pm", "230p", "1430", "14.30", "noon" and "midnight" all
// work. A bare "4" in 12-hour mode keeps the half of the day already chosen;
// for the end of a range it picks the half that makes the shorter window.
// Typed times snap to `step`. ↑/↓ in the field move one step, PageUp/PageDown
// one hour, Alt+↓ opens the columns and moves focus into them.
// On touch screens the field opens the columns without the on-screen keyboard.
//
// Attributes: name, value ("14:30", or "06:00/14:00" in range mode), mode
//   ("single" | "range"), min, max (a window; min after max means overnight,
//   e.g. min="22:00" max="06:00"), step (minutes, a divisor of 60, default 5),
//   hour-cycle ("12" | "24"; default from the locale), locale, placeholder,
//   label, placement, disabled, required, invalid.
// Properties: value, start, end ("HH:MM" or ""), duration (minutes, range),
//   overnight (range ends the next day), isTimeDisabled (("HH:MM") => boolean),
//   open, form, validity, validationMessage.
// Methods: show(part?), close(), clear(), focus().
// Events: input, change ({ detail: { value, start, end, duration, overnight } }),
//   rig-open, rig-close.
// Form: 24-hour "HH:MM", like <input type="time">; a range submits two
//   entries (start, end) under `name`.

import { sound } from '../sound.js';
import { define, h, paths, svgIcon, uid } from '../util.js';
import { FormElement, contain, createPopup, whenParsed } from './shared.js';
import { TimeColumns } from './time-columns.js';
import {
  formatDuration, formatTime, hourCycleFor, inWindow, nearestAllowed, normalizeStep, nowMinutes, parseTimeRange,
  parseTimeValue, parseTypedTime, snapToStep, spanMinutes, stepTime, toTimeValue,
} from './time-logic.js';

const COARSE = '(pointer: coarse)';
export const clockPaths = ['M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z', 'M12 7.5V12l3 2'];

export class RigTimePicker extends FormElement {
  static observedAttributes = ['mode', 'min', 'max', 'step', 'hour-cycle', 'locale', 'placeholder', 'disabled', 'value', 'label'];

  #built = false;
  #start = null;
  #end = null;
  #initial = '';
  #isTimeDisabled = null;
  #part = 'start';
  #bad = { start: '', end: '' };
  #flagged = false;
  #last = '';
  #field;
  #inputs = {};
  #dash;
  #clearBtn;
  #pop;
  #popup;
  #cols;
  #ends;
  #endBtns = {};
  #hint;
  #nowBtn;
  #doneBtn;

  connectedCallback() {
    if (!this.#built) whenParsed(() => this.#build());
    else this._linkLabels(this.#inputs.start);
  }

  disconnectedCallback() {
    this.#popup?.hide({ instant: true });
  }

  attributeChangedCallback(attr, oldValue, newValue) {
    if (!this.#built || oldValue === newValue) return;
    if (attr === 'value') { this.value = newValue ?? ''; return; }
    if (attr === 'disabled') { this._onDisabledChange(this._isDisabled); return; }
    if (attr === 'mode') { this.#close({ focus: false }); this.#start = null; this.#end = null; }
    if (['mode', 'placeholder', 'label'].includes(attr)) this.#layout();
    if (['hour-cycle', 'locale', 'step', 'min', 'max'].includes(attr)) this.#configureColumns();
    this.#sync({ quiet: true });
  }

  get mode() { return this.getAttribute('mode') === 'range' ? 'range' : 'single'; }
  get locale() {
    return this.getAttribute('locale') || this.closest('[lang]')?.getAttribute('lang') || navigator.language || 'en';
  }
  get hourCycle() {
    const attr = this.getAttribute('hour-cycle');
    if (attr === '12' || attr === '24') return Number(attr);
    return hourCycleFor(this.locale);
  }
  get step() { return normalizeStep(this.getAttribute('step')); }
  get #min() { return parseTimeValue(this.getAttribute('min')); }
  get #max() { return parseTimeValue(this.getAttribute('max')); }

  get value() {
    if (this.mode === 'single') return toTimeValue(this.#start);
    return this.#start != null && this.#end != null ? `${toTimeValue(this.#start)}/${toTimeValue(this.#end)}` : '';
  }
  set value(next) {
    if (!this.#built) { this.#initial = next ?? ''; return; }
    this.#setRaw(next ?? '');
    this.#sync({ quiet: true });
  }
  get start() { return toTimeValue(this.#start); }
  get end() { return this.mode === 'range' ? toTimeValue(this.#end) : toTimeValue(this.#start); }
  get duration() { return this.mode === 'range' ? spanMinutes(this.#start, this.#end) : null; }
  get overnight() { return this.mode === 'range' && this.#start != null && this.#end != null && this.#end < this.#start; }
  get isTimeDisabled() { return this.#isTimeDisabled; }
  set isTimeDisabled(fn) {
    this.#isTimeDisabled = typeof fn === 'function' ? fn : null;
    if (this.#built) { this.#configureColumns(); this.#sync({ quiet: true }); }
  }
  get open() { return Boolean(this.#popup?.open); }

  focus(opts) { this.#inputs.start?.focus(opts); }
  show(part) { this.#show(part === 'end' && this.mode === 'range' ? 'end' : 'start'); }
  close() { this.#close(); }
  clear() {
    this.#start = null;
    this.#end = null;
    this.#bad = { start: '', end: '' };
    this.#sync({ quiet: false });
  }

  formResetCallback() {
    this.#bad = { start: '', end: '' };
    this.#setRaw(this.#initial);
    this.#sync({ quiet: true });
  }
  formStateRestoreCallback(state) {
    if (typeof state !== 'string') return;
    this.#setRaw(state);
    this.#sync({ quiet: true });
  }
  _onDisabledChange(disabled) {
    if (!this.#field) return;
    for (const input of Object.values(this.#inputs)) input.disabled = disabled;
    this.#clearBtn.disabled = disabled;
    this.#renderClear();
    if (disabled) this.#close({ focus: false });
  }

  /** Allowed: inside the min/max window and not turned away by isTimeDisabled. */
  #allowed = (t) => inWindow(t, this.#min, this.#max) && !(this.#isTimeDisabled?.(toTimeValue(t)));

  #fmt(t) { return formatTime(t, { locale: this.locale, hourCycle: this.hourCycle }); }

  #build() {
    if (this.#built) return;
    this.#built = true;
    this.classList.add('rig-time-picker');
    const popId = uid('rig-timepick-pop');
    const coarse = window.matchMedia(COARSE).matches;
    const input = (part) => h('input', {
      class: 'rig-timepick__input',
      type: 'text',
      role: 'combobox',
      'aria-haspopup': 'dialog',
      'aria-expanded': 'false',
      'aria-controls': popId,
      'aria-autocomplete': 'none',
      autocomplete: 'off',
      autocapitalize: 'off',
      spellcheck: 'false',
      enterkeyhint: 'done',
      inputmode: coarse ? 'none' : null,
      'data-part': part,
    });
    this.#inputs = { start: input('start'), end: input('end') };
    this.#dash = h('span', { class: 'rig-timepick__dash', 'aria-hidden': 'true' }, '–');
    this.#clearBtn = h('button', { type: 'button', class: 'rig-combo__btn rig-timepick__clear', 'aria-label': 'Clear time', hidden: true },
      svgIcon(paths.close, { size: 14 }));
    this.#field = h('div', { class: 'rig-pick-field rig-timepick__field' },
      svgIcon(clockPaths, { size: 18, className: 'rig-timepick__icon' }),
      this.#inputs.start, this.#dash, this.#inputs.end, this.#clearBtn);

    this.#cols = new TimeColumns({
      hourCycle: this.hourCycle,
      step: this.step,
      locale: this.locale,
      isAllowed: this.#allowed,
      onPick: (t) => {
        this.#bad[this.#part] = '';
        this.#setPart(this.#part, t);
        this.#sync({ quiet: false });
        sound.play('tick');
      },
      onCommit: () => {
        if (this.mode === 'range' && this.#part === 'start' && this.#end == null) {
          this.#switchPart('end');
          this.#cols.focus('hour');
        } else {
          this.#close({ focus: true });
        }
      },
      onEscape: () => this.#close({ focus: true }),
    });

    const endBtn = (part, label) => {
      const b = h('button', { type: 'button', class: 'rig-timepick__end', 'aria-pressed': 'false', 'data-part': part },
        h('span', { class: 'rig-timepick__end-label' }, label), h('span', { class: 'rig-timepick__end-value' }));
      b.addEventListener('click', () => this.#switchPart(part));
      this.#endBtns[part] = b;
      return b;
    };
    this.#ends = h('div', { class: 'rig-timepick__ends', role: 'group', 'aria-label': 'Which end' }, endBtn('start', 'Start'), endBtn('end', 'End'));
    this.#hint = h('span', { class: 'rig-timepick__hint', 'aria-live': 'polite' });
    this.#nowBtn = h('button', { type: 'button', class: 'rig-btn rig-btn--ghost rig-btn--sm' }, 'Now');
    this.#doneBtn = h('button', { type: 'button', class: 'rig-btn rig-btn--accent rig-btn--sm' }, 'Done');
    const foot = h('div', { class: 'rig-timepick__foot' }, this.#hint, h('span', { class: 'rig-timepick__actions' }, this.#nowBtn, this.#doneBtn));
    this.#pop = h('div', { class: 'rig-pick-pop rig-timepick__pop', id: popId, role: 'dialog', 'aria-label': 'Choose a time' },
      this.#ends, this.#cols.el, foot);
    this.append(this.#field, this.#pop);

    this.#popup = createPopup({
      host: this,
      anchor: this.#field,
      panel: this.#pop,
      placement: this.getAttribute('placement') || 'bottom-start',
      onDismiss: (why) => { this.#commitTyped(this.#part); this.#close({ focus: why === 'escape' }); },
    });

    for (const [part, el] of Object.entries(this.#inputs)) {
      contain(el, 'input', 'change', 'select');
      el.addEventListener('input', () => this.#preview(part));
      el.addEventListener('keydown', (e) => this.#onInputKey(e, part));
      // Focusing the field selects its text, so typing replaces the time.
      let fresh = false;
      el.addEventListener('focus', () => {
        if (this.open) this.#switchPart(part);
        // (Not on touch screens, where a selection brings up the copy/paste bar.)
        if (coarse) return;
        fresh = true;
        el.select();
      });
      el.addEventListener('mouseup', (e) => { if (fresh) e.preventDefault(); fresh = false; });
      el.addEventListener('keydown', () => { fresh = false; });
      el.addEventListener('blur', () => this.#commitTyped(part));
    }
    this.#field.addEventListener('click', (e) => {
      if (this._isDisabled || e.target.closest('.rig-timepick__clear')) return;
      const input = e.target.closest('.rig-timepick__input');
      const part = input?.dataset.part ?? this.#part;
      if (!input) this.#inputs[part === 'end' && this.mode === 'range' ? 'end' : 'start'].focus();
      if (this.open) this.#switchPart(part);
      else this.#show(part);
    });
    this.#pop.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      this.#close({ focus: true });
    });
    this.#clearBtn.addEventListener('click', () => {
      this.clear();
      this.#inputs.start.focus();
      sound.play('tick');
    });
    this.#nowBtn.addEventListener('click', () => {
      const t = this.#nowAllowed();
      if (t == null) return;
      this.#bad[this.#part] = '';
      this.#setPart(this.#part, t);
      this.#sync({ quiet: false });
      this.#renderColumns('smooth');
      sound.play('tick');
    });
    this.#doneBtn.addEventListener('click', () => this.#close({ focus: true }));

    this.toggleAttribute('data-twelve', this.hourCycle === 12);
    this.#layout();
    this.#setRaw(this.#initial || this.getAttribute('value') || '');
    this.#sync({ quiet: true });
    this._onDisabledChange(this._isDisabled);
    this._linkLabels(this.#inputs.start);
  }

  #layout() {
    const range = this.mode === 'range';
    this.#inputs.end.hidden = !range;
    this.#dash.hidden = !range;
    this.#ends.hidden = !range;
    const label = this.getAttribute('label');
    const placeholder = this.getAttribute('placeholder');
    if (range) {
      this.#inputs.start.placeholder = 'Start';
      this.#inputs.end.placeholder = 'End';
      this.#inputs.start.setAttribute('aria-label', `${label || 'Time window'}, start`);
      this.#inputs.end.setAttribute('aria-label', `${label || 'Time window'}, end`);
    } else {
      this.#inputs.start.placeholder = placeholder || 'Choose a time';
      if (label) this.#inputs.start.setAttribute('aria-label', label);
      else this.#inputs.start.removeAttribute('aria-label');
    }
    if (!range) this.#part = 'start';
  }

  #configureColumns() {
    this.#cols.configure({ hourCycle: this.hourCycle, step: this.step, locale: this.locale, isAllowed: this.#allowed });
    this.toggleAttribute('data-twelve', this.hourCycle === 12);
    if (this.open) this.#renderColumns('instant');
  }

  #setRaw(raw) {
    const text = String(raw ?? '');
    if (this.mode === 'single') {
      this.#start = parseTimeValue(text.split('/')[0]);
      this.#end = null;
    } else {
      const r = parseTimeRange(text);
      this.#start = r.start;
      this.#end = r.end;
    }
  }

  #setPart(part, t) {
    if (part === 'end' && this.mode === 'range') this.#end = t;
    else this.#start = t;
  }

  #partValue(part) { return part === 'end' && this.mode === 'range' ? this.#end : this.#start; }

  /** Where the columns sit while a part is empty. */
  #seed(part) {
    const own = this.#partValue(part);
    if (own != null) return own;
    const opts = { step: this.step, min: this.#min, max: this.#max, isAllowed: this.#isTimeDisabled ? this.#allowed : null };
    const from = part === 'end' && this.#start != null ? this.#start + 60 : nowMinutes();
    return nearestAllowed(snapToStep(from % 1440, this.step), opts) ?? 540;
  }

  #nowAllowed() {
    const t = snapToStep(nowMinutes(), this.step);
    return this.#allowed(t) ? t : null;
  }

  /** Reads what's typed in a part. Returns minutes, null for empty, or undefined when it can't be read. */
  #readTyped(part) {
    const text = this.#inputs[part].value.trim();
    if (!text) return null;
    const cycle = this.hourCycle;
    const am = parseTypedTime(text, { hourCycle: cycle, prefer: 'am' });
    if (am == null) return undefined;
    const pm = parseTypedTime(text, { hourCycle: cycle, prefer: 'pm' });
    let t = am;
    if (am !== pm) {
      const other = this.mode === 'range' ? this.#partValue(part === 'start' ? 'end' : 'start') : null;
      const own = this.#partValue(part);
      const fits = [am, pm].filter((x) => this.#allowed(snapToStep(x, this.step)));
      if (fits.length === 1) t = fits[0];
      else if (other != null) {
        // The half of the day that makes the shorter window.
        const span = (x) => (part === 'end' ? spanMinutes(other, x) : spanMinutes(x, other)) || 1440;
        t = span(pm) < span(am) ? pm : am;
      } else if (own != null) t = own >= 720 ? pm : am;
    }
    return snapToStep(t, this.step);
  }

  #preview(part) {
    if (!this.open || part !== this.#part) return;
    const t = this.#readTyped(part);
    if (t == null || !this.#allowed(t)) return;
    this.#cols.value = t;
    this.#cols.render();
  }

  #commitTyped(part) {
    const input = this.#inputs[part];
    if (!input || input.hidden) return;
    const current = this.#partValue(part);
    if (input.value === (current == null ? '' : this.#fmt(current)) && !this.#bad[part]) return;
    const t = this.#readTyped(part);
    if (t === undefined) {
      this.#bad[part] = `Enter a time like ${this.hourCycle === 12 ? '2:30 PM' : '14:30'}.`;
    } else if (t != null && !this.#allowed(t)) {
      this.#bad[part] = this.#windowMessage(t);
    } else {
      this.#bad[part] = '';
      this.#setPart(part, t);
    }
    this.#sync({ quiet: false });
    if (this.open) this.#renderColumns('smooth');
  }

  #windowMessage(t = null) {
    const min = this.#min;
    const max = this.#max;
    if (t != null && inWindow(t, min, max)) return `${this.#fmt(t)} isn't available. Choose another time.`;
    if (min != null && max != null) return `Choose a time between ${this.#fmt(min)} and ${this.#fmt(max)}.`;
    if (min != null) return `Choose ${this.#fmt(min)} or later.`;
    if (max != null) return `Choose ${this.#fmt(max)} or earlier.`;
    return 'That time isn\'t available. Choose another.';
  }

  #onInputKey(e, part) {
    const input = this.#inputs[part];
    const opts = { step: this.step, min: this.#min, max: this.#max, isAllowed: this.#isTimeDisabled ? this.#allowed : null, from: this.#seed(part) };
    const nudge = (count) => {
      e.preventDefault();
      const typed = this.#readTyped(part);
      const from = typed == null || typed === undefined ? this.#partValue(part) : typed;
      const t = stepTime(from, from == null ? 1 : count, opts);
      if (t == null) return;
      this.#bad[part] = '';
      this.#setPart(part, t);
      this.#sync({ quiet: false });
      if (this.open) this.#renderColumns('smooth');
      input.select();
    };
    switch (e.key) {
      case 'ArrowDown':
        if (e.altKey) {
          e.preventDefault();
          if (!this.open) this.#show(part);
          this.#cols.focus('hour');
          return;
        }
        nudge(-1);
        return;
      case 'ArrowUp': nudge(1); return;
      case 'PageUp': nudge(60 / this.step); return;
      case 'PageDown': nudge(-60 / this.step); return;
      case 'Enter': {
        const current = this.#partValue(part);
        const changed = input.value !== (current == null ? '' : this.#fmt(current));
        if (changed) this.#commitTyped(part);
        if (changed || this.open) {
          e.preventDefault();
          if (this.mode === 'range' && part === 'start' && !this.#bad.start && this.#end == null) {
            this.#inputs.end.focus();
            if (this.open) this.#switchPart('end');
            return;
          }
          this.#close({ focus: false });
        }
        return;
      }
      case 'Escape': {
        const current = this.#partValue(part);
        const shown = current == null ? '' : this.#fmt(current);
        if (this.open) {
          e.preventDefault();
          e.stopPropagation();
          input.value = shown;
          this.#bad[part] = '';
          this.#close({ focus: false });
          this.#sync({ quiet: true });
        } else if (input.value !== shown || this.#bad[part]) {
          e.preventDefault();
          e.stopPropagation();
          input.value = shown;
          this.#bad[part] = '';
          this.#sync({ quiet: true });
        }
        return;
      }
      default:
    }
  }

  #switchPart(part) {
    const next = part === 'end' && this.mode === 'range' ? 'end' : 'start';
    if (next !== this.#part) this.#commitTyped(this.#part);
    this.#part = next;
    this.#renderEnds();
    this.#renderColumns('instant');
    this.#renderHint();
  }

  #renderColumns(scroll) {
    this.#cols.value = this.#partValue(this.#part);
    this.#cols.seed = this.#seed(this.#part);
    this.#cols.render({ scroll });
    this.#nowBtn.disabled = this.#nowAllowed() == null;
    this.#pop.setAttribute('aria-label', this.mode === 'range' ? `Choose the ${this.#part} time` : 'Choose a time');
  }

  /** Form value, validity, the field's text and the popup's labels, then events. */
  #sync({ quiet }) {
    const before = this.#last;
    const value = this.value;
    const name = this.name;
    if (this.mode === 'range' && this.#start != null && this.#end != null && name) {
      const data = new FormData();
      data.append(name, toTimeValue(this.#start));
      data.append(name, toTimeValue(this.#end));
      this._setForm(data, value);
    } else {
      this._setForm(value || null, value);
    }

    // Field text: typed text that couldn't be read stays put so it can be fixed.
    for (const part of ['start', 'end']) {
      const input = this.#inputs[part];
      if (!input || this.#bad[part]) continue;
      const t = part === 'end' ? this.#end : this.#start;
      input.value = t == null ? '' : this.#fmt(t);
    }

    const bad = this.#bad.start || (this.mode === 'range' ? this.#bad.end : '');
    const badPart = this.#bad.start ? 'start' : 'end';
    const outside = [this.#start, this.mode === 'range' ? this.#end : null].find((t) => t != null && !this.#allowed(t));
    const internals = this._internals;
    if (internals) {
      try {
        if (bad) internals.setValidity({ badInput: true }, bad, this.#inputs[badPart]);
        else if (outside != null) internals.setValidity({ rangeOverflow: true }, this.#windowMessage(outside), this.#inputs.start);
        else if (this.required && !value) {
          internals.setValidity({ valueMissing: true }, this.mode === 'range' ? 'Choose a start and end time.' : 'Choose a time.', this.#inputs.start);
        } else internals.setValidity({});
      } catch { /* not connected yet */ }
    }
    // `invalid` also comes from a failed submit (see FormElement) or the page itself;
    // it clears once the value changes or a typing mistake is fixed.
    if (bad) { this.setAttribute('invalid', ''); this.#flagged = true; }
    else if (this.#flagged || before !== value) { this.removeAttribute('invalid'); this.#flagged = false; }
    for (const part of ['start', 'end']) this.#inputs[part]?.setAttribute('aria-invalid', String(Boolean(this.#bad[part])));

    this.#renderClear();
    this.#renderEnds();
    this.#renderHint();
    this.toggleAttribute('has-value', this.#start != null || this.#end != null);

    this.#last = value;
    if (before !== value && !quiet) {
      this._emit('input');
      this._emit('change', { value, start: this.start, end: this.end, duration: this.duration, overnight: this.overnight });
    }
  }

  #renderClear() {
    if (!this.#clearBtn) return;
    const has = this.#start != null || this.#end != null || Object.values(this.#inputs).some((i) => !i.hidden && i.value);
    this.#clearBtn.hidden = !has || this._isDisabled;
  }

  #renderEnds() {
    if (!this.#ends || this.mode !== 'range') return;
    for (const part of ['start', 'end']) {
      const b = this.#endBtns[part];
      const t = this.#partValue(part);
      b.setAttribute('aria-pressed', String(part === this.#part));
      b.querySelector('.rig-timepick__end-value').textContent = t == null ? '--:--' : this.#fmt(t);
      this.#inputs[part].classList.toggle('is-active', this.open && part === this.#part);
    }
  }

  #renderHint() {
    if (!this.#hint) return;
    let text = '';
    if (this.mode === 'range') {
      if (this.#start != null && this.#end != null) {
        text = `${formatDuration(this.duration)}${this.overnight ? ', ends the next day' : ''}`;
      } else if (this.#start != null) text = 'Now choose the end';
      else text = 'Choose the start';
    } else {
      const min = this.#min;
      const max = this.#max;
      if (min != null && max != null) text = `${this.#fmt(min)} to ${this.#fmt(max)}`;
      else if (min != null) text = `From ${this.#fmt(min)}`;
      else if (max != null) text = `Until ${this.#fmt(max)}`;
    }
    this.#hint.textContent = text;
  }

  #show(part = 'start') {
    if (this.open || this._isDisabled) return;
    this.#part = part === 'end' && this.mode === 'range' ? 'end' : 'start';
    this.#popup.show();
    for (const input of Object.values(this.#inputs)) input.setAttribute('aria-expanded', 'true');
    this.setAttribute('open', '');
    this.#renderEnds();
    this.#renderHint();
    this.#renderColumns('instant');
    this.#popup.reposition();
    sound.play('open');
    this._emit('rig-open');
  }

  #close({ focus = false } = {}) {
    if (!this.open) return;
    this.#popup.hide();
    for (const input of Object.values(this.#inputs)) input.setAttribute('aria-expanded', 'false');
    this.removeAttribute('open');
    this.#renderEnds();
    if (focus) this.#inputs[this.#part].focus({ preventScroll: true });
    this._emit('rig-close');
  }
}

define('rig-time-picker', RigTimePicker);
