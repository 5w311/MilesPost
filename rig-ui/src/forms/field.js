// Shared DOM helpers for the forms category: ids, aria-describedby wiring,
// inline error messages and spring timings exposed to CSS.

import { animate, springEasing, springs } from '../motion.js';
import { h, paths, svgIcon, uid } from '../util.js';
import { validityMessage } from './field-logic.js';

/** Kind of choice a native control represents, for message wording. */
export function kindOf(control) {
  if (!control) return 'text';
  if (control.type === 'checkbox') return 'checkbox';
  if (control.type === 'radio') return 'radio';
  if (control.localName === 'select') return 'select';
  return 'text';
}

/**
 * Friendly message for a native control's current validity ('' when valid).
 * A custom validity message wins, then `override` (an error slot) or
 * data-error on the control, then generated copy. An empty required text
 * field always gets "Enter the <label>." since the override usually
 * describes the format.
 */
export function controlMessage(control, { label = '', override = '' } = {}) {
  const v = control?.validity;
  if (!v || v.valid) return '';
  if (v.customError) return control.validationMessage;
  const emptyText = v.valueMissing && kindOf(control) === 'text';
  const custom = override || control.dataset?.error;
  if (custom && !emptyText) return custom;
  return validityMessage(v, {
    label,
    kind: kindOf(control),
    type: control.type,
    value: control.value,
    minLength: control.minLength,
    maxLength: control.maxLength,
    min: control.min,
    max: control.max,
    step: control.step,
    title: control.title,
  }) || control.validationMessage;
}

/** True when `el` lays out right-to-left (nearest dir attribute or CSS direction). */
export function isRtl(el) {
  return typeof getComputedStyle === 'function' && el?.isConnected ? getComputedStyle(el).direction === 'rtl' : false;
}

/** Swap ArrowLeft/ArrowRight in right-to-left layouts so arrows follow what's on screen. */
export function visualKey(key, rtl) {
  if (!rtl) return key;
  if (key === 'ArrowLeft') return 'ArrowRight';
  if (key === 'ArrowRight') return 'ArrowLeft';
  return key;
}

/**
 * Mark which physical sides of a sideways scroller have hidden content, for
 * edge fades: host gets is-scrollable, fade-left, fade-right. Handles RTL,
 * where scrollLeft runs from 0 (start, at the right) to negative values.
 */
export function scrollEdges(host, scroller) {
  const max = scroller.scrollWidth - scroller.clientWidth;
  const pos = Math.abs(scroller.scrollLeft);
  const rtl = isRtl(scroller);
  const beforeStart = max > 1 && pos > 1;
  const pastEnd = max > 1 && pos < max - 1;
  host.classList.toggle('is-scrollable', max > 1);
  host.classList.toggle('fade-left', rtl ? pastEnd : beforeStart);
  host.classList.toggle('fade-right', rtl ? beforeStart : pastEnd);
}

export function ensureId(el, prefix = 'rig-field') {
  if (!el.id) el.id = uid(prefix);
  return el.id;
}

function tokens(el, attr) {
  return (el.getAttribute(attr) || '').split(/\s+/).filter(Boolean);
}

export function addDescribedBy(el, id) {
  if (!el || !id) return;
  const list = tokens(el, 'aria-describedby');
  if (!list.includes(id)) el.setAttribute('aria-describedby', [...list, id].join(' '));
}

export function removeDescribedBy(el, id) {
  if (!el || !id) return;
  const list = tokens(el, 'aria-describedby').filter((t) => t !== id);
  if (list.length) el.setAttribute('aria-describedby', list.join(' '));
  else el.removeAttribute('aria-describedby');
}

/**
 * Expose spring timings to CSS on `el`, so plain transitions can spring:
 *   transition: transform var(--_spring-ms) var(--_spring);
 * Sets --_spring/--_spring-ms (lively) and --_snappy/--_snappy-ms.
 */
export function springVars(el) {
  const lively = springEasing(springs.lively);
  const snappy = springEasing(springs.snappy);
  el.style.setProperty('--_spring', lively.easing);
  el.style.setProperty('--_spring-ms', `${lively.duration}ms`);
  el.style.setProperty('--_snappy', snappy.easing);
  el.style.setProperty('--_snappy-ms', `${snappy.duration}ms`);
}

/** The inline message element used under every field. */
export function errorNode() {
  return h('div', { class: 'rig-field__error', id: uid('rig-error'), hidden: true });
}

/**
 * Show or clear an inline error. `targets` are the focusable elements that
 * should point at the message (aria-describedby) and carry aria-invalid.
 */
export function renderError(node, message, targets = []) {
  const text = String(message || '').trim();
  const wasShown = !node.hidden;
  if (text) {
    const current = node.querySelector('.rig-field__error-text');
    if (current && current.textContent === text && wasShown) return;
    node.replaceChildren(
      svgIcon(paths.alert, { size: 15, className: 'rig-field__error-icon' }),
      h('span', { class: 'rig-field__error-text' }, text),
    );
    node.hidden = false;
    for (const t of targets) {
      if (!t) continue;
      addDescribedBy(t, node.id);
      t.setAttribute('aria-invalid', 'true');
    }
    if (!wasShown) {
      animate(node, [
        { opacity: 0, transform: 'translateY(-5px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ], { spring: springs.snappy, fill: 'none' });
    }
  } else {
    node.hidden = true;
    node.replaceChildren();
    for (const t of targets) {
      if (!t) continue;
      removeDescribedBy(t, node.id);
      t.removeAttribute('aria-invalid');
    }
  }
}

/** Text of a `slot="name"` child, removed from the DOM. */
export function takeSlot(host, name) {
  const el = host.querySelector(`:scope > [slot="${name}"]`);
  if (!el) return null;
  el.remove();
  el.removeAttribute('slot');
  return el;
}

/** True when `el` sits inside a <rig-form>, which then owns validation. */
export function inRigForm(el) {
  return Boolean(el.closest('rig-form'));
}
