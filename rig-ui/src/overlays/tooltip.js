// Tooltips for any element with data-tip. Importing this file turns them on.
//
//   import './rig-ui/src/overlays/tooltip.js'
//   <button class="rig-btn rig-btn--icon" data-tip="Add fuel stop"><svg …/></button>
//   <span data-tip="Hours left on your 14-hour clock" data-tip-placement="right">9:40</span>
//
// The first tooltip waits about half a second. Once one has shown, moving to
// another trigger within ~600 ms shows the next one at once, and the bubble
// glides from the old trigger to the new one instead of fading out and in.
// Escape hides it, scrolling hides it, a press on the trigger hides it, and on
// touch a long press shows it.
//
// Accessibility: a trigger with no accessible name (an icon button) gets the
// tip as its aria-label. Any other trigger gets it as a description through
// aria-describedby, unless the tip just repeats the trigger's own text.
//
// Attributes on triggers: data-tip (text), data-tip-placement (top default,
//   bottom, left, right, optionally -start/-end).
// API: tooltip.show(el), tooltip.hide(), tooltip.delay (ms, default 500).

import { computePosition } from '../position.js';
import { springDriver, springs } from '../motion.js';
import { h, uid } from '../util.js';
import { longPress, whenParsed } from './layer.js';

const hasDOM = typeof document !== 'undefined';
const WARM = 600;
const HIDE_GRACE = 80;

let delay = 500;
let bubble = null;
let textEl = null;
let driver = null;
let current = null; // trigger the tooltip belongs to (visible or fading in)
let pending = null;
let openTimer = 0;
let hideTimer = 0;
let lastHide = -Infinity;
let suppressed = null; // trigger pressed while its tip showed; don't reshow until left
let touchHide = 0;
let descBox = null;
const described = new WeakMap(); // trigger -> description element

function ensureBubble() {
  if (bubble) return;
  textEl = h('span', { class: 'rig-tip__text' });
  bubble = h('div', { class: 'rig-tip', role: 'tooltip', 'aria-hidden': 'true', popover: 'manual' }, textEl);
  document.body.append(bubble);
  // [x, y, width, height, opacity, scale]
  driver = springDriver([0, 0, 0, 0, 0, 0.94], springs.snappy, render);
}

function render([x, y, w, ht, o, s]) {
  bubble.style.translate = `${x.toFixed(2)}px ${y.toFixed(2)}px`;
  bubble.style.width = `${Math.max(0, w).toFixed(2)}px`;
  bubble.style.height = `${Math.max(0, ht).toFixed(2)}px`;
  bubble.style.opacity = String(Math.min(1, Math.max(0, o)));
  bubble.style.scale = String(s);
  if (o === 0 && !current) {
    try { bubble.hidePopover(); } catch { /* not shown */ }
  }
}

function show(trigger) {
  const text = trigger?.getAttribute('data-tip');
  if (!text || !trigger.isConnected) return;
  ensureBubble();
  clearTimeout(openTimer);
  clearTimeout(hideTimer);
  pending = null;
  const wasVisible = Boolean(current) || driver.value[4] > 0.02;
  const warm = performance.now() - lastHide < WARM;
  current = trigger;
  textEl.textContent = text;
  // Re-enter the top layer each time so the bubble sits above any dialog opened since.
  try {
    if (bubble.matches(':popover-open')) bubble.hidePopover();
    bubble.showPopover();
  } catch { bubble.style.display = 'block'; }
  const size = { width: textEl.offsetWidth, height: textEl.offsetHeight };
  const viewport = { width: document.documentElement.clientWidth, height: window.visualViewport?.height ?? window.innerHeight };
  const r = computePosition(trigger.getBoundingClientRect(), size, {
    placement: trigger.getAttribute('data-tip-placement') || 'top',
    offset: 7,
    viewport,
  });
  bubble.dataset.side = r.side;
  const target = [r.x, r.y, size.width, size.height, 1, 1];
  if (wasVisible || warm) {
    // Glide from wherever the bubble is (or last was) to the new trigger.
    if (!wasVisible) driver.to([...driver.value.slice(0, 4), 0, 1], { immediate: true });
    driver.to(target);
  } else {
    bubble.style.transformOrigin = r.origin;
    driver.to([r.x, r.y, size.width, size.height, 0, 0.94], { immediate: true });
    driver.to(target);
  }
}

function hide({ instant = false } = {}) {
  clearTimeout(openTimer);
  clearTimeout(hideTimer);
  pending = null;
  if (!current) return;
  current = null;
  lastHide = performance.now();
  const v = driver.value;
  driver.to([v[0], v[1], v[2], v[3], 0, v[5]], { immediate: instant });
}

function scheduleShow(trigger) {
  clearTimeout(openTimer);
  clearTimeout(hideTimer);
  if (trigger === current) return;
  const warm = current || performance.now() - lastHide < WARM;
  if (warm) { show(trigger); return; }
  pending = trigger;
  openTimer = setTimeout(() => {
    // Still wanted? (The page may have scrolled the trigger away from the pointer.)
    if (pending === trigger && trigger.matches(':hover, :focus-visible')) show(trigger);
    else if (pending === trigger) pending = null;
  }, delay);
}

function scheduleHide() {
  clearTimeout(openTimer);
  pending = null;
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => hide(), HIDE_GRACE);
}

const tipOf = (node) => (node instanceof Element ? node.closest('[data-tip]') : null);

/* ---------- accessible names and descriptions ---------- */

function hasName(el) {
  if (el.hasAttribute('aria-labelledby')) return true;
  if (el.hasAttribute('aria-label') && el.getAttribute('data-tip-label') !== 'auto') return true;
  if (el.textContent.trim()) return true;
  return Boolean(el.querySelector('img[alt]:not([alt=""]), [aria-label]:not(svg)'));
}

function removeId(el, attr, id) {
  const ids = (el.getAttribute(attr) || '').split(/\s+/).filter((x) => x && x !== id);
  if (ids.length) el.setAttribute(attr, ids.join(' '));
  else el.removeAttribute(attr);
}

function wire(el) {
  const tip = el.getAttribute('data-tip');
  const desc = described.get(el);
  if (!tip) {
    if (desc) { removeId(el, 'aria-describedby', desc.id); desc.remove(); described.delete(el); }
    if (el.getAttribute('data-tip-label') === 'auto') { el.removeAttribute('aria-label'); el.removeAttribute('data-tip-label'); }
    return;
  }
  if (!hasName(el)) {
    el.setAttribute('aria-label', tip);
    el.setAttribute('data-tip-label', 'auto');
    if (desc) { removeId(el, 'aria-describedby', desc.id); desc.remove(); described.delete(el); }
    return;
  }
  if (el.getAttribute('data-tip-label') === 'auto') { el.setAttribute('aria-label', tip); return; }
  if (el.textContent.trim().replace(/\s+/g, ' ') === tip.trim()) {
    if (desc) { removeId(el, 'aria-describedby', desc.id); desc.remove(); described.delete(el); }
    return;
  }
  if (!descBox) {
    descBox = h('div', { hidden: true, 'data-rig-tip-descriptions': '' });
    document.body.append(descBox);
  }
  let node = desc;
  if (!node) {
    node = h('span', { id: uid('rig-tip-d') });
    descBox.append(node);
    described.set(el, node);
  }
  node.textContent = tip;
  const ids = (el.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
  if (!ids.includes(node.id)) el.setAttribute('aria-describedby', [...ids, node.id].join(' '));
}

function wireTree(root) {
  if (!(root instanceof Element)) return;
  if (root.hasAttribute('data-tip')) wire(root);
  root.querySelectorAll('[data-tip]').forEach(wire);
}

/* ---------- install ---------- */

function install() {
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const t = tipOf(e.target);
    if (!t) return;
    if (t === suppressed) return;
    if (t === current) { clearTimeout(hideTimer); return; }
    scheduleShow(t);
  });
  // A scroll can cancel a pending tip while the pointer stays on the trigger
  // (no new pointerover follows); the next movement re-arms it.
  document.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch' || current || pending) return;
    const t = tipOf(e.target);
    if (t && t !== suppressed) scheduleShow(t);
  }, { passive: true });
  document.addEventListener('pointerout', (e) => {
    if (e.pointerType === 'touch') return;
    const t = tipOf(e.target);
    if (!t || t.contains(e.relatedTarget)) return;
    if (t === suppressed) suppressed = null;
    if (t === pending) { clearTimeout(openTimer); pending = null; }
    if (t === current) scheduleHide();
  });
  document.addEventListener('focusin', (e) => {
    const t = tipOf(e.target);
    if (t && t === e.target && t.matches(':focus-visible')) scheduleShow(t);
  });
  document.addEventListener('focusout', (e) => {
    const t = tipOf(e.target);
    if (t && (t === current || t === pending)) scheduleHide();
  });
  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') return;
    const t = tipOf(e.target);
    if (current || pending) {
      suppressed = t;
      hide({ instant: false });
    }
  }, true);
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !current) return;
    e.preventDefault();
    // Stays hidden until the pointer leaves this trigger (only matters if it's on it).
    suppressed = current.matches(':hover') ? current : null;
    hide();
  }, true);
  // A visible tip would be left behind by scrolling; a pending one re-checks hover when due.
  window.addEventListener('scroll', () => { if (current) hide({ instant: true }); }, { capture: true, passive: true });
  window.addEventListener('resize', () => hide({ instant: true }));
  window.addEventListener('blur', () => hide({ instant: true }));
  longPress(document.documentElement, (e) => {
    const t = tipOf(e.target);
    if (!t) return;
    show(t);
    clearTimeout(touchHide);
  }, { filter: (e) => Boolean(tipOf(e.target)) });
  document.addEventListener('pointerup', (e) => {
    if (e.pointerType !== 'touch' || !current) return;
    clearTimeout(touchHide);
    touchHide = setTimeout(() => hide(), 1500);
  });

  whenParsed(() => {
    wireTree(document.body);
    new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'attributes') wire(r.target);
        else r.addedNodes.forEach(wireTree);
        if (current && !current.isConnected) hide({ instant: true });
      }
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-tip'] });
  });
}

if (hasDOM && !window.__rigTooltip) {
  window.__rigTooltip = true;
  install();
}

export const tooltip = {
  show(el) { show(el); },
  hide() { hide(); },
  get delay() { return delay; },
  set delay(ms) { delay = Math.max(0, Number(ms) || 0); },
};
