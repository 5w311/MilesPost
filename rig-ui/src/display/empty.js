// <rig-empty> — what to show when there's nothing to show yet, and what to do next.
//
//   <rig-empty icon="truck" heading="No loads assigned"
//              description="New loads from dispatch show up here.">
//     <button slot="actions" class="rig-btn rig-btn--accent">Request a load</button>
//   </rig-empty>
//
// Attributes: icon (built-in: "inbox", "search", "truck", "route", "file", "image";
//   or put your own element in slot="icon"), heading, description, bordered (dashed outline),
//   size ("sm" for inline use).
// Children: slot="icon" (custom art), slot="actions" (buttons and links); other
//   children are extra description content.

import { define, h } from '../util.js';
import { icon } from './icons.js';

class RigEmpty extends HTMLElement {
  #built = false;
  connectedCallback() {
    if (this.#built) return;
    this.#built = true;
    this.classList.add('rig-empty');
    const kids = [...this.childNodes];
    const art = kids.filter((n) => n.nodeType === 1 && n.getAttribute('slot') === 'icon');
    const actions = kids.filter((n) => n.nodeType === 1 && n.getAttribute('slot') === 'actions');
    const rest = kids.filter((n) => !art.includes(n) && !actions.includes(n) && (n.nodeType === 1 || n.textContent.trim()));
    const name = this.getAttribute('icon') || 'inbox';
    const heading = this.getAttribute('heading');
    const description = this.getAttribute('description');
    this.replaceChildren(...[
      h('div', { class: 'rig-empty__icon', 'aria-hidden': 'true' }, art.length ? art : icon(name, { size: 26, stroke: 1.75 })),
      heading ? h('p', { class: 'rig-empty__title' }, heading) : null,
      description || rest.length ? h('div', { class: 'rig-empty__desc' }, description || '', rest) : null,
      actions.length ? h('div', { class: 'rig-empty__actions' }, actions) : null,
    ].filter(Boolean));
  }
}

define('rig-empty', RigEmpty);
export { RigEmpty };
