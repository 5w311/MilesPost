// Roving focus for tables that behave as a grid. Internal to the data components.
//
//   const nav = new GridNav(table, { onKey(e, cell, row) { return handled } })
//   nav.sync()            // after re-rendering rows
//   nav.focusRow(row)     // move focus to a row, keeping the column
//
// The whole grid is one tab stop. Arrow keys move between cells, Home/End go to
// the ends of a row, Ctrl+Home/End to the first/last cell, PageUp/PageDown jump
// ten rows. A cell's focus target is the first control inside it (checkbox,
// button, link) or the cell itself.

const FOCUSABLE = 'input:not([type=hidden]), button, a[href], select, textarea, [data-nav-target]';
const TEXT_INPUT = /^(text|search|email|url|tel|number|password)$/;

export class GridNav {
  #table;
  #onKey;
  #pos = { row: null, col: 0 }; // row element + cell index

  constructor(table, { onKey } = {}) {
    this.#table = table;
    this.#onKey = onKey;
    table.addEventListener('keydown', (e) => this.#keydown(e));
    table.addEventListener('focusin', (e) => {
      if (!this.#on()) return;
      const cell = e.target.closest?.('th, td');
      if (!cell || !table.contains(cell)) return;
      const row = cell.parentElement;
      if (!this.#rows().includes(row)) return;
      this.#pos = { row, col: [...row.cells].indexOf(cell) };
      this.#roving();
    });
  }

  /** Rows that can take focus, in visual order. */
  #rows() {
    return [...this.#table.rows].filter((r) => !r.hidden && !r.closest('[hidden]') && !r.hasAttribute('data-nav-skip'));
  }

  target(cell) {
    if (!cell) return null;
    return cell.querySelector(FOCUSABLE) ?? cell;
  }

  get activeRow() { return this.#pos.row; }

  #current() {
    const rows = this.#rows();
    let row = this.#pos.row;
    if (!row || !rows.includes(row)) row = rows.find((r) => r.parentElement?.localName === 'tbody') ?? rows[0];
    if (!row) return null;
    const col = Math.min(this.#pos.col, row.cells.length - 1);
    return { row, col, rows };
  }

  /** Make exactly one control in the grid tabbable. */
  #roving() {
    const cur = this.#current();
    for (const el of this.#table.querySelectorAll('th, td')) {
      if (el.hasAttribute('data-nav-ignore')) continue;
      const t = this.target(el);
      if (t === el) el.tabIndex = -1;
      else { el.removeAttribute('tabindex'); for (const inner of el.querySelectorAll(FOCUSABLE)) if (!inner.closest('[data-nav-free]')) inner.tabIndex = -1; }
    }
    if (!cur) return;
    const t = this.target(cur.row.cells[cur.col]);
    if (t) t.tabIndex = 0;
  }

  sync() { this.#roving(); }

  /** Focus a cell (row element, cell index). */
  focusCell(row, col) {
    if (!row) return;
    const c = Math.max(0, Math.min(col, row.cells.length - 1));
    this.#pos = { row, col: c };
    this.#roving();
    const t = this.target(row.cells[c]);
    t?.focus({ preventScroll: false });
    t?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }

  focusRow(row) { this.focusCell(row, this.#pos.col); }

  /** Remember a position without moving focus (e.g. before a re-render). */
  remember(row, col) { this.#pos = { row, col }; }

  /** The helper stays attached but idles once the table stops being a grid. */
  #on() { return this.#table.getAttribute('role') === 'grid'; }

  #keydown(e) {
    if (!this.#on()) return;
    const t = e.target;
    // Text fields own their keys (inline editors, search).
    if (t.localName === 'textarea' || t.isContentEditable || (t.localName === 'input' && TEXT_INPUT.test(t.type))) return;
    const cell = t.closest?.('th, td');
    if (!cell || !this.#table.contains(cell)) return;
    const row = cell.parentElement;
    if (this.#onKey?.(e, cell, row)) return;
    const rows = this.#rows();
    const r = rows.indexOf(row);
    if (r === -1) return;
    const c = [...row.cells].indexOf(cell);
    const ctrl = e.ctrlKey || e.metaKey;
    let next = null;
    switch (e.key) {
      case 'ArrowDown': next = [Math.min(rows.length - 1, r + 1), c]; break;
      case 'ArrowUp': next = [Math.max(0, r - 1), c]; break;
      case 'ArrowRight': next = [r, Math.min(row.cells.length - 1, c + 1)]; break;
      case 'ArrowLeft': next = [r, Math.max(0, c - 1)]; break;
      case 'Home': next = ctrl ? [0, 0] : [r, 0]; break;
      case 'End': next = ctrl ? [rows.length - 1, rows[rows.length - 1].cells.length - 1] : [r, row.cells.length - 1]; break;
      case 'PageDown': next = [Math.min(rows.length - 1, r + 10), c]; break;
      case 'PageUp': next = [Math.max(0, r - 10), c]; break;
      default: return;
    }
    e.preventDefault();
    const nextRow = rows[next[0]];
    // Moving between rows with different cell counts (colspans) keeps the column when it can.
    this.focusCell(nextRow, next[1]);
  }
}
