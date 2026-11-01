// <rig-alert> — an inline message with an icon, title, description and actions.
//
//   <rig-alert variant="warn" heading="Chain law in effect on the pass" dismissible>
//     Carry chains west of the summit until 6 PM. Check the state DOT site first.
//     <a slot="actions" class="rig-btn rig-btn--sm" href="/routes">Reroute</a>
//   </rig-alert>
//
// Attributes: variant ("info" | "ok" | "warn" | "bad"), heading, dismissible,
//   icon ("false" to hide it). Problems ("bad") are announced right away
//   (role="alert"); the rest are polite (role="status").
// Children: slot="actions" for buttons and links; everything else is the description.
// Methods: dismiss(). Event: dismiss (cancelable), fired before it collapses.

import { animate, springs } from '../motion.js';
import { sound } from '../sound.js';
import { define, h } from '../util.js';
import { icon } from './icons.js';
import { springHeight } from './height.js';

const ICONS = { info: 'info', ok: 'checkCircle', warn: 'warn', bad: 'alert' };
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

class RigAlert extends HTMLElement {
  #built = false;

  connectedCallback() {
    if (this.#built) return;
    this.#built = true;
    this.classList.add('rig-alert');
    const variant = ICONS[this.getAttribute('variant')] ? this.getAttribute('variant') : 'info';
    this.dataset.variant = variant;
    if (!this.hasAttribute('role')) this.setAttribute('role', variant === 'bad' ? 'alert' : 'status');
    const kids = [...this.childNodes];
    const actions = kids.filter((n) => n.nodeType === 1 && n.getAttribute('slot') === 'actions');
    const desc = kids.filter((n) => !actions.includes(n) && (n.nodeType === 1 || n.textContent.trim()));
    const heading = this.getAttribute('heading');
    const close = this.hasAttribute('dismissible')
      ? h('button', { class: 'rig-alert__close', type: 'button', 'aria-label': `Dismiss${heading ? `: ${heading}` : ''}`, onclick: () => this.dismiss() }, icon('close', { size: 16 }))
      : null;
    this.replaceChildren(...[
      this.getAttribute('icon') === 'false' ? null : h('span', { class: 'rig-alert__icon', 'aria-hidden': 'true' }, icon(ICONS[variant], { size: 20 })),
      h('div', { class: 'rig-alert__body' },
        heading ? h('p', { class: 'rig-alert__title' }, heading) : null,
        desc.length ? h('div', { class: 'rig-alert__desc' }, desc) : null,
        actions.length ? h('div', { class: 'rig-alert__actions' }, actions) : null),
      close,
    ].filter(Boolean));
  }

  dismiss() {
    if (this.classList.contains('is-leaving')) return;
    if (!this.dispatchEvent(new CustomEvent('dismiss', { bubbles: true, cancelable: true }))) return;
    sound.play('close');
    // Find where focus should go before the alert disappears.
    const hadFocus = this.contains(document.activeElement);
    const next = hadFocus ? this.#nextFocusable() : null;
    this.classList.add('is-leaving');
    this.setAttribute('aria-hidden', 'true');
    this.inert = true;
    animate(this, [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.98)' }], { spring: springs.snappy, fill: 'forwards' });
    // Height springs to zero while padding and margins ease out with it, so the
    // content below slides up instead of jumping.
    springHeight(this, 0, { spring: springs.smooth, onDone: () => this.remove() });
    Object.assign(this.style, {
      transition: 'padding 0.32s ease, margin 0.32s ease, border-width 0.32s ease',
      paddingTop: '0px', paddingBottom: '0px', marginTop: '0px', marginBottom: '0px', borderTopWidth: '0px', borderBottomWidth: '0px',
    });
    if (next) next.focus({ preventScroll: true });
  }

  #nextFocusable() {
    const all = [...document.querySelectorAll(FOCUSABLE)].filter((el) => !this.contains(el) && !el.closest('[inert], [hidden]') && el.offsetParent !== null);
    const after = all.find((el) => this.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
    return after || all.reverse().find((el) => this.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING) || null;
  }
}

define('rig-alert', RigAlert);
export { RigAlert };
