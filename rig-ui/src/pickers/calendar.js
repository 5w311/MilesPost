// <rig-calendar> — a month grid for picking a day or a range.
//
//   <rig-calendar mode="range" months="2" min="2026-11-01" week-start="1" name="window"></rig-calendar>
//   cal.isDateDisabled = (iso) => new Date(iso).getUTCDay() === 0 // no Sunday deliveries
//
// Days are ISO strings ("2026-11-03"); all math is in ./date-grid.js, so time
// zones and daylight saving never move a day. Month and weekday names come
// from Intl for `locale`.
//
// Click a month's heading to zoom out to a grid of months, and again for a
// decade of years; picking zooms back in. With months="2" two months sit side
// by side (stacking when the calendar is narrower than about 35rem).
//
// Attributes: mode ("single" | "range"), months (1 | 2), value ("2026-11-03"
//   or "2026-11-03/2026-11-06"), min, max, week-start (0 = Sunday … 6;
//   default from the locale), locale, name, disabled, required.
// Properties: value, start, end, month ("yyyy-mm" of the first month shown),
//   view ("days" | "months" | "years"), isDateDisabled ((iso) => boolean),
//   form, validity.
// Methods: focusDate(iso?), showMonth(iso), focus().
// Events: input (every pick, including the first day of a range),
//   change ({ detail: { value, start, end } } when a day or full range is
//   chosen), monthchange ({ detail: { month } }).
// Form: single submits "yyyy-mm-dd"; range submits two entries (start, end)
//   under `name`.
//
// Keyboard (WAI-ARIA grid): days — arrows by day/week, Home/End to the
// week's ends, PageUp/PageDown by month, Shift+PageUp/PageDown by year;
// months and years — arrows, Home/End along a row, PageUp/PageDown by year
// or decade, Esc back to the days. Enter/Space picks.
//
// Deliberate limits: at most two months side by side; days are picked, not
// typed (pair it with a text field if people need to type dates).

import { animate, reducedMotion, springs } from '../motion.js';
import { sound } from '../sound.js';
import { define, h, paths, svgIcon, uid } from '../util.js';
import {
  addDays, addMonths, addYears, clampISO, endOfWeek, makeISO, monthAvailable, monthDiff, monthGrid, orderRange,
  parseISO, parseRange, shiftWindow, startOfMonth, startOfWeek, toParts, todayISO, utcDate, weekdayOrder,
  withMonth, yearAvailable, yearPage,
} from './date-grid.js';
import { FormElement, whenParsed } from './shared.js';

const formatters = new Map();
function fmt(locale, opts) {
  const key = `${locale}|${JSON.stringify(opts)}`;
  let f = formatters.get(key);
  if (!f) {
    try { f = new Intl.DateTimeFormat(locale, { ...opts, timeZone: 'UTC' }); } catch { f = new Intl.DateTimeFormat('en', { ...opts, timeZone: 'UTC' }); }
    formatters.set(key, f);
  }
  return f;
}

/** First day of the week for a locale (0 = Sunday), from Intl when the engine knows it. */
export function localeWeekStart(locale) {
  try {
    const loc = new Intl.Locale(locale);
    const info = typeof loc.getWeekInfo === 'function' ? loc.getWeekInfo() : loc.weekInfo;
    if (info?.firstDay) return info.firstDay % 7;
  } catch { /* unknown locale */ }
  return 0;
}

const NAV_LABELS = {
  days: ['Previous month', 'Next month'],
  months: ['Previous year', 'Next year'],
  years: ['Previous decade', 'Next decade'],
};

export class RigCalendar extends FormElement {
  static observedAttributes = ['mode', 'months', 'value', 'min', 'max', 'week-start', 'locale', 'disabled'];

  #built = false;
  #start = '';
  #end = '';
  #initial = '';
  #focus = '';
  #month = ''; // first month shown in the days view
  #view = 'days';
  #hover = '';
  #isDateDisabled = null;
  #prev;
  #next;
  #stage;
  #live;
  #sheet = null;
  #cells = new Map(); // days view: iso -> { td, btn }
  #units = new Map(); // months/years view: key -> btn
  #daysHeight = 0;

  connectedCallback() {
    if (!this.#built) whenParsed(() => this.#build());
  }

  attributeChangedCallback(attr, oldValue, newValue) {
    if (!this.#built || oldValue === newValue) return;
    if (attr === 'value') { this.value = newValue ?? ''; return; }
    if (attr === 'disabled') { this._onDisabledChange(this._isDisabled); return; }
    if (attr === 'mode') { this.#start = ''; this.#end = ''; this.#sync(); }
    this.#focus = clampISO(this.#focus, this.min, this.max);
    this.#month = shiftWindow(this.#month || this.#focus, this.#focus, this.months);
    this.style.setProperty('--rig-cal-months', String(this.months));
    this.#render();
  }

  get mode() { return this.getAttribute('mode') === 'range' ? 'range' : 'single'; }
  get months() { return parseInt(this.getAttribute('months') ?? '1', 10) === 2 ? 2 : 1; }
  get min() { return parseISO(this.getAttribute('min')) ?? ''; }
  get max() { return parseISO(this.getAttribute('max')) ?? ''; }
  get locale() {
    return this.getAttribute('locale') || this.closest('[lang]')?.getAttribute('lang') || navigator.language || 'en';
  }
  get weekStart() {
    const attr = this.getAttribute('week-start');
    const n = parseInt(attr ?? '', 10);
    return n >= 0 && n <= 6 ? n : localeWeekStart(this.locale);
  }

  get value() {
    if (this.mode === 'single') return this.#start;
    return this.#start ? (this.#end ? `${this.#start}/${this.#end}` : this.#start) : '';
  }
  set value(next) {
    if (!this.#built) { this.#initial = next ?? ''; return; }
    this.#setValue(next ?? '');
    this.#view = 'days';
    this.#render();
  }
  get start() { return this.#start; }
  get end() { return this.mode === 'range' ? this.#end : this.#start; }
  get month() { return this.#month.slice(0, 7); }
  get view() { return this.#view; }
  get isDateDisabled() { return this.#isDateDisabled; }
  set isDateDisabled(fn) {
    this.#isDateDisabled = typeof fn === 'function' ? fn : null;
    if (this.#built) this.#paint();
  }

  focus(opts) { this.focusDate(undefined, opts); }

  /** Show the days view and focus a day (default: the selection, else today). */
  focusDate(iso, opts = {}) {
    if (!this.#built) this.#build();
    const target = clampISO(parseISO(iso) ?? (this.#start || todayISO()), this.min, this.max);
    if (this.#view !== 'days') {
      this.#view = 'days';
      this.#focus = target;
      this.#month = shiftWindow(this.#month || target, target, this.months);
      this.#render();
    }
    this.#moveFocus(target, { focus: true, slide: false, ...opts });
  }

  /** Show the month containing `iso` without moving focus into the grid. */
  showMonth(iso) {
    const day = parseISO(iso);
    if (!day) return;
    this.#view = 'days';
    this.#moveFocus(clampISO(day, this.min, this.max), { focus: false });
  }

  formResetCallback() {
    this.#setValue(this.#initial);
    this.#view = 'days';
    this.#render();
  }
  formStateRestoreCallback(state) {
    if (typeof state === 'string') { this.#setValue(state); this.#render(); }
  }
  _onDisabledChange(disabled) {
    if (!this.#built) return;
    this.toggleAttribute('aria-disabled', disabled);
    this.#updateNav();
    if (this.#view === 'days') this.#paint();
    else this.#render();
  }

  #build() {
    if (this.#built) return;
    this.#built = true;
    this.classList.add('rig-calendar');
    this.style.setProperty('--rig-cal-months', String(this.months));
    this.#prev = h('button', { type: 'button', class: 'rig-cal__nav rig-cal__nav--prev', 'aria-label': 'Previous month' }, svgIcon(paths.chevronLeft, { size: 18 }));
    this.#next = h('button', { type: 'button', class: 'rig-cal__nav rig-cal__nav--next', 'aria-label': 'Next month' }, svgIcon(paths.chevronRight, { size: 18 }));
    this.#stage = h('div', { class: 'rig-cal__view' });
    this.#live = h('div', { class: 'rig-visually-hidden', 'aria-live': 'polite' });
    this.replaceChildren(this.#prev, this.#next, this.#stage, this.#live);

    this.#prev.addEventListener('click', () => this.#step(-1));
    this.#next.addEventListener('click', () => this.#step(1));
    this.#stage.addEventListener('keydown', (e) => this.#onKey(e));
    this.#stage.addEventListener('click', (e) => {
      if (this._isDisabled || !this.#sheet) return;
      const target = e.target.closest('button');
      if (!target || !this.#sheet.contains(target)) return;
      if (target.classList.contains('rig-cal__day')) this.#pick(target.dataset.date, { viaPointer: true });
      else if (target.classList.contains('rig-cal__unit')) this.#pickUnit(target);
      else if (target.classList.contains('rig-cal__title')) this.#zoomOut(target.dataset.month);
    });
    this.#stage.addEventListener('pointerover', (e) => {
      const btn = e.target.closest('.rig-cal__day');
      if (!btn || e.pointerType === 'touch' || !this.#rangePending()) return;
      if (this.#hover !== btn.dataset.date) { this.#hover = btn.dataset.date; this.#paint(); }
    });
    this.#stage.addEventListener('pointerleave', () => {
      if (!this.#hover) return;
      this.#hover = this.contains(document.activeElement) && this.#rangePending() ? this.#focus : '';
      this.#paint();
    });

    this.#setValue(this.#initial || this.getAttribute('value') || '');
    this.#focus = clampISO(this.#start || todayISO(), this.min, this.max);
    this.#month = shiftWindow(this.#focus, this.#focus, this.months);
    this.#render();
    this._onDisabledChange(this._isDisabled);
    // Two months stack on narrow widths, which changes the days' height.
    new ResizeObserver(() => this.#holdHeight()).observe(this);
  }

  #rangePending() {
    return this.mode === 'range' && this.#start && !this.#end;
  }

  #setValue(raw) {
    if (this.mode === 'single') {
      this.#start = parseISO(String(raw).split('/')[0]) ?? '';
      this.#end = '';
    } else {
      const r = parseRange(raw);
      this.#start = r.start;
      this.#end = r.end;
    }
    this.#hover = '';
    if (this.#start) {
      this.#focus = clampISO(this.#start, this.min, this.max);
      this.#month = shiftWindow(this.#month || this.#focus, this.#focus, this.months);
    }
    this.#sync();
  }

  #sync() {
    const name = this.name;
    const anchor = this.#sheet?.querySelector('[tabindex="0"]') ?? undefined;
    if (this.mode === 'range') {
      if (this.#start && this.#end && name) {
        const data = new FormData();
        data.append(name, this.#start);
        data.append(name, this.#end);
        this._setForm(data, this.value);
      } else {
        this._setForm(null, this.value);
      }
      this._setValidity(this.required && !(this.#start && this.#end), 'Choose a start and end date.', anchor);
    } else {
      this._setForm(this.#start || null, this.#start);
      this._setValidity(this.required && !this.#start, 'Choose a date.', anchor);
    }
  }

  #disabledDay(iso) {
    if (this._isDisabled) return true;
    if (this.min && iso < this.min) return true;
    if (this.max && iso > this.max) return true;
    try { return Boolean(this.#isDateDisabled?.(iso)); } catch { return false; }
  }

  #updateNav() {
    const { min, max } = this;
    const minYear = min ? toParts(min).y : -Infinity;
    const maxYear = max ? toParts(max).y : Infinity;
    const year = toParts(this.#focus).y;
    let before = false;
    let after = false;
    if (this.#view === 'days') {
      before = Boolean(min && monthDiff(min, addMonths(this.#month, -1)) < 0);
      after = Boolean(max && monthDiff(addMonths(this.#month, this.months), max) < 0);
    } else if (this.#view === 'months') {
      before = year - 1 < minYear;
      after = year + 1 > maxYear;
    } else {
      const page = yearPage(year);
      before = page.start - 1 < minYear;
      after = page.end + 1 > maxYear;
    }
    const [prevLabel, nextLabel] = NAV_LABELS[this.#view];
    this.#prev.setAttribute('aria-label', prevLabel);
    this.#next.setAttribute('aria-label', nextLabel);
    this.#prev.disabled = this._isDisabled || before;
    this.#next.disabled = this._isDisabled || after;
  }

  /* ---------- building sheets ---------- */

  #render({ dir = 0, zoom = 0, origin = null } = {}) {
    let sheet;
    if (this.#view === 'months') sheet = this.#buildMonths();
    else if (this.#view === 'years') sheet = this.#buildYears();
    else sheet = this.#buildDays();
    this.#swap(sheet, { dir, zoom, origin });
    this.#updateNav();
    if (this.#view === 'days') {
      this.#paint();
      this.#holdHeight();
    }
  }

  /** Months and years fill the same height as the days, so zooming never jumps. */
  #holdHeight() {
    const days = this.#sheet?.dataset.view === 'days' ? this.#sheet : null;
    const ht = days?.offsetHeight ?? 0;
    if (ht && ht !== this.#daysHeight) {
      this.#daysHeight = ht;
      this.#stage.style.minHeight = `${ht}px`;
    }
  }

  #titleButton(text, label, month) {
    return h('button', { type: 'button', class: 'rig-cal__title', 'aria-label': label, 'data-month': month },
      h('span', { class: 'rig-cal__title-text' }, text),
      svgIcon(['m7 10 5 5 5-5'], { size: 14, stroke: 2.2, className: 'rig-cal__title-chev' }));
  }

  #buildDays() {
    const locale = this.locale;
    const ws = this.weekStart;
    const count = this.months;
    const long = fmt(locale, { weekday: 'long' });
    const short = fmt(locale, { weekday: 'short' });
    const dayLabel = fmt(locale, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    const monthTitle = fmt(locale, { month: 'long', year: 'numeric' });
    // 2023-01-01 was a Sunday: weekday i is 2023-01-0(1+i).
    const ref = (i) => utcDate(`2023-01-0${1 + i}`);
    const cells = new Map();
    const sheet = h('div', { class: 'rig-cal__sheet', 'data-view': 'days' });
    const titles = [];
    for (let k = 0; k < count; k++) {
      const first = addMonths(this.#month, k);
      const { y, m } = toParts(first);
      const grid = monthGrid(y, m, ws);
      const title = monthTitle.format(utcDate(first));
      titles.push(title);
      const head = h('tr', {}, ...weekdayOrder(ws).map((i) => h('th', { scope: 'col', abbr: long.format(ref(i)) }, short.format(ref(i)).replace(/\.$/, '').slice(0, 3))));
      const body = h('tbody');
      for (const week of grid.weeks) {
        const tr = h('tr');
        for (const day of week) {
          // With two months, neighbouring days belong to the other pane.
          if (!day.inMonth && count > 1) {
            tr.append(h('td', { class: 'rig-cal__cell is-outside is-blank', role: 'gridcell' }));
            continue;
          }
          const btn = h('button', {
            type: 'button',
            class: 'rig-cal__day',
            tabindex: '-1',
            'data-date': day.iso,
            'aria-label': dayLabel.format(utcDate(day.iso)),
          }, String(day.day));
          const td = h('td', { class: 'rig-cal__cell', role: 'gridcell', 'aria-selected': 'false' }, btn);
          if (!day.inMonth) td.classList.add('is-outside');
          tr.append(td);
          cells.set(day.iso, { td, btn });
        }
        body.append(tr);
      }
      const table = h('table', {
        class: 'rig-cal__grid',
        role: 'grid',
        'aria-label': title,
        'aria-multiselectable': this.mode === 'range' ? 'true' : null,
      }, h('thead', {}, head), body);
      sheet.append(h('div', { class: 'rig-cal__pane' }, this.#titleButton(title, `${title}. Choose a month`, first), table));
    }
    this.#cells = cells;
    this.#units = new Map();
    this.#announce(titles.join(' and '));
    return sheet;
  }

  #buildMonths() {
    const locale = this.locale;
    const { y } = toParts(this.#focus);
    const { min, max } = this;
    const today = todayISO();
    const shortName = fmt(locale, { month: 'short' });
    const longName = fmt(locale, { month: 'long', year: 'numeric' });
    const yearText = fmt(locale, { year: 'numeric' }).format(utcDate(makeISO(y, 1, 1)));
    const chosen = new Set([this.#start, this.#end].filter(Boolean).map((d) => d.slice(0, 7)));
    const units = new Map();
    const grid = h('div', { class: 'rig-cal__units', role: 'grid', 'aria-label': yearText });
    for (let row = 0; row < 4; row++) {
      const tr = h('div', { class: 'rig-cal__units-row', role: 'row' });
      for (let col = 0; col < 3; col++) {
        const m = row * 3 + col + 1;
        const first = makeISO(y, m, 1);
        const key = first.slice(0, 7);
        const btn = h('button', {
          type: 'button', class: 'rig-cal__unit', tabindex: '-1', 'data-key': key,
          'aria-label': longName.format(utcDate(first)),
        }, shortName.format(utcDate(first)).replace(/\.$/, ''));
        if (!monthAvailable(y, m, min, max) || this._isDisabled) btn.setAttribute('aria-disabled', 'true');
        if (key === today.slice(0, 7)) { btn.classList.add('is-today'); btn.setAttribute('aria-current', 'date'); }
        if (chosen.has(key)) btn.classList.add('is-selected');
        units.set(key, btn);
        tr.append(h('div', { class: 'rig-cal__units-cell', role: 'gridcell', 'aria-selected': String(chosen.has(key)) }, btn));
      }
      grid.append(tr);
    }
    const sheet = h('div', { class: 'rig-cal__sheet', 'data-view': 'months' },
      h('div', { class: 'rig-cal__pane' }, this.#titleButton(yearText, `${yearText}. Choose a year`, this.#focus), grid));
    this.#cells = new Map();
    this.#units = units;
    this.#syncUnitFocus();
    this.#announce(`${yearText}, choose a month`);
    return sheet;
  }

  #buildYears() {
    const locale = this.locale;
    const { y } = toParts(this.#focus);
    const page = yearPage(y);
    const { min, max } = this;
    const yearName = fmt(locale, { year: 'numeric' });
    const thisYear = toParts(todayISO()).y;
    const chosen = new Set([this.#start, this.#end].filter(Boolean).map((d) => toParts(d).y));
    const units = new Map();
    const grid = h('div', { class: 'rig-cal__units', role: 'grid', 'aria-label': `${page.start} to ${page.end}` });
    for (let row = 0; row < 4; row++) {
      const tr = h('div', { class: 'rig-cal__units-row', role: 'row' });
      for (let col = 0; col < 3; col++) {
        const year = page.years[row * 3 + col];
        const key = String(year);
        const text = year < 1 ? '' : yearName.format(utcDate(makeISO(year, 1, 1)));
        const btn = h('button', { type: 'button', class: 'rig-cal__unit', tabindex: '-1', 'data-key': key, 'aria-label': text }, text);
        if (year < 1 || !yearAvailable(year, min, max) || this._isDisabled) btn.setAttribute('aria-disabled', 'true');
        if (year === thisYear) { btn.classList.add('is-today'); btn.setAttribute('aria-current', 'date'); }
        if (chosen.has(year)) btn.classList.add('is-selected');
        const cell = h('div', { class: 'rig-cal__units-cell', role: 'gridcell', 'aria-selected': String(chosen.has(year)) }, btn);
        if (year < page.start || year > page.end) cell.classList.add('is-outside');
        units.set(key, btn);
        tr.append(cell);
      }
      grid.append(tr);
    }
    const label = `${page.start} – ${page.end}`;
    const sheet = h('div', { class: 'rig-cal__sheet', 'data-view': 'years' },
      h('div', { class: 'rig-cal__pane' }, h('span', { class: 'rig-cal__title is-static' }, h('span', { class: 'rig-cal__title-text' }, label)), grid));
    this.#cells = new Map();
    this.#units = units;
    this.#syncUnitFocus();
    this.#announce(`${page.start} to ${page.end}, choose a year`);
    return sheet;
  }

  #unitKey(iso = this.#focus) {
    return this.#view === 'months' ? iso.slice(0, 7) : String(toParts(iso).y);
  }

  #syncUnitFocus() {
    const key = this.#unitKey();
    for (const [k, btn] of this.#units) btn.tabIndex = k === key ? 0 : -1;
  }

  #announce(text) {
    if (this.#live && this.#live.textContent !== text) this.#live.textContent = text;
  }

  /**
   * Swap in a new sheet. dir slides sideways (-1 back, 1 forward); zoom
   * scales through `origin` (1 drills in, -1 zooms out). Neither: no motion.
   */
  #swap(sheet, { dir, zoom, origin }) {
    const old = this.#sheet;
    this.#sheet = sheet;
    for (const stale of this.#stage.querySelectorAll('.rig-cal__sheet.is-leaving')) stale.remove();
    const hadFocus = Boolean(old && old.contains(document.activeElement));
    if (!old || (!dir && !zoom) || reducedMotion()) {
      old?.remove();
      this.#stage.append(sheet);
      if (hadFocus) this.#focusCurrent();
      return;
    }
    old.classList.add('is-leaving');
    old.setAttribute('aria-hidden', 'true');
    old.inert = true;
    this.#stage.append(sheet);
    if (hadFocus) this.#focusCurrent();
    const done = () => old.remove();
    if (dir) {
      const shift = 34;
      animate(old, [{ transform: 'translateX(0)', opacity: 1 }, { transform: `translateX(${-dir * shift}%)`, opacity: 0 }],
        { spring: springs.smooth, fill: 'forwards' }).finished.then(done, done);
      animate(sheet, [{ transform: `translateX(${dir * shift}%)`, opacity: 0 }, { transform: 'none', opacity: 1 }],
        { spring: springs.smooth, fill: 'none' });
      return;
    }
    // Zoom: the overview and the detail scale through the same point, so the
    // picked month or year appears to open up (or the days fold back into it).
    const point = origin ?? this.#originOf(sheet);
    const o = point ? `${Math.round(point.x)}px ${Math.round(point.y)}px` : '50% 40%';
    old.style.transformOrigin = o;
    sheet.style.transformOrigin = o;
    const big = 'scale(1.5)';
    const small = 'scale(0.55)';
    animate(old, [{ transform: 'none', opacity: 1 }, { transform: zoom > 0 ? big : small, opacity: 0 }],
      { spring: springs.smooth, fill: 'forwards' }).finished.then(done, done);
    animate(sheet, [{ transform: zoom > 0 ? small : big, opacity: 0 }, { transform: 'none', opacity: 1 }],
      { spring: springs.smooth, fill: 'none' });
  }

  /** Centre of the focused unit (zoom out) within the stage. */
  #originOf(sheet) {
    const btn = sheet.querySelector('.rig-cal__unit[tabindex="0"]');
    return btn ? this.#centerIn(btn) : null;
  }

  #centerIn(el) {
    const s = this.#stage.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { x: r.left - s.left + r.width / 2, y: r.top - s.top + r.height / 2 };
  }

  #focusCurrent() {
    if (this.#view === 'days') this.#cells.get(this.#focus)?.btn.focus({ preventScroll: true });
    else this.#units.get(this.#unitKey())?.focus({ preventScroll: true });
  }

  /** Reflect selection, range, preview, today and focus onto the day cells. */
  #paint() {
    if (!this.#sheet || this.#view !== 'days') return;
    const range = this.mode === 'range';
    const today = todayISO();
    const start = this.#start;
    let lo = start;
    let hi = range ? this.#end : start;
    const previewing = range && start && !this.#end && this.#hover && this.#hover !== start;
    if (previewing) [lo, hi] = orderRange(start, this.#hover);
    for (const [iso, { td, btn }] of this.#cells) {
      const disabled = this.#disabledDay(iso);
      const isEdge = Boolean(lo && hi && (iso === lo || iso === hi));
      const chosen = range ? (iso === start || iso === this.#end) : iso === start;
      const inside = Boolean(lo && hi && iso > lo && iso < hi);
      const selectedCell = range ? (this.#end ? iso >= start && iso <= this.#end : iso === start) : iso === start;
      td.setAttribute('aria-selected', String(selectedCell && Boolean(start)));
      td.classList.toggle('is-range-start', range && Boolean(hi) && hi !== lo && iso === lo);
      td.classList.toggle('is-range-end', range && Boolean(hi) && hi !== lo && iso === hi);
      td.classList.toggle('is-in-range', range && inside);
      td.classList.toggle('is-preview', Boolean(previewing) && (inside || isEdge));
      btn.classList.toggle('is-selected', chosen || (previewing && iso === this.#hover && !disabled));
      btn.classList.toggle('is-today', iso === today);
      if (iso === today) btn.setAttribute('aria-current', 'date');
      else btn.removeAttribute('aria-current');
      if (disabled) btn.setAttribute('aria-disabled', 'true');
      else btn.removeAttribute('aria-disabled');
      btn.tabIndex = iso === this.#focus ? 0 : -1;
    }
  }

  /* ---------- moving around ---------- */

  #moveFocus(iso, { focus = true, slide = true } = {}) {
    const target = clampISO(iso, this.min, this.max);
    const prevFirst = this.#month;
    this.#focus = target;
    if (this.#rangePending()) this.#hover = target;
    const first = shiftWindow(prevFirst || target, target, this.months);
    if (first !== prevFirst || !this.#sheet || this.#sheet.dataset.view !== 'days') {
      this.#month = first;
      this.#view = 'days';
      this.#render({ dir: slide && prevFirst ? Math.sign(monthDiff(prevFirst, first)) : 0 });
      this.dispatchEvent(new CustomEvent('monthchange', { bubbles: true, detail: { month: this.month } }));
    } else {
      this.#paint();
    }
    if (focus) this.#cells.get(target)?.btn.focus({ preventScroll: false });
  }

  /** Move a months/years view's focus (re-render when it leaves the page). */
  #moveUnitFocus(iso, { focus = true } = {}) {
    const target = clampISO(iso, this.min, this.max);
    const before = this.#focus;
    this.#focus = target;
    const samePage = this.#view === 'months'
      ? toParts(before).y === toParts(target).y
      : yearPage(toParts(before).y).start === yearPage(toParts(target).y).start;
    if (samePage) {
      this.#syncUnitFocus();
      if (focus) this.#units.get(this.#unitKey())?.focus();
      this.#updateNav();
    } else {
      this.#render({ dir: Math.sign(monthDiff(before, target)) });
      if (focus) this.#focusCurrent();
    }
  }

  /** Previous/next button: a month, a year or a decade depending on the view. */
  #step(delta) {
    if (this._isDisabled) return;
    if (this.#view === 'days') {
      const first = addMonths(this.#month, delta);
      const focus = clampISO(addMonths(this.#focus, delta), this.min, this.max);
      this.#focus = focus;
      this.#month = shiftWindow(first, focus, this.months);
      if (this.#rangePending()) this.#hover = '';
      this.#render({ dir: delta });
      this.dispatchEvent(new CustomEvent('monthchange', { bubbles: true, detail: { month: this.month } }));
    } else {
      const years = this.#view === 'months' ? delta : delta * 10;
      this.#focus = clampISO(addYears(this.#focus, years), this.min, this.max);
      this.#render({ dir: delta });
    }
    sound.play('tick', { step: delta > 0 ? 2 : -2 });
  }

  /** Heading: days -> months -> years. */
  #zoomOut(monthIso) {
    if (this._isDisabled) return;
    const focusInside = this.contains(document.activeElement);
    if (this.#view === 'days') {
      // The heading of the second month zooms out from that month.
      const m = parseISO(monthIso);
      if (m && this.#focus.slice(0, 7) !== m.slice(0, 7)) {
        const { y, m: mm } = toParts(m);
        this.#focus = clampISO(withMonth(this.#focus, y, mm), this.min, this.max);
      }
      this.#view = 'months';
    } else if (this.#view === 'months') {
      this.#view = 'years';
    } else return;
    this.#hover = '';
    this.#render({ zoom: -1 });
    if (focusInside) this.#focusCurrent();
    sound.play('tick', { step: 4 });
  }

  /** Back toward days from a months/years view, scaling through the focused unit. */
  #zoomIn({ toDays = false } = {}) {
    const btn = this.#units.get(this.#unitKey());
    const origin = btn ? this.#centerIn(btn) : null;
    this.#view = this.#view === 'years' && !toDays ? 'months' : 'days';
    if (this.#view === 'days') this.#month = shiftWindow(startOfMonth(this.#focus), this.#focus, this.months);
    this.#render({ zoom: 1, origin });
    this.#focusCurrent();
  }

  #pickUnit(btn) {
    if (btn.getAttribute('aria-disabled') === 'true') { sound.play('error'); return; }
    const key = btn.dataset.key;
    if (this.#view === 'months') {
      const [y, m] = key.split('-').map(Number);
      this.#focus = clampISO(withMonth(this.#focus, y, m), this.min, this.max);
    } else {
      const { m } = toParts(this.#focus);
      this.#focus = clampISO(withMonth(this.#focus, Number(key), m), this.min, this.max);
    }
    this.#syncUnitFocus();
    sound.play('tap');
    this.#zoomIn();
    if (this.#view === 'days') this.dispatchEvent(new CustomEvent('monthchange', { bubbles: true, detail: { month: this.month } }));
  }

  #pick(iso, { viaPointer = false } = {}) {
    if (!iso || this.#disabledDay(iso)) {
      if (iso) sound.play('error');
      return;
    }
    if (shiftWindow(this.#month, iso, this.months) !== this.#month) {
      this.#moveFocus(iso, { focus: viaPointer || this.contains(document.activeElement) });
    }
    this.#focus = iso;
    if (this.mode === 'single') {
      const changed = iso !== this.#start;
      this.#start = iso;
      this.#sync();
      this.#paint();
      this.#pulse(iso);
      sound.play('tap');
      this._emit('input');
      if (changed) this._emit('change', { value: this.value, start: this.#start, end: this.#start });
      return;
    }
    if (!this.#start || this.#end) {
      this.#start = iso;
      this.#end = '';
      this.#hover = iso;
      this.#sync();
      this.#paint();
      this.#pulse(iso);
      sound.play('tick');
      this._emit('input');
      return;
    }
    const [a, b] = orderRange(this.#start, iso);
    this.#start = a;
    this.#end = b;
    this.#hover = '';
    this.#sync();
    this.#paint();
    this.#pulse(iso);
    sound.play('tap');
    this._emit('input');
    this._emit('change', { value: this.value, start: a, end: b });
  }

  #pulse(iso) {
    const btn = this.#cells.get(iso)?.btn;
    if (!btn || reducedMotion()) return;
    animate(btn, [{ transform: 'scale(0.86)' }, { transform: 'scale(1)' }], { spring: springs.lively, fill: 'none' });
  }

  #onKey(e) {
    if (this._isDisabled) return;
    const unit = e.target.closest?.('.rig-cal__unit');
    if (unit) { this.#onUnitKey(e); return; }
    const btn = e.target.closest?.('.rig-cal__day');
    if (!btn) return;
    const f = this.#focus || btn.dataset.date;
    const rtl = getComputedStyle(this).direction === 'rtl';
    const ws = this.weekStart;
    let next = null;
    switch (e.key) {
      case 'ArrowLeft': next = addDays(f, rtl ? 1 : -1); break;
      case 'ArrowRight': next = addDays(f, rtl ? -1 : 1); break;
      case 'ArrowUp': next = addDays(f, -7); break;
      case 'ArrowDown': next = addDays(f, 7); break;
      case 'Home': next = startOfWeek(f, ws); break;
      case 'End': next = endOfWeek(f, ws); break;
      case 'PageUp': next = e.shiftKey ? addYears(f, -1) : addMonths(f, -1); break;
      case 'PageDown': next = e.shiftKey ? addYears(f, 1) : addMonths(f, 1); break;
      default: // Enter and Space activate the day button natively (click).
        return;
    }
    e.preventDefault();
    this.#moveFocus(next);
  }

  #onUnitKey(e) {
    const months = this.#view === 'months';
    const step = (n) => (months ? addMonths(this.#focus, n) : addYears(this.#focus, n));
    const rtl = getComputedStyle(this).direction === 'rtl' ? -1 : 1;
    const index = months ? toParts(this.#focus).m - 1 : yearPage(toParts(this.#focus).y).years.indexOf(toParts(this.#focus).y);
    const col = index % 3;
    let next = null;
    switch (e.key) {
      case 'ArrowLeft': next = step(-1 * rtl); break;
      case 'ArrowRight': next = step(1 * rtl); break;
      case 'ArrowUp': next = step(-3); break;
      case 'ArrowDown': next = step(3); break;
      case 'Home': next = step(-col); break;
      case 'End': next = step(2 - col); break;
      case 'PageUp': next = months ? addYears(this.#focus, -1) : addYears(this.#focus, -10); break;
      case 'PageDown': next = months ? addYears(this.#focus, 1) : addYears(this.#focus, 10); break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        this.#zoomIn({ toDays: true }); // Esc goes all the way back to the days
        return;
      default:
        return;
    }
    e.preventDefault();
    this.#moveUnitFocus(next);
  }
}

define('rig-calendar', RigCalendar);
