// Extra 24x24 stroke icon paths for the display components. Rendered with
// svgIcon() from ../util.js, so they inherit currentColor.

import { paths as base, svgIcon } from '../util.js';

export const icons = {
  ...base,
  warn: ['M12 4 21.5 20h-19z', 'M12 10v4.5', 'M12 17.3v.1'],
  bad: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'm9 9 6 6', 'm15 9-6 6'],
  file: ['M6 3h8l4 4v14H6z', 'M14 3v4h4'],
  pdf: ['M6 3h8l4 4v14H6z', 'M14 3v4h4', 'M9 13h6', 'M9 16.5h4'],
  doc: ['M6 3h8l4 4v14H6z', 'M14 3v4h4', 'M9 11h6', 'M9 14h6', 'M9 17h4'],
  sheet: ['M5 4h14v16H5z', 'M5 9.5h14', 'M5 14.5h14', 'M10.5 9.5V20'],
  slides: ['M4 5h16v11H4z', 'M12 16v4', 'M8.5 20h7'],
  image: ['M4 5h16v14H4z', 'm4 16 4.5-4.5 4 4L15 13l5 5', 'M15.5 9.5v.1'],
  archive: ['M5 4h14v16H5z', 'M11 4v2h2v2h-2v2h2v2h-2'],
  audio: ['M9 18V6l10-2v12', 'M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z', 'M19 16a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z'],
  video: ['M4 6h11v12H4z', 'm15 10.5 5-3v9l-5-3'],
  code: ['m8.5 8-4 4 4 4', 'm15.5 8 4 4-4 4', 'm13.5 5.5-3 13'],
  text: ['M6 3h8l4 4v14H6z', 'M14 3v4h4', 'M9 12h6', 'M9 15.5h6'],
  inbox: ['M4 13.5 6.5 5h11l2.5 8.5V19H4z', 'M4 13.5h4.5l1 2h5l1-2H20'],
  truck: ['M3 6h11v10H3z', 'M14 9.5h4l3 3.5v3h-7', 'M7.5 18.5a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5z', 'M17.5 18.5a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5z'],
  route: ['M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z', 'M18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4z', 'M8 17h7.5a3 3 0 0 0 0-6h-7a3 3 0 0 1 0-6H16'],
  zoomIn: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'm20 20-3.5-3.5', 'M11 8v6', 'M8 11h6'],
  zoomOut: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'm20 20-3.5-3.5', 'M8 11h6'],
  pause: ['M9 6v12', 'M15 6v12'],
  play: ['M8 5.5v13l10.5-6.5z'],
  external: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v6H4V6h6'],
};

/** An SVG icon by name from the set above. */
export const icon = (name, opts) => svgIcon(icons[name] ?? icons.file, opts);
