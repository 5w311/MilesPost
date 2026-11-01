// Button extras: a loading state whose width springs as the label swaps.
//
//   import { setButtonLoading, withButtonLoading } from './forms/index.js'
//   setButtonLoading(button, true)                       // spinner + "Saving…"
//   setButtonLoading(button, true, { text: 'Sending BOL…' })
//   setButtonLoading(button, false)                      // original label back
//   await withButtonLoading(button, () => save())        // both, around a promise
//
// While loading the button gets aria-busy, aria-disabled and .is-loading, and
// swallows clicks. It keeps focus (unlike `disabled`, which would drop it).
// If the button is stretched by its layout (full-width, grid cell) only the
// label swaps; otherwise its width springs between the two labels.
//
// CSS in this category also adds .rig-btn--danger and icon spacing: a
// <rig-icon> (or any child with class rig-btn__icon) in a .rig-btn sits
// 0.25rem closer to the button edge than text would, at either end, while
// keeping the normal gap to the label. Plain text works, no wrapper needed:
//   <button class="rig-btn"><rig-icon name="plus"></rig-icon> Add stop</button>
//   <button class="rig-btn">Next stop <rig-icon name="arrow-right"></rig-icon></button>

import { animate, reducedMotion, springs } from '../motion.js';
import { h } from '../util.js';

const state = new WeakMap();

function guard(e) {
  e.preventDefault();
  e.stopImmediatePropagation();
}

// Width the button would have if nothing stretched it.
function naturalWidth(button) {
  const prev = button.style.width;
  button.style.width = 'max-content';
  const w = button.getBoundingClientRect().width;
  button.style.width = prev;
  return w;
}

function swap(button, nodes, wrapperClass) {
  const before = button.getBoundingClientRect().width;
  const stretched = Math.abs(before - naturalWidth(button)) > 1;
  const wrap = h('span', { class: wrapperClass });
  wrap.append(...nodes);
  button.replaceChildren(wrap);
  const after = button.getBoundingClientRect().width;
  const still = reducedMotion();

  if (!still) {
    animate(wrap, [
      { opacity: 0, transform: 'translateY(35%) scale(0.96)', filter: 'blur(2px)' },
      { opacity: 1, transform: 'none', filter: 'blur(0px)' },
    ], { spring: springs.snappy, fill: 'none' });
  }
  if (!stretched && !still && Math.abs(after - before) > 0.5) {
    button.classList.add('is-resizing');
    const anim = animate(button, [{ width: `${before}px` }, { width: `${after}px` }], { spring: springs.snappy, fill: 'none' });
    anim.finished.catch(() => {}).finally(() => button.classList.remove('is-resizing'));
    return { wrap, anim };
  }
  return { wrap, anim: null };
}

/**
 * Put a button into (or out of) its loading state.
 * @param {HTMLElement} button
 * @param {boolean} loading
 * @param {{ text?: string }} options label shown next to the spinner
 */
export function setButtonLoading(button, loading = true, { text = 'Saving…' } = {}) {
  if (!button) return Promise.resolve();
  const current = state.get(button);
  if (loading) {
    if (current) {
      const label = current.busy.querySelector('.rig-btn__busy-text');
      if (label && label.textContent !== text) label.textContent = text;
      return Promise.resolve();
    }
    const saved = [...button.childNodes];
    const busy = [h('span', { class: 'rig-spinner', 'aria-hidden': 'true' }), h('span', { class: 'rig-btn__busy-text' }, text)];
    button.classList.add('is-loading');
    button.setAttribute('aria-busy', 'true');
    button.setAttribute('aria-disabled', 'true');
    button.addEventListener('click', guard, true);
    const { wrap, anim } = swap(button, busy, 'rig-btn__swap');
    state.set(button, { saved, busy: wrap });
    return anim ? anim.finished.catch(() => {}) : Promise.resolve();
  }
  if (!current) return Promise.resolve();
  state.delete(button);
  button.classList.remove('is-loading');
  button.removeAttribute('aria-busy');
  button.removeAttribute('aria-disabled');
  button.removeEventListener('click', guard, true);
  const { wrap, anim } = swap(button, current.saved, 'rig-btn__swap');
  // Unwrap once settled so the button's DOM is exactly what it was.
  const unwrap = () => { if (wrap.parentNode === button && !state.has(button)) wrap.replaceWith(...wrap.childNodes); };
  const done = anim ? anim.finished.catch(() => {}) : Promise.resolve();
  return done.then(() => new Promise((r) => setTimeout(r, reducedMotion() ? 0 : 260))).then(unwrap);
}

/** Show the loading state while `work` (a promise or function returning one) runs. */
export async function withButtonLoading(button, work, options) {
  setButtonLoading(button, true, options);
  try {
    return await (typeof work === 'function' ? work() : work);
  } finally {
    setButtonLoading(button, false);
  }
}

export function isButtonLoading(button) {
  return state.has(button);
}
