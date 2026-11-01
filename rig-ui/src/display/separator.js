// <rig-separator> — a hairline between content, optionally with a centered label.
//
//   <rig-separator></rig-separator>
//   <rig-separator label="Or upload from your phone"></rig-separator>
//   <span>Load 418</span><rig-separator orientation="vertical"></rig-separator><span>286 mi</span>
//
// Attributes: orientation ("horizontal" | "vertical"), label (text in the middle),
//   decorative (purely visual: hidden from assistive technology).

import { define, h } from '../util.js';

class RigSeparator extends HTMLElement {
  static observedAttributes = ['orientation', 'label', 'decorative'];
  connectedCallback() {
    this.classList.add('rig-separator');
    this.attributeChangedCallback();
  }
  attributeChangedCallback() {
    if (!this.isConnected) return;
    const vertical = this.getAttribute('orientation') === 'vertical';
    const label = this.getAttribute('label');
    this.dataset.orientation = vertical ? 'vertical' : 'horizontal';
    if (this.hasAttribute('decorative')) {
      this.setAttribute('role', 'none');
      this.removeAttribute('aria-orientation');
    } else {
      this.setAttribute('role', 'separator');
      this.setAttribute('aria-orientation', vertical ? 'vertical' : 'horizontal');
    }
    this.replaceChildren(...(label ? [h('span', { class: 'rig-separator__label' }, label)] : []));
    this.classList.toggle('has-label', Boolean(label));
  }
}

define('rig-separator', RigSeparator);
export { RigSeparator };
