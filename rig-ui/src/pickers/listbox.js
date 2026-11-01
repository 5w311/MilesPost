// The listbox engine behind <rig-select>, <rig-combobox> and <rig-multi-select>.
//
// It renders options (optionally grouped) into role="listbox", tracks the
// active option with a highlight that glides between rows on a spring, and
// never takes focus: the owning control keeps focus and points at the active
// option with aria-activedescendant (via the onActive callback).
//
//   const list = new Picklist({ label: 'Trailer types', onPick, onActive })
//   list.render(items.map((item) => ({ item })))
//   list.setSelected(['dv53']); list.setActive(0); list.move(1)
//
// Deliberate limit: every row is a real element (no virtual scrolling). That
// keeps find-in-page and screen readers simple and is fast to a few thousand
// rows; page bigger sources through <rig-combobox>'s load().

import { springDriver, springs } from '../motion.js';
import { h, paths, svgIcon, uid } from '../util.js';
import { markText } from './shared.js';
import { edgeIndex, stepIndex, typeaheadIndex } from './pick-logic.js';

/** Strings or objects -> { value, label, disabled, group, hint, keywords, ... }. */
export function normalizeItems(list) {
  return (Array.isArray(list) ? list : []).map((entry) => {
    if (entry == null) return null;
    if (typeof entry !== 'object') return { value: String(entry), label: String(entry), disabled: false, group: '', hint: '', keywords: '' };
    const value = String(entry.value ?? entry.label ?? '');
    return {
      ...entry,
      value,
      label: String(entry.label ?? value),
      disabled: Boolean(entry.disabled),
      group: entry.group ? String(entry.group) : '',
      hint: entry.hint ? String(entry.hint) : '',
      keywords: entry.keywords ? String(entry.keywords) : '',
    };
  }).filter(Boolean);
}

/** Read and remove child <option>/<optgroup> elements. */
export function readOptions(host) {
  const items = [];
  const selected = [];
  const take = (opt, group, groupDisabled) => {
    const label = (opt.getAttribute('label') || opt.textContent).trim().replace(/\s+/g, ' ');
    const value = opt.getAttribute('value') ?? label;
    items.push({
      value,
      label,
      disabled: opt.hasAttribute('disabled') || groupDisabled,
      group,
      hint: opt.dataset.hint || '',
      keywords: opt.dataset.keywords || '',
    });
    if (opt.hasAttribute('selected')) selected.push(value);
  };
  for (const child of [...host.children]) {
    if (child.localName === 'optgroup') {
      const label = child.getAttribute('label') || '';
      for (const opt of child.querySelectorAll('option')) take(opt, label, child.hasAttribute('disabled'));
      child.remove();
    } else if (child.localName === 'option') {
      take(child, '', false);
      child.remove();
    }
  }
  return { items, selected };
}

export class Picklist {
  #rows = new Map(); // key -> { el, labelEl, hintEl }
  #groups = new Map(); // name -> { el, heading }
  #view = []; // [{ item, el, indices }]
  #active = -1;
  #selected = new Set();
  #hl;
  #hlDriver;
  #hlShown = false;
  #buffer = '';
  #bufferTimer = 0;
  #footer = null;

  /**
   * @param {{ multiple?: boolean, label?: string, onPick?: (item) => void,
   *   onActive?: (entry|null) => void, isLocked?: (item) => boolean }} opts
   */
  constructor({ multiple = false, label = 'Options', onPick, onActive, isLocked } = {}) {
    this.multiple = multiple;
    this.onPick = onPick;
    this.onActive = onActive;
    this.isLocked = isLocked;
    this.id = uid('rig-picklist');
    this.#hl = h('span', { class: 'rig-picklist__hl', 'aria-hidden': 'true' });
    this.inner = h('div', { class: 'rig-picklist__inner' }, this.#hl);
    this.el = h('div', {
      class: 'rig-picklist',
      id: this.id,
      role: 'listbox',
      'aria-label': label,
      'aria-multiselectable': multiple ? 'true' : null,
      tabindex: '-1',
    }, this.inner);

    this.#hlDriver = springDriver([0, 0, 0], springs.snappy, ([y, ht, o]) => {
      this.#hl.style.transform = `translateY(${y}px)`;
      this.#hl.style.height = `${Math.max(0, ht)}px`;
      this.#hl.style.opacity = String(Math.max(0, Math.min(1, o)));
    });

    // Keep focus on the owning control while pressing options.
    this.el.addEventListener('mousedown', (e) => e.preventDefault());
    this.el.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      const index = this.#indexOfEl(e.target.closest('.rig-picklist__option'));
      if (index !== -1 && index !== this.#active && !this.isDisabled(this.#view[index].item)) this.setActive(index, { scroll: false });
    });
    this.el.addEventListener('click', (e) => {
      const index = this.#indexOfEl(e.target.closest('.rig-picklist__option'));
      if (index === -1) return;
      const { item } = this.#view[index];
      if (this.isDisabled(item)) return;
      this.setActive(index, { scroll: false });
      this.onPick?.(item);
    });
  }

  get view() { return this.#view; }
  get count() { return this.#view.length; }
  get active() { return this.#active; }
  get activeEntry() { return this.#view[this.#active] ?? null; }
  get typing() { return this.#buffer.length > 0; }

  isDisabled(item) {
    return Boolean(item.disabled || this.isLocked?.(item));
  }

  indexOf(value) {
    return this.#view.findIndex((e) => e.item.value === value && !e.item.create);
  }

  #indexOfEl(el) {
    return el ? this.#view.findIndex((e) => e.el === el) : -1;
  }

  #row(item) {
    const key = item.create ? '\u0000create' : item.value;
    let row = this.#rows.get(key);
    if (!row) {
      const labelEl = h('span', { class: 'rig-picklist__label' });
      const hintEl = h('span', { class: 'rig-picklist__hint' });
      const el = h('div', {
        class: `rig-picklist__option${item.create ? ' rig-picklist__option--create' : ''}`,
        role: 'option',
        id: uid('rig-opt'),
        'aria-selected': 'false',
      },
      this.multiple && !item.create ? h('span', { class: 'rig-picklist__box', 'aria-hidden': 'true' }, svgIcon(paths.check, { size: 12, stroke: 3 })) : null,
      item.create ? svgIcon(['M12 5v14', 'M5 12h14'], { size: 16, className: 'rig-picklist__plus' }) : null,
      labelEl,
      hintEl,
      !this.multiple && !item.create ? svgIcon(paths.check, { size: 16, stroke: 2.4, className: 'rig-picklist__check' }) : null);
      row = { el, labelEl, hintEl };
      this.#rows.set(key, row);
    }
    return row;
  }

  #group(name) {
    let group = this.#groups.get(name);
    if (!group) {
      const heading = h('div', { class: 'rig-picklist__heading', id: uid('rig-optgroup'), 'aria-hidden': 'true' }, name);
      const el = h('div', { class: 'rig-picklist__group', role: 'group', 'aria-labelledby': heading.id }, heading);
      group = { el, heading };
      this.#groups.set(name, group);
    }
    group.el.replaceChildren(group.heading);
    return group;
  }

  /**
   * Show these entries, in this order: [{ item, indices? }]. Items sharing a
   * `group` are gathered under one heading, placed where the group first appears.
   */
  render(entries) {
    const buckets = new Map();
    for (const entry of entries) {
      const name = entry.item.create ? '\u0000create' : entry.item.group || '';
      if (!buckets.has(name)) buckets.set(name, []);
      buckets.get(name).push(entry);
    }
    const nodes = [];
    const view = [];
    const prevActive = this.activeEntry?.item;
    for (const [name, bucket] of buckets) {
      const container = name && name !== '\u0000create' ? this.#group(name) : null;
      for (const entry of bucket) {
        const row = this.#row(entry.item);
        markText(row.labelEl, entry.item.label, entry.indices);
        row.hintEl.textContent = entry.item.hint || '';
        row.hintEl.hidden = !entry.item.hint;
        row.el.setAttribute('aria-selected', String(this.#selected.has(entry.item.value) && !entry.item.create));
        row.el.classList.remove('is-active');
        if (this.isDisabled(entry.item)) row.el.setAttribute('aria-disabled', 'true');
        else row.el.removeAttribute('aria-disabled');
        view.push({ item: entry.item, el: row.el, indices: entry.indices || [], group: container?.el ?? null });
        (container ? container.el : null)?.append(row.el);
        if (!container) nodes.push(row.el);
      }
      if (container) nodes.push(container.el);
    }
    this.#view = view;
    this.inner.replaceChildren(this.#hl, ...nodes, ...(this.#footer ? [this.#footer] : []));
    this.#active = -1;
    // Keep the same item active across re-renders when it's still there.
    const keep = prevActive ? view.findIndex((e) => e.item === prevActive || (e.item.value === prevActive.value && !e.item.create)) : -1;
    if (keep !== -1) this.setActive(keep, { scroll: false });
    else this.#hideHighlight();
  }

  /**
   * A row after the options that isn't one (e.g. "Loading more…"). Keep it
   * aria-hidden and announce its state elsewhere: a listbox may only own options.
   */
  setFooter(el) {
    if (this.#footer === el) return;
    this.#footer?.remove();
    this.#footer = el;
    if (el) this.inner.append(el);
  }

  /** Re-check disabled/locked state without re-rendering (e.g. after a max is reached). */
  refreshDisabled() {
    for (const { item, el } of this.#view) {
      if (this.isDisabled(item)) el.setAttribute('aria-disabled', 'true');
      else el.removeAttribute('aria-disabled');
    }
  }

  setSelected(values) {
    this.#selected = new Set(values);
    for (const { item, el } of this.#view) el.setAttribute('aria-selected', String(this.#selected.has(item.value) && !item.create));
  }

  /** Make `index` active. scroll: 'nearest' | 'center' | false. */
  setActive(index, { scroll = 'nearest', instant = false } = {}) {
    this.#view[this.#active]?.el.classList.remove('is-active');
    this.#active = index;
    const entry = this.#view[index];
    if (!entry) {
      this.#hideHighlight();
      this.onActive?.(null);
      return;
    }
    entry.el.classList.add('is-active');
    this.onActive?.(entry);
    this.#place(entry, { scroll, instant });
  }

  /** Re-measure after the popup opens (layout exists now). Snaps, no glide. */
  reveal({ scroll = 'center' } = {}) {
    this.#hlShown = false;
    const entry = this.activeEntry;
    if (entry) this.#place(entry, { scroll, instant: true });
    else this.#hideHighlight();
  }

  #place(entry, { scroll, instant }) {
    const run = () => {
      if (this.activeEntry !== entry) return;
      const ht = entry.el.offsetHeight;
      if (!ht) return; // popup closed; reveal() measures on open
      const y = entry.el.offsetTop;
      if (!this.#hlShown || instant) {
        this.#hlShown = true;
        this.#hlDriver.to([y, ht, 1], { immediate: true });
      } else {
        this.#hlDriver.to([y, ht, 1]);
      }
      if (scroll) this.#scrollTo(entry, scroll);
    };
    if (entry.el.offsetHeight) run();
    else requestAnimationFrame(run);
  }

  #scrollTo(entry, mode) {
    const box = this.el;
    if (box.scrollHeight <= box.clientHeight) return;
    const top = entry.el.offsetTop;
    const ht = entry.el.offsetHeight;
    if (mode === 'center') {
      box.scrollTop = Math.max(0, top - (box.clientHeight - ht) / 2);
      return;
    }
    const pad = 6;
    // Show the group heading when landing on a group's first option.
    const groupTop = entry.group && entry.group.querySelector('.rig-picklist__option') === entry.el ? entry.group.offsetTop : top;
    if (groupTop < box.scrollTop + pad) box.scrollTop = Math.max(0, groupTop - pad);
    else if (top + ht > box.scrollTop + box.clientHeight - pad) box.scrollTop = top + ht - box.clientHeight + pad;
  }

  #hideHighlight() {
    this.#hlShown = false;
    const [y, ht] = this.#hlDriver.value;
    this.#hlDriver.to([y, ht, 0], { immediate: true });
  }

  #disabledFlags() {
    return this.#view.map((e) => this.isDisabled(e.item));
  }

  move(delta, { wrap = false } = {}) {
    if (!this.#view.length) return -1;
    const next = stepIndex(this.#disabledFlags(), this.#active, delta, { wrap });
    if (next !== -1) this.setActive(next);
    return next;
  }

  edge(which) {
    const next = edgeIndex(this.#disabledFlags(), which);
    if (next !== -1) this.setActive(next);
    return next;
  }

  /** PageUp / PageDown: a viewport of rows at a time. */
  page(dir) {
    const rowHeight = this.activeEntry?.el.offsetHeight || this.#view[0]?.el.offsetHeight || 36;
    const size = Math.max(1, Math.floor(this.el.clientHeight / rowHeight) - 1);
    return this.move(dir * size);
  }

  /** Add a typed character to the typeahead buffer and jump to the match. */
  typeahead(char) {
    clearTimeout(this.#bufferTimer);
    this.#buffer += char;
    this.#bufferTimer = setTimeout(() => { this.#buffer = ''; }, 650);
    const index = typeaheadIndex(this.#view.map((e) => e.item.label), this.#buffer, this.#active, this.#disabledFlags());
    if (index !== -1) this.setActive(index);
    return index;
  }
}
