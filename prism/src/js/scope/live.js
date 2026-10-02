/**
 * Live circles: oscilloscope-music circles that spin and morph with what you
 * play and sing, generated sample by sample on the audio thread.
 *
 * Two circles, two sources: the lower-left one follows the music (a playing
 * track, or keys held on the generator), the upper-right one follows your voice.
 * For each:
 *   - loudness sets how fast it spins and how far it blooms from a circle into a
 *     flower; a sudden jump in loudness (an onset) kicks both;
 *   - the note sets the number of petals — one more per step around the Circle of
 *     Fifths, so neighbouring keys have neighbouring shapes;
 *   - the melody sets the direction: rising pitch spins one way, falling the other.
 *
 * Pure maths, no DOM or Web Audio, so the same code runs in the worklet and in
 * the tests.
 */

import { circleIndex, pitchClass } from '../theory/circle.js';

const TAU = Math.PI * 2;
/** Circle centres: music lower-left, voice upper-right. */
export const CENTERS = [[-0.36, -0.26], [0.36, 0.26]];
const BASE_RADIUS = 0.27;
const EASE = 0.008; // fraction of a turn spent jumping between circles: fast, so faint
const EASE_MIN_SAMPLES = 8; // but never quicker than this, or the jump is a click

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Petal count for a note: 2 to 7, stepping with the Circle of Fifths. */
export function lobesFor(midi) {
  return 2 + (circleIndex(pitchClass(Math.round(midi))) % 6);
}

/** Loudness in dBFS mapped to 0..1: -50 dB is silence, -10 dB is full. */
export function levelFromDb(db) {
  return clamp((db + 50) / 40, 0, 1);
}

/** Turns one source's measurements, frame by frame, into shape targets. */
export class Driver {
  constructor() {
    this.level = 0;
    this.slow = 0;
    this.pop = 0;
    this.dir = 1;
    this.lastMidi = null;
    this.k = 3;
  }

  /** `level` 0..1, `midi` the current pitch or null, `dt` seconds since last call. */
  update({ level = 0, midi = null }, dt) {
    const lvl = clamp(level, 0, 1);
    this.slow += (lvl - this.slow) * Math.min(1, dt * 2.5);
    if (lvl - this.slow > 0.12) this.pop = 1; // onset: well above its recent average
    this.pop *= Math.exp(-dt * 5);
    this.level += (lvl - this.level) * Math.min(1, dt * 12);
    if (midi !== null && Number.isFinite(midi)) {
      if (this.lastMidi !== null && Math.abs(midi - this.lastMidi) > 0.5) this.dir = midi > this.lastMidi ? 1 : -1;
      this.lastMidi = midi;
      this.k = lobesFor(midi);
    }
    return {
      k: this.k,
      m: Math.min(0.55, this.level * 0.6 + this.pop * 0.15),
      spin: this.dir * (0.25 + this.level * 4 + this.pop * 3), // rad/s
      scale: 0.75 + this.level * 0.45 + this.pop * 0.25
    };
  }
}

/**
 * Sample-by-sample renderer. Traces one circle per turn, alternating, at `f`
 * turns a second, easing quickly across the gap between them. Every parameter is
 * smoothed per sample and petal counts crossfade, so nothing ever jumps — a jump
 * would be a click in the audio and a tear in the picture.
 */
export class LiveCircles {
  constructor(sampleRate) {
    this.sr = sampleRate;
    this.u = 0;
    this.f = 110;
    this.circles = CENTERS.map(([cx, cy]) => ({
      cx, cy, k0: 3, k1: 3, mix: 1, m: 0, mT: 0, spin: 0.25, spinT: 0.25, rot: 0, scale: 0.75, scaleT: 0.75
    }));
    this.smooth = 1 - Math.exp(-1 / (0.05 * sampleRate)); // ~50 ms
    this.mixStep = 1 / (0.25 * sampleRate); // petal crossfade over 250 ms
  }

  setTargets(targets, f) {
    targets.forEach((t, i) => {
      const c = this.circles[i];
      if (!c || !t) return;
      if (t.k !== c.k1) {
        c.k0 = c.mix >= 0.5 ? c.k1 : c.k0;
        c.k1 = t.k;
        c.mix = 0;
      }
      c.mT = t.m;
      c.spinT = t.spin;
      c.scaleT = t.scale;
    });
    if (f) this.f = clamp(f, 40, 440);
  }

  point(i, theta) {
    const c = this.circles[i];
    const petals = (1 - c.mix) * Math.cos(c.k0 * theta) + c.mix * Math.cos(c.k1 * theta);
    const r = BASE_RADIUS * c.scale * (1 + c.m * petals);
    const a = theta + c.rot;
    return [c.cx + r * Math.cos(a), c.cy + r * Math.sin(a)];
  }

  render(left, right, n) {
    const a = this.smooth;
    for (let i = 0; i < n; i++) {
      for (const c of this.circles) {
        c.m += (c.mT - c.m) * a;
        c.spin += (c.spinT - c.spin) * a;
        c.scale += (c.scaleT - c.scale) * a;
        c.rot += c.spin / this.sr;
        if (c.mix < 1) c.mix = Math.min(1, c.mix + this.mixStep);
      }
      this.u += this.f / this.sr;
      if (this.u > 1e6) this.u -= 1e6; // keep precision over long sessions (even, so parity holds)
      const turn = Math.floor(this.u);
      const w = this.u - turn;
      const which = turn & 1;
      const ease = Math.max(EASE, (EASE_MIN_SAMPLES * this.f) / this.sr);
      let [x, y] = this.point(which, TAU * w);
      if (w < ease) {
        const [px, py] = this.point(1 - which, 0);
        const k = w / ease;
        const s = k * k * (3 - 2 * k);
        x = px + (x - px) * s;
        y = py + (y - py) * s;
      }
      left[i] = clamp(x, -1, 1) * 0.92;
      right[i] = clamp(y, -1, 1) * 0.92;
    }
  }
}
