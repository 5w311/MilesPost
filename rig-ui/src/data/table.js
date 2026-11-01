// <rig-table> — a data table: sortable headers, row selection, inline editing,
// row actions, loading and empty states. The core of <rig-crm-table> and
// <rig-grouped-table>.
//
// From data:
//   <rig-table label="Loads this week" selectable></rig-table>
//   table.columns = [
//     { key: 'load', label: 'Load' },
//     { key: 'rate', label: 'Rate', format: (v) => `$${v.toLocaleString()}` },
//     { key: 'pickup', label: 'Pickup', type: 'date', width: '9rem' },
//   ]
//   table.rows = [{ id: 'L-24817', load: 'L-24817', rate: 2450, pickup: '2026-11-02' }]
//
// Or enhance a plain table (it stays readable before the script loads):
//   <rig-table selectable>
//     <table>
//       <thead><tr><th>Load</th><th data-type="number">Miles</th></tr></thead>
//       <tbody><tr><td>L-24817</td><td data-value="412">412 mi</td></tr></tbody>
//     </table>
//   </rig-table>
//   (th: data-key, data-type, data-align, data-sortable="false", data-width.
//    td: data-value holds the raw value when the text is formatted.)
//
// Column: { key, label, align ('start'|'end'|'center'), format(value, row) → string | Node,
//   sortable (default true), width, type ('number'|'date'|'string', detected when left out),
//   value(row) (computed value), sortValue(row), editable (true or a list of fields),
//   fieldLabels { field: label }, validate(value, field, row) → error message or '' }.
// Numbers are right-aligned with tabular figures.
//
// Attributes: label (caption), selectable, navigable (the table becomes a grid: one tab
//   stop, arrow keys between cells), density ("comfortable" | "compact"),
//   loading (skeleton rows), empty (empty-state text; or a child with slot="empty"),
//   noun (singular, e.g. "load", used in messages).
// Properties: columns, rows, rowKey (row, index) → key (default row.id ?? index),
//   rowActions ([{ value, label, danger, separator }] adds a ⋯ menu per row; "edit" and
//   "delete" are handled for you), selectedKeys, selectedRows, sort ({ key, dir }).
// Methods: sortBy(key, dir), select(keys, on = true), selectAll(on = true), clearSelection(),
//   startEdit(rowKey, columnKey), deleteRows(keys) (with an Undo toast), refresh().
// Events: sortchange { key, dir }, selectionchange { keys, rows },
//   cellchange { row, key, value, previous } (cancelable, before the row is updated),
//   rowaction { action, row, key } (cancelable), rowactivate { row, key } (Enter on a row),
//   rowsdelete { rows, keys } (cancelable), rowsrestore { rows }.
//
// Editing: double-click a cell, or press Enter or F2 on it; Enter saves, Esc cancels,
// leaving the cell saves. Without `navigable`, every editable cell is its own tab stop
// (checkboxes and ⋯ buttons are too), so editing never needs grid mode. With
// `navigable` the whole table is one tab stop and arrows reach every cell, which suits
// long tables. On touch, tap a cell to select it and tap again to edit.
//
// Keyboard (grid mode): arrows, Home/End, Ctrl+Home/End, PageUp/PageDown move; Space
// selects the row; Ctrl/⌘+A selects all; Esc clears the selection. Shift+click a
// checkbox selects a range in either mode.

import { animate, reducedMotion, springEasing, springs } from '../motion.js';
import { sound } from '../sound.js';
import { toast } from '../toast.js';
import { define, h, paths, svgIcon, uid } from '../util.js';
import { GridNav } from './grid-nav.js';
import { ActionMenu } from './menu.js';
import { detectType, sortRows } from './rows.js';

const ICONS = {
  arrow: ['M12 18.5v-13', 'm6.5 11 5.5-5.5 5.5 5.5'],
  unsorted: ['m8 9.5 4-4 4 4', 'm16 14.5-4 4-4-4'],
  more: ['M5.5 12h.01', 'M12 12h.01', 'M18.5 12h.01'],
  dash: ['M6.5 12h11'],
  empty: ['M3.5 13.5h4.5l1.5 2.5h5l1.5-2.5h4.5', 'M5.5 6.5h13l2 7v4.5a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-4.5z'],
};

const SORT_CYCLE = { none: 'asc', asc: 'desc', desc: 'none' };
const ARIA_SORT = { asc: 'ascending', desc: 'descending' };
const SKELETON_WIDTHS = [68, 44, 82, 56, 38, 74, 50];

// Original cell content of an enhanced <table>, per row object and column key.
const SOURCE_CELLS = new WeakMap();

/** A styled native checkbox (keeps native semantics, focus and indeterminate). */
export function checkbox(label) {
  return h('label', { class: 'rig-check' },
    h('input', { class: 'rig-check__input', type: 'checkbox', 'aria-label': label }),
    h('span', { class: 'rig-check__box', 'aria-hidden': 'true' },
      svgIcon(paths.check, { size: 14, stroke: 3, className: 'rig-check__tick' }),
      svgIcon(ICONS.dash, { size: 14, stroke: 3, className: 'rig-check__dash' })));
}

const slug = (text) => String(text).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function readSourceTable(table) {
  const headRow = table.tHead?.rows[0] ?? table.rows[0];
  const ths = headRow ? [...headRow.cells] : [];
  const used = new Set();
  const columns = ths.map((th, i) => {
    let key = th.dataset.key || slug(th.textContent) || `col-${i}`;
    while (used.has(key)) key += '-';
    used.add(key);
    return {
      key,
      label: th.textContent.trim(),
      align: th.dataset.align || undefined,
      type: th.dataset.type || undefined,
      sortable: th.dataset.sortable !== 'false',
      width: th.dataset.width || th.style.width || undefined,
    };
  });
  const bodyRows = table.tBodies.length
    ? [...table.tBodies].flatMap((tb) => [...tb.rows])
    : [...table.rows].filter((r) => r !== headRow);
  const rows = bodyRows.map((tr, r) => {
    const row = { id: tr.dataset.key || tr.id || `row-${r + 1}` };
    const cells = {};
    [...tr.cells].forEach((td, i) => {
      const col = columns[i];
      if (!col) return;
      row[col.key] = td.dataset.value ?? td.textContent.trim();
      cells[col.key] = [...td.childNodes].map((n) => n.cloneNode(true));
    });
    SOURCE_CELLS.set(row, cells);
    return row;
  });
  // Show the original markup unless a cell has been edited since.
  for (const col of columns) {
    col.format = (value, row) => {
      const nodes = SOURCE_CELLS.get(row)?.[col.key];
      return nodes ? nodes.map((n) => n.cloneNode(true)) : String(value ?? '');
    };
  }
  return { columns, rows, caption: table.caption?.textContent.trim() || '' };
}

export class RigTable extends HTMLElement {
  static observedAttributes = ['density', 'loading', 'selectable', 'navigable', 'label', 'empty'];

  /** (row, index) → a stable key. */
  rowKey = (row, index) => row?.id ?? index;
  /** [{ value, label, danger, separator }] for a per-row actions menu. */
  rowActions = null;

  #built = false;
  #columns = [];
  #cols = [];
  #colsVersion = 0;
  #rows = [];
  #keys = new WeakMap();
  #view = [];
  #items = [];
  #sort = { key: null, dir: 'none' };
  #selected = new Set();
  #anchorKey = null;
  #trs = new Map();
  #used = new Set();
  #headVersion = -1;
  #headCheck = null;
  #nav = null;
  #menu = null;
  #editing = null;
  #tapArmed = null;
  #emptySlot = null;
  #ro = null;

  connectedCallback() {
    for (const prop of ['columns', 'rows']) {
      if (Object.prototype.hasOwnProperty.call(this, prop)) {
        const value = this[prop];
        delete this[prop];
        this[prop] = value;
      }
    }
    if (!this.#built) {
      this.#built = true;
      this._build();
      this.render();
    }
  }

  disconnectedCallback() {
    if (this.#menu?.isOpen) this.#menu.close({ focus: false });
  }

  attributeChangedCallback(name, oldValue, value) {
    if (!this.#built || oldValue === value) return;
    if (name === 'label') this.#caption();
    else if (name === 'navigable') this.refresh();
    else if (name !== 'density') this.render();
  }

  /* ---------- public API ---------- */

  get columns() { return this.#columns; }
  set columns(value) {
    this.#columns = Array.isArray(value) ? value : [];
    this.#normalize();
    this.render();
  }

  get rows() { return this.#rows; }
  set rows(value) {
    this.#rows = Array.isArray(value) ? value.slice() : [];
    this.#rekey();
    this.#normalize();
    // Forget selections that point at rows that are gone.
    const live = new Set(this.#rows.map((r) => this.keyOf(r)));
    let changed = false;
    for (const k of [...this.#selected]) if (!live.has(k)) { this.#selected.delete(k); changed = true; }
    this.render();
    if (changed) this.#emitSelection();
  }

  get sort() { return { ...this.#sort }; }
  get selectedKeys() { return [...this.#selected]; }
  get selectedRows() { return this.#rows.filter((r) => this.#selected.has(this.keyOf(r))); }
  /** Rows after filtering and sorting (all pages). */
  get viewRows() { return this.#view.slice(); }

  keyOf(row) { return this.#keys.get(row); }

  sortBy(key, dir = 'asc') {
    const next = dir && key ? dir : 'none';
    this.#sort = { key: next === 'none' ? null : key, dir: next };
    this.render({ flip: true });
    const col = this.#cols.find((c) => c.key === key);
    this._announce(next === 'none' ? 'Sort cleared' : `Sorted by ${col?.label ?? key}, ${ARIA_SORT[next]}`);
    this.dispatchEvent(new CustomEvent('sortchange', { bubbles: true, detail: { key: this.#sort.key, dir: next } }));
  }

  select(keys, on = true) {
    for (const k of [].concat(keys)) on ? this.#selected.add(k) : this.#selected.delete(k);
    this.#syncSelection();
    this.#emitSelection();
  }

  /** Select (or clear) every row in the current view, across pages. */
  selectAll(on = true) {
    this.select(this.#view.map((r) => this.keyOf(r)), on);
  }

  clearSelection() {
    if (!this.#selected.size) return;
    this.#selected.clear();
    this.#syncSelection();
    this.#emitSelection();
  }

  /** Re-render after changing row objects in place. */
  refresh() {
    this.#colsVersion++;
    this.#normalize();
    this.render();
  }

  startEdit(rowKey, columnKey, { field } = {}) {
    const tr = this.#trs.get(rowKey);
    const col = this.#cols.find((c) => c.key === columnKey) ?? this.#cols.find((c) => c.editable);
    if (!tr || !col?.editable) return false;
    const cell = tr.querySelector(`[data-col="${CSS.escape(col.key)}"]`);
    if (!cell) return false;
    this.#beginEdit(cell, col, tr.__row, field);
    return true;
  }

  deleteRows(keys) {
    const set = new Set([].concat(keys));
    const removed = [];
    this.#rows.forEach((row, index) => { if (set.has(this.keyOf(row))) removed.push({ row, index }); });
    if (!removed.length) return;
    const rows = removed.map((r) => r.row);
    const ok = this.dispatchEvent(new CustomEvent('rowsdelete', { bubbles: true, cancelable: true, detail: { rows, keys: [...set] } }));
    if (!ok) return;
    if (this.#editing) this.#cancelEdit();
    const focusWasInside = this.contains(document.activeElement);
    const trs = rows.map((r) => this.#trs.get(this.keyOf(r))).filter((tr) => tr?.isConnected);
    const finish = () => {
      this.#rows = this.#rows.filter((r) => !set.has(this.keyOf(r)));
      for (const k of set) this.#selected.delete(k);
      this.render({ flip: true });
      this.#emitSelection();
      if (focusWasInside && !this.contains(document.activeElement)) this.#refocus();
    };
    if (trs.length && !reducedMotion()) {
      Promise.all(trs.map((tr) => animate(tr, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(-12px)' }], { spring: null, duration: 150, easing: 'ease-in' }).finished)).then(finish, finish);
    } else finish();
    sound.play('whoosh');
    const label = rows.length === 1 ? this._rowLabel(rows[0]) : `${rows.length} ${this._noun(rows.length)}`;
    toast(`Deleted ${label}`, {
      description: rows.length === 1 ? '' : this.#nameList(rows),
      action: { label: 'Undo', onClick: () => this.restoreRows(removed) },
    });
  }

  /** Put deleted rows back where they were. `removed` is [{ row, index }]. */
  restoreRows(removed) {
    const sorted = removed.slice().sort((a, b) => a.index - b.index);
    for (const { row, index } of sorted) {
      if (this.#rows.includes(row)) continue;
      this.#rows.splice(Math.min(index, this.#rows.length), 0, row);
    }
    this.#rekey();
    this.render({ flip: true });
    for (const { row } of removed) {
      const tr = this.#trs.get(this.keyOf(row));
      if (tr) this.#flash(tr);
    }
    sound.play('pop');
    this._announce(`Restored ${removed.length} ${this._noun(removed.length)}`);
    this.dispatchEvent(new CustomEvent('rowsrestore', { bubbles: true, detail: { rows: removed.map((r) => r.row) } }));
  }

  /* ---------- building ---------- */

  _build() {
    this.classList.add('rig-table');
    this.style.setProperty('--rig-ease-spring', springEasing(springs.lively).easing);
    const source = this.querySelector(':scope > table');
    this.#emptySlot = this.querySelector(':scope > [slot="empty"]');
    this.#emptySlot?.remove();

    this._caption = h('caption', { class: 'rig-visually-hidden' });
    this._thead = h('thead', { class: 'rig-table__head' });
    this._tbody = h('tbody', { class: 'rig-table__body' });
    this._table = h('table', { class: 'rig-table__table' }, this._caption, this._thead, this._tbody);
    this._scroll = h('div', { class: 'rig-table__scroll' }, this._table);
    this._view = h('div', { class: 'rig-table__view' }, this._scroll);
    this._frame = h('div', { class: 'rig-table__frame' }, this._view);
    this._live = h('p', { class: 'rig-visually-hidden', role: 'status', 'aria-live': 'polite' });

    if (source) {
      const parsed = readSourceTable(source);
      source.remove();
      if (!this.#columns.length) this.#columns = parsed.columns;
      if (!this.#rows.length) this.#rows = parsed.rows;
      if (parsed.caption && !this.hasAttribute('label')) this.setAttribute('label', parsed.caption);
      this.#rekey();
      this.#normalize();
    }
    this.append(this._frame, this._live);
    this.#caption();

    this._thead.addEventListener('click', (e) => this.#onHeadClick(e));
    this._table.addEventListener('click', (e) => this.#onBodyClick(e));
    this._table.addEventListener('dblclick', (e) => this.#onDblClick(e));
    this._table.addEventListener('mousedown', (e) => {
      // Shift+click on a checkbox selects a range; don't also select text.
      if (e.shiftKey && e.target.closest('.rig-check')) e.preventDefault();
    });
    // Touch: remember whether the tapped cell already had focus (second tap edits).
    this._table.addEventListener('pointerdown', (e) => {
      const cell = e.pointerType === 'mouse' ? null : e.target.closest('[data-editable]');
      this.#tapArmed = cell && cell.classList.contains('is-armed') ? cell : null;
    }, true);
    this._table.addEventListener('focusout', (e) => {
      const cell = e.target.closest?.('[data-editable]');
      if (cell && !cell.contains(e.relatedTarget)) cell.classList.remove('is-armed');
    });
    // Without grid mode, editable cells take Enter/F2 themselves.
    this._table.addEventListener('keydown', (e) => {
      if (this.#gridMode() || (e.key !== 'Enter' && e.key !== 'F2')) return;
      const cell = e.target.closest?.('[data-editable]');
      if (!cell || e.target !== cell) return;
      const col = this.#cols.find((c) => c.key === cell.dataset.col);
      if (!col || !cell.parentElement.__row) return;
      e.preventDefault();
      this.#beginEdit(cell, col, cell.parentElement.__row);
    });

    this.#ro = new ResizeObserver(() => this.#fitCheck());
    this.#ro.observe(this._scroll);
    this.#ro.observe(this._table);
    this._scroll.addEventListener('scroll', () => this.#edges(), { passive: true });
  }

  #caption() {
    const label = this.getAttribute('label') || '';
    this._caption.textContent = label;
    this._caption.hidden = !label;
    if (this.#gridMode()) {
      this._table.setAttribute('aria-describedby', this.#hintId());
    }
  }

  #hintId() {
    if (!this._hint) {
      const editable = this.#cols.some((c) => c.editable);
      const parts = ['Arrow keys move between cells.'];
      if (this.hasAttribute('selectable')) parts.push('Space selects the row.');
      if (editable) parts.push('Enter edits a cell.');
      this._hint = h('p', { class: 'rig-visually-hidden', id: uid('rig-table-hint') }, parts.join(' '));
      this.append(this._hint);
    }
    return this._hint.id;
  }

  #rekey() {
    this.#keys = new WeakMap();
    this.#rows.forEach((row, i) => this.#keys.set(row, this.rowKey(row, i)));
  }

  #normalize() {
    const sample = this.#rows.slice(0, 300);
    this.#cols = this.#columns.map((col) => {
      const c = { sortable: true, ...col };
      c.label = c.label ?? c.key;
      if (!c.type) c.type = detectType(sample.map((r) => (c.value ? c.value(r) : r?.[c.key])));
      const align = c.align === 'right' ? 'end' : c.align === 'left' ? 'start' : c.align;
      c.align = align || (c.type === 'number' ? 'end' : 'start');
      if (c.editable === true) c.fields = [c.key];
      else if (Array.isArray(c.editable)) c.fields = c.editable;
      return c;
    });
    this.#colsVersion++;
  }

  _noun(count) {
    const noun = this.getAttribute('noun') || 'row';
    return count === 1 ? noun : `${noun}s`;
  }

  /** A short human label for a row: the row-header column's value. */
  _rowLabel(row) {
    const col = this.#cols[0];
    if (!col) return this._noun(1);
    const v = col.value ? col.value(row) : row?.[col.key];
    return String(v ?? this._noun(1));
  }

  #nameList(rows) {
    const names = rows.map((r) => this._rowLabel(r));
    return names.length <= 3 ? names.join(', ') : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;
  }

  #gridMode() {
    return this.hasAttribute('navigable');
  }

  _announce(text) {
    if (!this._live) return;
    this._live.textContent = '';
    requestAnimationFrame(() => { this._live.textContent = text; });
  }

  /* ---------- rendering ---------- */

  /** Hook: narrow rows before sorting. */
  _filter(rows) { return rows; }
  /** Hook: pick the rows to show from the sorted view (pagination). */
  _page(rows) { return rows; }
  /** Hook: called after every render with { view, items }. */
  _afterRender() {}
  /** Hook: called when the selection changes. */
  _onSelection() {}

  get _columnCount() {
    return this.#cols.length + (this.hasAttribute('selectable') ? 1 : 0) + (this.rowActions?.length ? 1 : 0);
  }

  get _cols() { return this.#cols; }

  render({ flip = false } = {}) {
    if (!this.#built) return;
    if (this.#editing) this.#commitEdit({ keepFocus: false, silent: true });
    const grid = this.#gridMode();
    if (!grid && this._table.getAttribute('role') === 'grid') {
      // Leaving grid mode: hand tab stops back to the native controls.
      this._table.removeAttribute('role');
      this._table.removeAttribute('aria-multiselectable');
      this._table.removeAttribute('aria-describedby');
      for (const el of this._table.querySelectorAll('thead [tabindex]')) el.removeAttribute('tabindex');
    }
    if (grid) {
      this._table.setAttribute('role', 'grid');
      this._table.setAttribute('aria-multiselectable', String(this.hasAttribute('selectable')));
      if (!this.#nav) this.#nav = new GridNav(this._table, { onKey: (e, cell, row) => this.#onGridKey(e, cell, row) });
      this._table.setAttribute('aria-describedby', this.#hintId());
    }
    this.#renderHead();
    const loading = this.hasAttribute('loading');
    this._table.toggleAttribute('aria-busy', loading);
    if (loading) {
      this.#renderSkeleton();
      this.#view = [];
      this.#items = [];
      this._afterRender({ view: [], items: [], loading: true });
      return;
    }
    const focusKey = this.#focusedKey();
    const sorted = this.#applySort(this._filter(this.#rows));
    this.#view = sorted;
    const items = this._page(sorted).map((row) => ({ row, key: this.keyOf(row) }));
    this.#items = items;
    const before = flip && !reducedMotion() ? this.#measure() : null;
    this.#used = new Set();
    if (items.length) this._renderBody(items);
    else {
      for (const tb of [...this._table.tBodies]) if (tb !== this._tbody) tb.remove();
      this._tbody.replaceChildren(this.#emptyRow());
    }
    // Drop rows that are no longer shown.
    for (const [k, tr] of this.#trs) {
      if (!this.#used.has(k)) { tr.remove(); this.#trs.delete(k); }
    }
    if (before) this.#flip(before);
    this.#syncSelection();
    if (grid) {
      const tr = focusKey?.key != null ? this.#trs.get(focusKey.key) : null;
      if (tr) this.#nav.remember(tr, focusKey.col);
      this.#nav.sync();
      if (focusKey && !this.contains(document.activeElement)) this.#refocus(focusKey);
    }
    this.#fitCheck();
    this._afterRender({ view: sorted, items });
  }

  /** Default body: one row per item in the main tbody. Subclasses may group. */
  _renderBody(items) {
    const frag = document.createDocumentFragment();
    for (const item of items) frag.append(this._rowFor(item));
    this._tbody.replaceChildren(frag);
  }

  /** The <tr> for an item, reused when the row object hasn't changed. */
  _rowFor(item) {
    let tr = this.#trs.get(item.key);
    if (!tr || tr.__row !== item.row || tr.__ver !== this.#colsVersion) {
      const fresh = this._buildRow(item);
      if (tr?.isConnected) tr.replaceWith(fresh);
      tr = fresh;
      this.#trs.set(item.key, tr);
    }
    this.#used.add(item.key);
    return tr;
  }

  _buildRow({ row, key }) {
    const tr = h('tr', { class: 'rig-table__row' });
    tr.__row = row;
    tr.__key = key;
    tr.__ver = this.#colsVersion;
    if (this.hasAttribute('selectable')) {
      tr.append(h('td', { class: 'rig-table__check' }, h('div', { class: 'rig-table__cell' }, checkbox(`Select ${this._rowLabel(row)}`))));
    }
    this.#cols.forEach((col, i) => tr.append(this.#buildCell(col, row, i === 0)));
    if (this.rowActions?.length) {
      tr.append(h('td', { class: 'rig-table__act' }, h('div', { class: 'rig-table__cell' },
        h('button', {
          class: 'rig-table__more',
          type: 'button',
          'aria-label': `Actions for ${this._rowLabel(row)}`,
          'aria-haspopup': 'menu',
          'aria-expanded': 'false',
        }, svgIcon(ICONS.more, { size: 18, stroke: 3 })))));
    }
    return tr;
  }

  #buildCell(col, row, isHeader) {
    const value = col.value ? col.value(row) : row?.[col.key];
    let content = col.format ? col.format(value, row) : value;
    if (content == null) content = '';
    const cell = h(isHeader ? 'th' : 'td', {
      class: 'rig-table__td',
      scope: isHeader ? 'row' : null,
      'data-col': col.key,
      'data-align': col.align,
      'data-type': col.type,
      'data-editable': col.editable ? '' : null,
      // Outside grid mode an editable cell is its own tab stop.
      tabindex: col.editable && !this.#gridMode() ? '0' : null,
      'aria-describedby': col.editable && !this.#gridMode() ? this.#editHintId() : null,
    });
    const inner = h('div', { class: 'rig-table__cell' });
    if (content instanceof Node) inner.append(content);
    else if (Array.isArray(content)) inner.append(...content);
    else inner.textContent = String(content);
    cell.append(inner);
    return cell;
  }

  #renderHead() {
    const selectable = this.hasAttribute('selectable');
    const signature = `${this.#colsVersion}|${selectable}|${this.rowActions?.length ?? 0}`;
    if (signature !== this.#headVersion) {
      this.#headVersion = signature;
      const tr = h('tr');
      this.#headCheck = null;
      if (selectable) {
        const box = checkbox('Select all rows');
        this.#headCheck = box.querySelector('input');
        tr.append(h('th', { class: 'rig-table__check', scope: 'col' }, box));
      }
      for (const col of this.#cols) {
        const style = col.width ? { width: col.width, minWidth: col.width } : null;
        const th = h('th', { class: 'rig-table__th', scope: 'col', 'data-col': col.key, 'data-align': col.align, style });
        const label = h('span', { class: 'rig-table__label' }, col.label);
        if (col.sortable) {
          th.append(h('button', { class: 'rig-table__sort', type: 'button' },
            label,
            h('span', { class: 'rig-table__arrows', 'aria-hidden': 'true' },
              svgIcon(ICONS.arrow, { size: 14, stroke: 2.25, className: 'rig-table__arrow' }),
              svgIcon(ICONS.unsorted, { size: 14, stroke: 2, className: 'rig-table__unsorted' }))));
        } else th.append(label);
        tr.append(th);
      }
      if (this.rowActions?.length) tr.append(h('th', { class: 'rig-table__act', scope: 'col' }, h('span', { class: 'rig-visually-hidden' }, 'Actions')));
      this._thead.replaceChildren(tr);
    }
    for (const th of this._thead.querySelectorAll('th[data-col]')) {
      const dir = th.dataset.col === this.#sort.key ? this.#sort.dir : 'none';
      if (ARIA_SORT[dir]) th.setAttribute('aria-sort', ARIA_SORT[dir]);
      else th.removeAttribute('aria-sort');
    }
  }

  #renderSkeleton() {
    const frag = document.createDocumentFragment();
    const count = Math.max(3, Math.min(8, this.#items.length || 5));
    for (let r = 0; r < count; r++) {
      const tr = h('tr', { class: 'rig-table__row rig-table__skeleton', 'data-nav-skip': '', 'aria-hidden': 'true' });
      if (this.hasAttribute('selectable')) tr.append(h('td', { class: 'rig-table__check' }, h('span', { class: 'rig-table__skel rig-table__skel--box' })));
      this.#cols.forEach((col, c) => {
        const w = SKELETON_WIDTHS[(r * 3 + c * 2) % SKELETON_WIDTHS.length];
        tr.append(h('td', { class: 'rig-table__td', 'data-align': col.align },
          h('div', { class: 'rig-table__cell' }, h('span', { class: 'rig-table__skel', style: { width: `${w}%` } }))));
      });
      if (this.rowActions?.length) tr.append(h('td', { class: 'rig-table__act' }));
      frag.append(tr);
    }
    for (const tb of [...this._table.tBodies]) if (tb !== this._tbody) tb.remove();
    for (const tr of this.#trs.values()) tr.remove();
    this.#trs.clear();
    this._tbody.replaceChildren(frag);
    this._announce(`Loading ${this._noun(2)}`);
  }

  /** Hook: what the empty state says. */
  _emptyContent() {
    if (this.#emptySlot) return this.#emptySlot.cloneNode(true);
    return h('p', { class: 'rig-table__empty-title' }, this.getAttribute('empty') || `No ${this._noun(2)} yet`);
  }

  #emptyRow() {
    return h('tr', { class: 'rig-table__empty-row', 'data-nav-skip': '' },
      h('td', { colspan: String(this._columnCount) },
        h('div', { class: 'rig-table__empty' },
          h('span', { class: 'rig-table__empty-icon', 'aria-hidden': 'true' }, svgIcon(ICONS.empty, { size: 22, stroke: 1.75 })),
          this._emptyContent())));
  }

  #applySort(rows) {
    const { key, dir } = this.#sort;
    if (!key || dir === 'none') return rows;
    const col = this.#cols.find((c) => c.key === key);
    if (!col) return rows;
    return sortRows(rows, {
      key,
      dir,
      type: col.sortValue ? undefined : col.type,
      value: col.sortValue ?? col.value,
    });
  }

  #measure() {
    const tops = new Map();
    for (const [k, tr] of this.#trs) if (tr.isConnected) tops.set(k, tr.getBoundingClientRect().top);
    return tops;
  }

  #flip(before) {
    for (const [k, tr] of this.#trs) {
      if (!tr.isConnected) continue;
      const was = before.get(k);
      if (was == null) {
        if (before.size) animate(tr, [{ opacity: 0 }, { opacity: 1 }], { spring: null, duration: 180, fill: 'none' });
        continue;
      }
      const dy = was - tr.getBoundingClientRect().top;
      if (Math.abs(dy) < 1) continue;
      animate(tr, [{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { spring: springs.smooth, fill: 'none' });
    }
  }

  #flash(tr) {
    if (reducedMotion()) return;
    tr.classList.remove('is-flash');
    void tr.offsetWidth;
    tr.classList.add('is-flash');
    setTimeout(() => tr.classList.remove('is-flash'), 900);
  }

  /* ---------- horizontal scrolling ---------- */

  #fitCheck() {
    if (!this._scroll) return;
    const cs = getComputedStyle(this._scroll);
    const bounded = cs.maxHeight !== 'none' || this.hasAttribute('scroll');
    // Fitting tables let the header stick to the page; wide ones scroll in place.
    const fits = !bounded && this._table.offsetWidth <= this._scroll.clientWidth + 1;
    this._scroll.classList.toggle('is-fit', fits);
    // Group headers stick just under the column headers.
    this.style.setProperty('--rig-thead-h', `${this._thead.offsetHeight}px`);
    this.#edges();
  }

  #edges() {
    const s = this._scroll;
    const max = s.scrollWidth - s.clientWidth;
    this._view.classList.toggle('has-left', s.scrollLeft > 2);
    this._view.classList.toggle('has-right', max > 2 && s.scrollLeft < max - 2);
  }

  /* ---------- selection ---------- */

  /** Keys the header checkbox acts on (the rows on screen). */
  _scopeKeys() { return this.#items.map((i) => i.key); }

  #syncSelection() {
    const grid = this._table.getAttribute('role') === 'grid';
    for (const tr of this.#trs.values()) {
      const on = this.#selected.has(tr.__key);
      tr.classList.toggle('is-selected', on);
      if (grid && this.hasAttribute('selectable')) tr.setAttribute('aria-selected', String(on));
      const input = tr.querySelector('.rig-check__input');
      if (input) input.checked = on;
    }
    if (this.#headCheck) {
      const scope = this._scopeKeys();
      const count = scope.filter((k) => this.#selected.has(k)).length;
      this.#headCheck.checked = count > 0 && count === scope.length;
      this.#headCheck.indeterminate = count > 0 && count < scope.length;
      this.#headCheck.disabled = scope.length === 0;
    }
  }

  #emitSelection() {
    const keys = this.selectedKeys;
    this._onSelection(keys);
    this._announce(keys.length ? `${keys.length} ${this._noun(keys.length)} selected` : 'Selection cleared');
    this.dispatchEvent(new CustomEvent('selectionchange', { bubbles: true, detail: { keys, rows: this.selectedRows } }));
  }

  #toggleKeys(keys, on) {
    for (const k of keys) on ? this.#selected.add(k) : this.#selected.delete(k);
    this.#syncSelection();
    this.#emitSelection();
    sound.play('toggle', { on });
  }

  #pop(input) {
    const box = input.parentElement.querySelector('.rig-check__box');
    if (box && input.checked) animate(box, [{ transform: 'scale(0.7)' }, { transform: 'scale(1)' }], { spring: springs.lively, fill: 'none' });
  }

  /* ---------- events ---------- */

  #onHeadClick(e) {
    const check = e.target.closest('.rig-check__input');
    if (check) {
      this.#toggleKeys(this._scopeKeys(), check.checked);
      this.#pop(check);
      return;
    }
    const btn = e.target.closest('.rig-table__sort');
    if (!btn) return;
    const key = btn.closest('th').dataset.col;
    const current = this.#sort.key === key ? this.#sort.dir : 'none';
    sound.play('tick');
    this.sortBy(key, SORT_CYCLE[current]);
  }

  #onBodyClick(e) {
    if (e.target.closest('thead')) return;
    const check = e.target.closest('.rig-check__input');
    const tr = e.target.closest('tr');
    if (check && tr?.__key != null) {
      const on = check.checked;
      let keys = [tr.__key];
      if (e.shiftKey && this.#anchorKey != null) {
        const order = this._scopeKeys();
        const a = order.indexOf(this.#anchorKey);
        const b = order.indexOf(tr.__key);
        if (a !== -1 && b !== -1) keys = order.slice(Math.min(a, b), Math.max(a, b) + 1);
      }
      this.#anchorKey = tr.__key;
      this.#toggleKeys(keys, on);
      this.#pop(check);
      return;
    }
    const more = e.target.closest('.rig-table__more');
    if (more && tr) { this.#openMenu(more, tr); return; }
    // Touch: the first tap selects an editable cell, a second tap on it edits.
    if (e.pointerType === 'touch' || e.pointerType === 'pen') {
      const cell = e.target.closest('[data-editable]');
      if (!cell || cell.classList.contains('is-editing') || e.target.closest('button, a, input')) return;
      const col = this.#cols.find((c) => c.key === cell.dataset.col);
      if (!col || !cell.parentElement.__row) return;
      if (this.#tapArmed === cell) {
        cell.classList.remove('is-armed');
        this.#beginEdit(cell, col, cell.parentElement.__row, e.target.closest('[data-field]')?.dataset.field);
      } else {
        for (const armed of this._table.querySelectorAll('.is-armed')) armed.classList.remove('is-armed');
        cell.focus({ preventScroll: true });
        cell.classList.add('is-armed');
      }
      this.#tapArmed = null;
    }
  }

  #editHintId() {
    if (!this._editHint) {
      this._editHint = h('p', { class: 'rig-visually-hidden', id: uid('rig-table-edit') }, 'Press Enter to edit.');
      this.append(this._editHint);
    }
    return this._editHint.id;
  }

  /** Put focus back on a cell after editing, in either mode. */
  #focusCell(tr, index) {
    if (this.#nav && this.#gridMode()) { this.#nav.focusCell(tr, index); return; }
    const cell = tr.cells[index];
    if (cell && cell.tabIndex >= 0) cell.focus({ preventScroll: true });
  }

  #onDblClick(e) {
    const cell = e.target.closest('[data-editable]');
    if (!cell || e.target.closest('button, a, input')) return;
    const tr = cell.parentElement;
    const col = this.#cols.find((c) => c.key === cell.dataset.col);
    if (!col || !tr.__row) return;
    window.getSelection?.()?.removeAllRanges();
    this.#beginEdit(cell, col, tr.__row, e.target.closest('[data-field]')?.dataset.field);
  }

  #onGridKey(e, cell, tr) {
    if (!tr.__row) {
      // Header row: let Space/Enter reach buttons and checkboxes.
      return false;
    }
    const key = e.key;
    const onControl = e.target !== cell;
    if ((key === 'Enter' || key === 'F2') && !onControl) {
      e.preventDefault();
      const col = this.#cols.find((c) => c.key === cell.dataset.col);
      if (col?.editable) this.#beginEdit(cell, col, tr.__row);
      else if (key === 'Enter') this.dispatchEvent(new CustomEvent('rowactivate', { bubbles: true, detail: { row: tr.__row, key: tr.__key } }));
      return true;
    }
    if (key === ' ' && !onControl && this.hasAttribute('selectable')) {
      e.preventDefault();
      this.#anchorKey = tr.__key;
      this.#toggleKeys([tr.__key], !this.#selected.has(tr.__key));
      return true;
    }
    if ((e.ctrlKey || e.metaKey) && key.toLowerCase() === 'a' && this.hasAttribute('selectable')) {
      e.preventDefault();
      this.#toggleKeys(this._scopeKeys(), true);
      return true;
    }
    if (key === 'Escape' && this.#selected.size) {
      e.preventDefault();
      this.clearSelection();
      return true;
    }
    return false;
  }

  #focusedKey() {
    const active = document.activeElement;
    if (!active || !this._table.contains(active)) return null;
    const cell = active.closest('th, td');
    const tr = cell?.parentElement;
    if (!tr?.__row) return null;
    return { key: tr.__key, col: [...tr.cells].indexOf(cell) };
  }

  #refocus(pos = null) {
    if (!this.#nav) return;
    const tr = (pos && this.#trs.get(pos.key)) || this._tbody.querySelector('tr.rig-table__row:not([data-nav-skip])') || this._table.querySelector('tbody tr:not([data-nav-skip])');
    if (tr) this.#nav.focusCell(tr, pos?.col ?? 0);
  }

  /* ---------- row actions ---------- */

  #openMenu(button, tr) {
    if (!this.#menu) this.#menu = new ActionMenu({ host: this, label: 'Row actions' });
    if (this.#menu.isOpen && this.#menu.anchor === button) { this.#menu.close(); return; }
    if (this.#menu.justClosedFrom(button)) return;
    const row = tr.__row;
    const key = tr.__key;
    this.#menu.open(button, this.rowActions, (value) => {
      const ok = this.dispatchEvent(new CustomEvent('rowaction', { bubbles: true, cancelable: true, detail: { action: value, row, key } }));
      if (ok) this._defaultAction(value, row, key);
    });
  }

  /** Hook: built-in row actions. */
  _defaultAction(action, row, key) {
    if (action === 'edit') {
      const col = this.#cols.find((c) => c.editable);
      if (col) requestAnimationFrame(() => this.startEdit(key, col.key));
    } else if (action === 'delete') {
      this.deleteRows([key]);
    }
  }

  /* ---------- inline editing ---------- */

  #beginEdit(cell, col, row, field) {
    if (this.#editing) {
      if (this.#editing.cell === cell) return;
      if (!this.#commitEdit({ keepFocus: false })) return;
    }
    const inner = cell.querySelector('.rig-table__cell');
    if (!inner) return;
    const fields = col.fields ?? [col.key];
    const inputs = fields.map((f) => {
      const label = col.fieldLabels?.[f] ?? (f === col.key ? col.label : f);
      return h('input', {
        class: 'rig-table__input',
        type: 'text',
        value: row?.[f] ?? '',
        'data-field': f,
        'aria-label': `${label} for ${this._rowLabel(row)}`,
        inputmode: /mail/i.test(f) ? 'email' : null,
        autocomplete: 'off',
        spellcheck: 'false',
      });
    });
    const error = h('p', { class: 'rig-table__edit-error', id: uid('rig-edit-err'), hidden: true });
    const editor = h('div', { class: 'rig-table__editor' }, inputs, error);
    const saved = [...inner.childNodes];
    inner.replaceChildren(editor);
    cell.classList.add('is-editing');
    this.#editing = { cell, col, row, inputs, saved, error, tr: cell.parentElement };

    editor.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.#commitEdit({ keepFocus: true }); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.#cancelEdit(); }
    });
    editor.addEventListener('focusout', (e) => {
      if (editor.contains(e.relatedTarget)) return;
      // Let the click that moved focus land first (e.g. another cell's double-click).
      queueMicrotask(() => { if (this.#editing?.cell === cell) this.#commitEdit({ keepFocus: false, fromBlur: true }); });
    });
    const target = inputs.find((i) => i.dataset.field === field) ?? inputs[0];
    target.focus();
    target.select();
    sound.play('tap');
  }

  #cancelEdit() {
    const ed = this.#editing;
    if (!ed) return;
    this.#editing = null;
    const inner = ed.cell.querySelector('.rig-table__cell');
    inner.replaceChildren(...ed.saved);
    ed.cell.classList.remove('is-editing');
    this.#focusCell(ed.tr, [...ed.tr.cells].indexOf(ed.cell));
  }

  /** Save the open editor. Returns false when a value is invalid and the editor stays open. */
  #commitEdit({ keepFocus = true, fromBlur = false, silent = false } = {}) {
    const ed = this.#editing;
    if (!ed) return true;
    const { cell, col, row, inputs, error, tr } = ed;
    const values = inputs.map((input) => ({ field: input.dataset.field, value: input.value.trim(), input }));
    for (const v of values) {
      const message = col.validate?.(v.value, v.field, row) || '';
      v.input.toggleAttribute('aria-invalid', Boolean(message));
      if (message) {
        if (fromBlur || silent) {
          // Leaving with an invalid value keeps the old one.
          this.#cancelEditQuiet();
          if (!silent) toast.error(`${col.fieldLabels?.[v.field] ?? col.label} not saved`, { description: message });
          return true;
        }
        error.textContent = message;
        error.hidden = false;
        v.input.setAttribute('aria-describedby', error.id);
        v.input.focus();
        sound.play('error');
        if (!reducedMotion()) animate(v.input, [{ transform: 'translateX(0)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(0)' }], { spring: null, duration: 220, fill: 'none' });
        return false;
      }
    }
    this.#editing = null;
    let changed = false;
    for (const { field, value } of values) {
      const previous = row[field] ?? '';
      if (String(previous) === value) continue;
      const ok = this.dispatchEvent(new CustomEvent('cellchange', { bubbles: true, cancelable: true, detail: { row, key: field, column: col.key, value, previous } }));
      if (!ok) continue;
      row[field] = value;
      const src = SOURCE_CELLS.get(row);
      if (src) delete src[field];
      changed = true;
    }
    const colIndex = [...tr.cells].indexOf(cell);
    const newCell = this.#buildCell(col, row, col === this.#cols[0]);
    cell.replaceWith(newCell);
    if (changed) {
      // The row's name may have changed; keep control labels in step.
      const name = this._rowLabel(row);
      tr.querySelector('.rig-check__input')?.setAttribute('aria-label', `Select ${name}`);
      tr.querySelector('.rig-table__more')?.setAttribute('aria-label', `Actions for ${name}`);
    }
    if (this.#gridMode()) this.#nav?.sync();
    if (changed) {
      newCell.classList.add('is-saved');
      setTimeout(() => newCell.classList.remove('is-saved'), 900);
      if (!silent) sound.play('success');
      this._announce(`${col.label} saved`);
    }
    if (keepFocus) this.#focusCell(tr, colIndex);
    return true;
  }

  #cancelEditQuiet() {
    const ed = this.#editing;
    if (!ed) return;
    this.#editing = null;
    ed.cell.querySelector('.rig-table__cell').replaceChildren(...ed.saved);
    ed.cell.classList.remove('is-editing');
  }
}

define('rig-table', RigTable);
