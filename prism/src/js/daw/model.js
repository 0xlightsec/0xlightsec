/**
 * The song, FL Studio style:
 *
 *   channels   instruments in the Channel Rack: a synth sound or a drum, each with
 *              volume, pan, mute/solo and the mixer insert it plays through
 *   patterns   per channel, notes on a grid of sixteenth steps; a pattern loops
 *              every 1–16 bars. Steps and piano-roll notes are the same notes; a
 *              muted note stays in the pattern but doesn't play.
 *   playlist   pattern clips placed on tracks along a timeline of bars: the song
 *   mixer      the master and inserts, each with a fader, pan and effects
 *
 * Times are in sixteenth steps (16 to a bar). Everything here is plain data and
 * pure functions, so the tests drive it directly; the audio engine and the views
 * read it. Edits are grouped into undo steps: checkpoint() before a gesture,
 * settle() after it.
 */

import { SOUNDS } from '../studio/sounds.js';
import { KITS, BEATS } from '../studio/drums.js';
import { FX_DEFAULTS } from '../studio/fx.js';

export const VERSION = 2;
export const STEPS_PER_BAR = 16;
export const PATTERN_BARS = [1, 2, 4, 8, 16];
export const INSERTS = 8;
export const PLAYLIST_TRACKS = 8;
export const NOTE_LOW = 12;   // C0
export const NOTE_HIGH = 108; // C8
export const ROOT = 60;       // where a step goes, and a drum's natural pitch
const HISTORY = 150;

/** Drum channels: what they are, and their General MIDI note (for pads and MIDI files). */
export const DRUMS = {
  kick:    { label: 'Kick', gm: 36 },
  snare:   { label: 'Snare', gm: 38 },
  clap:    { label: 'Clap', gm: 39 },
  hat:     { label: 'Hat', gm: 42 },
  openhat: { label: 'Open Hat', gm: 46 },
  crash:   { label: 'Crash', gm: 49 },
  tom:     { label: 'Tom', gm: 45 },
  rim:     { label: 'Rim', gm: 37 },
  snap:    { label: 'Snap', gm: 26 },     // GM2 finger snap
  perc:    { label: 'Perc', gm: 63 },     // a conga
  chant:   { label: 'Chant', gm: 79 },    // no voice in GM: the open cuica's note
  riser:   { label: 'Riser', gm: 29 }     // GM2's scratch: lasts a bar, so start it a bar before the drop
};

/** Every GM drum note we understand, to the drum that plays it. */
export const GM_TO_DRUM = new Map([
  [35, 'kick'], [36, 'kick'], [37, 'rim'], [38, 'snare'], [40, 'snare'], [39, 'clap'],
  [42, 'hat'], [44, 'hat'], [46, 'openhat'], [49, 'crash'], [52, 'crash'], [55, 'crash'], [57, 'crash'],
  [41, 'tom'], [43, 'tom'], [45, 'tom'], [47, 'tom'], [48, 'tom'], [50, 'tom'],
  [26, 'snap'], [60, 'perc'], [61, 'perc'], [62, 'perc'], [63, 'perc'], [64, 'perc'],
  [78, 'chant'], [79, 'chant'], [29, 'riser']
]);

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const num = (v, fallback) => (Number.isFinite(v) ? v : fallback);

/** A colour for anything with an index: patterns and channels step round the wheel. */
export const hueOf = (i) => (i * 137.508) % 360;

export function defaultMixer() {
  const { level, mute, ...sound } = FX_DEFAULTS;
  const strip = (name) => ({ name, volume: level, pan: 0, mute: false, solo: false, fx: { ...sound, space: 0 } });
  const tracks = [strip('Master')];
  for (let i = 1; i <= INSERTS; i++) tracks.push(strip(`Insert ${i}`));
  return tracks;
}

/** A song with nothing in it: no channels, no patterns. */
export function emptySong(name = 'Untitled', bpm = 130) {
  return new Song({
    version: VERSION,
    name,
    bpm,
    swing: 0,
    nextId: 1,
    channels: [],
    patterns: [],
    playlist: { tracks: PLAYLIST_TRACKS, clips: [] },
    mixer: defaultMixer(),
    current: { pattern: null, channel: null },
    mode: 'pattern',
    position: 0
  });
}

/** A new song: FL's starting rack (kick, clap, hat, snare) plus an 808 and keys. */
export function newSong() {
  const song = emptySong();
  for (const drum of ['kick', 'clap', 'hat', 'snare']) song.addChannel({ kind: 'drum', drum, kit: 'classic' });
  song.addChannel({ kind: 'synth', sound: 'b808', name: '808' });
  song.addChannel({ kind: 'synth', sound: 'pluck', name: 'Pluck' });
  const p = song.addPattern();
  song.data.current = { pattern: p.id, channel: song.data.channels[0].id };
  song.past = [];
  return song;
}

export class Song {
  constructor(data) {
    this.data = data;
    this.past = [];
    this.future = [];
  }

  /* --------------------------------- lookups --------------------------------- */

  get channels() {
    return this.data.channels;
  }

  get patterns() {
    return this.data.patterns;
  }

  channel(id) {
    return this.data.channels.find((c) => c.id === id) ?? null;
  }

  pattern(id) {
    return this.data.patterns.find((p) => p.id === id) ?? null;
  }

  get currentPattern() {
    return this.pattern(this.data.current.pattern) ?? this.data.patterns[0] ?? null;
  }

  get currentChannel() {
    return this.channel(this.data.current.channel) ?? this.data.channels[0] ?? null;
  }

  id(prefix) {
    return `${prefix}${this.data.nextId++}`;
  }

  /* --------------------------------- channels -------------------------------- */

  /** Add an instrument; it gets the next free mixer insert, named after it. */
  addChannel(spec) {
    const kind = spec.kind === 'drum' ? 'drum' : 'synth';
    const ch = {
      id: this.id('c'),
      name: spec.name ?? (kind === 'drum' ? DRUMS[spec.drum]?.label ?? 'Drum' : SOUNDS[spec.sound]?.label ?? 'Synth'),
      kind,
      sound: kind === 'synth' ? (spec.sound in SOUNDS ? spec.sound : 'keys') : null,
      drum: kind === 'drum' ? (spec.drum in DRUMS ? spec.drum : 'kick') : null,
      kit: kind === 'drum' ? (spec.kit in KITS ? spec.kit : 'classic') : null,
      shape: { tone: 0.5, attack: 0.5, release: 0.5, ...spec.shape },
      volume: num(spec.volume, 0.8),
      pan: num(spec.pan, 0),
      mute: false,
      solo: false,
      insert: Number.isInteger(spec.insert) ? spec.insert : this.freeInsert()
    };
    this.data.channels.push(ch);
    if (ch.insert > 0) {
      const strip = this.data.mixer[ch.insert];
      if (strip && /^Insert \d+$/.test(strip.name)) strip.name = ch.name;
    }
    return ch;
  }

  /** The first insert nothing plays through yet, else the master. */
  freeInsert() {
    const used = new Set(this.data.channels.map((c) => c.insert));
    for (let i = 1; i <= INSERTS; i++) if (!used.has(i)) return i;
    return 0;
  }

  removeChannel(id) {
    this.data.channels = this.data.channels.filter((c) => c.id !== id);
    for (const p of this.data.patterns) delete p.notes[id];
    if (this.data.current.channel === id) this.data.current.channel = this.data.channels[0]?.id ?? null;
  }

  duplicateChannel(id) {
    const src = this.channel(id);
    if (!src) return null;
    const copy = this.addChannel({ ...src, name: `${src.name} 2`, insert: src.insert });
    for (const p of this.data.patterns) {
      if (p.notes[id]) p.notes[copy.id] = p.notes[id].map((n) => ({ ...n, id: this.id('n') }));
    }
    // Keep it next to the original.
    const list = this.data.channels;
    list.splice(list.indexOf(copy), 1);
    list.splice(list.indexOf(src) + 1, 0, copy);
    return copy;
  }

  moveChannel(id, by) {
    const list = this.data.channels;
    const i = list.findIndex((c) => c.id === id);
    const j = clamp(i + by, 0, list.length - 1);
    if (i < 0 || i === j) return;
    const [c] = list.splice(i, 1);
    list.splice(j, 0, c);
  }

  /** Channels that sound: soloed ones if any are, else every unmuted one. */
  audible(channel) {
    const soloing = this.data.channels.some((c) => c.solo);
    return soloing ? channel.solo : !channel.mute;
  }

  /* --------------------------------- patterns -------------------------------- */

  addPattern(name) {
    const n = this.data.patterns.length + 1;
    const p = { id: this.id('p'), name: name ?? `Pattern ${n}`, bars: 1, notes: {} };
    this.data.patterns.push(p);
    return p;
  }

  clonePattern(id) {
    const src = this.pattern(id);
    if (!src) return null;
    const p = this.addPattern(`${src.name} copy`);
    p.bars = src.bars;
    for (const [cid, list] of Object.entries(src.notes)) p.notes[cid] = list.map((n) => ({ ...n, id: this.id('n') }));
    return p;
  }

  removePattern(id) {
    if (this.data.patterns.length <= 1) return false;
    this.data.patterns = this.data.patterns.filter((p) => p.id !== id);
    this.data.playlist.clips = this.data.playlist.clips.filter((c) => c.pattern !== id);
    if (this.data.current.pattern === id) this.data.current.pattern = this.data.patterns[0].id;
    return true;
  }

  steps(pattern) {
    return pattern.bars * STEPS_PER_BAR;
  }

  setBars(patternId, bars) {
    const p = this.pattern(patternId);
    if (p && PATTERN_BARS.includes(bars)) p.bars = bars;
  }

  /** A pattern's notes for one channel (an empty list if it has none yet). */
  notes(patternId, channelId) {
    const p = this.pattern(patternId);
    if (!p) return [];
    if (!p.notes[channelId]) p.notes[channelId] = [];
    return p.notes[channelId];
  }

  addNote(patternId, channelId, { start, length = 1, midi = ROOT, velocity = 0.8, muted = false }) {
    const note = {
      id: this.id('n'),
      start: Math.max(0, num(start, 0)),
      length: Math.max(0.125, num(length, 1)),
      midi: clamp(Math.round(num(midi, ROOT)), NOTE_LOW, NOTE_HIGH),
      velocity: clamp(num(velocity, 0.8), 0.05, 1)
    };
    if (muted === true) note.muted = true; // shown in the piano roll, never played
    this.notes(patternId, channelId).push(note);
    return note;
  }

  removeNotes(patternId, channelId, ids) {
    const p = this.pattern(patternId);
    if (!p?.notes[channelId]) return;
    const drop = new Set(ids);
    p.notes[channelId] = p.notes[channelId].filter((n) => !drop.has(n.id));
  }

  /** Is there a note starting on this step? */
  hasStep(patternId, channelId, step) {
    return this.notes(patternId, channelId).some((n) => Math.abs(n.start - step) < 1e-6);
  }

  /** The Channel Rack's step button: add a note at the root, or remove what starts there. */
  toggleStep(patternId, channelId, step, on = null) {
    const has = this.hasStep(patternId, channelId, step);
    const want = on ?? !has;
    if (want && !has) this.addNote(patternId, channelId, { start: step, length: 1, midi: ROOT });
    else if (!want && has) {
      const ids = this.notes(patternId, channelId).filter((n) => Math.abs(n.start - step) < 1e-6).map((n) => n.id);
      this.removeNotes(patternId, channelId, ids);
    }
    return want;
  }

  /** Clear a channel in a pattern and put a step every `every` steps (FL's "fill each N steps"). */
  fillSteps(patternId, channelId, every) {
    const p = this.pattern(patternId);
    if (!p) return;
    p.notes[channelId] = [];
    for (let s = 0; s < this.steps(p); s += every) this.addNote(patternId, channelId, { start: s });
  }

  /** Shows as steps (every note a short hit at the root) or needs the piano roll to show it. */
  isSteps(patternId, channelId) {
    return this.notes(patternId, channelId).every((n) => n.midi === ROOT && n.length <= 1 && Number.isInteger(n.start));
  }

  /* --------------------------------- playlist -------------------------------- */

  addClip({ track, pattern, start, length }) {
    const p = this.pattern(pattern);
    if (!p) return null;
    const clip = {
      id: this.id('k'),
      track: clamp(Math.round(num(track, 0)), 0, this.data.playlist.tracks - 1),
      pattern,
      start: Math.max(0, num(start, 0)),
      length: Math.max(1, num(length, this.steps(p)))
    };
    this.data.playlist.clips.push(clip);
    return clip;
  }

  removeClip(id) {
    this.data.playlist.clips = this.data.playlist.clips.filter((c) => c.id !== id);
  }

  clipAt(track, step) {
    const clips = this.data.playlist.clips;
    for (let i = clips.length - 1; i >= 0; i--) {
      const c = clips[i];
      if (c.track === track && step >= c.start && step < c.start + c.length) return c;
    }
    return null;
  }

  /** The song's length in steps: to the end of the last clip, in whole bars (one bar if empty). */
  get songSteps() {
    const end = this.data.playlist.clips.reduce((m, c) => Math.max(m, c.start + c.length), 0);
    return Math.max(STEPS_PER_BAR, Math.ceil(end / STEPS_PER_BAR - 1e-9) * STEPS_PER_BAR);
  }

  /** How long one cycle of the transport is: the pattern, or the song. */
  period(mode = this.data.mode) {
    if (mode === 'song') return this.songSteps;
    const p = this.currentPattern;
    return p ? this.steps(p) : STEPS_PER_BAR;
  }

  /* ---------------------------------- beats ---------------------------------- */

  /** The drum channel for a drum type, made (on the beat's kit) if there isn't one. */
  drumChannel(drum, kit) {
    let ch = this.data.channels.find((c) => c.kind === 'drum' && c.drum === drum);
    if (!ch) ch = this.addChannel({ kind: 'drum', drum, kit });
    return ch;
  }

  /**
   * Write one of the built-in beats into a pattern: its drums onto drum channels
   * (made if missing, all switched to the beat's kit), replacing what they had.
   * An accented hat is an open hat; a roll is two hits in the step.
   */
  applyBeat(patternId, name) {
    const beat = BEATS[name];
    const p = this.pattern(patternId);
    if (!beat || !p) return;
    const parts = ['kick', 'snare', 'clap', 'hat', 'crash'].filter((part) => beat[part]);
    const steps = Math.max(...parts.map((part) => beat[part].length));
    p.bars = Math.max(1, steps / STEPS_PER_BAR);
    const used = new Set(parts);
    if (parts.includes('hat') && beat.hat.includes('o')) used.add('openhat');
    for (const drum of used) {
      const ch = this.drumChannel(drum, beat.kit);
      ch.kit = beat.kit;
      p.notes[ch.id] = [];
    }
    for (const part of parts) {
      const pattern = beat[part];
      for (let s = 0; s < steps; s++) {
        const c = pattern[s % pattern.length];
        if (c === '.') continue;
        const drum = part === 'hat' && c === 'o' ? 'openhat' : part;
        const ch = this.drumChannel(drum, beat.kit);
        if (c === 'r') {
          this.addNote(p.id, ch.id, { start: s, length: 0.5, velocity: 0.6 });
          this.addNote(p.id, ch.id, { start: s + 0.5, length: 0.5, velocity: 0.5 });
        } else this.addNote(p.id, ch.id, { start: s, length: 1, velocity: c === 'o' ? 1 : 0.8 });
      }
    }
    this.data.swing = Math.min(1, (beat.swing ?? 0) * 2); // the beats' swing is a fraction of a step
  }

  /* ----------------------------------- undo ---------------------------------- */

  snapshot() {
    return JSON.stringify(this.data);
  }

  checkpoint() {
    this.past.push(this.snapshot());
    if (this.past.length > HISTORY) this.past.shift();
    this.future = [];
  }

  /** Drop the last checkpoint if what followed it changed nothing. */
  settle() {
    if (this.past.length && this.past[this.past.length - 1] === this.snapshot()) this.past.pop();
  }

  undo() {
    if (!this.past.length) return false;
    this.future.push(this.snapshot());
    this.data = JSON.parse(this.past.pop());
    return true;
  }

  redo() {
    if (!this.future.length) return false;
    this.past.push(this.snapshot());
    this.data = JSON.parse(this.future.pop());
    return true;
  }

  toJSON() {
    return this.data;
  }
}

/**
 * Read a saved song, keeping only what makes sense: unknown sounds fall back to
 * defaults, numbers are clamped, notes pointing at missing channels are dropped.
 * Throws if it isn't a song at all.
 */
export function loadSong(raw) {
  const d = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!d || typeof d !== 'object' || !Array.isArray(d.channels) || !Array.isArray(d.patterns)) {
    throw new Error('not a PRISM song');
  }
  if (d.version > VERSION) throw new Error('this song was saved by a newer PRISM');
  const song = new Song({
    version: VERSION,
    name: typeof d.name === 'string' ? d.name.slice(0, 80) : 'Untitled',
    bpm: clamp(num(d.bpm, 130), 40, 240),
    swing: clamp(num(d.swing, 0), 0, 1),
    nextId: 1,
    channels: [],
    patterns: [],
    playlist: { tracks: PLAYLIST_TRACKS, clips: [] },
    mixer: defaultMixer(),
    current: { pattern: null, channel: null },
    mode: d.mode === 'song' ? 'song' : 'pattern',
    position: Math.max(0, num(d.position, 0))
  });
  const ids = new Map(); // old id -> new id
  for (const c of d.channels) {
    const ch = song.addChannel({ ...c, insert: Number.isInteger(c.insert) ? clamp(c.insert, 0, INSERTS) : undefined });
    ch.name = typeof c.name === 'string' && c.name ? c.name.slice(0, 40) : ch.name;
    ch.volume = clamp(num(c.volume, 0.8), 0, 1);
    ch.pan = clamp(num(c.pan, 0), -1, 1);
    ch.mute = !!c.mute;
    ch.solo = !!c.solo;
    for (const k of ['tone', 'attack', 'release']) ch.shape[k] = clamp(num(c.shape?.[k], 0.5), 0, 1);
    ids.set(c.id, ch.id);
  }
  for (const p of d.patterns) {
    const np = song.addPattern(typeof p.name === 'string' ? p.name.slice(0, 40) : undefined);
    np.bars = PATTERN_BARS.includes(p.bars) ? p.bars : 1;
    for (const [cid, list] of Object.entries(p.notes ?? {})) {
      const to = ids.get(cid);
      if (!to || !Array.isArray(list)) continue;
      for (const n of list) if ([n.start, n.length, n.midi].every(Number.isFinite)) song.addNote(np.id, to, n);
    }
    ids.set(p.id, np.id);
  }
  if (!song.data.patterns.length) song.addPattern();
  for (const c of d.playlist?.clips ?? []) {
    const pattern = ids.get(c.pattern);
    if (pattern) song.addClip({ ...c, pattern });
  }
  if (Array.isArray(d.mixer)) {
    d.mixer.slice(0, INSERTS + 1).forEach((t, i) => {
      const strip = song.data.mixer[i];
      if (typeof t?.name === 'string' && t.name) strip.name = t.name.slice(0, 24);
      strip.volume = clamp(num(t?.volume, strip.volume), 0, 1);
      strip.pan = clamp(num(t?.pan, 0), -1, 1);
      strip.mute = !!t?.mute;
      strip.solo = !!t?.solo;
      for (const k of Object.keys(strip.fx)) strip.fx[k] = clamp(num(t?.fx?.[k], strip.fx[k]), 0, 1);
    });
  }
  song.data.current = {
    pattern: ids.get(d.current?.pattern) ?? song.data.patterns[0].id,
    channel: ids.get(d.current?.channel) ?? song.data.channels[0]?.id ?? null
  };
  // What a beat generator made: its seed, key and which channels and patterns it wrote.
  if (d.gen && typeof d.gen === 'object' && typeof d.gen.style === 'string') {
    const remap = (o) => Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => ids.has(v)).map(([k, v]) => [k, ids.get(v)]));
    song.data.gen = {
      style: d.gen.style.slice(0, 20),
      seed: num(d.gen.seed, 1),
      key: clamp(Math.round(num(d.gen.key, 0)), 0, 11),
      scale: typeof d.gen.scale === 'string' ? d.gen.scale.slice(0, 20) : 'phrygian',
      roles: remap(d.gen.roles),
      sections: remap(d.gen.sections)
    };
  }
  return song;
}

/**
 * Every note that starts in [s0, s1) of the transport, in absolute steps. In
 * pattern mode the current pattern loops; in song mode the playlist plays, each
 * clip repeating its pattern for as long as the clip lasts, and the whole song
 * loops. `room` is how long the note may last before its clip ends.
 */
export function eventsBetween(song, mode, s0, s1) {
  const out = [];
  if (!(s1 > s0)) return out;
  const d = song.data;
  if (mode !== 'song') {
    const p = song.currentPattern;
    if (!p) return out;
    const period = song.steps(p);
    const k0 = Math.floor(s0 / period);
    const k1 = Math.floor((s1 - 1e-9) / period);
    for (let k = k0; k <= k1; k++) {
      for (const [channel, list] of Object.entries(p.notes)) {
        for (const note of list) {
          if (note.start >= period || note.muted) continue;
          const step = k * period + note.start;
          if (step >= s0 && step < s1) out.push({ channel, note, step, room: Infinity });
        }
      }
    }
  } else {
    const period = song.songSteps;
    const k0 = Math.floor(s0 / period);
    const k1 = Math.floor((s1 - 1e-9) / period);
    for (let k = k0; k <= k1; k++) {
      for (const clip of d.playlist.clips) {
        const p = song.pattern(clip.pattern);
        if (!p) continue;
        const pl = song.steps(p);
        const base = k * period + clip.start;
        const end = base + clip.length;
        if (end <= s0 || base >= s1) continue;
        const r0 = Math.max(0, Math.floor((s0 - base) / pl));
        for (let r = r0; base + r * pl < Math.min(end, s1); r++) {
          for (const [channel, list] of Object.entries(p.notes)) {
            for (const note of list) {
              if (note.start >= pl || note.muted) continue;
              const step = base + r * pl + note.start;
              if (step >= end) continue;
              if (step >= s0 && step < s1) out.push({ channel, note, step, room: end - step });
            }
          }
        }
      }
    }
  }
  return out.sort((a, b) => a.step - b.step);
}

/** Swing: every second sixteenth is pushed late, up to half a step at full swing. */
export function swingOffset(step, swing) {
  const s = Math.round(step);
  return Math.abs(step - s) < 1e-6 && s % 2 === 1 ? swing * 0.5 : 0;
}

/** "bar:beat:step", counting from 1, as FL's song position shows it. */
export function formatPosition(step) {
  const s = Math.max(0, Math.floor(step + 1e-6));
  return `${Math.floor(s / 16) + 1}:${Math.floor((s % 16) / 4) + 1}:${(s % 4) + 1}`;
}
