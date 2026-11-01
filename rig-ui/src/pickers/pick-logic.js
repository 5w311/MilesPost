// Pure helpers shared by the pickers: list navigation, typeahead, initials,
// file validation and crop math. No DOM.

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/* ---------- list navigation ---------- */

/**
 * Move through a list by `delta` enabled items (±1 for arrows, ±page for
 * PageUp/PageDown), skipping disabled ones. Without `wrap` it stops at the
 * last enabled item it reached. `from` = -1 means "nothing active yet".
 * Returns the new index, or -1 when nothing is enabled.
 */
export function stepIndex(disabled, from, delta, { wrap = false } = {}) {
  const n = disabled.length;
  if (!n || !delta) return from;
  const dir = Math.sign(delta);
  let remaining = Math.abs(delta);
  let i = from < 0 || from >= n ? (dir > 0 ? -1 : n) : from;
  let landed = from >= 0 && from < n && !disabled[from] ? from : -1;
  for (let guard = 0; remaining > 0 && guard < n * (Math.abs(delta) + 1); guard++) {
    i += dir;
    if (i < 0 || i >= n) {
      if (!wrap) break;
      i = (i + n) % n;
    }
    if (!disabled[i]) {
      landed = i;
      remaining--;
    }
  }
  return landed;
}

/** First or last enabled index (-1 if none). */
export function edgeIndex(disabled, edge = 'first') {
  return stepIndex(disabled, -1, edge === 'first' ? 1 : -1);
}

const fold = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase();

/**
 * Typeahead: which option does the typed buffer point to? A single letter (or
 * the same letter repeated) cycles through options starting with it; longer
 * buffers refine the current match. Search wraps. Returns -1 for no match.
 */
export function typeaheadIndex(labels, buffer, from = -1, disabled = []) {
  const q = fold(buffer);
  if (!q) return -1;
  const n = labels.length;
  const repeated = [...q].every((c) => c === q[0]);
  const needle = repeated ? q[0] : q;
  const start = repeated ? from + 1 : Math.max(0, from);
  for (let k = 0; k < n; k++) {
    const i = (((start + k) % n) + n) % n;
    if (!disabled[i] && fold(labels[i]).startsWith(needle)) return i;
  }
  return -1;
}

/**
 * Normalize what an async `load()` returns: a plain array is one complete
 * page; `{ items, hasMore }` is one page of several.
 */
export function readPage(raw) {
  if (Array.isArray(raw)) return { items: raw, hasMore: false };
  if (raw && typeof raw === 'object') return { items: Array.isArray(raw.items) ? raw.items : [], hasMore: Boolean(raw.hasMore) };
  return { items: [], hasMore: false };
}

/* ---------- names ---------- */

const SKIP_WORDS = new Set(['llc', 'inc', 'co', 'corp', 'ltd', 'the', 'and', 'of', '&', 'gmbh', 'sa', 'plc']);

/**
 * Initials for a monogram: 'Figari Freight LLC' -> 'FF', 'FuelPost' -> 'FP',
 * 'dispatch' -> 'D'. Skips company suffixes and filler words.
 */
export function initials(name, max = 2) {
  const words = String(name ?? '').normalize('NFC').trim().split(/[\s\-_.,/]+/).filter(Boolean);
  const useful = words.filter((w) => !SKIP_WORDS.has(w.toLowerCase()));
  const pool = useful.length ? useful : words;
  const firstChar = (w) => [...w].find((ch) => /[\p{L}\p{N}]/u.test(ch)) ?? '';
  let letters;
  if (pool.length === 1) {
    // One word: use camelCase humps if it has them ("FuelPost").
    const humps = pool[0].match(/\p{Lu}/gu) ?? [];
    letters = humps.length > 1 && /^\p{Lu}/u.test(pool[0]) ? humps : [firstChar(pool[0])];
  } else {
    letters = pool.map(firstChar);
  }
  return letters.filter(Boolean).slice(0, max).join('').toLocaleUpperCase();
}

/* ---------- files ---------- */

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/** 1536 -> '1.5 KB', 14900000 -> '14 MB'. Binary steps (1024). */
export function formatBytes(bytes, locale = 'en') {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < UNITS.length - 1) {
    value /= 1024;
    i++;
  }
  const digits = i === 0 || value >= 10 ? 0 : 1;
  const text = new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value);
  return `${text} ${UNITS[i]}`;
}

/** '10MB', '500 kb', '1.5GB', '2048' -> bytes, or NaN. */
export function parseBytes(text) {
  const match = /^\s*(\d+(?:\.\d+)?)\s*(b|kb|k|mb|m|gb|g|tb|t)?\s*$/i.exec(String(text ?? ''));
  if (!match) return NaN;
  const unit = (match[2] || 'b').toLowerCase()[0];
  const power = { b: 0, k: 1, m: 2, g: 3, t: 4 }[unit];
  return Math.round(parseFloat(match[1]) * 1024 ** power);
}

/** Split a file name for middle truncation: the head may be ellipsized, the tail (with extension) stays. */
export function splitFileName(name, keep = 5) {
  const text = String(name ?? '');
  const dot = text.lastIndexOf('.');
  const ext = dot > 0 && text.length - dot <= 6 ? text.slice(dot) : '';
  const tailLength = Math.min(text.length, ext.length + keep);
  if (text.length - tailLength < 3) return [text, ''];
  return [text.slice(0, text.length - tailLength), text.slice(text.length - tailLength)];
}

/** 'BOL-418-2207-signed-pod.pdf', 16 -> 'BOL-418…pod.pdf' (keeps the extension). */
export function middleTruncate(name, max = 24) {
  const text = String(name ?? '');
  if (text.length <= max) return text;
  const [, tail] = splitFileName(text, Math.max(2, Math.floor(max / 3)));
  const end = tail || text.slice(-Math.floor(max / 2));
  const headLength = Math.max(1, max - end.length - 1);
  return `${text.slice(0, headLength)}…${end}`;
}

/** Does a file ({ name, type }) match an `accept` string like ".pdf,image/*"? */
export function acceptsFile(file, accept) {
  const rules = String(accept ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!rules.length) return true;
  const name = String(file?.name ?? '').toLowerCase();
  const type = String(file?.type ?? '').toLowerCase();
  return rules.some((rule) => {
    if (rule.startsWith('.')) return name.endsWith(rule);
    if (rule.endsWith('/*')) return type.startsWith(rule.slice(0, -1));
    return type === rule;
  });
}

const FRIENDLY = {
  'image/*': 'images', 'video/*': 'videos', 'audio/*': 'audio files', 'text/*': 'text files',
  'application/pdf': 'PDF', 'image/jpeg': 'JPG', 'image/png': 'PNG', 'image/webp': 'WebP',
  'image/heic': 'HEIC', 'text/csv': 'CSV', '.jpeg': 'JPG',
};

/** '.pdf,image/*' -> 'PDF or images' (for hints and error messages). */
export function describeAccept(accept, locale = 'en') {
  const rules = String(accept ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const names = [];
  for (const rule of rules) {
    const label = FRIENDLY[rule] ?? (rule.startsWith('.') ? rule.slice(1).toUpperCase() : rule.split('/').pop().toUpperCase());
    if (!names.includes(label)) names.push(label);
  }
  if (!names.length) return '';
  try {
    return new Intl.ListFormat(locale, { type: 'disjunction' }).format(names);
  } catch {
    return names.join(', ');
  }
}

/** Broad kind of file for picking an icon. */
export function fileKind(file) {
  const type = String(file?.type ?? '').toLowerCase();
  const name = String(file?.name ?? '').toLowerCase();
  const ext = name.includes('.') ? name.split('.').pop() : '';
  if (type === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (type.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'tif', 'tiff', 'bmp'].includes(ext)) return 'image';
  if (type.startsWith('video/') || ['mp4', 'mov', 'webm', 'm4v'].includes(ext)) return 'video';
  if (type.startsWith('audio/') || ['mp3', 'wav', 'm4a', 'ogg'].includes(ext)) return 'audio';
  if (['xls', 'xlsx', 'csv', 'ods', 'numbers'].includes(ext) || type.includes('spreadsheet') || type === 'text/csv') return 'sheet';
  if (['zip', 'gz', 'rar', '7z', 'tar'].includes(ext) || type.includes('zip')) return 'archive';
  if (['doc', 'docx', 'odt', 'rtf', 'pages', 'txt', 'md'].includes(ext) || type.startsWith('text/') || type.includes('word')) return 'doc';
  return 'file';
}

/**
 * Split incoming files into accepted and rejected against the rules.
 * `existing` is how many files are already in the list.
 * Each rejection: { file, reason: 'type' | 'size' | 'count' | 'empty' }.
 */
export function validateFiles(files, { accept = '', maxSize = Infinity, maxFiles = Infinity, existing = 0 } = {}) {
  const accepted = [];
  const rejected = [];
  for (const file of files) {
    if (!acceptsFile(file, accept)) rejected.push({ file, reason: 'type' });
    else if (file.size > maxSize) rejected.push({ file, reason: 'size' });
    else if (file.size === 0) rejected.push({ file, reason: 'empty' });
    else if (existing + accepted.length >= maxFiles) rejected.push({ file, reason: 'count' });
    else accepted.push(file);
  }
  return { accepted, rejected };
}

/** Plain-language messages for rejections, one per problem kind. */
export function rejectionMessages(rejected, { accept = '', maxSize = Infinity, maxFiles = Infinity, locale = 'en' } = {}) {
  const messages = [];
  const by = (reason) => rejected.filter((r) => r.reason === reason).map((r) => r.file.name);
  const quote = (names) => (names.length === 1 ? `“${names[0]}”` : `${names.length} files`);
  const type = by('type');
  if (type.length) {
    const what = describeAccept(accept, locale);
    messages.push(`${quote(type)} ${type.length === 1 ? 'isn’t' : 'aren’t'} an accepted type. Add ${what || 'a different file'} instead.`);
  }
  const size = by('size');
  if (size.length) messages.push(`${quote(size)} ${size.length === 1 ? 'is' : 'are'} over the ${formatBytes(maxSize, locale)} limit. Compress or split ${size.length === 1 ? 'it' : 'them'} and try again.`);
  const empty = by('empty');
  if (empty.length) messages.push(`${quote(empty)} ${empty.length === 1 ? 'is' : 'are'} empty.`);
  const count = by('count');
  if (count.length) messages.push(`You can add up to ${maxFiles} file${maxFiles === 1 ? '' : 's'}, so ${count.length === 1 ? `“${count[0]}” was` : `${count.length} were`} left out. Remove one to make room.`);
  return messages;
}

const TYPE_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/heic': 'heic', 'application/pdf': 'pdf', 'text/plain': 'txt' };

/**
 * A readable name for a pasted file. Screenshots arrive as "image.png" (or
 * with no name at all); those become "Pasted image 2026-10-31 at 14.03.07.png".
 * Real file names are kept.
 */
export function pastedFileName(name, type = '', now = new Date()) {
  const text = String(name ?? '').trim();
  if (text && !/^(image|blob|clipboard|untitled)(\.\w+)?$/i.test(text)) return text;
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} at ${p(now.getHours())}.${p(now.getMinutes())}.${p(now.getSeconds())}`;
  const ext = TYPE_EXT[String(type).toLowerCase()] ?? (text.includes('.') ? text.split('.').pop().toLowerCase() : 'bin');
  const kind = String(type).startsWith('image/') ? 'image' : 'file';
  return `Pasted ${kind} ${stamp}.${ext}`;
}

/* ---------- square crop ---------- */

/**
 * The square of an image (iw x ih) that shows in a square viewport at `zoom`
 * (1 = the shorter side fills the square), centred on the image point
 * (fx, fy), clamped so the square never leaves the image.
 * Returns { sx, sy, size, fx, fy } in image pixels.
 */
export function cropRect(iw, ih, zoom, fx, fy) {
  const size = Math.min(iw, ih) / Math.max(1, zoom);
  const cx = clamp(fx, size / 2, iw - size / 2);
  const cy = clamp(fy, size / 2, ih - size / 2);
  return { sx: cx - size / 2, sy: cy - size / 2, size, fx: cx, fy: cy };
}

/** Zoom to `nextZoom` keeping the image point under (px, py) — fractions 0..1 of the viewport — still. */
export function zoomCropAt(iw, ih, crop, nextZoom, px = 0.5, py = 0.5) {
  const before = cropRect(iw, ih, crop.zoom, crop.fx, crop.fy);
  const ix = before.sx + px * before.size;
  const iy = before.sy + py * before.size;
  const size = Math.min(iw, ih) / Math.max(1, nextZoom);
  const r = cropRect(iw, ih, nextZoom, ix - px * size + size / 2, iy - py * size + size / 2);
  return { zoom: Math.max(1, nextZoom), fx: r.fx, fy: r.fy };
}

/** Pan by a drag of (dx, dy) screen px in a viewport `view` px wide. */
export function panCrop(iw, ih, crop, dx, dy, view) {
  const { size } = cropRect(iw, ih, crop.zoom, crop.fx, crop.fy);
  const k = size / view;
  const r = cropRect(iw, ih, crop.zoom, crop.fx - dx * k, crop.fy - dy * k);
  return { zoom: crop.zoom, fx: r.fx, fy: r.fy };
}
