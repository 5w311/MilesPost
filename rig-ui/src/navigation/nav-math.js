// Pure logic for navigation components. No DOM access.
//
//   pageCount(total, perPage)                 pages needed for `total` items
//   pageRange(page, count, { siblings, boundaries })
//       page buttons with gaps, always the same number of slots so the bar
//       doesn't change width as you page: 1 … 4 5 [6] 7 8 … 20
//   collapseCount(widths, available, ellipsis, { keepStart, keepEnd, gap })
//       how many middle breadcrumb items to fold into "…" so the trail fits
//   stepIndex(count, from, delta, isDisabled, { wrap })
//       next enabled index for arrow-key roving focus

export const GAP = '…';

export function pageCount(total, perPage = 10) {
  const t = Math.max(0, Math.floor(Number(total) || 0));
  const p = Math.max(1, Math.floor(Number(perPage) || 1));
  return Math.max(1, Math.ceil(t / p));
}

export function clampPage(page, count) {
  const n = Math.floor(Number(page) || 1);
  return Math.min(Math.max(1, n), Math.max(1, count));
}

/**
 * Page numbers to show, with GAP ('…') where pages are skipped.
 * `siblings` pages either side of the current one, `boundaries` pages at each end.
 * When pages are skipped the result always has boundaries * 2 + siblings * 2 + 3 slots.
 */
export function pageRange(page, count, { siblings = 1, boundaries = 1 } = {}) {
  const n = Math.max(1, Math.floor(count));
  const s = Math.max(0, Math.floor(siblings));
  const b = Math.max(1, Math.floor(boundaries));
  const current = clampPage(page, n);
  const slots = b * 2 + s * 2 + 3;
  const range = (from, to) => Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);
  if (n <= slots) return range(1, n);

  const start = Math.max(Math.min(current - s, n - b - s * 2 - 1), b + 2);
  const end = Math.min(Math.max(current + s, b + s * 2 + 2), n - b - 1);
  return [
    ...range(1, b),
    start > b + 2 ? GAP : b + 1,
    ...range(start, end),
    end < n - b - 1 ? GAP : n - b,
    ...range(n - b + 1, n),
  ];
}

/**
 * Breadcrumb collapsing. `widths` are the natural widths of every item,
 * `available` the room for the trail, `ellipsis` the width of the "…" item.
 * Middle items are hidden from the start side first, so the current page and
 * its parent stay visible longest. Returns how many items to hide, starting at
 * index `keepStart`.
 */
export function collapseCount(widths, available, ellipsis, { keepStart = 1, keepEnd = 1, gap = 0 } = {}) {
  const n = widths.length;
  const total = (list) => list.reduce((sum, w) => sum + w, 0) + Math.max(0, list.length - 1) * gap;
  if (total(widths) <= available) return 0;
  const max = Math.max(0, n - keepStart - keepEnd);
  for (let hide = 1; hide <= max; hide++) {
    const shown = [...widths.slice(0, keepStart), ellipsis, ...widths.slice(keepStart + hide)];
    if (total(shown) <= available) return hide;
  }
  return max;
}

/**
 * Step from `from` by `delta` (+1/-1) to the next index that isn't disabled.
 * Wraps around by default. Returns `from` when every other index is disabled.
 */
export function stepIndex(count, from, delta, isDisabled = () => false, { wrap = true } = {}) {
  if (count <= 0) return -1;
  let i = from;
  for (let tries = 0; tries < count; tries++) {
    i += delta;
    if (i < 0 || i >= count) {
      if (!wrap) return from;
      i = (i + count) % count;
    }
    if (!isDisabled(i)) return i;
  }
  return from;
}

/** First (delta = 1) or last (delta = -1) enabled index, or -1. */
export function edgeIndex(count, delta, isDisabled = () => false) {
  for (let k = 0; k < count; k++) {
    const i = delta > 0 ? k : count - 1 - k;
    if (!isDisabled(i)) return i;
  }
  return -1;
}
