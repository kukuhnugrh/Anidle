// Anime sound effects for the Sakuga controls, synthesized with Web Audio (no files). One shared
// AudioContext, made and resumed inside the first user gesture that plays a sound. Their own on/off,
// kept in localStorage and independent of the song volume (volume.ts).
import { useSyncExternalStore } from 'react';

/** The Sakuga sound-effect words: ドン, カチッ, キラッ, シュッ, ズザッ, ポン (and ポン played back, for off). */
export type SfxName = 'don' | 'kachi' | 'kira' | 'shu' | 'zuza' | 'pon' | 'pon-off';

const KEY = 'anidle:sfx';

function load(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    // Storage blocked: on, like a first visit.
    return true;
  }
}

let on = load();
const listeners = new Set<() => void>();

export function setSfxOn(next: boolean) {
  if (next === on) return;
  on = next;
  try {
    localStorage.setItem(KEY, next ? 'on' : 'off');
  } catch {
    // Not persisted, still applied for this visit.
  }
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
const snapshot = () => on;
export const useSfxOn = () => useSyncExternalStore(subscribe, snapshot);

// ------------------------------------------------------------------ synthesis

interface Bus {
  ctx: AudioContext;
  /** Every sound goes through here: a master level and a limiter, so stacked sounds never clip. */
  out: AudioNode;
  noise: AudioBuffer;
}

let bus: Bus | null = null;

function getBus(): Bus | null {
  if (!bus) {
    if (typeof AudioContext === 'undefined') return null;
    const ctx = new AudioContext();
    const master = ctx.createGain();
    master.gain.value = 0.6;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.12;
    master.connect(limiter);
    limiter.connect(ctx.destination);
    // One second of white noise, read from a random offset by every noisy sound.
    const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    bus = { ctx, out: master, noise };
  }
  if (bus.ctx.state === 'suspended') void bus.ctx.resume();
  return bus;
}

/** A gain that swells to `peak` in `attack` seconds and dies away over `decay`. */
function envelope(b: Bus, t: number, peak: number, attack: number, decay: number): GainNode {
  const g = b.ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  g.connect(b.out);
  return g;
}

/** An oscillator gliding from f0 to f1 Hz over the decay. */
function tone(b: Bus, t: number, type: OscillatorType, f0: number, f1: number, peak: number, attack: number, decay: number) {
  const osc = b.ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, t);
  osc.frequency.exponentialRampToValueAtTime(f1, t + attack + decay);
  osc.connect(envelope(b, t, peak, attack, decay));
  osc.start(t);
  osc.stop(t + attack + decay + 0.02);
}

/** Filtered noise, the filter sweeping from f0 to f1 Hz; `into` puts a node (grit) between the filter and the envelope. */
function hiss(b: Bus, t: number, filter: BiquadFilterType, f0: number, f1: number, q: number, peak: number, attack: number, decay: number, into?: AudioNode) {
  const src = b.ctx.createBufferSource();
  src.buffer = b.noise;
  const f = b.ctx.createBiquadFilter();
  f.type = filter;
  f.Q.value = q;
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(f1, t + attack + decay);
  src.connect(f);
  const env = envelope(b, t, peak, attack, decay);
  if (into) {
    f.connect(into);
    into.connect(env);
  } else f.connect(env);
  src.start(t, Math.random() * 0.5);
  src.stop(t + attack + decay + 0.02);
}

/** A gain chattering at `rate` Hz: the grain of a skid. */
function grit(b: Bus, t: number, rate: number, until: number): GainNode {
  const g = b.ctx.createGain();
  g.gain.value = 0.55;
  const lfo = b.ctx.createOscillator();
  lfo.type = 'square';
  lfo.frequency.value = rate;
  const depth = b.ctx.createGain();
  depth.gain.value = 0.45;
  lfo.connect(depth);
  depth.connect(g.gain);
  lfo.start(t);
  lfo.stop(until);
  return g;
}

// Levels measured by rendering each sound offline: every one peaks between -11 and -16 dBFS (noise varies a
// little per play). A narrow band of noise needs a gain above 1 to get there; the limiter catches stack-ups.
const SOUNDS: Record<SfxName, (b: Bus, t: number) => void> = {
  // ドン: a low thump dropping in pitch, with a dull noise hit on top.
  don: (b, t) => {
    tone(b, t, 'sine', 170, 42, 0.5, 0.004, 0.34);
    tone(b, t, 'triangle', 110, 50, 0.18, 0.003, 0.16);
    hiss(b, t, 'lowpass', 1400, 160, 0.7, 0.32, 0.002, 0.22);
  },
  // カチッ: two short clicks.
  kachi: (b, t) => {
    hiss(b, t, 'bandpass', 3400, 2800, 3, 1.2, 0.001, 0.025);
    tone(b, t, 'square', 2300, 1900, 0.12, 0.001, 0.014);
    hiss(b, t + 0.055, 'bandpass', 2600, 2200, 3, 0.9, 0.001, 0.03);
  },
  // キラッ: a bright chime climbing an arpeggio, with a little sparkle.
  kira: (b, t) => {
    [1568, 2093, 2637, 3136].forEach((f, i) => {
      tone(b, t + i * 0.05, 'sine', f, f * 1.01, 0.16, 0.004, 0.3);
      tone(b, t + i * 0.05, 'triangle', f * 2, f * 2, 0.035, 0.004, 0.12);
    });
    hiss(b, t + 0.12, 'highpass', 6000, 9000, 0.7, 0.05, 0.02, 0.14);
  },
  // シュッ: a noise swish sweeping up.
  shu: (b, t) => hiss(b, t, 'bandpass', 500, 3600, 1.3, 0.95, 0.06, 0.17),
  // ズザッ: a gritty skid that lands and stops.
  zuza: (b, t) => {
    hiss(b, t, 'bandpass', 1100, 520, 0.9, 0.34, 0.01, 0.13, grit(b, t, 42, t + 0.16));
    hiss(b, t + 0.1, 'lowpass', 2600, 380, 0.8, 0.38, 0.008, 0.24, grit(b, t + 0.1, 34, t + 0.36));
  },
  // ポン: a pop gliding up (on)…
  pon: (b, t) => tone(b, t, 'sine', 420, 1000, 0.9, 0.003, 0.13),
  // …and gliding down (off).
  'pon-off': (b, t) => tone(b, t, 'sine', 880, 330, 0.9, 0.003, 0.13),
};

/** Plays a sound now, unless sound effects are off. Call it inside a user gesture the first time, so the browser lets audio start. */
export function playSfx(name: SfxName) {
  if (!on) return;
  const b = getBus();
  if (b) SOUNDS[name](b, b.ctx.currentTime + 0.005);
}

// ------------------------------------------------------------------ which control makes which sound

/** The Sakuga tags that make a sound of their own (the toast's is played by whoever shows it). */
const SOUNDING = 'sakuga-button, sakuga-tabs, sakuga-slider, sakuga-toggle, sakuga-radio, sakuga-checkbox, sakuga-tooltip';

interface Control {
  localName: string;
  disabled?: boolean;
  checked?: boolean;
  getAttribute(name: string): string | null;
}

/**
 * The sound an event on a Sakuga control makes, or null: a button's click (ドン, カチッ for a secondary one),
 * a tab or a slider settling (シュッ, on change: a tab picked, a slider let go), a toggle flipped (ポン up or down),
 * a radio picked (ポン), a checkbox ticked (ズザッ) or cleared (カチッ), a tooltip's "?" pressed (カチッ).
 * Text fields stay quiet: a sound per key would be noise.
 */
export function soundFor(type: string, el: Control): SfxName | null {
  if (el.disabled) return null;
  switch (el.localName) {
    case 'sakuga-button':
      return type === 'click' ? (el.getAttribute('variant') === 'secondary' ? 'kachi' : 'don') : null;
    case 'sakuga-tabs':
    case 'sakuga-slider':
      return type === 'change' ? 'shu' : null;
    case 'sakuga-toggle':
      return type === 'change' ? (el.checked ? 'pon' : 'pon-off') : null;
    case 'sakuga-radio':
      return type === 'change' ? 'pon' : null;
    case 'sakuga-checkbox':
      return type === 'change' ? (el.checked ? 'zuza' : 'kachi') : null;
    case 'sakuga-tooltip':
      return type === 'click' ? 'kachi' : null;
    default:
      return null;
  }
}

/**
 * Listens on the document for every Sakuga control's click and change, and plays its sound. Capture phase:
 * it hears a click before React's handlers run, which may disable the button (e.g. while a guess is sent).
 * Returns the cleanup.
 */
export function installSfx(): () => void {
  const onEvent = (e: Event) => {
    const el = e.target instanceof Element ? e.target.closest<HTMLElement & Control>(SOUNDING) : null;
    const name = el && soundFor(e.type, el);
    if (name) playSfx(name);
  };
  document.addEventListener('click', onEvent, true);
  document.addEventListener('change', onEvent, true);
  return () => {
    document.removeEventListener('click', onEvent, true);
    document.removeEventListener('change', onEvent, true);
  };
}
