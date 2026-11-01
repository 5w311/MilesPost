// A small action menu for table rows. Internal to the data components.
//
//   const menu = new ActionMenu({ host: tableEl, label: 'Row actions' })
//   menu.open(button, [
//     { value: 'edit', label: 'Edit' },
//     { separator: true },
//     { value: 'delete', label: 'Delete', danger: true },
//   ], (value) => { ... })
//
// One popover element is reused for every row. It sits in the top layer
// (popover="auto", so clicks outside dismiss it), follows its trigger, and has the
// menu keyboard pattern: arrows, Home/End, typeahead, Enter/Space to choose,
// Esc or Tab to close with focus back on the trigger.

import { animate, springs } from '../motion.js';
import { follow } from '../position.js';
import { sound } from '../sound.js';
import { h, uid } from '../util.js';

export class ActionMenu {
  #el;
  #anchor = null;
  #items = [];
  #onPick = null;
  #stopFollow = null;
  #typed = '';
  #typedAt = 0;
  #returnFocus = true;
  #closedFrom = null;
  #closedAt = 0;

  constructor({ host, label = 'Actions' } = {}) {
    this.#el = h('div', { class: 'rig-dmenu', role: 'menu', id: uid('rig-dmenu'), 'aria-label': label, tabindex: '-1' });
    if ('popover' in HTMLElement.prototype) this.#el.setAttribute('popover', 'auto');
    (host ?? document.body).append(this.#el);
    this.#el.addEventListener('keydown', (e) => this.#onKey(e));
    this.#el.addEventListener('click', (e) => {
      const item = e.target.closest('.rig-dmenu__item');
      if (item && !item.disabled) this.#choose(item.dataset.value);
    });
    this.#el.addEventListener('pointermove', (e) => {
      const item = e.target.closest('.rig-dmenu__item');
      if (item && document.activeElement !== item) item.focus({ preventScroll: true });
    });
    // Light dismiss (click outside) arrives as a native toggle event.
    this.#el.addEventListener('toggle', (e) => {
      // A reopen for another row can land before this queued event; ignore it then.
      if (e.newState === 'closed' && !this.#el.matches(':popover-open')) this.#cleanup({ dismissed: true });
    });
  }

  get element() { return this.#el; }
  get isOpen() { return Boolean(this.#anchor); }
  get anchor() { return this.#anchor; }

  /** True right after a light dismiss from this trigger, so its click doesn't reopen the menu. */
  justClosedFrom(anchor) { return this.#closedFrom === anchor && performance.now() - this.#closedAt < 400; }

  open(anchor, items, onPick) {
    if (this.#anchor) this.close({ focus: false });
    this.#anchor = anchor;
    this.#onPick = onPick;
    this.#returnFocus = true;
    this.#items = items;
    this.#el.replaceChildren(...items.map((item) => (item.separator
      ? h('div', { class: 'rig-dmenu__sep', role: 'separator' })
      : h('button', {
        class: `rig-dmenu__item${item.danger ? ' is-danger' : ''}`,
        type: 'button',
        role: 'menuitem',
        tabindex: '-1',
        'data-value': item.value,
        disabled: item.disabled || null,
      }, item.label))));
    anchor.setAttribute('aria-expanded', 'true');
    anchor.setAttribute('aria-controls', this.#el.id);
    try { this.#el.showPopover?.(); } catch { /* already open */ }
    if (!this.#el.hasAttribute('popover')) this.#el.classList.add('is-open');
    this.#stopFollow = follow(anchor, this.#el, { placement: 'bottom-end', offset: 6 });
    animate(this.#el, [
      { opacity: 0, transform: 'scale(0.94) translateY(-4px)' },
      { opacity: 1, transform: 'none' },
    ], { spring: springs.snappy, fill: 'none' });
    this.#focusAt(0);
    sound.play('open');
  }

  close({ focus = true } = {}) {
    if (!this.#anchor) return;
    this.#returnFocus = focus;
    try { this.#el.hidePopover?.(); } catch { /* not open */ }
    this.#cleanup();
  }

  #cleanup({ dismissed = false } = {}) {
    const anchor = this.#anchor;
    if (!anchor) return;
    this.#anchor = null;
    // Only a click-outside close needs guarding against the same click reopening it.
    this.#closedFrom = dismissed ? anchor : null;
    this.#closedAt = performance.now();
    this.#stopFollow?.();
    this.#stopFollow = null;
    this.#el.classList.remove('is-open');
    anchor.setAttribute('aria-expanded', 'false');
    sound.play('close');
    // Only pull focus back when the menu owned it (keyboard close, pick).
    if (this.#returnFocus && (this.#el.contains(document.activeElement) || document.activeElement === document.body)) {
      if (anchor.isConnected) anchor.focus({ preventScroll: true });
    }
  }

  #buttons() { return [...this.#el.querySelectorAll('.rig-dmenu__item:not(:disabled)')]; }

  #focusAt(index) {
    const list = this.#buttons();
    if (!list.length) return;
    list[(index + list.length) % list.length].focus({ preventScroll: true });
  }

  #choose(value) {
    const pick = this.#onPick;
    sound.play('tap');
    this.close();
    pick?.(value);
  }

  #onKey(e) {
    const list = this.#buttons();
    const current = list.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); this.#focusAt(current + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); this.#focusAt(current < 0 ? -1 : current - 1); }
    else if (e.key === 'Home') { e.preventDefault(); this.#focusAt(0); }
    else if (e.key === 'End') { e.preventDefault(); this.#focusAt(-1); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); }
    else if (e.key === 'Tab') { e.preventDefault(); this.close(); }
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (current >= 0) this.#choose(list[current].dataset.value);
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Typeahead: jump to the next item starting with the typed letters.
      const now = performance.now();
      this.#typed = now - this.#typedAt > 700 ? e.key.toLowerCase() : this.#typed + e.key.toLowerCase();
      this.#typedAt = now;
      const order = [...list.slice(current + 1), ...list.slice(0, current + 1)];
      const hit = order.find((b) => b.textContent.trim().toLowerCase().startsWith(this.#typed))
        ?? order.find((b) => b.textContent.trim().toLowerCase().startsWith(e.key.toLowerCase()));
      hit?.focus({ preventScroll: true });
    }
  }
}
