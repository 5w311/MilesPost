// The hour / minute / AM-PM columns inside <rig-time-picker>'s popup (and the
// date picker's time field). Not a custom element: the owner creates one,
// appends `.el`, and hears about picks through callbacks.
//
//   const cols = new TimeColumns({ hourCycle: 12, step: 15, locale: 'en-US',
//     isAllowed: (minutes) => true, onPick: (minutes) => {}, onCommit() {}, onEscape() {} })
//   popup.append(cols.el)
//   cols.value = 870        // 14:30, or null for nothing chosen
//   cols.seed = 540         // where the lists sit (and what the other columns
//                           // assume) while nothing is chosen
//   cols.render({ scroll: 'instant' })
//   cols.focus('hour')
//
// Each column is a listbox whose selection follows focus, so arrow keys and
// clicks both pick straight away. Keys: ↑/↓ move, Home/End, PageUp/PageDown
// by five, ←/→ change column, digits jump ("1", "14", "3" → 30), A/P switch
// half of the day, Enter calls onCommit, Esc calls onEscape.

import { reducedMotion } from '../motion.js';
import { h, uid } from '../util.js';
import { dayPeriods, normalizeStep } from './time-logic.js';

const pad = (n) => String(n).padStart(2, '0');

export class TimeColumns {
  #opts;
  #cols = {};
  #value = null;
  #seed = 540;
  #buffer = '';
  #bufferTimer = 0;

  constructor(opts) {
    this.#opts = { hourCycle: 24, step: 5, locale: 'en', isAllowed: () => true, ...opts };
    this.el = h('div', { class: 'rig-timecols', dir: 'ltr' });
    this.el.addEventListener('keydown', (e) => this.#onKey(e));
    this.el.addEventListener('click', (e) => {
      const opt = e.target.closest('.rig-timecols__opt');
      if (!opt || opt.getAttribute('aria-disabled') === 'true') return;
      const col = opt.parentElement;
      if (document.activeElement !== col) col.focus({ preventScroll: true });
      this.#pick(col.dataset.part, opt);
    });
    this.#build();
  }

  get value() { return this.#value; }
  set value(v) { this.#value = Number.isFinite(v) ? v : null; }
  get seed() { return this.#seed; }
  set seed(v) { if (Number.isFinite(v)) this.#seed = v; }

  /** Change hourCycle, step, locale or isAllowed; rebuilds the columns when needed. */
  configure(next) {
    const before = this.#opts;
    this.#opts = { ...before, ...next };
    if (before.hourCycle !== this.#opts.hourCycle || before.step !== this.#opts.step || before.locale !== this.#opts.locale) this.#build();
  }

  focus(part = 'hour') {
    const col = this.#cols[part] ?? this.#cols.hour;
    col.focus({ preventScroll: true });
  }

  get #twelve() { return this.#opts.hourCycle === 12; }
  get #base() { return this.#value ?? this.#seed; }

  #build() {
    const step = normalizeStep(this.#opts.step);
    const make = (part, label, options) => {
      const col = h('div', {
        class: `rig-timecols__col rig-timecols__col--${part}`,
        role: 'listbox',
        tabindex: '0',
        'aria-label': label,
        'data-part': part,
      });
      for (const [v, text] of options) {
        col.append(h('div', { class: 'rig-timecols__opt', role: 'option', id: uid('rig-tc'), 'data-v': v, 'aria-selected': 'false' }, text));
      }
      return col;
    };
    const hours = this.#twelve
      ? [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((n) => [n, String(n)])
      : Array.from({ length: 24 }, (_, n) => [n, pad(n)]);
    const minutes = [];
    for (let m = 0; m < 60; m += step) minutes.push([m, pad(m)]);
    this.#cols = {
      hour: make('hour', 'Hour', hours),
      minute: make('minute', 'Minutes', minutes),
    };
    const parts = [this.#cols.hour, h('span', { class: 'rig-timecols__sep', 'aria-hidden': 'true' }, ':'), this.#cols.minute];
    if (this.#twelve) {
      const [am, pm] = dayPeriods(this.#opts.locale);
      this.#cols.period = make('period', 'AM or PM', [['am', am], ['pm', pm]]);
      parts.push(this.#cols.period);
    }
    this.el.replaceChildren(...parts);
  }

  /** The 24-hour hour an hour-column option stands for, given the current half of the day. */
  #hourOf(opt) {
    const v = Number(opt.dataset.v);
    if (!this.#twelve) return v;
    return (v % 12) + (this.#base >= 720 ? 12 : 0);
  }

  #minutesIn(hour) {
    return [...this.#cols.minute.children].map((o) => hour * 60 + Number(o.dataset.v));
  }

  #enabled(part, opt) {
    const ok = this.#opts.isAllowed;
    const base = this.#base;
    if (part === 'hour') return this.#minutesIn(this.#hourOf(opt)).some(ok);
    if (part === 'minute') return ok(Math.floor(base / 60) * 60 + Number(opt.dataset.v));
    const pm = opt.dataset.v === 'pm';
    const step = normalizeStep(this.#opts.step);
    for (let t = pm ? 720 : 0; t < (pm ? 1440 : 720); t += step) if (ok(t)) return true;
    return false;
  }

  #isSelected(part, opt, t) {
    if (part === 'hour') return this.#hourOf(opt) === Math.floor(t / 60);
    if (part === 'minute') return Number(opt.dataset.v) === t % 60;
    return (opt.dataset.v === 'pm') === (t >= 720);
  }

  /** Refresh selection and disabled states; `scroll` is 'smooth', 'instant' or false. */
  render({ scroll = 'smooth' } = {}) {
    const base = this.#base;
    for (const [part, col] of Object.entries(this.#cols)) {
      let active = null;
      for (const opt of col.children) {
        const disabled = !this.#enabled(part, opt);
        const match = this.#isSelected(part, opt, base);
        opt.setAttribute('aria-disabled', String(disabled));
        opt.setAttribute('aria-selected', String(this.#value != null && match));
        opt.classList.toggle('is-seed', this.#value == null && match);
        if (match) active = opt;
      }
      if (!active || active.getAttribute('aria-disabled') === 'true') {
        active = [...col.children].find((o) => o.getAttribute('aria-disabled') !== 'true') ?? active;
      }
      for (const opt of col.children) opt.classList.toggle('is-active', opt === active);
      if (active) col.setAttribute('aria-activedescendant', active.id);
      else col.removeAttribute('aria-activedescendant');
      if (scroll && active) this.#center(col, active, scroll);
    }
  }

  #center(col, opt, behavior) {
    if (col.scrollHeight <= col.clientHeight + 1) return;
    const top = opt.offsetTop - (col.clientHeight - opt.offsetHeight) / 2;
    const instant = behavior === 'instant' || reducedMotion();
    if (Math.abs(col.scrollTop - top) < 1) return;
    col.scrollTo({ top, behavior: instant ? 'instant' : 'smooth' });
  }

  #pick(part, opt) {
    const ok = this.#opts.isAllowed;
    const base = this.#base;
    const minute = this.#value != null ? base % 60 : 0;
    let target;
    if (part === 'hour') {
      const hour = this.#hourOf(opt);
      target = hour * 60 + minute;
      if (!ok(target)) {
        // Keep the minutes as close as the allowed ones in that hour let us.
        const choices = this.#minutesIn(hour).filter(ok);
        choices.sort((a, b) => Math.abs((a % 60) - minute) - Math.abs((b % 60) - minute));
        target = choices[0];
      }
    } else if (part === 'minute') {
      target = Math.floor(base / 60) * 60 + Number(opt.dataset.v);
    } else {
      const pm = opt.dataset.v === 'pm';
      target = ((Math.floor(base / 60) % 12) + (pm ? 12 : 0)) * 60 + (base % 60);
      if (!ok(target)) {
        const step = normalizeStep(this.#opts.step);
        let best = null;
        for (let t = pm ? 720 : 0; t < (pm ? 1440 : 720); t += step) {
          if (ok(t) && (best == null || Math.abs(t - target) < Math.abs(best - target))) best = t;
        }
        target = best;
      }
    }
    if (target == null || !ok(target)) return;
    this.#value = target;
    this.render();
    this.#opts.onPick?.(target, part);
  }

  #move(col, opt, delta) {
    const opts = [...col.children];
    let i = opts.indexOf(opt);
    let last = null;
    const dir = Math.sign(delta);
    let left = Math.abs(delta);
    while (left > 0) {
      i += dir;
      if (i < 0 || i >= opts.length) break;
      if (opts[i].getAttribute('aria-disabled') !== 'true') { last = opts[i]; left -= 1; }
    }
    return last;
  }

  #onKey(e) {
    const col = e.target.closest?.('.rig-timecols__col');
    if (!col) return;
    const part = col.dataset.part;
    const active = col.querySelector('.is-active') ?? col.firstElementChild;
    const order = Object.values(this.#cols);
    const enabled = [...col.children].filter((o) => o.getAttribute('aria-disabled') !== 'true');
    let target = null;
    switch (e.key) {
      case 'ArrowDown': target = this.#move(col, active, 1); break;
      case 'ArrowUp': target = this.#move(col, active, -1); break;
      case 'PageDown': target = this.#move(col, active, 5) ?? enabled.at(-1); break;
      case 'PageUp': target = this.#move(col, active, -5) ?? enabled[0]; break;
      case 'Home': target = enabled[0]; break;
      case 'End': target = enabled.at(-1); break;
      case 'ArrowLeft':
      case 'ArrowRight': {
        e.preventDefault();
        const next = order[order.indexOf(col) + (e.key === 'ArrowRight' ? 1 : -1)];
        next?.focus({ preventScroll: true });
        return;
      }
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (this.#value == null && active && active.getAttribute('aria-disabled') !== 'true') this.#pick(part, active);
        this.#opts.onCommit?.();
        return;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        this.#opts.onEscape?.();
        return;
      default: {
        const key = e.key.toLowerCase();
        if (this.#cols.period && (key === 'a' || key === 'p')) {
          e.preventDefault();
          const opt = this.#cols.period.querySelector(`[data-v="${key === 'a' ? 'am' : 'pm'}"]`);
          if (opt.getAttribute('aria-disabled') !== 'true') this.#pick('period', opt);
          return;
        }
        if (/^\d$/.test(e.key) && part !== 'period') {
          e.preventDefault();
          clearTimeout(this.#bufferTimer);
          this.#buffer += e.key;
          this.#bufferTimer = setTimeout(() => { this.#buffer = ''; }, 900);
          const want = this.#buffer;
          const find = (text) => enabled.find((o) => Number(o.dataset.v) === Number(text))
            ?? enabled.find((o) => o.textContent.startsWith(text));
          target = find(want);
          if (!target && want.length > 1) { this.#buffer = e.key; target = find(e.key); }
        }
        if (!target) return;
      }
    }
    e.preventDefault();
    if (target) this.#pick(part, target);
  }
}
