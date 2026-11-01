// <rig-combobox> — type to filter a list, with optional async search.
//
//   <rig-combobox name="city" placeholder="Search a city" allow-custom>
//     <option value="ocala-fl">Ocala, FL</option>
//     <option value="savannah-ga" data-keywords="port">Savannah, GA</option>
//   </rig-combobox>
//
//   combo.load = async (query, signal, { offset }) => {
//     const res = await fetch(`/cities?q=${encodeURIComponent(query)}&offset=${offset}`, { signal })
//     return res.json() // [{ value, label, hint }], strings, or { items, hasMore }
//   }
//
// Static options are fuzzy-filtered as you type (matched letters are marked).
// With `load`, results come from your function instead: calls are debounced,
// the previous call's signal is aborted, and a spinner shows while it runs.
// Return { items, hasMore: true } to page: a "Loading more…" row appears and
// the next page (offset = items so far) loads when the highlight reaches the
// last item or the list is scrolled near the bottom. The highlight stays put.
//
// Deliberate limit: every loaded row stays in the DOM (no virtual scrolling),
// which is fine for a few hundred suggestions.
//
// Attributes: name, value, placeholder, disabled, required, label,
//   allow-custom (offer “Use ‘typed text’”), empty (no-results text),
//   debounce (ms, default 250), min-chars (for load, default 1), invalid.
// Properties: value, options, load, inputValue (the text in the box), open.
// Methods: show(), close(), focus(), clear().
// Events: input, change (value committed: { detail: { value, label, custom } }),
//   rig-open, rig-close.
//
// Keyboard (WAI-ARIA combobox, list autocomplete): ↓/↑ open and move,
// PageUp/PageDown, Enter chooses, Esc closes (then clears), Alt+↓ opens.

import { fuzzyMatch, fuzzyRank } from '../fuzzy.js';
import { sound } from '../sound.js';
import { define, h, paths, svgIcon } from '../util.js';
import { Picklist, normalizeItems, readOptions } from './listbox.js';
import { readPage } from './pick-logic.js';
import { FormElement, contain, createPopup, icon, whenParsed } from './shared.js';

export class RigCombobox extends FormElement {
  static observedAttributes = ['placeholder', 'disabled', 'label', 'value'];

  #built = false;
  #items = [];
  #known = new Map();
  #value = '';
  #label = '';
  #custom = false;
  #initial = '';
  #field;
  #input;
  #clearBtn;
  #toggleBtn;
  #spinner;
  #pop;
  #status;
  #live;
  #list;
  #popup;
  #showAll = false;
  #loader = null;
  #loadCtl = null;
  #loadTimer = 0;
  #loading = false;
  #error = '';
  #liveTimer = 0;
  #page = null; // { q, entries, hasMore, loadingMore, failed }
  #moreCtl = null;
  #moreRow;

  connectedCallback() {
    if (!this.#built) whenParsed(() => this.#build());
    else this._linkLabels(this.#input, this.#list?.el);
  }

  disconnectedCallback() {
    this.#popup?.hide({ instant: true });
    this.#loadCtl?.abort();
    this.#moreCtl?.abort();
    clearTimeout(this.#loadTimer);
  }

  attributeChangedCallback(attr, oldValue, newValue) {
    if (!this.#built || oldValue === newValue) return;
    if (attr === 'value') this.value = newValue ?? '';
    else if (attr === 'disabled') this._onDisabledChange(this._isDisabled);
    else if (attr === 'placeholder') this.#input.placeholder = newValue || '';
    else if (attr === 'label') this.#input.setAttribute('aria-label', newValue || '');
  }

  get allowCustom() { return this.hasAttribute('allow-custom'); }
  get value() { return this.#value; }
  set value(next) {
    const v = next == null ? '' : String(next);
    if (!this.#built) { this.#initial = v; return; }
    this.#applyValue(v, { quiet: true });
  }
  get inputValue() { return this.#input?.value ?? ''; }
  get options() { return this.#items.slice(); }
  set options(list) {
    this.#items = normalizeItems(list);
    for (const item of this.#items) this.#known.set(item.value, item);
    if (this.#built && this.open) this.#update();
  }
  get load() { return this.#loader; }
  set load(fn) { this.#loader = typeof fn === 'function' ? fn : null; }
  get open() { return Boolean(this.#popup?.open); }

  focus(opts) { this.#input?.focus(opts); }
  show() { this.#show(); }
  close() { this.#close(); }
  clear() { this.#applyValue('', { quiet: false }); this.#input.value = ''; this.#syncClear(); }

  formResetCallback() { this.#applyValue(this.#initial, { quiet: true }); }
  formStateRestoreCallback(state) { if (typeof state === 'string') this.#applyValue(state, { quiet: true }); }
  _onDisabledChange(disabled) {
    if (!this.#input) return;
    this.#input.disabled = disabled;
    this.#toggleBtn.disabled = disabled;
    this.#clearBtn.disabled = disabled;
    if (disabled) this.#close();
  }

  #build() {
    if (this.#built) return;
    this.#built = true;
    this.classList.add('rig-combobox');
    const declared = readOptions(this);
    if (!this.#items.length) this.#items = normalizeItems(declared.items);
    for (const item of this.#items) this.#known.set(item.value, item);
    this.#initial = this.#initial || this.getAttribute('value') || declared.selected[0] || '';

    this.#list = new Picklist({
      label: this.getAttribute('label') || 'Suggestions',
      onPick: (item) => this.#commit(item),
      onActive: (entry) => {
        if (entry && this.open) this.#input.setAttribute('aria-activedescendant', entry.el.id);
        else this.#input.removeAttribute('aria-activedescendant');
        // Highlight on the last loaded suggestion: fetch the next page.
        if (entry && this.#page?.hasMore && entry.item === this.#page.entries.at(-1)?.item) this.#loadMore();
      },
    });
    this.#moreRow = h('div', { class: 'rig-picklist__more', 'aria-hidden': 'true' });
    this.#list.el.addEventListener('scroll', () => {
      const el = this.#list.el;
      if (this.#page?.hasMore && el.scrollTop + el.clientHeight >= el.scrollHeight - 72) this.#loadMore();
    }, { passive: true });
    this.#input = h('input', {
      class: 'rig-combo__input',
      type: 'text',
      role: 'combobox',
      autocomplete: 'off',
      spellcheck: 'false',
      'aria-autocomplete': 'list',
      'aria-expanded': 'false',
      'aria-controls': this.#list.id,
      'aria-label': this.getAttribute('label'),
      placeholder: this.getAttribute('placeholder') || '',
    });
    this.#spinner = h('span', { class: 'rig-spinner rig-combo__spinner', 'aria-hidden': 'true', hidden: true });
    this.#clearBtn = h('button', { type: 'button', class: 'rig-combo__btn rig-combo__clear', 'aria-label': 'Clear', tabindex: '-1', hidden: true },
      svgIcon(paths.close, { size: 14 }));
    this.#toggleBtn = h('button', {
      type: 'button', class: 'rig-combo__btn rig-combo__toggle', tabindex: '-1', 'aria-label': 'Show suggestions',
      'aria-expanded': 'false', 'aria-controls': this.#list.id,
    }, icon('chevronUpDown', 16));
    this.#field = h('div', { class: 'rig-pick-field rig-combo__field' },
      svgIcon(paths.search, { size: 16, className: 'rig-combo__glass' }), this.#input, this.#spinner, this.#clearBtn, this.#toggleBtn);
    this.#status = h('div', { class: 'rig-pick-pop__status', hidden: true });
    this.#live = h('div', { class: 'rig-visually-hidden', 'aria-live': 'polite', role: 'status' });
    this.#pop = h('div', { class: 'rig-pick-pop rig-combo__pop' }, this.#status, this.#list.el);
    this.append(this.#field, this.#pop, this.#live);

    this.#popup = createPopup({
      host: this,
      anchor: this.#field,
      panel: this.#pop,
      placement: this.getAttribute('placement') || 'bottom-start',
      matchWidth: true,
      onDismiss: () => this.#close(),
    });

    contain(this.#input, 'input', 'change');
    this.#input.addEventListener('input', () => {
      this.#showAll = false;
      this.#syncClear();
      if (!this.open) this.#show({ fromTyping: true });
      else this.#update();
    });
    this.#input.addEventListener('keydown', (e) => this.#onKey(e));
    this.#input.addEventListener('click', () => { if (!this.open) this.#show(); });
    this.#field.addEventListener('mousedown', (e) => {
      if (e.target === this.#input) return;
      e.preventDefault();
      this.#input.focus();
    });
    this.#toggleBtn.addEventListener('click', () => {
      if (this.open) this.#close();
      else this.#show();
    });
    this.#clearBtn.addEventListener('click', () => {
      this.clear();
      this.#input.focus();
      sound.play('tick');
    });
    this.addEventListener('focusout', (e) => {
      if (e.relatedTarget && this.contains(e.relatedTarget)) return;
      this.#settle();
    });

    this.#applyValue(this.#initial, { quiet: true });
    this._onDisabledChange(this._isDisabled);
    this._linkLabels(this.#input, this.#list?.el);
  }

  #syncClear() {
    this.#clearBtn.hidden = !this.#input.value || this._isDisabled;
  }

  /** Set the committed value and put its label in the box. */
  #applyValue(v, { quiet }) {
    const prev = this.#value;
    const item = this.#known.get(v);
    if (item) {
      this.#value = item.value;
      this.#label = item.label;
      this.#custom = false;
    } else if (v && this.allowCustom) {
      this.#value = v;
      this.#label = v;
      this.#custom = true;
    } else {
      this.#value = '';
      this.#label = '';
      this.#custom = false;
    }
    if (this.#input) {
      this.#input.value = this.#label;
      this.#syncClear();
    }
    this._setForm(this.#value || null, this.#value);
    this._setValidity(this.required && !this.#value, 'Choose one of the suggestions.', this.#input);
    if (prev !== this.#value) {
      this.removeAttribute('invalid');
      if (!quiet) {
        this._emit('input');
        this._emit('change', { value: this.#value, label: this.#label, custom: this.#custom });
      }
    }
    return prev !== this.#value;
  }

  #commit(item) {
    if (!item) return;
    if (!item.create) this.#known.set(item.value, item);
    const changed = this.#applyValue(item.create ? item.text : item.value, { quiet: false });
    sound.play(changed ? 'tap' : 'tick');
    this.#close();
    const end = this.#input.value.length;
    this.#input.setSelectionRange(end, end);
  }

  /** Focus left: keep an exact match, a custom entry, or put the old label back. */
  #settle() {
    this.#close();
    const text = this.#input.value.trim();
    if (text === this.#label) return;
    if (!text) { this.#applyValue('', { quiet: false }); return; }
    const lower = text.toLocaleLowerCase();
    const exact = [...this.#known.values()].find((i) => i.label.toLocaleLowerCase() === lower && !i.disabled);
    if (exact) this.#applyValue(exact.value, { quiet: false });
    else if (this.allowCustom) this.#applyValue(text, { quiet: false });
    else this.#input.value = this.#label;
    this.#syncClear();
  }

  #show({ fromTyping = false } = {}) {
    if (this.open || this._isDisabled) return;
    // Opening on a box that still shows the chosen label lists everything.
    this.#showAll = !fromTyping && this.#input.value.trim() === this.#label;
    this.#popup.show();
    this.#input.setAttribute('aria-expanded', 'true');
    this.#toggleBtn.setAttribute('aria-expanded', 'true');
    this.setAttribute('open', '');
    this.#update({ opening: true });
    sound.play('open');
    this._emit('rig-open');
  }

  #close() {
    if (!this.open) return;
    this.#popup.hide();
    this.#input.setAttribute('aria-expanded', 'false');
    this.#toggleBtn.setAttribute('aria-expanded', 'false');
    this.#input.removeAttribute('aria-activedescendant');
    this.removeAttribute('open');
    clearTimeout(this.#loadTimer);
    this.#loadCtl?.abort();
    this.#moreCtl?.abort();
    this.#setLoading(false);
    this._emit('rig-close');
  }

  #query() {
    return this.#showAll ? '' : this.#input.value.trim();
  }

  #update({ opening = false } = {}) {
    const q = this.#query();
    if (this.#loader) {
      this.#scheduleLoad(q, opening);
      return;
    }
    const entries = !q
      ? this.#items.map((item) => ({ item }))
      : fuzzyRank(q, this.#items, (i) => [i.label, i.keywords, i.hint]).map((r) => ({ item: r.item, indices: r.indices }));
    this.#showResults(entries, q, opening);
  }

  #scheduleLoad(q, opening) {
    clearTimeout(this.#loadTimer);
    this.#loadCtl?.abort();
    this.#moreCtl?.abort();
    this.#setPage(null);
    const min = Math.max(0, parseInt(this.getAttribute('min-chars') ?? '1', 10) || 0);
    if (q.length < min) {
      this.#setLoading(false);
      this.#error = '';
      // Nothing typed yet: fall back to static options, or a prompt.
      const entries = this.#items.map((item) => ({ item }));
      this.#showResults(entries, q, opening, entries.length ? '' : 'Start typing to search.');
      return;
    }
    this.#setLoading(true);
    this.#renderStatus();
    const wait = opening ? 0 : Math.max(0, parseInt(this.getAttribute('debounce') ?? '250', 10) || 0);
    this.#loadTimer = setTimeout(async () => {
      const ctl = new AbortController();
      this.#loadCtl = ctl;
      try {
        const raw = await this.#loader(q, ctl.signal, { offset: 0 });
        if (ctl.signal.aborted) return;
        const page = readPage(raw);
        const items = normalizeItems(page.items);
        for (const item of items) this.#known.set(item.value, item);
        this.#error = '';
        this.#setLoading(false);
        const entries = items.map((item) => ({ item, indices: fuzzyMatch(q, item.label)?.indices ?? [] }));
        this.#setPage(page.hasMore && items.length ? { q, entries, hasMore: true, loadingMore: false, failed: false } : null);
        this.#showResults(entries, q, false);
      } catch (err) {
        if (ctl.signal.aborted || err?.name === 'AbortError') return;
        this.#setLoading(false);
        this.#error = 'Couldn’t load suggestions. Check your connection and try again.';
        this.#showResults([], q, false);
        sound.play('error');
      }
    }, wait);
  }

  #setPage(page) {
    this.#page = page;
    this.#list.setFooter(page?.hasMore ? this.#moreRow : null);
    this.#renderMore();
  }

  #renderMore() {
    const page = this.#page;
    if (!page?.hasMore) { this.#list.el.removeAttribute('aria-busy'); return; }
    this.#list.el.toggleAttribute('aria-busy', page.loadingMore);
    this.#moreRow.classList.toggle('is-failed', page.failed);
    this.#moreRow.replaceChildren(
      ...(page.failed ? [] : [h('span', { class: 'rig-spinner', 'aria-hidden': 'true' })]),
      page.failed ? 'Couldn’t load more. Scroll down or press ↓ to try again.' : 'Loading more…',
    );
  }

  /** Fetch the next page of async results and append it, keeping the highlight. */
  async #loadMore() {
    const page = this.#page;
    if (!page?.hasMore || page.loadingMore || !this.open || !this.#loader) return;
    page.loadingMore = true;
    page.failed = false;
    this.#renderMore();
    this.#say('Loading more suggestions');
    const ctl = new AbortController();
    this.#moreCtl = ctl;
    try {
      const raw = await this.#loader(page.q, ctl.signal, { offset: page.entries.length });
      if (ctl.signal.aborted || page !== this.#page) return;
      const next = readPage(raw);
      const seen = new Set(page.entries.map((e) => e.item.value));
      const fresh = normalizeItems(next.items).filter((i) => !seen.has(i.value));
      for (const item of fresh) this.#known.set(item.value, item);
      page.entries.push(...fresh.map((item) => ({ item, indices: fuzzyMatch(page.q, item.label)?.indices ?? [] })));
      page.hasMore = next.hasMore && fresh.length > 0;
      page.loadingMore = false;
      const scroll = this.#list.el.scrollTop;
      this.#list.setFooter(page.hasMore ? this.#moreRow : null);
      this.#list.render(this.#withCreate(page.entries, page.q));
      this.#list.setSelected(this.#value ? [this.#value] : []);
      this.#list.el.scrollTop = scroll;
      this.#renderMore();
      this.#say(`${page.entries.length} suggestions loaded${page.hasMore ? '' : ', that’s all of them'}`);
    } catch (err) {
      if (ctl.signal.aborted || err?.name === 'AbortError' || page !== this.#page) return;
      page.loadingMore = false;
      page.failed = true;
      this.#renderMore();
      this.#say('Couldn’t load more suggestions');
    }
  }

  #say(text) {
    clearTimeout(this.#liveTimer);
    this.#live.textContent = text;
  }

  #setLoading(on) {
    this.#loading = on;
    this.#spinner.hidden = !on;
    this.#field.toggleAttribute('aria-busy', on);
    this.#pop.classList.toggle('is-loading', on);
  }

  #renderStatus(prompt = '') {
    const status = this.#status;
    let text = '';
    let tone = '';
    if (this.#error) { text = this.#error; tone = 'bad'; }
    else if (this.#loading && !this.#list.count) text = 'Searching…';
    else if (!this.#list.count) {
      const q = this.#query();
      text = prompt || this.getAttribute('empty') || (q ? `No matches for “${q}”. Check the spelling or try fewer letters.` : 'No options.');
    }
    status.hidden = !text;
    status.dataset.tone = tone;
    status.replaceChildren(...(this.#loading && !this.#list.count && !this.#error ? [h('span', { class: 'rig-spinner', 'aria-hidden': 'true' })] : []), text);
    this.#list.el.hidden = !this.#list.count;
  }

  /** Entries plus the “Use ‘typed text’” row when custom values are allowed. */
  #withCreate(entries, q) {
    if (!this.allowCustom || !q) return entries;
    const lower = q.toLocaleLowerCase();
    if (entries.some((e) => e.item.label.toLocaleLowerCase() === lower)) return entries;
    return [...entries, { item: { value: `\u0000${q}`, label: `Use “${q}”`, text: q, create: true } }];
  }

  #showResults(entries, q, opening, prompt = '') {
    if (!this.#loader) this.#setPage(null);
    this.#list.render(this.#withCreate(entries, q));
    this.#list.setSelected(this.#value ? [this.#value] : []);
    this.#renderStatus(prompt);
    if (q) {
      this.#list.edge('first');
    } else {
      const i = this.#list.indexOf(this.#value);
      this.#list.setActive(i, { scroll: false, instant: true });
    }
    if (opening) this.#list.reveal({ scroll: 'center' });
    this.#popup.reposition();
    this.#announce(q, entries.length);
  }

  #announce(q, n) {
    clearTimeout(this.#liveTimer);
    if (!q) return;
    this.#liveTimer = setTimeout(() => {
      this.#live.textContent = this.#error || (n ? `${n} suggestion${n === 1 ? '' : 's'}` : 'No suggestions');
    }, 450);
  }

  #onKey(e) {
    const list = this.#list;
    const open = this.open;
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        e.preventDefault();
        const dir = e.key === 'ArrowDown' ? 1 : -1;
        if (!open) {
          this.#show();
          if (!e.altKey && list.active === -1) list.edge(dir > 0 ? 'first' : 'last');
          return;
        }
        list.move(dir);
        // ↓ on the last row retries a failed page.
        if (dir > 0 && this.#page?.failed && list.activeEntry?.item === this.#page.entries.at(-1)?.item) this.#loadMore();
        sound.play('tick', { step: -6 });
        break;
      }
      case 'PageUp':
      case 'PageDown':
        if (!open) return;
        e.preventDefault();
        list.page(e.key === 'PageDown' ? 1 : -1);
        break;
      case 'Enter': {
        if (e.isComposing) return;
        if (open && list.activeEntry) {
          e.preventDefault();
          this.#commit(list.activeEntry.item);
        } else if (this.#input.value.trim() !== this.#label) {
          e.preventDefault();
          this.#settle();
        }
        break;
      }
      case 'Escape':
        if (open) {
          e.preventDefault();
          e.stopPropagation();
          this.#close();
        } else if (this.#input.value) {
          e.preventDefault();
          this.#input.value = '';
          this.#applyValue('', { quiet: false });
        }
        break;
      default:
    }
  }
}

define('rig-combobox', RigCombobox);
