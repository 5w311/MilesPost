// Pure formatting helpers for the display components. No DOM access, so they
// run under `node --test`.
//
//   hashString('Rosa Delgado')        -> 32-bit unsigned FNV-1a hash
//   avatarHue('Rosa Delgado')         -> 0, 30, 60 … 330 (degrees to rotate the accent hue)
//   initials('Rosa M. Delgado')       -> 'RD'
//   formatBytes(1_450_000)            -> '1.4 MB'
//   middleTruncate('fuel-receipt-2026-10-14-pilot-ocala.pdf', 24) -> 'fuel-receipt-…-ocala.pdf'
//   fileKind('bol.pdf')               -> 'pdf'
//   formatCount(140, 99)              -> '99+'
//   parseRatio('16/9')                -> 1.7777…

/** FNV-1a, 32-bit. Stable across runs and platforms. */
export function hashString(input) {
  const str = String(input ?? '');
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Hue rotation (degrees) for an avatar, picked from `steps` evenly spaced
 * slots so neighbouring names land on clearly different colors.
 */
export function avatarHue(name, steps = 12) {
  const n = Math.max(1, Math.floor(steps));
  const key = String(name ?? '').trim().toLowerCase();
  return (hashString(key) % n) * (360 / n);
}

/** Up to `max` initials: first and last word. Handles emoji and accents. */
export function initials(name, max = 2) {
  const words = String(name ?? '')
    .replace(/\([^)]*\)/g, ' ')
    .split(/[\s._-]+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+/u, ''))
    .filter(Boolean);
  if (!words.length) return '';
  const first = (w) => Array.from(w)[0].toLocaleUpperCase();
  if (words.length === 1 || max === 1) return first(words[0]);
  return first(words[0]) + first(words[words.length - 1]);
}

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/** Human file size, base 1024: 0 B, 812 B, 14 KB, 1.4 MB, 2.1 GB. */
export function formatBytes(bytes, { decimals = 1 } = {}) {
  let n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return '';
  let unit = 0;
  while (n >= 1024 && unit < UNITS.length - 1) {
    n /= 1024;
    unit += 1;
  }
  if (unit === 0) return `${Math.round(n)} B`;
  // One decimal below 10 (1.4 MB), whole numbers above (14 MB, 840 KB).
  const fixed = n < 10 ? n.toFixed(decimals) : String(Math.round(n));
  const clean = fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
  // 1023.6 KB rounds to 1024 KB: promote it.
  if (Number(clean) >= 1024 && unit < UNITS.length - 1) return `1 ${UNITS[unit + 1]}`;
  return `${clean} ${UNITS[unit]}`;
}

/** Split 'trip.photo.JPG' into ['trip.photo', '.JPG']. Dotfiles keep their name. */
export function splitExt(name) {
  const str = String(name ?? '');
  const dot = str.lastIndexOf('.');
  if (dot <= 0 || dot === str.length - 1 || str.length - dot > 10) return [str, ''];
  return [str.slice(0, dot), str.slice(dot)];
}

/**
 * Shorten a file name in the middle so the start and the extension stay
 * readable. `max` counts characters including the ellipsis.
 */
export function middleTruncate(name, max) {
  const chars = Array.from(String(name ?? ''));
  const limit = Math.max(1, Math.floor(max));
  if (chars.length <= limit) return chars.join('');
  const [base, ext] = splitExt(chars.join(''));
  const extChars = Array.from(ext);
  const baseChars = Array.from(base);
  // Room left for the base name around the ellipsis.
  let room = limit - 1 - extChars.length;
  if (room < 2) {
    // The extension alone doesn't fit: truncate the whole thing at the end.
    return `${chars.slice(0, Math.max(0, limit - 1)).join('')}…`;
  }
  const tail = Math.min(Math.floor(room / 3), baseChars.length);
  const head = room - tail;
  return `${baseChars.slice(0, head).join('')}…${tail ? baseChars.slice(-tail).join('') : ''}${ext}`;
}

const KINDS = {
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'heic', 'heif', 'svg', 'bmp', 'tif', 'tiff'],
  pdf: ['pdf'],
  doc: ['doc', 'docx', 'odt', 'rtf', 'pages'],
  sheet: ['xls', 'xlsx', 'ods', 'csv', 'tsv', 'numbers'],
  slides: ['ppt', 'pptx', 'odp', 'key'],
  archive: ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2'],
  audio: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'],
  video: ['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v'],
  code: ['js', 'mjs', 'ts', 'json', 'html', 'css', 'py', 'sh', 'xml', 'yml', 'yaml'],
  text: ['txt', 'md', 'log'],
};

/** Coarse file type from extension, falling back to the MIME type. */
export function fileKind(name, mime = '') {
  const ext = splitExt(name)[1].slice(1).toLowerCase();
  for (const [kind, list] of Object.entries(KINDS)) if (ext && list.includes(ext)) return kind;
  const m = String(mime || '').toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m === 'application/pdf') return 'pdf';
  if (m.startsWith('audio/')) return 'audio';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('text/')) return 'text';
  if (m.includes('zip') || m.includes('compressed')) return 'archive';
  return 'file';
}

/** Badge count text: 7 -> '7', 140 -> '99+'. Non-numbers -> ''. */
export function formatCount(value, max = 99) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return '';
  const cap = Math.max(1, Math.floor(Number(max) || 99));
  return n > cap ? `${cap}+` : String(Math.max(0, n));
}

/**
 * Line up two strings of digits from the right for an odometer: returns one
 * entry per column of the new value, with the digit it rolls from ('' when the
 * column is new) and whether it changed.
 */
export function digitColumns(from, to) {
  const a = Array.from(String(from ?? ''));
  const b = Array.from(String(to ?? ''));
  const out = [];
  for (let i = 0; i < b.length; i++) {
    const fromChar = a[a.length - b.length + i] ?? '';
    out.push({ from: fromChar, to: b[i], changed: fromChar !== b[i] });
  }
  return out;
}

/** '16/9', '16:9', '1.5', '4 / 3' -> width / height. Bad input -> fallback. */
export function parseRatio(value, fallback = 1) {
  const str = String(value ?? '').trim();
  const m = str.match(/^(\d*\.?\d+)\s*(?:[/:]\s*(\d*\.?\d+))?$/);
  if (!m) return fallback;
  const w = Number(m[1]);
  const h = m[2] == null ? 1 : Number(m[2]);
  return w > 0 && h > 0 ? w / h : fallback;
}
