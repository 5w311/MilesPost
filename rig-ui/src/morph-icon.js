// <rig-icon name="menu"> — line icons that morph into each other.
//
// Every icon is exactly three strokes on a 24x24 grid, plus a rotation for the
// whole glyph. Each stroke is [x1, y1, x2, y2, opacity]. Because every icon has
// the same shape of data, any icon can spring into any other: change the
// `name` attribute and the strokes travel to their new places.

import { springDriver, springs } from './motion.js';
import { define } from './util.js';
import { ICONS } from './icon-data.js';

export { ICONS, iconNames } from './icon-data.js';

function flatten(name) {
  const icon = ICONS[name] ?? ICONS.menu;
  return [...icon.strokes.flat(), icon.rotate];
}

// Shortest way round from the current angle to the target angle.
function nearestAngle(current, target) {
  const delta = ((((target - current) % 360) + 540) % 360) - 180;
  return current + delta;
}

const NS = 'http://www.w3.org/2000/svg';

class RigIcon extends HTMLElement {
  static observedAttributes = ['name', 'label', 'stroke'];

  connectedCallback() {
    if (!this.svg) this.#build();
  }

  #build() {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('class', 'rig-icon__svg');
    const g = document.createElementNS(NS, 'g');
    this.lines = [0, 1, 2].map(() => {
      const line = document.createElementNS(NS, 'line');
      g.append(line);
      return line;
    });
    svg.append(g);
    this.group = g;
    this.svg = svg;
    this.replaceChildren(svg);
    this.#applyStroke();
    this.#applyLabel();
    const start = flatten(this.getAttribute('name'));
    this.driver = springDriver(start, springs.lively, (v) => this.#render(v));
    this.#render(start);
  }

  attributeChangedCallback(attr) {
    if (!this.svg) return;
    if (attr === 'stroke') this.#applyStroke();
    if (attr === 'label') this.#applyLabel();
    if (attr === 'name') {
      const next = flatten(this.getAttribute('name'));
      const now = this.driver.value;
      next[15] = nearestAngle(now[15], next[15]);
      this.driver.to(next);
    }
  }

  /** Jump to an icon without animating. */
  set(name) {
    this.setAttribute('name', name);
    this.driver?.to(flatten(name), { immediate: true });
  }

  #applyStroke() {
    this.svg.setAttribute('stroke-width', this.getAttribute('stroke') || '2');
  }

  #applyLabel() {
    const label = this.getAttribute('label');
    if (label) {
      this.setAttribute('role', 'img');
      this.setAttribute('aria-label', label);
      this.removeAttribute('aria-hidden');
    } else {
      this.removeAttribute('role');
      this.removeAttribute('aria-label');
      this.setAttribute('aria-hidden', 'true');
    }
  }

  #render(v) {
    for (let i = 0; i < 3; i++) {
      const o = i * 5;
      const line = this.lines[i];
      line.setAttribute('x1', v[o].toFixed(3));
      line.setAttribute('y1', v[o + 1].toFixed(3));
      line.setAttribute('x2', v[o + 2].toFixed(3));
      line.setAttribute('y2', v[o + 3].toFixed(3));
      line.setAttribute('opacity', Math.min(1, Math.max(0, v[o + 4])).toFixed(3));
    }
    this.group.setAttribute('transform', `rotate(${v[15].toFixed(2)} 12 12)`);
  }
}

define('rig-icon', RigIcon);
export { RigIcon };
