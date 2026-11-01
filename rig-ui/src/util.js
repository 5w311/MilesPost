// Small shared helpers.

let counter = 0;
export const uid = (prefix = 'rig') => `${prefix}-${(++counter).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);

/** Tiny element builder: h('button', { class: 'x', onclick }, 'Label') */
export function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (key === 'class') node.className = value;
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key === 'html') node.innerHTML = value;
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** Inline SVG from a list of path "d" strings, 24x24 stroke icons. */
export function svgIcon(paths, { size = 16, stroke = 2, fill = 'none', className = '' } = {}) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', fill);
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', stroke);
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  if (className) svg.setAttribute('class', className);
  for (const d of paths) {
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}

/** 75 -> "1:15", 3725 -> "1:02:05" */
export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const hr = Math.floor(seconds / 3600);
  const ss = String(s).padStart(2, '0');
  return hr ? `${hr}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Copy text, falling back to a hidden textarea + execCommand. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

/** Element is in a text field where single-key shortcuts must not fire. */
export function isTyping(target) {
  if (!target || !(target instanceof Element)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return !['checkbox', 'radio', 'button', 'submit', 'range'].includes(target.type);
  return false;
}

/** Define a custom element once (safe to import twice). */
export function define(name, ctor) {
  if (typeof customElements !== 'undefined' && !customElements.get(name)) customElements.define(name, ctor);
}

/** Common icon paths (24x24, stroke). */
export const paths = {
  search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'm20 20-3.5-3.5'],
  check: ['M5 12.5 10 17.5 19.5 7'],
  checkCircle: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'm8.5 12.2 2.4 2.4 4.6-5'],
  alert: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7.5v5.5', 'M12 16.4v.1'],
  info: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 11v5.5', 'M12 7.6v.1'],
  close: ['M6 6l12 12', 'M18 6 6 18'],
  chevronDown: ['m6 9 6 6 6-6'],
  chevronLeft: ['m15 6-6 6 6 6'],
  chevronRight: ['m9 6 6 6-6 6'],
  copy: ['M9 9h10v10H9z', 'M5 15V5h10'],
  retry: ['M4 12a8 8 0 0 1 13.7-5.6L20 9', 'M20 4v5h-5', 'M20 12a8 8 0 0 1-13.7 5.6L4 15', 'M4 20v-5h5'],
  volume: ['M4 9.5h3.5L12 5.5v13l-4.5-4H4z', 'M15.5 9a4 4 0 0 1 0 6', 'M18 6.5a7.5 7.5 0 0 1 0 11'],
  volumeLow: ['M4 9.5h3.5L12 5.5v13l-4.5-4H4z', 'M15.5 9a4 4 0 0 1 0 6'],
  mute: ['M4 9.5h3.5L12 5.5v13l-4.5-4H4z', 'm16 9.5 5 5', 'm21 9.5-5 5'],
  fullscreen: ['M4 9V4h5', 'M15 4h5v5', 'M20 15v5h-5', 'M9 20H4v-5'],
  exitFullscreen: ['M9 4v5H4', 'M20 9h-5V4', 'M15 20v-5h5', 'M4 15h5v5'],
  pip: ['M3 6h18v12H3z', 'M12.5 11.5h6v4.5h-6z'],
  sparkle: ['M12 3.5 13.8 9 19.5 10.5 13.8 12 12 17.5 10.2 12 4.5 10.5 10.2 9z', 'M19 16.5v4', 'M17 18.5h4'],
  arrowUp: ['M12 19V5', 'm5.5 11.5 6.5-6.5 6.5 6.5'],
  stop: ['M7 7h10v10H7z'],
  undo: ['M9 14 4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11'],
};
