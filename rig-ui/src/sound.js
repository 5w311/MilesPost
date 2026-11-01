// Rig UI sound: short, quiet interface sounds synthesized with Web Audio.
// No audio files. Off by default; turn on with `sound.enabled = true` or
// <html data-rig-sound="on">. The choice is remembered per browser.
//
//   import { sound } from './sound.js'
//   sound.enabled = true
//   sound.play('success')

const STORAGE_KEY = 'rig-ui:sound';
const hasDOM = typeof window !== 'undefined';

let ctx = null;
let master = null;
let noiseBuffer = null;
const lastPlayed = new Map();
const listeners = new Set();

function readStored() {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}
function writeStored(value) {
  try { localStorage.setItem(STORAGE_KEY, value); } catch { /* storage blocked */ }
}

let enabled = (() => {
  if (!hasDOM) return false;
  const stored = readStored();
  if (stored === 'on' || stored === 'off') return stored === 'on';
  return document.documentElement.dataset.rigSound === 'on';
})();
let volume = 0.6;

function audio() {
  if (ctx) return ctx;
  const AC = hasDOM && (window.AudioContext || window.webkitAudioContext);
  if (!AC) return null;
  ctx = new AC();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.ratio.value = 4;
  master = ctx.createGain();
  master.gain.value = volume * 0.5;
  master.connect(comp).connect(ctx.destination);
  return ctx;
}

function noise() {
  if (noiseBuffer) return noiseBuffer;
  const c = audio();
  const length = Math.floor(c.sampleRate * 0.5);
  noiseBuffer = c.createBuffer(1, length, c.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  let seed = 7;
  for (let i = 0; i < length; i++) {
    seed = (seed * 16807) % 2147483647;
    data[i] = (seed / 2147483647) * 2 - 1;
  }
  return noiseBuffer;
}

// A single enveloped oscillator note.
function tone(c, t, { freq, to, type = 'sine', gain = 0.3, attack = 0.002, decay = 0.08, filter }) {
  const osc = c.createOscillator();
  const env = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + decay);
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(gain, t + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  let node = osc.connect(env);
  if (filter) {
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = filter;
    node = env.connect(f);
  }
  node.connect(master);
  osc.start(t);
  osc.stop(t + attack + decay + 0.02);
}

// A filtered noise burst, swept between two frequencies.
function hiss(c, t, { from = 500, to = 2400, q = 1.2, gain = 0.12, duration = 0.16 }) {
  const src = c.createBufferSource();
  src.buffer = noise();
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = q;
  bp.frequency.setValueAtTime(from, t);
  bp.frequency.exponentialRampToValueAtTime(to, t + duration);
  const env = c.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(gain, t + duration * 0.3);
  env.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  src.connect(bp).connect(env).connect(master);
  src.start(t);
  src.stop(t + duration + 0.02);
}

// Each recipe gets the context, a start time and options.
const recipes = {
  // Keypress / digit entry. `step` raises pitch a little per position.
  tick(c, t, { step = 0 } = {}) {
    const f = 1500 * Math.pow(2, step / 24);
    tone(c, t, { freq: f, to: f * 0.7, type: 'triangle', gain: 0.16, decay: 0.03 });
  },
  // Button press: a soft, low thock.
  tap(c, t) {
    tone(c, t, { freq: 420, to: 180, type: 'sine', gain: 0.32, decay: 0.05 });
    hiss(c, t, { from: 3000, to: 1800, gain: 0.03, duration: 0.025, q: 0.7 });
  },
  // Something appeared (toast, popover).
  pop(c, t) {
    tone(c, t, { freq: 520, to: 880, type: 'sine', gain: 0.22, decay: 0.07 });
  },
  open(c, t) {
    tone(c, t, { freq: 640, type: 'sine', gain: 0.14, decay: 0.05 });
    tone(c, t + 0.045, { freq: 960, type: 'sine', gain: 0.12, decay: 0.07 });
  },
  close(c, t) {
    tone(c, t, { freq: 880, type: 'sine', gain: 0.11, decay: 0.05 });
    tone(c, t + 0.04, { freq: 600, type: 'sine', gain: 0.1, decay: 0.07 });
  },
  toggle(c, t, { on = true } = {}) {
    tone(c, t, { freq: on ? 980 : 740, to: on ? 1300 : 560, type: 'triangle', gain: 0.14, decay: 0.045 });
  },
  success(c, t) {
    tone(c, t, { freq: 784, type: 'triangle', gain: 0.18, decay: 0.12, filter: 4000 });
    tone(c, t + 0.085, { freq: 1175, type: 'triangle', gain: 0.18, decay: 0.22, filter: 4000 });
  },
  error(c, t) {
    tone(c, t, { freq: 220, type: 'square', gain: 0.08, decay: 0.09, filter: 900 });
    tone(c, t + 0.11, { freq: 174, type: 'square', gain: 0.08, decay: 0.14, filter: 700 });
  },
  whoosh(c, t) {
    hiss(c, t, { from: 380, to: 2200, gain: 0.09, duration: 0.18 });
  },
  send(c, t) {
    hiss(c, t, { from: 900, to: 3600, gain: 0.06, duration: 0.12, q: 2 });
    tone(c, t + 0.02, { freq: 660, to: 990, type: 'sine', gain: 0.12, decay: 0.08 });
  },
};

export const sound = {
  get enabled() { return enabled; },
  set enabled(value) {
    enabled = Boolean(value);
    writeStored(enabled ? 'on' : 'off');
    if (enabled) audio()?.resume?.();
    for (const fn of listeners) fn(enabled);
  },
  get volume() { return volume; },
  set volume(value) {
    volume = Math.min(1, Math.max(0, Number(value) || 0));
    if (master) master.gain.value = volume * 0.5;
  },
  /** Names you can pass to play(). */
  get names() { return Object.keys(recipes); },
  /** Add or replace a sound: (ctx, time, opts, { tone, hiss, out }) => void */
  define(name, recipe) {
    recipes[name] = (c, t, opts) => recipe(c, t, opts, { tone: (...a) => tone(c, ...a), hiss: (...a) => hiss(c, ...a), out: master });
  },
  play(name, opts) {
    if (!enabled || !recipes[name]) return;
    const c = audio();
    if (!c) return;
    if (c.state === 'suspended') c.resume();
    // Same sound fired in a burst (e.g. a paste) gets spaced out, not stacked.
    const now = c.currentTime;
    const prev = lastPlayed.get(name) ?? 0;
    const t = Math.max(now + 0.005, prev + 0.028);
    if (t - now > 0.4) return;
    lastPlayed.set(name, t);
    try { recipes[name](c, t, opts); } catch { /* audio graph errors are never fatal */ }
  },
  /** Run fn(enabled) whenever sound is switched on or off. Returns an unsubscribe. */
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
};

// Browsers start audio suspended until a user gesture.
if (hasDOM) {
  const unlock = () => { if (enabled) audio()?.resume?.(); };
  window.addEventListener('pointerdown', unlock, { capture: true, passive: true });
  window.addEventListener('keydown', unlock, { capture: true });
}
