// <rig-dialog> — a modal dialog on the native <dialog> element.
//
//   <button data-rig-dialog="edit-stop">Edit stop</button>
//   <rig-dialog id="edit-stop" heading="Edit stop">
//     <p>Children are the body.</p>
//     <div class="rig-dialog__footer">
//       <button class="rig-btn" data-rig-close value="cancel">Cancel</button>
//       <button class="rig-btn rig-btn--accent" data-rig-close value="save">Save stop</button>
//     </div>
//   </rig-dialog>
//
// Confirmation variant: add role="alertdialog". Escape and backdrop clicks
// don't dismiss it (it pulses instead) and focus starts on the least
// destructive button (value="cancel", or the first non-accent button).
//
// Attributes: open, heading, label (when there's no heading), no-close,
//   role="alertdialog". Width: --rig-dialog-width (default 30rem).
// Properties: open, returnValue, alert, body, panel.
// Methods: show(trigger?), close(returnValue?).
// Events: rig-open, rig-close ({ detail: { returnValue } }).
// Triggers: any element with data-rig-dialog="<id>". Inside the dialog, any
//   [data-rig-close] element closes it with its value; <form method="dialog">
//   closes it with the submitter's value.
//
// Opening from a trigger, the panel springs out of the trigger's position;
// closing, it shrinks back toward it. The page doesn't scroll while open and
// focus returns to the trigger afterwards.

import { animate, reducedMotion, springs } from '../motion.js';
import { define } from '../util.js';
import { onTrigger } from './layer.js';
import { ModalLayer } from './modal.js';

const ENTER = { duration: 0.42, bounce: 0.16 };

class RigDialog extends ModalLayer {
  static kind = 'dialog';
  #origin = '50% 50%';

  connectedCallback() {
    super.connectedCallback();
    if (this.id) {
      for (const t of document.querySelectorAll(`[data-rig-dialog="${CSS.escape(this.id)}"]`)) t.setAttribute('aria-haspopup', 'dialog');
    }
  }

  onOpen(trigger) {
    this.#origin = '50% 50%';
    let from = 'scale(0.96)';
    const r = trigger?.isConnected ? trigger.getBoundingClientRect() : null;
    if (r && (r.width || r.height)) {
      const p = this.panel.getBoundingClientRect();
      this.#origin = `${Math.round(r.left + r.width / 2 - p.left)}px ${Math.round(r.top + r.height / 2 - p.top)}px`;
      from = 'scale(0.45)';
    }
    if (reducedMotion()) return;
    this.panel.style.transformOrigin = this.#origin;
    animate(this.panel, [{ transform: from }, { transform: 'scale(1)' }], { spring: ENTER, fill: 'none' });
    animate(this.panel, [{ opacity: 0 }, { opacity: 1 }], { spring: null, duration: 170, easing: 'ease-out', fill: 'none' });
    animate(this.overlay, [{ opacity: 0 }, { opacity: 1 }], { spring: springs.smooth, fill: 'none' });
  }

  onClose() {
    if (reducedMotion()) return null;
    this.panel.style.transformOrigin = this.#origin;
    const shrink = this.#origin === '50% 50%' ? 'scale(0.97)' : 'scale(0.6)';
    animate(this.overlay, [{ opacity: 1 }, { opacity: 0 }], { spring: null, duration: 190, easing: 'ease-in', fill: 'forwards' });
    const a = animate(this.panel, [
      { transform: 'scale(1)', opacity: 1 },
      { transform: shrink, opacity: 0 },
    ], { spring: null, duration: 170, easing: 'cubic-bezier(.4,0,.8,.4)', fill: 'forwards' });
    return a.finished;
  }

  afterClose() {
    for (const el of [this.panel, this.overlay]) el.getAnimations().forEach((a) => a.cancel());
  }
}

define('rig-dialog', RigDialog);

onTrigger('data-rig-dialog', (trigger, id, e) => {
  const target = id && document.getElementById(id);
  if (!(target instanceof RigDialog)) return;
  e.preventDefault();
  trigger.setAttribute('aria-haspopup', 'dialog');
  target.show(trigger);
});

export { RigDialog };
