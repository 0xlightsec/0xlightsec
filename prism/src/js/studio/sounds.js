/**
 * The Studio's instrument: a library of ready-made sounds in six groups, three
 * knobs to shape any of them (Tone, Attack, Release), and chord mode, where one
 * key plays a whole chord that belongs to the key you're in — so whatever you
 * press sounds right.
 *
 * Every sound is a recipe for one voice:
 *   osc     oscillators: wave type, frequency ratio, detune (cents), level.
 *           `{ saws: n, spread }` stacks n detuned saws (a "supersaw").
 *   env     a d s r: attack, decay (time constant), sustain level, release
 *   cutoff  low-pass filter, Hz above the note; `env` adds a bright attack
 *   vowel   formant filters, for a choir
 *   pitch   a pitch drop at the start: { semis, time } (808s, mallets)
 *   lfo     wobble: { to: 'pitch' | 'filter' | 'amp', rate Hz or beats per cycle, depth, delay }
 *   drive   soft-clip inside the voice
 *   shift   octave shift in semitones; mono + glide for basses and leads
 *   short   the name on its button, when the full one is long
 *
 * Voices are keyed by what triggered them (a key code, a MIDI note), so a chord
 * starts and stops as one even when two chords share a note.
 */

import { pianoFrequency } from '../theory/piano.js';
import { driveCurve } from './fx.js';

const saw = (detune = 0, gain = 0.6) => ({ type: 'sawtooth', ratio: 1, detune, gain });
const tone = (type, ratio = 1, gain = 0.6, detune = 0) => ({ type, ratio, gain, detune });

export const GROUPS = [
  { id: 'keys',  label: 'Keys' },
  { id: 'pads',  label: 'Pads' },
  { id: 'bass',  label: 'Bass' },
  { id: 'lead',  label: 'Lead' },
  { id: 'pluck', label: 'Pluck' },
  { id: 'hyper', label: 'Hyper' }
];

export const SOUNDS = {
  // Keys
  keys:     { group: 'keys', label: 'Soft Keys', short: 'Soft', osc: [tone('triangle'), tone('sine', 2, 0.35)], env: [0.004, 0.9, 0.22, 0.5], cutoff: 4200, level: 0.2 },
  epiano:   { group: 'keys', label: 'E-Piano', osc: [tone('sine'), tone('sine', 2, 0.2), tone('triangle', 7, 0.07)], env: [0.003, 1.2, 0.3, 0.45], cutoff: 6000, level: 0.22, lfo: { to: 'amp', rate: 4.5, depth: 0.12 } },
  organ:    { group: 'keys', label: 'Organ', osc: [tone('sine', 0.5, 0.35), tone('sine', 1, 0.5), tone('sine', 2, 0.3), tone('sine', 3, 0.18), tone('sine', 4, 0.12)], env: [0.01, 0.1, 1, 0.08], cutoff: 8000, level: 0.14, lfo: { to: 'pitch', rate: 6.5, depth: 6 } },
  bells:    { group: 'keys', label: 'Bells', osc: [tone('sine'), tone('sine', 2.76, 0.32), tone('sine', 5.4, 0.16)], env: [0.002, 1.8, 0, 2.2], cutoff: 9000, level: 0.2 },
  lofikeys: { group: 'keys', label: 'Lo-fi Keys', short: 'Lo-fi', osc: [tone('sine'), tone('sine', 2, 0.18), tone('triangle', 3, 0.05)], env: [0.004, 1.4, 0.3, 0.5], cutoff: 1300, level: 0.24, lfo: { to: 'pitch', rate: 0.9, depth: 14 } },
  marimba:  { group: 'keys', label: 'Marimba', short: 'Mallet', osc: [tone('sine'), tone('sine', 4, 0.25)], env: [0.002, 0.28, 0, 0.3], cutoff: 5000, level: 0.3, pitch: { semis: 0.6, time: 0.02 } },
  // Pads
  pad:      { group: 'pads', label: 'Warm Pad', short: 'Warm', osc: [saw(-9), saw(9)], env: [0.35, 0.8, 0.75, 1.4], cutoff: 1700, level: 0.1 },
  strings:  { group: 'pads', label: 'Strings', osc: [{ saws: 5, spread: 16 }], env: [0.5, 1, 0.85, 1.2], cutoff: 2600, level: 0.07, lfo: { to: 'pitch', rate: 5, depth: 8, delay: 0.5 } },
  choir:    { group: 'pads', label: 'Choir', osc: [saw(-6, 0.5), saw(6, 0.5)], env: [0.4, 1, 0.8, 1.1], cutoff: 5000, vowel: [800, 1150, 2900], level: 0.3, lfo: { to: 'pitch', rate: 5.2, depth: 10, delay: 0.3 } },
  glass:    { group: 'pads', label: 'Glass', osc: [tone('triangle'), tone('sine', 3, 0.25), tone('sine', 5, 0.08)], env: [0.6, 1.5, 0.6, 2], cutoff: 7000, level: 0.16, lfo: { to: 'amp', rate: 0.5, depth: 0.25 } },
  // Bass
  bass:     { group: 'bass', label: 'Sub Bass', short: 'Sub', osc: [tone('square', 1, 0.45), tone('sine', 1, 0.6)], env: [0.005, 0.3, 0.7, 0.12], cutoff: 900, env2: 700, level: 0.17, shift: -12, mono: true, glide: 0.04 },
  b808:     { group: 'bass', label: '808', osc: [tone('sine', 1, 0.9)], env: [0.003, 1.4, 0, 0.5], cutoff: 3000, level: 0.32, shift: -12, mono: true, glide: 0.06, pitch: { semis: 12, time: 0.05 }, drive: 0.35 },
  wobble:   { group: 'bass', label: 'Wobble', osc: [saw(-7), tone('square', 1, 0.4, 7)], env: [0.01, 0.4, 0.85, 0.15], cutoff: 500, level: 0.15, shift: -12, mono: true, glide: 0.05, lfo: { to: 'filter', beats: 0.5, depth: 1800 } },
  reese:    { group: 'bass', label: 'Reese', osc: [saw(-22), saw(22)], env: [0.01, 0.5, 0.9, 0.2], cutoff: 700, level: 0.13, shift: -12, mono: true, glide: 0.05, drive: 0.2 },
  // Lead
  lead:     { group: 'lead', label: 'Square Lead', short: 'Square', osc: [tone('square', 1, 0.6, -8), tone('square', 1, 0.6, 8)], env: [0.01, 0.3, 0.8, 0.25], cutoff: 3200, level: 0.09, lfo: { to: 'pitch', rate: 5.5, depth: 14, delay: 0.4 } },
  supersaw: { group: 'lead', label: 'Supersaw', short: 'Saws', osc: [{ saws: 7, spread: 26 }], env: [0.01, 0.4, 0.8, 0.3], cutoff: 6000, level: 0.06 },
  chip:     { group: 'lead', label: 'Chiptune', short: 'Chip', osc: [tone('square', 1, 0.6)], env: [0.001, 0.15, 0.6, 0.05], cutoff: 16000, level: 0.09, mono: true },
  grunge:   { group: 'lead', label: 'Grunge Guitar', short: 'Grunge', osc: [saw(-5, 0.6), tone('sawtooth', 1.5, 0.45, 5), tone('sawtooth', 2, 0.3)], env: [0.004, 0.9, 0.6, 0.2], cutoff: 2400, level: 0.1, drive: 0.85, mono: true, glide: 0.02 },
  whistle:  { group: 'lead', label: 'Whistle', osc: [tone('sine', 1, 0.9), tone('sine', 2, 0.04)], env: [0.06, 0.4, 0.85, 0.2], cutoff: 9000, level: 0.24, mono: true, glide: 0.08, lfo: { to: 'pitch', rate: 6, depth: 18, delay: 0.25 } },
  // Pluck
  pluck:    { group: 'pluck', label: 'Pluck', osc: [saw(-4), tone('square', 1, 0.6, 4)], env: [0.002, 0.28, 0, 0.22], cutoff: 600, env2: 5200, level: 0.13 },
  harp:     { group: 'pluck', label: 'Harp', osc: [tone('triangle'), tone('sine', 2, 0.2)], env: [0.002, 1.1, 0, 1.2], cutoff: 1500, env2: 4000, level: 0.24 },
  kalimba:  { group: 'pluck', label: 'Kalimba', osc: [tone('sine'), tone('sine', 5.4, 0.15)], env: [0.002, 0.6, 0, 0.6], cutoff: 6000, level: 0.28, pitch: { semis: 0.4, time: 0.015 } },
  stab:     { group: 'pluck', label: 'Stab', osc: [{ saws: 5, spread: 20 }], env: [0.002, 0.18, 0, 0.15], cutoff: 900, env2: 6000, level: 0.07 },
  // Hyper: hyperpop, rage, electric
  ragelead: { group: 'hyper', label: 'Rage Lead', short: 'Rage', osc: [{ saws: 7, spread: 35 }, tone('square', 2, 0.25)], env: [0.003, 0.5, 0.75, 0.25], cutoff: 7000, level: 0.055, drive: 0.3 },
  hyperlead:{ group: 'hyper', label: 'Hyper Lead', short: 'Hyper', osc: [tone('square', 1, 0.5, -6), saw(6, 0.5), tone('sine', 2, 0.25)], env: [0.005, 0.3, 0.8, 0.2], cutoff: 9000, level: 0.09, mono: true, glide: 0.05, pitch: { semis: -3, time: 0.06 }, lfo: { to: 'pitch', rate: 7, depth: 22, delay: 0.15 } },
  glitchbell:{ group: 'hyper', label: 'Glitch Bell', short: 'Glitch', osc: [tone('sine', 1, 0.8), tone('sine', 3.5, 0.4), tone('sine', 7.1, 0.2)], env: [0.001, 0.35, 0, 0.4], cutoff: 12000, level: 0.22, pitch: { semis: 12, time: 0.01 } },
  dist808:  { group: 'hyper', label: 'Dist 808', osc: [tone('sine', 1, 0.9)], env: [0.003, 1.6, 0, 0.6], cutoff: 4000, level: 0.26, shift: -12, mono: true, glide: 0.1, pitch: { semis: 14, time: 0.06 }, drive: 0.9 }
};

/** Knob centre (0.5) plays a sound as designed; each side scales it by up to 8x. */
export const shapeFactor = (v) => Math.pow(8, (Math.min(1, Math.max(0, v)) - 0.5) * 2);
export const SHAPE_DEFAULT = { tone: 0.5, attack: 0.5, release: 0.5 };

export const KEY_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const MAJOR = [0, 2, 4, 5, 7, 9, 11];

/**
 * The chord a key plays in chord mode, in the major key with tonic `key` (pitch
 * class). Notes of the scale get their own triad from the scale (I ii iii IV V vi
 * vii°); the notes between them get a major triad, for colour.
 */
export function chordFor(midi, key = 0) {
  const degree = MAJOR.indexOf((((midi - key) % 12) + 12) % 12);
  if (degree < 0) return [midi, midi + 4, midi + 7];
  const up = (steps) => {
    const d = degree + steps;
    return MAJOR[d % 7] + 12 * Math.floor(d / 7) - MAJOR[degree];
  };
  return [midi, midi + up(2), midi + up(4)];
}

/** Name of a chord from chordFor: "C", "Dm", "B°". */
export function chordName(notes) {
  const root = KEY_NAMES[((notes[0] % 12) + 12) % 12];
  const third = notes[1] - notes[0];
  const fifth = notes[2] - notes[0];
  if (third === 3 && fifth === 6) return `${root}°`;
  return third === 3 ? `${root}m` : root;
}

/** The oscillators a recipe asks for, with supersaw stacks expanded. */
export function oscillatorsOf(p) {
  const out = [];
  for (const o of p.osc) {
    if (!o.saws) {
      out.push(o);
      continue;
    }
    const gain = 1.2 / Math.sqrt(o.saws);
    for (let i = 0; i < o.saws; i++) {
      const detune = o.saws === 1 ? 0 : -o.spread + (2 * o.spread * i) / (o.saws - 1);
      out.push({ type: 'sawtooth', ratio: 1, detune, gain });
    }
  }
  return out;
}

export class StudioSynth {
  constructor(ctx, out) {
    this.ctx = ctx;
    this.out = out;
    this.sound = 'keys';
    this.shape = { ...SHAPE_DEFAULT };
    this.bpm = 96;
    this.voices = new Map(); // trigger id -> [voice]
    this.lastFreq = 0;       // for gliding mono sounds
    this.booked = [];        // notes booked ahead by the piano roll
    this.lastBooked = null;
  }

  get preset() {
    return SOUNDS[this.sound];
  }

  /** Start notes under one id; returns the notes actually played. */
  noteOn(id, notes, velocity = 0.8) {
    this.noteOff(id, true);
    const p = this.preset;
    let glideFrom = 0;
    if (p.mono) {
      // One note at a time: chords turn to mud down there, and a new note glides
      // from the last one if it's still held.
      if (this.voices.size) glideFrom = this.lastFreq;
      for (const other of [...this.voices.keys()]) this.noteOff(other, true);
      notes = [notes[0]];
    }
    const played = notes.map((m) => m + (p.shift ?? 0));
    const now = this.ctx.currentTime;
    this.voices.set(id, played.map((m) => this.voice(m, velocity / Math.sqrt(played.length), now, glideFrom)));
    return played;
  }

  noteOff(id, immediate = false) {
    const list = this.voices.get(id);
    if (!list) return;
    this.voices.delete(id);
    const now = this.ctx.currentTime;
    for (const v of list) {
      const tail = immediate ? 0.012 : v.release;
      v.amp.gain.cancelScheduledValues(now);
      v.amp.gain.setValueAtTime(Math.max(v.amp.gain.value, 0.0001), now);
      v.amp.gain.setTargetAtTime(0.0001, now, tail / 4);
      for (const o of v.oscs) o.stop(now + tail + 0.05);
    }
  }

  allOff() {
    for (const id of [...this.voices.keys()]) this.noteOff(id);
  }

  /**
   * Book one note on the audio clock, for the piano roll: it starts at `at` and
   * is released `duration` seconds later. Mono sounds cut (and glide from) the
   * previous booked note if it's still sounding then.
   */
  schedule(midi, velocity, at, duration) {
    const p = this.preset;
    const m = midi + (p.shift ?? 0);
    let glideFrom = 0;
    const last = this.lastBooked;
    if (p.mono && last && last.end > at + 0.001 && last.start < at) {
      glideFrom = last.freq;
      this.release(last.voice, at, 0.012);
      last.end = at;
    }
    const v = this.voice(m, velocity, at, glideFrom);
    this.release(v, at + duration, v.release);
    const entry = { midi: m, start: at, end: at + duration, voice: v, freq: pianoFrequency(m) };
    this.booked.push(entry);
    this.lastBooked = entry;
    return entry;
  }

  /** Release a voice at a set time (cancelling any later release already booked). */
  release(v, at, tail) {
    v.amp.gain.cancelScheduledValues(at);
    v.amp.gain.setTargetAtTime(0.0001, at, tail / 4);
    for (const o of v.oscs) o.stop(at + tail + 0.05);
  }

  /** Booked notes sounding at time t, lowest first; forgets the finished ones. */
  sounding(t) {
    this.booked = this.booked.filter((b) => b.end + 2 > t);
    return this.booked.filter((b) => b.start <= t && t < b.end).map((b) => b.midi).sort((a, b) => a - b);
  }

  /** Silence everything booked: what's playing fades fast, what hasn't started never does. */
  cancelBooked() {
    const now = this.ctx.currentTime;
    for (const b of this.booked) {
      if (b.start > now) for (const o of b.voice.oscs) o.stop(now);
      else if (b.end > now) this.release(b.voice, now, 0.03);
    }
    this.booked = [];
    this.lastBooked = null;
  }

  /** Notes sounding now, lowest first. */
  get held() {
    return [...this.voices.values()].flat().map((v) => v.midi).sort((a, b) => a - b);
  }

  voice(midi, velocity, now, glideFrom) {
    const ctx = this.ctx;
    const p = this.preset;
    const f = pianoFrequency(midi);
    const [a0, d, s, r0] = p.env;
    const a = a0 * shapeFactor(this.shape.attack);
    const r = r0 * shapeFactor(this.shape.release);
    const bright = shapeFactor(this.shape.tone);
    const peak = p.level * Math.min(1, velocity) * 1.6;

    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, now);
    amp.gain.linearRampToValueAtTime(peak, now + a);
    amp.gain.setTargetAtTime(Math.max(0.0001, peak * s), now + a, d / 3);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.8;
    const rest = Math.min(18000, (p.cutoff + f) * bright);
    filter.frequency.setValueAtTime(Math.min(18000, rest + (p.env2 ?? 0) * bright), now);
    if (p.env2) filter.frequency.setTargetAtTime(rest, now + a, d / 2);

    // Oscillators -> (formants) -> (drive) -> filter -> amp.
    let into = filter;
    if (p.drive) {
      const shaper = ctx.createWaveShaper();
      shaper.curve = driveCurve(p.drive);
      shaper.connect(filter);
      into = shaper;
    }
    if (p.vowel) {
      const mix = ctx.createGain();
      for (const [i, hz] of p.vowel.entries()) {
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = hz;
        bp.Q.value = 7;
        const g = ctx.createGain();
        g.gain.value = [1, 0.7, 0.35][i] ?? 0.3;
        mix.connect(bp).connect(g).connect(into);
      }
      into = mix;
    }

    const start = glideFrom || 0;
    const oscs = oscillatorsOf(p).map((o) => {
      const osc = ctx.createOscillator();
      osc.type = o.type;
      const target = f * o.ratio;
      if (start) {
        osc.frequency.setValueAtTime(start * o.ratio, now);
        osc.frequency.exponentialRampToValueAtTime(target, now + (p.glide ?? 0.05));
      } else if (p.pitch) {
        osc.frequency.setValueAtTime(target * Math.pow(2, p.pitch.semis / 12), now);
        osc.frequency.exponentialRampToValueAtTime(target, now + p.pitch.time);
      } else {
        osc.frequency.value = target;
      }
      osc.detune.value = o.detune ?? 0;
      const g = ctx.createGain();
      g.gain.value = o.gain;
      osc.connect(g).connect(into);
      osc.start(now);
      return osc;
    });
    this.lastFreq = f;

    if (p.lfo) {
      const { to, depth, delay = 0 } = p.lfo;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = p.lfo.beats ? this.bpm / 60 / p.lfo.beats : p.lfo.rate;
      const amount = ctx.createGain();
      amount.gain.setValueAtTime(0, now);
      amount.gain.linearRampToValueAtTime(to === 'amp' ? depth * peak : depth, now + delay + 0.02);
      lfo.connect(amount);
      if (to === 'pitch') for (const o of oscs) amount.connect(o.detune);
      else if (to === 'filter') amount.connect(filter.frequency);
      else amount.connect(amp.gain);
      lfo.start(now);
      oscs.push(lfo);
    }

    filter.connect(amp).connect(this.out);
    return { midi, amp, oscs, release: r };
  }
}
