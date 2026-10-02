/**
 * The Studio's instrument: five ready-made sounds, and chord mode, where one key
 * plays a whole chord that belongs to the key you're in — so whatever you press
 * sounds right.
 *
 * Voices are keyed by what triggered them (a key code, a MIDI note), so a chord
 * starts and stops as one even when two chords share a note.
 */

import { pianoFrequency } from '../theory/piano.js';

export const SOUNDS = {
  pad:   { label: 'Pad',   waves: ['sawtooth', 'sawtooth'], detune: 9,  a: 0.35,  d: 0.8,  s: 0.75, r: 1.4,  cutoff: 1700, env: 0,    level: 0.10 },
  keys:  { label: 'Keys',  waves: ['triangle', 'sine'],     detune: 0,  a: 0.004, d: 0.9,  s: 0.22, r: 0.5,  cutoff: 4200, env: 0,    level: 0.2, bell: true },
  pluck: { label: 'Pluck', waves: ['sawtooth', 'square'],   detune: 4,  a: 0.002, d: 0.28, s: 0,    r: 0.22, cutoff: 600,  env: 5200, level: 0.13 },
  bass:  { label: 'Bass',  waves: ['square', 'sine'],       detune: 0,  a: 0.005, d: 0.3,  s: 0.7,  r: 0.12, cutoff: 900,  env: 700,  level: 0.17, shift: -12, mono: true },
  lead:  { label: 'Lead',  waves: ['square', 'square'],     detune: 8,  a: 0.01,  d: 0.3,  s: 0.8,  r: 0.25, cutoff: 3200, env: 0,    level: 0.09, vibrato: true }
};

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

export class StudioSynth {
  constructor(ctx, out) {
    this.ctx = ctx;
    this.out = out;
    this.sound = 'keys';
    this.voices = new Map(); // trigger id -> [voice]
  }

  get preset() {
    return SOUNDS[this.sound];
  }

  /** Start notes under one id; returns the notes actually played. */
  noteOn(id, notes, velocity = 0.8) {
    this.noteOff(id, true);
    const p = this.preset;
    if (p.mono) {
      // A bass plays one note at a time, an octave down: chords turn mud there.
      for (const other of [...this.voices.keys()]) this.noteOff(other);
      notes = [notes[0]];
    }
    const played = notes.map((m) => m + (p.shift ?? 0));
    const now = this.ctx.currentTime;
    this.voices.set(id, played.map((m) => this.voice(m, velocity / Math.sqrt(played.length), now)));
    return played;
  }

  noteOff(id, immediate = false) {
    const list = this.voices.get(id);
    if (!list) return;
    this.voices.delete(id);
    const now = this.ctx.currentTime;
    for (const v of list) {
      const tail = immediate ? 0.01 : v.release;
      v.amp.gain.cancelScheduledValues(now);
      v.amp.gain.setValueAtTime(Math.max(v.amp.gain.value, 0.0001), now);
      v.amp.gain.setTargetAtTime(0.0001, now, tail / 4);
      for (const o of v.oscs) o.stop(now + tail + 0.05);
    }
  }

  allOff() {
    for (const id of [...this.voices.keys()]) this.noteOff(id);
  }

  /** Notes sounding now, lowest first. */
  get held() {
    return [...this.voices.values()].flat().map((v) => v.midi).sort((a, b) => a - b);
  }

  voice(midi, velocity, now) {
    const ctx = this.ctx;
    const p = this.preset;
    const f = pianoFrequency(midi);
    const peak = p.level * Math.min(1, velocity) * 1.6;

    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, now);
    amp.gain.linearRampToValueAtTime(peak, now + p.a);
    amp.gain.setTargetAtTime(Math.max(0.0001, peak * p.s), now + p.a, p.d / 3);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.8;
    const top = Math.min(18000, p.cutoff + p.env + f * 2);
    filter.frequency.setValueAtTime(top, now);
    if (p.env) filter.frequency.setTargetAtTime(Math.min(18000, p.cutoff + f), now + p.a, p.d / 2);

    const oscs = p.waves.map((type, i) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = p.bell && i === 1 ? f * 2 : f;
      o.detune.value = i === 0 ? -p.detune : p.detune;
      const g = ctx.createGain();
      g.gain.value = p.bell && i === 1 ? 0.35 : 0.6;
      o.connect(g).connect(filter);
      o.start(now);
      return o;
    });

    if (p.vibrato) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 5.5;
      const depth = ctx.createGain();
      depth.gain.setValueAtTime(0, now);
      depth.gain.linearRampToValueAtTime(14, now + 0.4); // cents, after a moment, like a singer
      lfo.connect(depth);
      for (const o of oscs) depth.connect(o.detune);
      lfo.start(now);
      oscs.push(lfo);
    }

    filter.connect(amp).connect(this.out);
    return { midi, amp, oscs, release: p.r };
  }
}
