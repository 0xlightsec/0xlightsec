/**
 * Voice effects: Pitch and Tune, the hyperpop vocal.
 *
 * Pitch shifts your voice up (chipmunk) or down (demon) without changing its
 * speed. Tune snaps it to the nearest note of the key you're in; all the way up,
 * it jumps from note to note with no glide — the hard-tuned, robotic sound.
 *
 * The shifter is the classic delay-line kind: two read heads sweep through a
 * short delay at the speed that gives the new pitch, each faded in and out so one
 * is always at full strength while the other jumps back. It's cheap, works on
 * anything, and its slight grain suits the style. At a ratio of exactly 1 it
 * passes the voice straight through, with no delay.
 *
 * Pure code (no Web Audio), so the tests drive it directly.
 */

import { freqToMidi } from '../theory/circle.js';

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const WINDOW_SECONDS = 0.04;

/** The pitch, as a ratio, that moves `hz` onto the nearest note of the major key `key`, by `amount` (0..1). */
export function tuneRatio(hz, key, amount) {
  if (!(hz > 0) || !(amount > 0)) return 1;
  const midi = freqToMidi(hz);
  let best = Infinity;
  for (let o = -1; o <= 1; o++) {
    const base = Math.floor(midi / 12) * 12 + o * 12;
    for (const d of MAJOR) {
      const m = base + ((d + key) % 12);
      if (Math.abs(m - midi) < Math.abs(best - midi)) best = m;
    }
  }
  return Math.pow(2, ((best - midi) * Math.min(1, amount)) / 12);
}

export class PitchShifter {
  constructor(sampleRate) {
    this.size = 1 << Math.ceil(Math.log2(sampleRate * WINDOW_SECONDS * 2 + 4));
    this.buf = new Float32Array(this.size);
    this.window = Math.round(sampleRate * WINDOW_SECONDS);
    this.at = 0;
    this.phase = 0;
    this.ratio = 1;
    this.target = 1;
    this.dry = 1; // 1 = straight through; crossfades when shifting starts or stops
    this.glide = 1 - Math.exp(-1 / (0.004 * sampleRate)); // ratio follows its target in ~4 ms
    this.fade = 1 - Math.exp(-1 / (0.01 * sampleRate));
  }

  tap(delay) {
    const pos = this.at - delay;
    const i = Math.floor(pos);
    const t = pos - i;
    const mask = this.size - 1;
    const a = this.buf[i & mask];
    const b = this.buf[(i + 1) & mask];
    return a + (b - a) * t;
  }

  process(input, output, n) {
    const W = this.window;
    const mask = this.size - 1;
    for (let i = 0; i < n; i++) {
      const x = input ? input[i] : 0;
      this.buf[this.at & mask] = x;
      const engaged = Math.abs(this.target - 1) > 1e-4;
      this.dry += ((engaged ? 0 : 1) - this.dry) * this.fade;
      if (!engaged && this.dry > 0.999) {
        // Untouched: no delay, no colour. Reset so the next shift starts clean.
        this.dry = 1;
        this.ratio = 1;
        this.phase = 0;
        output[i] = x;
      } else {
        this.ratio += (this.target - this.ratio) * this.glide;
        // The heads drift through the window at (1 - ratio) samples per sample.
        // Their gains are sin² and cos² of the same angle, so they always sum to one.
        this.phase += (1 - this.ratio) / W;
        this.phase -= Math.floor(this.phase);
        const p2 = (this.phase + 0.5) % 1;
        const g1 = Math.sin(Math.PI * this.phase);
        const g2 = Math.sin(Math.PI * p2);
        const wet = this.tap(this.phase * W + 1) * g1 * g1 + this.tap(p2 * W + 1) * g2 * g2;
        output[i] = x * this.dry + wet * (1 - this.dry);
      }
      this.at = (this.at + 1) & 0x3fffffff;
    }
  }
}
