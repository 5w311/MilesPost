// <rig-item> — a list row: media, title, description, meta and trailing actions.
//
//   <rig-item-group label="Drivers on shift">
//     <rig-item href="/drivers/12">
//       <rig-avatar slot="media" name="Rosa Delgado" status="online"></rig-avatar>
//       <span slot="title">Rosa Delgado</span>
//       <span slot="description">Load 418-2207 · Ocala, FL to Savannah, GA</span>
//       <span slot="meta">6h 12m left</span>
//       <button slot="actions" class="rig-btn rig-btn--sm">Message</button>
//     </rig-item>
//   </rig-item-group>
//
// <rig-item>
//   Attributes: variant ("default" | "outline" | "muted"), size ("sm"), href, target, rel.
//   Children by slot: media (icon, <rig-avatar>, <img>), title, description, meta, actions.
//   Unslotted children join the description column. With href, the title becomes the
//   row's one link and stretches over the whole row; buttons in actions stay clickable.
// <rig-item-group>
//   Attributes: label (accessible name), separators="false" to drop the dividers.
//   Renders as a list; each item becomes a list item.

import { define, h } from '../util.js';

const SLOTS = ['media', 'title', 'description', 'meta', 'actions'];

class RigItem extends HTMLElement {
  static observedAttributes = ['href', 'target', 'rel'];
  #built = false;
  #title;
  #link;

  connectedCallback() {
    if (this.closest('rig-item-group') === this.parentElement) this.setAttribute('role', 'listitem');
    if (this.#built) return;
    this.#built = true;
    this.classList.add('rig-item');

    const parts = Object.fromEntries(SLOTS.map((s) => [s, []]));
    const loose = [];
    for (const node of [...this.childNodes]) {
      const slot = node.nodeType === 1 ? node.getAttribute('slot') : null;
      if (slot && parts[slot]) parts[slot].push(node);
      else if (node.nodeType === 1 || node.textContent.trim()) loose.push(node);
    }
    // Plain text with no slots at all is the title.
    if (!parts.title.length && loose.length && !parts.description.length) parts.title = loose.splice(0);

    const media = parts.media.length ? h('span', { class: 'rig-item__media' }, parts.media) : null;
    if (media && parts.media.length === 1) {
      const m = parts.media[0];
      const kind = m.tagName === 'IMG' ? 'image' : m.tagName === 'RIG-AVATAR' ? 'avatar' : 'icon';
      media.dataset.kind = kind;
      if (kind === 'icon') m.setAttribute?.('aria-hidden', m.getAttribute('aria-hidden') ?? 'true');
    }
    this.#title = h('span', { class: 'rig-item__title' }, parts.title);
    const desc = parts.description.length || loose.length
      ? h('span', { class: 'rig-item__desc' }, parts.description, loose)
      : null;
    const body = h('span', { class: 'rig-item__body' }, this.#title, desc);
    const meta = parts.meta.length ? h('span', { class: 'rig-item__meta' }, parts.meta) : null;
    const actions = parts.actions.length ? h('span', { class: 'rig-item__actions' }, parts.actions) : null;
    this.replaceChildren(...[media, body, meta, actions].filter(Boolean));
    this.#syncLink();
  }

  attributeChangedCallback() { if (this.#built) this.#syncLink(); }

  #syncLink() {
    const href = this.getAttribute('href');
    if (href) {
      if (!this.#link) {
        this.#link = h('a', { class: 'rig-item__link' });
        this.#link.append(...this.#title.childNodes);
        this.#title.append(this.#link);
      }
      this.#link.href = href;
      for (const attr of ['target', 'rel']) {
        const v = this.getAttribute(attr);
        if (v) this.#link.setAttribute(attr, v); else this.#link.removeAttribute(attr);
      }
      if (this.getAttribute('target') === '_blank' && !this.hasAttribute('rel')) this.#link.rel = 'noopener';
    } else if (this.#link) {
      this.#title.append(...this.#link.childNodes);
      this.#link.remove();
      this.#link = null;
    }
    this.classList.toggle('is-link', Boolean(href));
  }
}

class RigItemGroup extends HTMLElement {
  static observedAttributes = ['label'];
  connectedCallback() {
    this.classList.add('rig-item-group');
    this.setAttribute('role', 'list');
    this.attributeChangedCallback();
  }
  attributeChangedCallback() {
    const label = this.getAttribute('label');
    if (label) this.setAttribute('aria-label', label); else this.removeAttribute('aria-label');
  }
}

define('rig-item', RigItem);
define('rig-item-group', RigItemGroup);
export { RigItem, RigItemGroup };
