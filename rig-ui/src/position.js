// Anchored positioning for floating layers (popovers, menus, tooltips, pickers).
//
//   import { place, follow } from './position.js'
//   const stop = follow(button, panel, { placement: 'bottom-start', offset: 6 })
//   ...later: stop()
//
// The floating element should be `position: fixed` (ideally in the top layer via
// the popover attribute or a <dialog>). `place` measures once; `follow` keeps it
// placed through scrolling, resizing and size changes until you call the
// returned cleanup.
//
// Placement: 'top' | 'bottom' | 'left' | 'right', optionally with '-start' or
// '-end'. Flips to the opposite side when there's more room there, and shifts
// along the other axis to stay inside the viewport.

const OPPOSITE = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

/**
 * Pure placement math. All rects are viewport-relative.
 * @param {{left:number, top:number, width:number, height:number}} anchor
 * @param {{width:number, height:number}} size floating element size
 * @param {{ placement?: string, offset?: number, padding?: number, flip?: boolean, shift?: boolean, viewport?: {width:number, height:number} }} options
 * @returns {{ x:number, y:number, placement:string, side:string, align:string, origin:string, arrow:number, maxHeight:number, maxWidth:number }}
 */
export function computePosition(anchor, size, options = {}) {
  const {
    placement = 'bottom',
    offset = 8,
    padding = 8,
    flip = true,
    shift = true,
    viewport = { width: 1024, height: 768 },
  } = options;
  let [side, align = 'center'] = placement.split('-');
  const vertical = side === 'top' || side === 'bottom';

  const space = {
    top: anchor.top - offset - padding,
    bottom: viewport.height - (anchor.top + anchor.height) - offset - padding,
    left: anchor.left - offset - padding,
    right: viewport.width - (anchor.left + anchor.width) - offset - padding,
  };
  const need = vertical ? size.height : size.width;
  if (flip && space[side] < need && space[OPPOSITE[side]] > space[side]) side = OPPOSITE[side];

  let x;
  let y;
  if (side === 'bottom') y = anchor.top + anchor.height + offset;
  if (side === 'top') y = anchor.top - offset - size.height;
  if (side === 'right') x = anchor.left + anchor.width + offset;
  if (side === 'left') x = anchor.left - offset - size.width;

  if (vertical) {
    if (align === 'start') x = anchor.left;
    else if (align === 'end') x = anchor.left + anchor.width - size.width;
    else x = anchor.left + anchor.width / 2 - size.width / 2;
  } else {
    if (align === 'start') y = anchor.top;
    else if (align === 'end') y = anchor.top + anchor.height - size.height;
    else y = anchor.top + anchor.height / 2 - size.height / 2;
  }

  if (shift) {
    if (vertical) x = Math.min(Math.max(padding, x), Math.max(padding, viewport.width - padding - size.width));
    else y = Math.min(Math.max(padding, y), Math.max(padding, viewport.height - padding - size.height));
  }

  // Where the anchor's centre falls along the floating element's edge (for arrows).
  const arrow = vertical
    ? anchor.left + anchor.width / 2 - x
    : anchor.top + anchor.height / 2 - y;

  // Grow out of the anchor.
  const originAxis = vertical ? `${Math.round(arrow)}px` : `${Math.round(arrow)}px`;
  const origin = {
    bottom: `${originAxis} 0`,
    top: `${originAxis} 100%`,
    right: `0 ${originAxis}`,
    left: `100% ${originAxis}`,
  }[side];

  return {
    x: Math.round(x),
    y: Math.round(y),
    side,
    align,
    placement: align === 'center' ? side : `${side}-${align}`,
    origin,
    arrow,
    maxHeight: Math.max(120, vertical ? space[side] : viewport.height - padding * 2),
    maxWidth: Math.max(160, vertical ? viewport.width - padding * 2 : space[side]),
  };
}

/** Measure and position `floating` next to `anchor` once. Returns the result. */
export function place(anchor, floating, options = {}) {
  const a = anchor.getBoundingClientRect();
  const size = { width: floating.offsetWidth, height: floating.offsetHeight };
  const viewport = {
    width: document.documentElement.clientWidth,
    height: window.visualViewport?.height ?? window.innerHeight,
  };
  const r = computePosition(a, size, { ...options, viewport });
  floating.style.position = 'fixed';
  floating.style.left = `${r.x}px`;
  floating.style.top = `${r.y}px`;
  floating.style.margin = '0';
  floating.style.transformOrigin = r.origin;
  floating.style.setProperty('--rig-arrow', `${Math.round(r.arrow)}px`);
  floating.style.setProperty('--rig-available-height', `${Math.round(r.maxHeight)}px`);
  floating.style.setProperty('--rig-available-width', `${Math.round(r.maxWidth)}px`);
  floating.dataset.side = r.side;
  return r;
}

/**
 * Keep `floating` placed against `anchor` until the returned function is called.
 * Accepts a virtual anchor too: { getBoundingClientRect() } (e.g. a pointer point).
 */
export function follow(anchor, floating, options = {}) {
  let raf = 0;
  const update = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (anchor.isConnected === false) return;
      place(anchor, floating, options);
      options.onPlace?.(floating.dataset.side);
    });
  };
  place(anchor, floating, options);
  window.addEventListener('scroll', update, { capture: true, passive: true });
  window.addEventListener('resize', update);
  window.visualViewport?.addEventListener('resize', update);
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
  ro?.observe(floating);
  if (anchor instanceof Element) ro?.observe(anchor);
  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('scroll', update, { capture: true });
    window.removeEventListener('resize', update);
    window.visualViewport?.removeEventListener('resize', update);
    ro?.disconnect();
  };
}

/** A virtual anchor at a point, e.g. for context menus: pointAnchor(e.clientX, e.clientY). */
export function pointAnchor(x, y) {
  return { getBoundingClientRect: () => ({ left: x, top: y, width: 0, height: 0, right: x, bottom: y }) };
}
