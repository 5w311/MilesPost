// Pure helpers for the forms category: validation copy, form data shaping,
// character counters, list parsing, range selection and roving focus.
// No DOM access, so everything here runs (and is tested) in Node.

const ARTICLE = /^(a|an|the|your|my|this|that|each|every)\s/i;

/** "Trailer number" -> "trailer number". Leaves acronyms alone ("BOL number"). */
export function lowerFirst(text) {
  const s = String(text ?? '').trim();
  if (!s) return s;
  const first = s.split(/\s+/)[0];
  if (first.length > 1 && first === first.toUpperCase() && /[A-Z]/.test(first)) return s;
  return s[0].toLowerCase() + s.slice(1);
}

function withArticle(name) {
  return ARTICLE.test(name) ? name : `the ${name}`;
}

/**
 * Friendly copy for a ValidityState-like object. Says what's wrong and how to
 * fix it, in sentence case. Returns '' when nothing is wrong.
 *
 * @param {Partial<ValidityState>} validity
 * @param {{ label?: string, kind?: string, type?: string, value?: string,
 *   minLength?: number, maxLength?: number, min?: string|number, max?: string|number,
 *   step?: string|number, title?: string, custom?: string, format?: (v:any) => string }} info
 *   kind: 'text' | 'checkbox' | 'switch' | 'radio' | 'select' | 'choice'
 */
export function validityMessage(validity = {}, info = {}) {
  const {
    label = '', kind = 'text', type = 'text', value = '',
    minLength, maxLength, min, max, step, title = '', custom = '', format = String,
  } = info;
  const name = lowerFirst(label).replace(/[\s:*]+$/, '');
  const length = String(value ?? '').length;

  if (validity.customError) return custom || 'Check this field.';
  if (validity.valueMissing) {
    if (kind === 'checkbox') return 'Check this box to continue.';
    if (kind === 'switch') return 'Turn this on to continue.';
    if (kind === 'radio' || kind === 'select' || kind === 'choice') return name ? `Choose ${withArticle(name)}.` : 'Choose an option.';
    if (type === 'file') return 'Choose a file to upload.';
    return name ? `Enter ${withArticle(name)}.` : 'Fill in this field.';
  }
  if (validity.badInput) {
    if (type === 'number') return 'Enter a number, using digits only.';
    if (type === 'date') return 'Enter a complete date.';
    if (type === 'time') return 'Enter a complete time.';
    return 'Check the format and try again.';
  }
  if (validity.typeMismatch) {
    if (type === 'email') return 'Enter an email address like name@example.com.';
    if (type === 'url') return 'Enter a full web address, starting with https://.';
    return 'Check the format and try again.';
  }
  if (validity.tooShort) return `Use at least ${minLength} characters. You have ${length}.`;
  if (validity.tooLong) return `Use ${maxLength} characters or fewer. You have ${length}.`;
  if (validity.rangeUnderflow) return `Enter ${format(min)} or more.`;
  if (validity.rangeOverflow) return `Enter ${format(max)} or less.`;
  if (validity.stepMismatch) {
    const s = Number(step);
    const base = Number(min) || 0;
    if (s === 1 && Number.isInteger(base)) return 'Enter a whole number.';
    return base ? `Use steps of ${step}, starting from ${format(min)}.` : `Use steps of ${step}.`;
  }
  if (validity.patternMismatch) return title || 'Check the format and try again.';
  return '';
}

/**
 * FormData entries -> plain object. Repeated names become arrays; names listed
 * in `multi` are always arrays (so a checkbox group with one box ticked still
 * gives ['bol'], not 'bol').
 */
export function formDataToObject(entries, multi = []) {
  const always = new Set(multi);
  const out = {};
  for (const name of always) out[name] = [];
  for (const [key, value] of entries) {
    if (always.has(key)) out[key].push(value);
    else if (Object.prototype.hasOwnProperty.call(out, key)) out[key] = [].concat(out[key], value);
    else out[key] = value;
  }
  return out;
}

/**
 * Character counter state.
 * level: 'ok' | 'warn' (within `warnAt` of the limit) | 'over'.
 */
export function counterState(length, max, { warnAt } = {}) {
  const n = Math.max(0, Number(length) || 0);
  if (!(max > 0)) return { text: String(n), remaining: Infinity, level: 'ok', spoken: `${n} characters` };
  const remaining = max - n;
  const threshold = warnAt ?? Math.max(5, Math.ceil(max * 0.1));
  const level = remaining < 0 ? 'over' : remaining <= threshold ? 'warn' : 'ok';
  const spoken = remaining < 0
    ? `${-remaining} ${-remaining === 1 ? 'character' : 'characters'} over the limit`
    : `${remaining} ${remaining === 1 ? 'character' : 'characters'} left`;
  return { text: `${n}/${max}`, remaining, level, spoken };
}

/** "a | b ||c" -> ['a', 'b', 'c'] */
export function splitList(text, separator = '|') {
  return String(text ?? '').split(separator).map((s) => s.trim()).filter(Boolean);
}

/** Set every item between `anchor` and `index` (inclusive) to `value`, skipping disabled ones. */
export function rangeApply(states, anchor, index, value, disabled = []) {
  const out = states.slice();
  const a = Math.max(0, Math.min(anchor, index));
  const b = Math.min(states.length - 1, Math.max(anchor, index));
  for (let i = a; i <= b; i++) if (!disabled[i]) out[i] = value;
  return out;
}

/** 'none' | 'some' | 'all' for a list of booleans (a "select all" parent). */
export function aggregate(states) {
  const on = states.filter(Boolean).length;
  if (!states.length || on === 0) return 'none';
  return on === states.length ? 'all' : 'some';
}

/**
 * Next index for roving focus. Arrow keys step (wrapping by default) and skip
 * disabled items; Home/End jump to the first/last enabled item. Returns -1 for
 * keys it doesn't handle.
 */
export function rovingIndex(current, key, count, disabled = [], { wrap = true } = {}) {
  const ok = (i) => !disabled[i];
  if (key === 'Home') { for (let i = 0; i < count; i++) if (ok(i)) return i; return -1; }
  if (key === 'End') { for (let i = count - 1; i >= 0; i--) if (ok(i)) return i; return -1; }
  const dir = key === 'ArrowRight' || key === 'ArrowDown' ? 1 : key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 0;
  if (!dir || count <= 0) return -1;
  let i = current;
  for (let n = 0; n < count; n++) {
    i += dir;
    if (i < 0 || i >= count) {
      if (!wrap) return current;
      i = (i + count) % count;
    }
    if (ok(i)) return i;
  }
  return current;
}
