// DOM helpers shared by the overlay and navigation components.
//
//   lockScroll()                    ref-counted page scroll lock; returns unlock()
//   focusables(root), focusFirst()  keyboard-reachable elements inside a layer
//   trackDrag(el, options)          one-axis pointer drag with velocity; returns cleanup
//   anchorTo(anchor, el, options)   follow() from position.js, kept inside the viewport
//   trackingPoint(el, x, y)         virtual anchor at a point that scrolls with `el`
//   longPress(el, callback)         touch long-press; returns cleanup
//   onTrigger(attr, handler)        one document click listener for [attr] triggers
//   renderShortcut(text), ariaShortcut(text)
//   whenParsed(fn)                  run once the document's children exist

import { follow, pointAnchor } from '../position.js';
import { clamp, h, isMac } from '../util.js';
import { velocityFrom } from './overlay-math.js';

const hasDOM = typeof document !== 'undefined';

/* ---------- scroll lock ---------- */

let locks = 0;
let saved = null;

/** Stop the page scrolling under a modal layer. Calls stack; each returns its own release. */
export function lockScroll() {
  if (hasDOM && locks++ === 0) {
    const html = document.documentElement;
    const body = document.body;
    const gutter = window.innerWidth - html.clientWidth;
    saved = { overflow: html.style.overflow, padding: body.style.paddingRight };
    if (gutter > 0) {
      const current = parseFloat(getComputedStyle(body).paddingRight) || 0;
      body.style.paddingRight = `${current + gutter}px`;
    }
    html.style.overflow = 'hidden';
  }
  let released = false;
  return () => {
    if (released || !hasDOM) return;
    released = true;
    if (--locks === 0 && saved) {
      document.documentElement.style.overflow = saved.overflow;
      document.body.style.paddingRight = saved.padding;
      saved = null;
    }
  };
}

/* ---------- focus ---------- */

const FOCUSABLE = [
  'a[href]', 'area[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])', 'textarea:not([disabled])', 'iframe', 'summary',
  '[contenteditable=""]', '[contenteditable="true"]', '[tabindex]:not([tabindex="-1"])',
].join(',');

export function focusables(root) {
  return [...root.querySelectorAll(FOCUSABLE)].filter((el) => !el.closest('[inert], [hidden]') && el.getClientRects().length > 0);
}

/** Focus `[autofocus]` or `[data-autofocus]`, else the first focusable that isn't excluded, else `fallback`. */
export function focusFirst(root, { exclude = () => false, fallback = root } = {}) {
  const auto = root.querySelector('[autofocus], [data-autofocus]');
  const target = auto ?? focusables(root).find((el) => !exclude(el)) ?? fallback;
  target?.focus?.({ preventScroll: true });
  return target;
}

/* ---------- drag ---------- */

/**
 * Track a one-axis drag on `el` with pointer events.
 * options:
 *   axis: 'x' | 'y'
 *   threshold: px before a drag is recognised (default 6)
 *   shouldStart(target, delta, event): return false to leave the gesture alone
 *   onStart(), onMove(delta, event), onEnd(delta, velocityPxPerSecond)
 * While dragging, touch scrolling is blocked and the click that follows is swallowed.
 */
export function trackDrag(el, { axis = 'y', threshold = 6, shouldStart = () => true, onStart, onMove, onEnd } = {}) {
  let start = null;
  let dragging = false;
  let samples = [];
  let swallowClick = false;
  let delta = 0;

  const down = (e) => {
    if (e.button !== 0 || !e.isPrimary) return;
    start = { x: e.clientX, y: e.clientY, id: e.pointerId, target: e.target };
    dragging = false;
    samples = [];
    delta = 0;
    // Moves are tracked on the window: the pointer may leave the element
    // before the drag is recognised (e.g. dragging a handle at its edge).
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
  };
  const move = (e) => {
    if (!start || e.pointerId !== start.id) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    const main = axis === 'x' ? dx : dy;
    const cross = axis === 'x' ? dy : dx;
    if (!dragging) {
      if (Math.abs(main) < threshold && Math.abs(cross) < threshold) return;
      if (Math.abs(cross) > Math.abs(main) || shouldStart(start.target, main, e) === false) {
        stopTracking();
        return;
      }
      dragging = true;
      try { el.setPointerCapture(start.id); } catch { /* pointer already gone */ }
      el.classList.add('is-dragging');
      onStart?.();
    }
    delta = main;
    samples.push({ t: e.timeStamp, p: main });
    if (samples.length > 24) samples.shift();
    onMove?.(main, e);
  };
  const stopTracking = () => {
    start = null;
    window.removeEventListener('pointermove', move, true);
    window.removeEventListener('pointerup', up, true);
    window.removeEventListener('pointercancel', up, true);
  };
  const up = (e) => {
    if (!start || e.pointerId !== start.id) return;
    const was = dragging;
    stopTracking();
    dragging = false;
    if (!was) return;
    el.classList.remove('is-dragging');
    swallowClick = true;
    setTimeout(() => { swallowClick = false; }, 0);
    const velocity = e.type === 'pointercancel' ? 0 : velocityFrom(samples, e.timeStamp);
    onEnd?.(delta, velocity);
  };
  const touchmove = (e) => { if (dragging && e.cancelable) e.preventDefault(); };
  const click = (e) => {
    if (!swallowClick) return;
    swallowClick = false;
    e.preventDefault();
    e.stopPropagation();
  };

  el.addEventListener('pointerdown', down);
  el.addEventListener('touchmove', touchmove, { passive: false });
  el.addEventListener('click', click, true);
  return () => {
    stopTracking();
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('touchmove', touchmove);
    el.removeEventListener('click', click, true);
  };
}

/* ---------- anchoring ---------- */

/** follow() that also keeps the layer fully on screen (submenus on phones, context menus). */
export function anchorTo(anchor, floating, options = {}) {
  const pad = options.padding ?? 8;
  const keepIn = () => {
    const vw = document.documentElement.clientWidth;
    const vh = window.visualViewport?.height ?? window.innerHeight;
    const x = parseFloat(floating.style.left) || 0;
    const y = parseFloat(floating.style.top) || 0;
    const nx = clamp(x, pad, Math.max(pad, vw - pad - floating.offsetWidth));
    const ny = clamp(y, pad, Math.max(pad, vh - pad - floating.offsetHeight));
    if (nx !== x) floating.style.left = `${nx}px`;
    if (ny !== y) floating.style.top = `${ny}px`;
  };
  const stop = follow(anchor, floating, {
    ...options,
    onPlace: (side) => { keepIn(); options.onPlace?.(side); },
  });
  keepIn();
  return stop;
}

/** A point anchor that stays attached to `el` when the page scrolls. */
export function trackingPoint(el, x, y) {
  const box = el.getBoundingClientRect();
  const dx = x - box.left;
  const dy = y - box.top;
  return {
    getBoundingClientRect() {
      const r = el.getBoundingClientRect();
      return pointAnchor(r.left + dx, r.top + dy).getBoundingClientRect();
    },
  };
}

/* ---------- touch long-press ---------- */

/**
 * Call `callback(event)` when a touch is held still on `el`. Returns cleanup.
 * Once it fires, the release is swallowed: no click, no compatibility mouse
 * events (which would move focus), and no native context menu.
 */
export function longPress(el, callback, { delay = 500, tolerance = 8, filter = () => true } = {}) {
  let timer = 0;
  let origin = null;
  let firedAt = -Infinity;
  const cancel = () => { clearTimeout(timer); timer = 0; origin = null; };
  const down = (e) => {
    if (e.pointerType !== 'touch' || !filter(e)) return;
    cancel();
    origin = { x: e.clientX, y: e.clientY, event: e };
    timer = setTimeout(() => {
      const fired = origin?.event;
      timer = 0;
      if (!fired) return;
      firedAt = performance.now();
      callback(fired);
    }, delay);
  };
  const move = (e) => {
    if (!origin) return;
    if (Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > tolerance) cancel();
  };
  const recent = () => performance.now() - firedAt < 1500;
  // Cancelling touchend stops the synthetic mousedown/mouseup/click that follow it.
  const touchend = (e) => {
    if (!recent()) return;
    firedAt = -Infinity;
    if (e.cancelable) e.preventDefault();
  };
  const contextmenu = (e) => { if (recent()) e.preventDefault(); };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('touchend', touchend, { passive: false });
  el.addEventListener('contextmenu', contextmenu);
  return () => {
    cancel();
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', cancel);
    el.removeEventListener('pointercancel', cancel);
    el.removeEventListener('touchend', touchend);
    el.removeEventListener('contextmenu', contextmenu);
  };
}

/* ---------- triggers ---------- */

const triggerHandlers = new Map();

/**
 * One document-level click listener per attribute. `handler(trigger, value, event)`
 * runs for clicks on any element carrying the attribute, now or added later.
 */
export function onTrigger(attr, handler) {
  if (!hasDOM) return;
  let list = triggerHandlers.get(attr);
  if (!list) {
    list = [];
    triggerHandlers.set(attr, list);
    document.addEventListener('click', (e) => {
      const trigger = e.target instanceof Element ? e.target.closest(`[${attr}]`) : null;
      if (!trigger || trigger.matches(':disabled, [aria-disabled="true"]')) return;
      for (const fn of list) fn(trigger, trigger.getAttribute(attr), e);
    });
  }
  list.push(handler);
}

/* ---------- keyboard shortcut labels ---------- */

const KEY_LABELS = {
  mod: isMac ? '⌘' : 'Ctrl', shift: '⇧', alt: isMac ? '⌥' : 'Alt', ctrl: isMac ? '⌃' : 'Ctrl', meta: isMac ? '⌘' : 'Win',
  enter: '↵', esc: 'Esc', escape: 'Esc', up: '↑', down: '↓', left: '←', right: '→', backspace: '⌫', delete: 'Del', tab: 'Tab', space: 'Space',
};
const ARIA_KEYS = {
  mod: isMac ? 'Meta' : 'Control', shift: 'Shift', alt: 'Alt', ctrl: 'Control', meta: 'Meta',
  enter: 'Enter', esc: 'Escape', escape: 'Escape', up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
  backspace: 'Backspace', delete: 'Delete', tab: 'Tab', space: 'Space',
};

/** "mod+shift+p" -> <span class="rig-menu__keys"><kbd>⌘</kbd><kbd>⇧</kbd><kbd>P</kbd></span> */
export function renderShortcut(shortcut, className = 'rig-menu__keys') {
  if (!shortcut) return null;
  const wrap = h('span', { class: className, 'aria-hidden': 'true' });
  for (const key of shortcut.trim().split('+')) {
    const k = key.trim().toLowerCase();
    wrap.append(h('kbd', { class: 'rig-kbd' }, KEY_LABELS[k] ?? key.trim().toUpperCase()));
  }
  return wrap;
}

/** "mod+shift+p" -> "Control+Shift+P" for aria-keyshortcuts. */
export function ariaShortcut(shortcut) {
  if (!shortcut) return null;
  return shortcut.trim().split('+').map((key) => {
    const k = key.trim().toLowerCase();
    return ARIA_KEYS[k] ?? (k.length === 1 ? k.toUpperCase() : key.trim());
  }).join('+');
}

/** Does a keydown match "mod+b" style text? */
export function matchesShortcut(e, shortcut) {
  const parts = shortcut.toLowerCase().split('+').map((s) => s.trim());
  let key = parts.pop();
  if (key === '' && parts[parts.length - 1] === '') { parts.pop(); key = '+'; } // "mod++"
  key = KEY_ALIASES[key] ?? key;
  const want = new Set(parts);
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (want.has('mod') !== mod) return false;
  if (want.has('ctrl') && !e.ctrlKey) return false;
  if (want.has('shift') !== e.shiftKey) return false;
  if (want.has('alt') !== e.altKey) return false;
  if ((e.key || '').toLowerCase() === key) return true;
  // Alt/Option changes e.key on some layouts (⌥N types "˜"), so fall back to the physical key.
  if (/^[a-z]$/.test(key)) return e.code === `Key${key.toUpperCase()}`;
  if (/^[0-9]$/.test(key)) return e.code === `Digit${key}`;
  return false;
}

const KEY_ALIASES = { esc: 'escape', up: 'arrowup', down: 'arrowdown', left: 'arrowleft', right: 'arrowright', space: ' ', del: 'delete' };

/** Briefly flash an element (a menu trigger whose shortcut just fired). */
export function flash(el) {
  if (!el) return;
  el.classList.remove('rig-shortcut-flash');
  void el.offsetWidth; // restart the animation
  el.classList.add('rig-shortcut-flash');
  el.addEventListener('animationend', () => el.classList.remove('rig-shortcut-flash'), { once: true });
}

/** True when a modal dialog is open and `el` isn't inside it (so `el` is inert). */
export function behindModal(el) {
  let modal = null;
  try { modal = document.querySelector('dialog:modal'); } catch { return false; }
  return Boolean(modal) && !modal.contains(el);
}

/* ---------- parsing ---------- */

/** Run fn now, or after the parser finishes if the document is still loading. */
export function whenParsed(fn) {
  if (!hasDOM || document.readyState !== 'loading') fn();
  else document.addEventListener('DOMContentLoaded', fn, { once: true });
}
