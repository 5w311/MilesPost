// Spring an element's height between two values, keeping velocity when the
// target changes mid-flight (open, then close before it finished).
// Used by accordion, collapsible, alert and skeleton. Internal helper.

import { springDriver } from '../motion.js';

export const HEIGHT_SPRING = { duration: 0.42, bounce: 0.1 };
const drivers = new WeakMap();

/**
 * Animate el's height to `to` px. `from` defaults to the current height.
 * `onDone` runs once the spring settles on this target (not if retargeted).
 */
export function springHeight(el, to, { from, spring = HEIGHT_SPRING, onDone } = {}) {
  let state = drivers.get(el);
  if (!state) {
    state = { target: 0, done: null, driver: null };
    state.driver = springDriver([from ?? el.getBoundingClientRect().height], spring, ([v]) => {
      el.style.height = `${Math.max(0, v).toFixed(2)}px`;
      if (v === state.target && state.done) {
        const done = state.done;
        state.done = null;
        done();
      }
    });
    drivers.set(el, state);
  } else if (!state.driver.moving) {
    state.driver.to([from ?? el.getBoundingClientRect().height], { immediate: true });
  }
  el.style.overflow = 'hidden';
  state.target = to;
  state.done = () => { onDone?.(); };
  state.driver.to([to]);
}

/** Clear inline height and overflow (back to auto). */
export function releaseHeight(el) {
  el.style.height = '';
  el.style.overflow = '';
}
