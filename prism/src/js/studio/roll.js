/**
 * The piano roll's pattern: notes drawn on a grid of sixteenths, looping every
 * 1, 2, 4 or 8 bars, played in time with the beat (or the loop) through its own
 * sound and effects.
 *
 * A note is { id, start, length, midi, velocity }, with start and length in
 * sixteenth steps (a 1/32 snap makes halves). Edits are grouped into undo steps:
 * call checkpoint() before a gesture changes anything.
 *
 * The player books notes a little ahead on the audio clock, like the drums, so
 * timing never depends on the page being responsive.
 */

import { stepSeconds } from './drums.js';

export const BAR_STEPS = 16;
export const PATTERN_BARS = [1, 2, 4, 8];
export const SNAPS = [
  { label: '1/4', steps: 4 },
  { label: '1/8', steps: 2 },
  { label: '1/16', steps: 1 },
  { label: '1/32', steps: 0.5 }
];
export const ROLL_LOW = 24;  // C1
export const ROLL_HIGH = 96; // C7
const HISTORY = 100;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** A position snapped down to the grid (where a click lands). */
export const snapDown = (step, snap) => Math.floor(step / snap + 1e-9) * snap;
/** A distance snapped to the nearest grid line (how far a drag moves). */
export const snapNearest = (step, snap) => Math.round(step / snap) * snap;

export class Pattern {
  constructor() {
    this.bars = 2;
    this.notes = [];
    this.nextId = 1;
    this.past = [];
    this.future = [];
  }

  get steps() {
    return this.bars * BAR_STEPS;
  }

  add({ start, length, midi, velocity = 0.8 }) {
    const note = {
      id: this.nextId++,
      start: Math.max(0, start),
      length: Math.max(0.25, length),
      midi: clamp(Math.round(midi), ROLL_LOW, ROLL_HIGH),
      velocity: clamp(velocity, 0.05, 1)
    };
    this.notes.push(note);
    return note;
  }

  remove(id) {
    const i = this.notes.findIndex((n) => n.id === id);
    if (i >= 0) this.notes.splice(i, 1);
    return i >= 0;
  }

  /** The note under a point, preferring the one drawn last (on top). */
  noteAt(step, midi) {
    for (let i = this.notes.length - 1; i >= 0; i--) {
      const n = this.notes[i];
      if (n.midi === midi && step >= n.start && step < n.start + n.length) return n;
    }
    return null;
  }

  clear() {
    this.notes = [];
  }

  /** Move every note's start to the nearest grid line. */
  quantize(snap) {
    for (const n of this.notes) n.start = Math.max(0, snapNearest(n.start, snap));
  }

  setBars(bars) {
    if (PATTERN_BARS.includes(bars)) this.bars = bars;
  }

  /* ----------------------------------- undo ---------------------------------- */

  snapshot() {
    return JSON.stringify({ bars: this.bars, notes: this.notes });
  }

  restore(json) {
    const { bars, notes } = JSON.parse(json);
    this.bars = bars;
    this.notes = notes;
    this.nextId = notes.reduce((m, n) => Math.max(m, n.id + 1), this.nextId);
  }

  /** Remember how things are, before an edit. */
  checkpoint() {
    this.past.push(this.snapshot());
    if (this.past.length > HISTORY) this.past.shift();
    this.future = [];
  }

  /** Drop the last checkpoint if the gesture after it changed nothing. */
  settle() {
    if (this.past.length && this.past[this.past.length - 1] === this.snapshot()) this.past.pop();
  }

  undo() {
    if (!this.past.length) return false;
    this.future.push(this.snapshot());
    this.restore(this.past.pop());
    return true;
  }

  redo() {
    if (!this.future.length) return false;
    this.past.push(this.snapshot());
    this.restore(this.future.pop());
    return true;
  }

  /* ------------------------------- save and load ------------------------------ */

  toJSON() {
    return { bars: this.bars, notes: this.notes.map(({ start, length, midi, velocity }) => ({ start, length, midi, velocity })) };
  }

  load(data) {
    this.bars = PATTERN_BARS.includes(data?.bars) ? data.bars : 2;
    this.notes = [];
    for (const n of data?.notes ?? []) {
      if ([n.start, n.length, n.midi].every(Number.isFinite)) this.add(n);
    }
    this.past = [];
    this.future = [];
  }
}

/**
 * Notes that start in [s0, s1) when the pattern repeats every `period` steps, with
 * where each lands in absolute steps. Notes past the end of the pattern are kept
 * (shorten it and lengthen it again, they're still there) but don't play.
 */
export function notesBetween(notes, period, s0, s1) {
  const out = [];
  if (!(s1 > s0)) return out;
  const k0 = Math.floor(s0 / period);
  const k1 = Math.floor((s1 - 1e-9) / period);
  for (let k = k0; k <= k1; k++) {
    for (const note of notes) {
      if (note.start >= period) continue;
      const step = k * period + note.start;
      if (step >= s0 && step < s1) out.push({ note, step });
    }
  }
  return out.sort((a, b) => a.step - b.step);
}

const LOOKAHEAD = 0.12;
const TICK_MS = 25;

/**
 * Plays a pattern through a synth. `clock()` says where step 0 is ({ origin in
 * seconds, bpm }), so the pattern follows the beat or the loop when there is one.
 */
export class RollPlayer {
  constructor(ctx, synth, pattern, clock) {
    this.ctx = ctx;
    this.synth = synth;
    this.pattern = pattern;
    this.clock = clock;
    this.playing = false;
    this.booked = 0;
    this.timer = 0;
  }

  start() {
    if (this.playing) return;
    this.playing = true;
    this.booked = this.ctx.currentTime + 0.02;
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  stop() {
    if (!this.playing) return;
    this.playing = false;
    clearInterval(this.timer);
    this.timer = 0;
    this.synth.cancelBooked();
  }

  /** Where the playhead is now, in pattern steps (null when stopped). */
  position(t = this.ctx.currentTime) {
    if (!this.playing) return null;
    const { origin, bpm } = this.clock();
    const step = (t - origin) / stepSeconds(bpm);
    if (step < 0) return null;
    const period = this.pattern.steps;
    return ((step % period) + period) % period;
  }

  tick() {
    if (!this.playing) return;
    const until = this.ctx.currentTime + LOOKAHEAD;
    const { origin, bpm } = this.clock();
    const step = stepSeconds(bpm);
    // Nothing before step 0: a beat that starts in a moment starts the pattern too.
    const s0 = Math.max(0, (this.booked - origin) / step);
    const s1 = (until - origin) / step;
    for (const { note, step: at } of notesBetween(this.pattern.notes, this.pattern.steps, s0, s1)) {
      this.synth.schedule(note.midi, note.velocity, origin + at * step, Math.max(0.03, note.length * step * 0.96));
    }
    this.booked = Math.max(this.booked, until);
  }
}
