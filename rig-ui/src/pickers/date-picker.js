// <rig-date-picker> — a field that opens a <rig-calendar> in a popover.
//
//   <rig-date-picker name="delivery" placeholder="Pick a delivery date" min="2026-11-01"></rig-date-picker>
//   <rig-date-picker name="window" mode="range" placeholder="Delivery window"></rig-date-picker>
//
//   <rig-date-picker name="pickup" time="08:00" time-step="15"></rig-date-picker>
//
// The text is formatted with Intl for `locale` ("Nov 3, 2026", or a range
// like "Nov 3 – 6, 2026"). A clear button appears once there's a value.
//
// Date and time: add `time` to put a <rig-time-picker> under the calendar.
// The value becomes "2026-11-03T14:30", like <input type="datetime-local">,
// and is only complete once both halves are chosen. `time="08:00"` fills in
// that time as soon as a date is picked. Time works in single mode only.
//
// Attributes: name, value ("2026-11-03" or "2026-11-03/2026-11-06", or
//   "2026-11-03T14:30" with `time`), mode ("single" | "range"), min, max,
//   week-start, locale, placeholder, label, months ("1" keeps a range to one
//   month; otherwise ranges show two months side by side on screens 48rem and
//   wider), time, time-step, time-min, time-max, hour-cycle, disabled,
//   required, invalid.
// Properties: value, start, end, date, time ("HH:MM" or ""), isDateDisabled
//   ((iso) => boolean), open, calendar (the inner <rig-calendar>),
//   timePicker (the inner <rig-time-picker>, with `time`), form, validity.
// Methods: show(), close(), clear(), focus().
// Events: input, change ({ detail: { value, start, end } }), rig-open, rig-close.
// Form: ISO "yyyy-mm-dd" (or "yyyy-mm-ddThh:mm" with `time`); a range submits
//   two entries (start, end) under `name`.
//
// Keyboard: Enter/Space/↓ on the field opens the calendar with focus on the
// selected day (see <rig-calendar> for grid keys); Esc closes and returns focus.
//
// Deliberate limit: dates are picked, not typed. Pair it with a text field if
// people need to type dates.

import { sound } from '../sound.js';
import { define, h, paths, svgIcon, uid } from '../util.js';
import { parseISO, parseRange, rangeDays, utcDate } from './date-grid.js';
import './calendar.js';
import { FormElement, contain, createPopup, icon, whenParsed } from './shared.js';
import { formatTime, hourCycleFor, parseTimeValue, toTimeValue } from './time-logic.js';
import './time-picker.js';

const WIDE = '(min-width: 48rem)';

export class RigDatePicker extends FormElement {
  static observedAttributes = ['mode', 'min', 'max', 'week-start', 'locale', 'placeholder', 'disabled', 'value', 'label',
    'time', 'time-step', 'time-min', 'time-max', 'hour-cycle'];

  #built = false;
  #start = '';
  #end = '';
  #initial = '';
  #isDateDisabled = null;
  #trigger;
  #text;
  #clearBtn;
  #pop;
  #popup;
  #cal;
  #hint;
  #todayBtn;
  #time = null;
  #timeRow;
  #timePicker;
  #doneBtn;
  #closeTimer = 0;

  connectedCallback() {
    if (!this.#built) whenParsed(() => this.#build());
    else this._linkLabels(this.#trigger);
  }

  disconnectedCallback() {
    this.#popup?.hide({ instant: true });
  }

  attributeChangedCallback(attr, oldValue, newValue) {
    if (!this.#built || oldValue === newValue) return;
    if (attr === 'value') { this.value = newValue ?? ''; return; }
    if (attr === 'disabled') { this._onDisabledChange(this._isDisabled); return; }
    if (['time', 'time-step', 'time-min', 'time-max', 'hour-cycle', 'locale', 'mode'].includes(attr)) this.#syncTimeField();
    if (['mode', 'min', 'max', 'week-start', 'locale'].includes(attr)) {
      if (newValue == null) this.#cal.removeAttribute(attr);
      else this.#cal.setAttribute(attr, newValue);
      if (attr === 'mode') { this.#start = ''; this.#end = ''; }
    }
    this.#renderText();
  }

  get mode() { return this.getAttribute('mode') === 'range' ? 'range' : 'single'; }
  get #hasTime() { return this.hasAttribute('time') && this.mode === 'single'; }
  get #hourCycle() {
    const attr = this.getAttribute('hour-cycle');
    return attr === '12' || attr === '24' ? Number(attr) : hourCycleFor(this.locale);
  }
  get locale() {
    return this.getAttribute('locale') || this.closest('[lang]')?.getAttribute('lang') || navigator.language || 'en';
  }
  get value() {
    if (this.#hasTime) return this.#start && this.#time != null ? `${this.#start}T${toTimeValue(this.#time)}` : '';
    if (this.mode === 'single') return this.#start;
    return this.#start && this.#end ? `${this.#start}/${this.#end}` : '';
  }
  set value(next) {
    if (!this.#built) { this.#initial = next ?? ''; return; }
    this.#setValue(next ?? '', { quiet: true });
  }
  get start() { return this.#start; }
  get end() { return this.mode === 'range' ? this.#end : this.#start; }
  get isDateDisabled() { return this.#isDateDisabled; }
  set isDateDisabled(fn) {
    this.#isDateDisabled = typeof fn === 'function' ? fn : null;
    if (this.#cal) this.#cal.isDateDisabled = this.#isDateDisabled;
  }
  get calendar() { return this.#cal; }
  get timePicker() { return this.#timePicker ?? null; }
  get date() { return this.#start; }
  get time() { return this.#hasTime ? toTimeValue(this.#time) : ''; }
  get open() { return Boolean(this.#popup?.open); }

  focus(opts) { this.#trigger?.focus(opts); }
  show() { this.#show(); }
  close() { this.#close(); }
  clear() { this.#time = null; this.#setValue('', { quiet: false }); }

  formResetCallback() { this.#setValue(this.#initial, { quiet: true }); }
  formStateRestoreCallback(state) { if (typeof state === 'string') this.#setValue(state, { quiet: true }); }
  _onDisabledChange(disabled) {
    if (!this.#trigger) return;
    this.#trigger.disabled = disabled;
    this.#clearBtn.disabled = disabled;
    if (this.#timePicker) this.#timePicker.disabled = disabled;
    this.#renderText();
    if (disabled) this.#close({ focus: false });
  }

  #build() {
    if (this.#built) return;
    this.#built = true;
    this.classList.add('rig-date-picker');
    const popId = uid('rig-datepick-pop');
    this.#text = h('span', { class: 'rig-datepick__text' });
    this.#trigger = h('button', {
      type: 'button',
      class: 'rig-pick-field rig-datepick__trigger',
      'aria-haspopup': 'dialog',
      'aria-expanded': 'false',
      'aria-controls': popId,
    }, icon('calendar', 18, { className: 'rig-datepick__icon' }), this.#text);
    this.#clearBtn = h('button', { type: 'button', class: 'rig-combo__btn rig-datepick__clear', 'aria-label': 'Clear date', hidden: true },
      svgIcon(paths.close, { size: 14 }));

    this.#cal = document.createElement('rig-calendar');
    for (const attr of ['mode', 'min', 'max', 'week-start', 'locale']) {
      const v = this.getAttribute(attr);
      if (v != null) this.#cal.setAttribute(attr, v);
    }
    if (this.#isDateDisabled) this.#cal.isDateDisabled = this.#isDateDisabled;
    this.#hint = h('span', { class: 'rig-datepick__hint', 'aria-live': 'polite' });
    this.#todayBtn = h('button', { type: 'button', class: 'rig-btn rig-btn--ghost rig-btn--sm' }, 'Today');
    const foot = h('div', { class: 'rig-datepick__foot' }, this.#hint, this.#todayBtn);
    this.#timeRow = h('div', { class: 'rig-datepick__time', hidden: true });
    this.#pop = h('div', {
      class: 'rig-pick-pop rig-datepick__pop',
      id: popId,
      role: 'dialog',
      'aria-label': this.mode === 'range' ? 'Choose dates' : 'Choose a date',
    }, this.#cal, foot, this.#timeRow);
    this.append(h('div', { class: 'rig-datepick__wrap' }, this.#trigger, this.#clearBtn), this.#pop);

    this.#popup = createPopup({
      host: this,
      anchor: this.#trigger,
      panel: this.#pop,
      placement: this.getAttribute('placement') || 'bottom-start',
      onDismiss: (why) => this.#close({ focus: why === 'escape' }),
    });

    contain(this.#cal, 'input', 'change', 'monthchange');
    this.#cal.addEventListener('input', () => {
      if (this.#hasTime) {
        // Keep the popup open for the time; a preset time fills in right away.
        if (this.#time == null) this.#time = parseTimeValue(this.getAttribute('time'));
        this.#setValue(this.#cal.start, { quiet: false, keepTime: true });
      } else if (this.mode === 'single') {
        this.#setValue(this.#cal.start, { quiet: false });
        this.#closeSoon();
      } else if (this.#cal.end) {
        this.#setValue(`${this.#cal.start}/${this.#cal.end}`, { quiet: false });
        this.#closeSoon();
      }
      this.#renderHint();
    });

    this.#trigger.addEventListener('click', () => {
      if (this._isDisabled) return;
      if (this.open) this.#close(); else this.#show();
    });
    this.#trigger.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' && !this.open) { e.preventDefault(); this.#show(); }
    });
    this.#pop.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.#close({ focus: true });
      }
    });
    this.#clearBtn.addEventListener('click', () => {
      this.#setValue('', { quiet: false });
      this.#trigger.focus();
      sound.play('tick');
    });
    this.#todayBtn.addEventListener('click', () => {
      const now = new Date();
      const iso = `${String(now.getFullYear()).padStart(4, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      this.#cal.focusDate(iso);
    });

    this.#syncTimeField();
    this.#setValue(this.#initial || this.getAttribute('value') || '', { quiet: true });
    this._onDisabledChange(this._isDisabled);
    this._linkLabels(this.#trigger);
  }

  /** Create, configure or hide the time field under the calendar. */
  #syncTimeField() {
    if (!this.#timeRow) return;
    const on = this.#hasTime;
    this.#timeRow.hidden = !on;
    if (!on) { this.#timePicker?.close(); return; }
    if (!this.#timePicker) {
      const tp = document.createElement('rig-time-picker');
      tp.setAttribute('label', 'Time');
      tp.setAttribute('placement', 'top-start');
      this.#timePicker = tp;
      this.#doneBtn = h('button', { type: 'button', class: 'rig-btn rig-btn--accent rig-btn--sm' }, 'Done');
      this.#doneBtn.addEventListener('click', () => this.#close({ focus: true }));
      this.#timeRow.append(h('span', { class: 'rig-datepick__time-label', 'aria-hidden': 'true' }, 'Time'), tp, this.#doneBtn);
      contain(tp, 'input', 'change', 'rig-open', 'rig-close');
      tp.addEventListener('change', () => {
        this.#time = parseTimeValue(tp.value);
        this.#setValue(this.#start, { quiet: false, keepTime: true });
        this.#renderHint();
      });
    }
    const tp = this.#timePicker;
    const pass = { step: 'time-step', min: 'time-min', max: 'time-max', 'hour-cycle': 'hour-cycle', locale: 'locale' };
    for (const [to, from] of Object.entries(pass)) {
      const v = this.getAttribute(from);
      if (v == null) tp.removeAttribute(to); else tp.setAttribute(to, v);
    }
    if (this.getAttribute('time-step') == null) tp.setAttribute('step', '15');
    tp.setAttribute('placeholder', 'Add a time');
  }

  #setValue(raw, { quiet, keepTime = false }) {
    const before = this.value;
    if (this.#hasTime) {
      const [day = '', clock = ''] = String(raw).split(/[T ]/);
      this.#start = parseISO(day.split('/')[0]) ?? '';
      if (!keepTime) this.#time = parseTimeValue(clock);
      if (!this.#start && !keepTime) this.#time = null;
      this.#end = '';
      if (this.#timePicker) this.#timePicker.value = toTimeValue(this.#time);
    } else if (this.mode === 'single') {
      this.#start = parseISO(String(raw).split('/')[0]) ?? '';
      this.#end = '';
    } else {
      const r = parseRange(raw);
      this.#start = r.start && r.end ? r.start : '';
      this.#end = r.start && r.end ? r.end : '';
    }
    if (this.#cal) this.#cal.value = this.#hasTime ? this.#start : this.value;
    const name = this.name;
    if (this.mode === 'range' && this.#start && name) {
      const data = new FormData();
      data.append(name, this.#start);
      data.append(name, this.#end);
      this._setForm(data, this.value);
    } else if (this.#hasTime) {
      this._setForm(this.value || null, this.value);
    } else {
      this._setForm(this.#start || null, this.value);
    }
    const missing = this.#hasTime ? 'Choose a date and time.' : this.mode === 'range' ? 'Choose a start and end date.' : 'Choose a date.';
    this._setValidity(this.required && !this.value, missing, this.#trigger);
    this.#renderText();
    if (before !== this.value) {
      this.removeAttribute('invalid');
      if (!quiet) {
        this._emit('input');
        this._emit('change', { value: this.value, start: this.#start, end: this.end });
      }
    }
  }

  #format() {
    if (!this.#start) return '';
    if (this.#hasTime && this.#time != null) {
      const [y, m, d] = this.#start.split('-').map(Number);
      const at = new Date(Date.UTC(y, m - 1, d, Math.floor(this.#time / 60), this.#time % 60));
      const cycle = this.#hourCycle === 12 ? 'h12' : 'h23';
      const opts = { dateStyle: 'medium', timeStyle: 'short', hourCycle: cycle, timeZone: 'UTC' };
      try { return new Intl.DateTimeFormat(this.locale, opts).format(at); } catch { /* fall through */ }
      return `${this.#start} ${formatTime(this.#time, { locale: this.locale, hourCycle: this.#hourCycle })}`;
    }
    const opts = { dateStyle: 'medium', timeZone: 'UTC' };
    let f;
    try { f = new Intl.DateTimeFormat(this.locale, opts); } catch { f = new Intl.DateTimeFormat('en', opts); }
    if (this.mode === 'single' || !this.#end) return f.format(utcDate(this.#start));
    if (typeof f.formatRange === 'function') return f.formatRange(utcDate(this.#start), utcDate(this.#end));
    return `${f.format(utcDate(this.#start))} – ${f.format(utcDate(this.#end))}`;
  }

  #renderText() {
    if (!this.#text) return;
    const text = this.#format();
    const placeholder = this.getAttribute('placeholder')
      || (this.#hasTime ? 'Choose a date and time' : this.mode === 'range' ? 'Choose dates' : 'Choose a date');
    this.#text.textContent = text || placeholder;
    if (this.#hasTime && text && this.#time == null) {
      this.#text.append(h('span', { class: 'rig-datepick__missing' }, ', no time yet'));
    }
    this.#trigger.classList.toggle('is-placeholder', !text);
    this.#clearBtn.hidden = !text || this._isDisabled;
    this.toggleAttribute('has-value', Boolean(text));
    const label = this.getAttribute('label');
    if (label) this.#trigger.setAttribute('aria-label', `${label}: ${text || placeholder}`);
    this.#pop?.setAttribute('aria-label', this.#hasTime ? 'Choose a date and time' : this.mode === 'range' ? 'Choose dates' : 'Choose a date');
    // With a time row, the calendar's own today marker is enough.
    this.#todayBtn.hidden = this.mode === 'range' || this.#hasTime;
  }

  #renderHint() {
    if (this.#hasTime) {
      this.#hint.textContent = this.#start && this.#time == null ? 'Now set a time' : '';
      return;
    }
    if (this.mode !== 'range') { this.#hint.textContent = ''; return; }
    const cal = this.#cal;
    if (cal.start && !cal.end) this.#hint.textContent = 'Now pick the last day';
    else if (cal.start && cal.end) {
      const n = rangeDays(cal.start, cal.end);
      this.#hint.textContent = `${n} day${n === 1 ? '' : 's'}`;
    } else this.#hint.textContent = 'Pick the first day';
  }

  #closeSoon() {
    clearTimeout(this.#closeTimer);
    this.#closeTimer = setTimeout(() => this.#close({ focus: true }), 160);
  }

  #show() {
    if (this.open || this._isDisabled) return;
    clearTimeout(this.#closeTimer);
    // Ranges get two months side by side when the screen has room for them.
    const two = this.mode === 'range' && this.getAttribute('months') !== '1' && window.matchMedia(WIDE).matches;
    if (two) this.#cal.setAttribute('months', '2');
    else this.#cal.removeAttribute('months');
    this.#cal.value = this.#hasTime ? this.#start : this.value;
    this.#popup.show();
    this.#trigger.setAttribute('aria-expanded', 'true');
    this.setAttribute('open', '');
    this.#renderHint();
    this.#cal.focusDate();
    this.#popup.reposition();
    sound.play('open');
    this._emit('rig-open');
  }

  #close({ focus = false } = {}) {
    clearTimeout(this.#closeTimer);
    if (!this.open) return;
    this.#timePicker?.close();
    this.#popup.hide();
    this.#trigger.setAttribute('aria-expanded', 'false');
    this.removeAttribute('open');
    // A half-picked range is abandoned.
    const calValue = this.#hasTime ? this.#start : this.value;
    if (this.#cal.value !== calValue) this.#cal.value = calValue;
    if (focus) this.#trigger.focus({ preventScroll: true });
    this._emit('rig-close');
  }
}

define('rig-date-picker', RigDatePicker);
