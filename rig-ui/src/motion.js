// Rig UI motion core.
//
// Two tools, both driven by the same damped-spring model:
//   springEasing()  turns a spring into a CSS linear() easing + duration, for
//                   one-shot Web Animations (enter/exit, flashes).
//   springDriver()  a tiny rAF integrator for values that get retargeted while
//                   moving (sliding highlights, resizing panels). It keeps
//                   velocity when the target changes, so motion never "restarts".
//
// Springs are described perceptually: `duration` (seconds, roughly how long it
// takes to arrive) and `bounce` (0 = no overshoot, 0.3 = lively, 0.6 = springy).

const hasDOM = typeof window !== 'undefined' && typeof document !== 'undefined';
const reduceQuery = hasDOM && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

/** True when the user asked for less motion, or the app set data-rig-motion="off" on <html>. */
export function reducedMotion() {
  if (!hasDOM) return false;
  if (document.documentElement.dataset.rigMotion === 'off') return true;
  return Boolean(reduceQuery && reduceQuery.matches);
}

/** Convert perceptual spring settings to physical stiffness/damping (mass = 1). */
export function springParams({ duration = 0.4, bounce = 0 } = {}) {
  const d = Math.max(0.05, duration);
  const b = Math.min(0.95, Math.max(-1, bounce));
  const omega = (2 * Math.PI) / d;
  const stiffness = omega * omega;
  // bounce >= 0 lowers the damping ratio below 1 (overshoot);
  // bounce < 0 makes it overdamped (slower, syrupy settle).
  const zeta = b >= 0 ? 1 - b : 1 / (1 + b);
  const damping = 2 * zeta * omega;
  return { stiffness, damping };
}

/**
 * Simulate a unit step response (0 -> 1) of a spring.
 * Returns sampled positions at `fps` and the time it took to settle.
 */
export function simulateSpring(opts = {}, { fps = 60, maxSeconds = 4, velocity = 0 } = {}) {
  const { stiffness, damping } = springParams(opts);
  const h = 1 / 1200; // integration step
  const sampleEvery = Math.round(1200 / fps);
  let x = 0;
  let v = velocity;
  const samples = [0];
  let settledAt = maxSeconds;
  for (let i = 1; i <= maxSeconds * 1200; i++) {
    const a = -stiffness * (x - 1) - damping * v;
    v += a * h;
    x += v * h;
    if (i % sampleEvery === 0) samples.push(x);
    if (Math.abs(x - 1) < 0.0008 && Math.abs(v) < 0.02) {
      settledAt = i / 1200;
      break;
    }
  }
  if (samples[samples.length - 1] !== 1) samples.push(1);
  return { samples, seconds: settledAt };
}

const easingCache = new Map();
const supportsLinear = hasDOM && typeof CSS !== 'undefined' && CSS.supports
  ? CSS.supports('animation-timing-function', 'linear(0, 1)')
  : false;

/**
 * A spring as a Web Animations easing.
 * @returns {{ easing: string, duration: number }} duration in ms
 */
export function springEasing(opts = {}) {
  const key = `${opts.duration ?? 0.4}|${opts.bounce ?? 0}`;
  const cached = easingCache.get(key);
  if (cached) return cached;
  const { samples, seconds } = simulateSpring(opts, { fps: 40 });
  const points = samples.map((s) => Math.round(s * 10000) / 10000);
  const result = supportsLinear
    ? { easing: `linear(${points.join(', ')})`, duration: Math.round(seconds * 1000) }
    // Older engines: a decelerating curve that roughly matches a no-bounce spring.
    : { easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', duration: Math.round(Math.min(seconds, 0.6) * 1000) };
  easingCache.set(key, result);
  return result;
}

/** Shared spring presets so components feel like one family. */
export const springs = {
  snappy: { duration: 0.28, bounce: 0.12 },
  smooth: { duration: 0.4, bounce: 0 },
  lively: { duration: 0.45, bounce: 0.28 },
  gentle: { duration: 0.6, bounce: 0.05 },
};

/**
 * Element.animate with a spring. Respects reduced motion (jumps to the end).
 * Pass `commit: true` to write the final frame as inline style and drop the
 * animation, so finished animations don't pile up as fill effects.
 */
export function animate(el, keyframes, { spring = springs.smooth, delay = 0, commit = false, fill = 'both', duration, easing } = {}) {
  const timing = spring ? springEasing(spring) : { duration: duration ?? 200, easing: easing ?? 'ease-out' };
  const instant = reducedMotion();
  const anim = el.animate(keyframes, {
    duration: instant ? 0 : (duration ?? timing.duration),
    easing: easing ?? timing.easing,
    delay: instant ? 0 : delay,
    fill,
  });
  if (commit) {
    anim.finished.then(() => {
      try { anim.commitStyles(); } catch { /* element may be detached */ }
      anim.cancel();
    }).catch(() => {});
  }
  return anim;
}

/**
 * Drive a vector of numbers toward targets with a spring, calling `render`
 * every frame. Retargeting keeps the current velocity.
 *
 *   const lens = springDriver([0, 0], springs.snappy, ([x, w]) => {...})
 *   lens.to([120, 48])
 */
export function springDriver(initial, opts = springs.smooth, render = () => {}) {
  let { stiffness, damping } = springParams(opts);
  let x = initial.slice();
  let v = initial.map(() => 0);
  let target = initial.slice();
  let raf = 0;
  let last = 0;
  // Settling precision scales with the size of each move, so a 600px slide
  // ends within about a pixel instead of creeping toward 0.01px, while
  // opacity and scale moves still land precisely.
  let eps = initial.map(() => 0.001);
  let waiters = [];

  const settle = () => {
    const done = waiters;
    waiters = [];
    for (const resolve of done) resolve();
  };

  function frame(now) {
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / steps;
    for (let s = 0; s < steps; s++) {
      for (let i = 0; i < x.length; i++) {
        const a = -stiffness * (x[i] - target[i]) - damping * v[i];
        v[i] += a * h;
        x[i] += v[i] * h;
      }
    }
    let moving = false;
    for (let i = 0; i < x.length; i++) {
      if (Math.abs(x[i] - target[i]) > eps[i] || Math.abs(v[i]) > eps[i] * 8) { moving = true; break; }
    }
    if (!moving) {
      x = target.slice();
      v.fill(0);
    }
    render(x.slice());
    raf = moving ? requestAnimationFrame(frame) : 0;
    if (!moving) settle();
  }

  return {
    to(next, { immediate = false } = {}) {
      target = next.slice();
      eps = target.map((t, i) => Math.max(0.001, Math.abs(t - (x[i] ?? t)) * 0.002));
      if (immediate || reducedMotion() || !hasDOM) {
        x = target.slice();
        v.fill(0);
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        render(x.slice());
        settle();
        return;
      }
      if (!raf) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    },
    /** Nudge velocity (e.g. after a fling) without changing the target. */
    kick(velocity) {
      v = v.map((vi, i) => vi + (velocity[i] ?? 0));
      if (!raf && hasDOM) { last = performance.now(); raf = requestAnimationFrame(frame); }
    },
    configure(nextOpts) { ({ stiffness, damping } = springParams(nextOpts)); },
    /** Resolves once the values come to rest (immediately if they already are). */
    rested() {
      if (!raf) return Promise.resolve();
      return new Promise((resolve) => waiters.push(resolve));
    },
    get value() { return x.slice(); },
    get target() { return target.slice(); },
    get moving() { return raf !== 0; },
    stop() { if (raf) cancelAnimationFrame(raf); raf = 0; settle(); },
  };
}
