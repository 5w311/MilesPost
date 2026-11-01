// toast() — stacked notifications.
//
//   import { toast } from './toast.js'
//   toast('Load accepted', { description: 'Pickup Tue 06:00, Ocala FL' })
//   toast.success('Saved')
//   const id = toast.loading('Uploading BOL')
//   toast.update(id, { type: 'success', title: 'BOL uploaded' })
//   toast.promise(upload(), { loading: 'Uploading', success: 'Uploaded', error: (e) => e.message })
//   toast('Trip deleted', { action: { label: 'Undo', onClick: restore } })
//
// The newest toast sits in front with older ones tucked behind it. Hovering or
// focusing the stack fans it out and pauses the timers. Swipe a toast sideways
// to dismiss it. Place <rig-toaster position="top-center"> in your page to
// choose a corner; one is created for you otherwise.

import { reducedMotion, springDriver, springs } from './motion.js';
import { sound } from './sound.js';
import { define, h, paths, svgIcon } from './util.js';

const GAP = 10;
const PEEK = 9;
const VISIBLE = 3;
const MAX = 6;
const DEFAULT_DURATION = 4800;

const ICONS = {
  success: () => svgIcon(paths.checkCircle, { size: 18 }),
  error: () => svgIcon(paths.alert, { size: 18 }),
  info: () => svgIcon(paths.info, { size: 18 }),
  loading: () => h('span', { class: 'rig-spinner', 'aria-hidden': 'true' }),
};

let seq = 0;

class RigToaster extends HTMLElement {
  #list;
  #toasts = []; // newest first
  #expanded = false;
  #ready = false;
  #ro;

  connectedCallback() {
    if (this.#ready) return;
    this.#ready = true;
    this.classList.add('rig-toaster');
    this.setAttribute('role', 'region');
    this.setAttribute('aria-label', this.getAttribute('label') || 'Notifications');
    if (!this.hasAttribute('position')) this.setAttribute('position', 'bottom-right');
    if ('popover' in HTMLElement.prototype) this.setAttribute('popover', 'manual');
    this.#list = h('ol', { class: 'rig-toaster__list', 'aria-live': 'polite', 'aria-relevant': 'additions text' });
    this.append(this.#list);
    this.#ro = new ResizeObserver(() => this.#layout());

    const expand = (on) => {
      if (this.#expanded === on) return;
      this.#expanded = on;
      this.toggleAttribute('data-expanded', on);
      for (const t of this.#toasts) on ? this.#pause(t) : this.#resume(t);
      this.#layout();
    };
    this.addEventListener('pointerenter', () => expand(true));
    this.addEventListener('pointerleave', (e) => { if (!this.contains(document.activeElement) && !e.buttons) expand(false); });
    this.addEventListener('focusin', () => expand(true));
    this.addEventListener('focusout', (e) => { if (!this.contains(e.relatedTarget)) expand(false); });
    document.addEventListener('visibilitychange', () => {
      for (const t of this.#toasts) document.hidden ? this.#pause(t) : (!this.#expanded && this.#resume(t));
    });
  }

  get #bottom() { return !(this.getAttribute('position') || '').startsWith('top'); }
  get #side() {
    const p = this.getAttribute('position') || '';
    return p.endsWith('left') ? -1 : p.endsWith('right') ? 1 : 0;
  }

  // Keep the stack above any modal dialog opened after it.
  #raise() {
    if (!this.hasAttribute('popover')) return;
    try {
      if (this.matches(':popover-open')) this.hidePopover();
      this.showPopover();
    } catch { /* not in the document yet */ }
  }

  add(options) {
    const t = {
      id: options.id ?? `t${++seq}`,
      type: options.type ?? 'default',
      title: options.title ?? '',
      description: options.description ?? '',
      action: options.action ?? null,
      duration: options.duration ?? (options.type === 'loading' ? Infinity : DEFAULT_DURATION),
      dismissible: options.dismissible !== false,
      onDismiss: options.onDismiss,
      remaining: 0,
      timer: 0,
      started: 0,
      height: 0,
      leaving: false,
    };
    const existing = this.#toasts.find((x) => x.id === t.id);
    if (existing) { this.update(t.id, options); return t.id; }

    t.el = this.#render(t);
    this.#list.prepend(t.el);
    this.#toasts.unshift(t);
    this.#raise();

    t.motion = springDriver([0, 1, 0, 0], springs.lively, ([y, s, o, ht]) => {
      t.y = y; t.s = s; t.o = o; t.h = ht;
      this.#paint(t);
    });
    t.swipe = springDriver([0], springs.smooth, ([x]) => { t.x = x; this.#paint(t); });
    t.x = 0;
    t.height = t.body.offsetHeight;
    const enterFrom = (this.#bottom ? 1 : -1) * Math.min(80, t.height + 16);
    t.motion.to([enterFrom, 1, 0, t.height], { immediate: true });
    this.#ro.observe(t.body);
    this.#wireSwipe(t);

    t.remaining = t.duration;
    if (!this.#expanded && !document.hidden) this.#resume(t);

    if (this.#toasts.length > MAX) this.dismiss(this.#toasts[this.#toasts.length - 1].id);
    this.#layout();
    const cue = t.type === 'success' ? 'success' : t.type === 'error' ? 'error' : 'pop';
    sound.play(cue);
    return t.id;
  }

  update(id, patch) {
    const t = this.#toasts.find((x) => x.id === id);
    if (!t) return;
    const typeChanged = patch.type && patch.type !== t.type;
    Object.assign(t, Object.fromEntries(Object.entries(patch).filter(([k]) => ['type', 'title', 'description', 'action', 'dismissible'].includes(k))));
    if ('duration' in patch || typeChanged) {
      this.#pause(t);
      t.duration = patch.duration ?? (t.type === 'loading' ? Infinity : DEFAULT_DURATION);
      t.remaining = t.duration;
      if (!this.#expanded && !document.hidden) this.#resume(t);
    }
    const fresh = this.#render(t);
    t.el.dataset.type = t.type;
    t.el.setAttribute('role', t.type === 'error' ? 'alert' : 'status');
    t.body.replaceChildren(...fresh.querySelector('.rig-toast__body').childNodes);
    if (typeChanged) {
      const icon = t.body.querySelector('.rig-toast__icon');
      if (icon && !reducedMotion()) {
        icon.animate([{ transform: 'scale(.4)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: 260, easing: 'cubic-bezier(.3,1.4,.5,1)' });
      }
      if (t.type === 'success') sound.play('success');
      if (t.type === 'error') sound.play('error');
    }
  }

  dismiss(id) {
    const targets = id == null ? [...this.#toasts] : this.#toasts.filter((x) => x.id === id);
    for (const t of targets) this.#remove(t);
  }

  #remove(t, { swiped = false } = {}) {
    if (t.leaving) return;
    t.leaving = true;
    this.#pause(t);
    this.#toasts = this.#toasts.filter((x) => x !== t);
    this.#ro.unobserve(t.body);
    t.el.setAttribute('aria-hidden', 'true');
    t.el.inert = true;
    if (!swiped) t.motion.to([t.y + (this.#bottom ? 1 : -1) * 18, 0.94, 0, t.h]);
    setTimeout(() => {
      t.motion.stop();
      t.swipe.stop();
      t.el.remove();
      if (!this.#toasts.length && this.hasAttribute('popover')) {
        try { this.hidePopover(); } catch { /* already hidden */ }
      }
    }, reducedMotion() ? 0 : 420);
    t.onDismiss?.(t.id);
    this.#layout();
  }

  #render(t) {
    const action = t.action
      ? h('button', {
        class: 'rig-toast__action',
        type: 'button',
        onclick: () => { t.action.onClick?.(); if (t.action.dismiss !== false) this.#remove(t); },
      }, t.action.label)
      : null;
    const close = t.dismissible
      ? h('button', { class: 'rig-toast__close', type: 'button', 'aria-label': 'Dismiss notification', onclick: () => this.#remove(t) }, svgIcon(paths.close, { size: 14 }))
      : null;
    const icon = ICONS[t.type] ? h('span', { class: 'rig-toast__icon' }, ICONS[t.type]()) : null;
    const body = h('div', { class: 'rig-toast__body' },
      icon,
      h('div', { class: 'rig-toast__text' },
        h('p', { class: 'rig-toast__title' }, t.title),
        t.description ? h('p', { class: 'rig-toast__desc' }, t.description) : null),
      action,
      close);
    const el = h('li', { class: 'rig-toast', 'data-type': t.type, role: t.type === 'error' ? 'alert' : 'status', 'aria-atomic': 'true' }, body);
    if (!t.body) t.body = body;
    return el;
  }

  #paint(t) {
    const el = t.el;
    el.style.transform = `translate3d(${(t.x ?? 0).toFixed(2)}px, ${(t.y ?? 0).toFixed(2)}px, 0) scale(${(t.s ?? 1).toFixed(4)})`;
    const swipeFade = 1 - Math.min(1, Math.abs(t.x ?? 0) / (t.width || 320));
    el.style.opacity = String(Math.max(0, Math.min(1, (t.o ?? 1) * swipeFade)));
    if (t.h) el.style.height = `${Math.max(0, t.h).toFixed(1)}px`;
  }

  #layout() {
    const dir = this.#bottom ? -1 : 1;
    let offset = 0;
    const front = this.#toasts[0];
    for (const t of this.#toasts) {
      t.height = t.body.offsetHeight;
      t.width = t.el.offsetWidth;
    }
    this.#toasts.forEach((t, i) => {
      let y;
      let s;
      let o;
      let ht;
      if (this.#expanded) {
        y = dir * offset;
        s = 1;
        o = 1;
        ht = t.height;
        offset += t.height + GAP;
      } else {
        y = dir * i * PEEK;
        s = 1 - i * 0.05;
        o = i < VISIBLE ? 1 : 0;
        ht = i === 0 ? t.height : front.height;
      }
      t.el.classList.toggle('is-behind', !this.#expanded && i > 0);
      t.el.style.zIndex = String(100 - i);
      t.motion.to([y, s, o, ht]);
    });
    // Size the hover area to what's on screen.
    const count = Math.min(this.#toasts.length, VISIBLE);
    const area = this.#expanded ? Math.max(0, offset - GAP) : front ? front.height + (count - 1) * PEEK : 0;
    this.#list.style.height = `${area}px`;
  }

  #pause(t) {
    if (!t.timer) return;
    clearTimeout(t.timer);
    t.timer = 0;
    t.remaining -= performance.now() - t.started;
  }

  #resume(t) {
    if (t.timer || t.leaving || !Number.isFinite(t.remaining)) return;
    t.started = performance.now();
    t.timer = setTimeout(() => this.#remove(t), Math.max(400, t.remaining));
  }

  #wireSwipe(t) {
    let startX = 0;
    let lastX = 0;
    let lastT = 0;
    let velocity = 0;
    let dragging = false;
    const allowed = this.#side; // 1: right only, -1: left only, 0: both
    t.el.addEventListener('pointerdown', (e) => {
      if (!t.dismissible || e.button !== 0 || e.target.closest('button, a')) return;
      dragging = true;
      startX = lastX = e.clientX;
      lastT = performance.now();
      velocity = 0;
      t.el.setPointerCapture(e.pointerId);
      t.el.classList.add('is-dragging');
    });
    t.el.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const now = performance.now();
      velocity = (e.clientX - lastX) / Math.max(1, now - lastT);
      lastX = e.clientX;
      lastT = now;
      let dx = e.clientX - startX;
      if (allowed && Math.sign(dx) !== allowed) dx *= 0.15; // resist the wrong way
      t.swipe.to([dx], { immediate: true });
    });
    const end = () => {
      if (!dragging) return;
      dragging = false;
      t.el.classList.remove('is-dragging');
      const dx = t.x ?? 0;
      const width = t.el.offsetWidth;
      const rightWay = !allowed || Math.sign(dx) === allowed;
      if (rightWay && (Math.abs(dx) > width * 0.35 || Math.abs(velocity) > 0.55)) {
        const dirX = Math.sign(dx || velocity) || 1;
        t.swipe.to([dirX * (width + 48)]);
        sound.play('whoosh');
        this.#remove(t, { swiped: true });
      } else {
        t.swipe.to([0]);
      }
    };
    t.el.addEventListener('pointerup', end);
    t.el.addEventListener('pointercancel', end);
  }
}

define('rig-toaster', RigToaster);

function toaster() {
  let el = document.querySelector('rig-toaster');
  if (!el) {
    el = document.createElement('rig-toaster');
    document.body.append(el);
  }
  return el;
}

function normalize(title, options = {}) {
  return typeof title === 'object' && title !== null ? { ...title } : { ...options, title };
}

export function toast(title, options) {
  return toaster().add(normalize(title, options));
}
toast.success = (title, options) => toast({ ...normalize(title, options), type: 'success' });
toast.error = (title, options) => toast({ ...normalize(title, options), type: 'error' });
toast.info = (title, options) => toast({ ...normalize(title, options), type: 'info' });
toast.loading = (title, options) => toast({ ...normalize(title, options), type: 'loading' });
toast.update = (id, patch) => toaster().update(id, patch);
toast.dismiss = (id) => toaster().dismiss(id);
toast.promise = (promise, { loading = 'Working', success = 'Done', error = 'Something went wrong' } = {}) => {
  const id = toast.loading(loading);
  const resolve = (msg, value) => (typeof msg === 'function' ? msg(value) : msg);
  Promise.resolve(promise).then(
    (value) => toast.update(id, { type: 'success', ...asPatch(resolve(success, value)) }),
    (err) => toast.update(id, { type: 'error', ...asPatch(resolve(error, err)) }),
  );
  return id;
};

function asPatch(msg) {
  return typeof msg === 'object' && msg !== null ? msg : { title: String(msg) };
}

export { RigToaster };
