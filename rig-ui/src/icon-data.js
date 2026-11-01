// Icon geometry for <rig-icon>. Pure data, no DOM.
// Every icon is exactly three strokes on a 24x24 grid plus a rotation for the
// whole glyph. Each stroke is [x1, y1, x2, y2, opacity].

const C = 12;
const hidden = (x = C, y = C) => [x, y, x, y, 0];

const plus = [[5, 12, 19, 12, 1], hidden(), [12, 5, 12, 19, 1]];
const arrow = [[4.5, 12, 19.5, 12, 1], [13, 5.5, 19.5, 12, 1], [13, 18.5, 19.5, 12, 1]];
const chevron = [hidden(15.5, 12), [9, 5.5, 15.5, 12, 1], [9, 18.5, 15.5, 12, 1]];

export const ICONS = {
  menu: { strokes: [[4, 7, 20, 7, 1], [4, 12, 20, 12, 1], [4, 17, 20, 17, 1]], rotate: 0 },
  text: { strokes: [[4, 7, 20, 7, 1], [4, 12, 14, 12, 1], [4, 17, 17, 17, 1]], rotate: 0 },
  close: { strokes: [[3.5, 12, 20.5, 12, 1], hidden(), [12, 3.5, 12, 20.5, 1]], rotate: 45 },
  plus: { strokes: plus, rotate: 0 },
  minus: { strokes: [[5, 12, 19, 12, 1], hidden(), hidden()], rotate: 0 },
  check: { strokes: [[4.5, 12.5, 9.5, 17.5, 1], hidden(9.5, 17.5), [9.5, 17.5, 19.5, 7, 1]], rotate: 0 },
  'arrow-right': { strokes: arrow, rotate: 0 },
  'arrow-down': { strokes: arrow, rotate: 90 },
  'arrow-left': { strokes: arrow, rotate: 180 },
  'arrow-up': { strokes: arrow, rotate: -90 },
  'chevron-right': { strokes: chevron, rotate: 0 },
  'chevron-down': { strokes: chevron, rotate: 90 },
  'chevron-left': { strokes: chevron, rotate: 180 },
  'chevron-up': { strokes: chevron, rotate: -90 },
  play: { strokes: [[7, 4.5, 7, 19.5, 1], [7, 19.5, 19, 12, 1], [19, 12, 7, 4.5, 1]], rotate: 0 },
  pause: { strokes: [[8, 5, 8, 19, 1], [16, 19, 16, 5, 1], hidden(16, 5)], rotate: 0 },
  more: { strokes: [[5, 12, 5.01, 12, 1], [12, 12, 12.01, 12, 1], [19, 12, 19.01, 12, 1]], rotate: 0 },
  'more-vertical': { strokes: [[5, 12, 5.01, 12, 1], [12, 12, 12.01, 12, 1], [19, 12, 19.01, 12, 1]], rotate: 90 },
};

export const iconNames = Object.keys(ICONS);
