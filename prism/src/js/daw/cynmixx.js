/**
 * One click, a whole beat: a Cynmixx-type hoodtrap song, arranged and mixed.
 *
 * What makes the sound (from listening to and reading about prodbyCyn's "mixx"
 * beats and the DJ Ess / kltekk scene they come from):
 *
 *   tempo     140–150 BPM
 *   key       Phrygian: the flat second sits a half step over the root, and
 *             the melodies lean on the half steps (1–♭2 and 5–♭6)
 *   snare     the hoodtrap bounce: hits on steps 1, 7 and 13 of the first bar,
 *             only the last two in the second, with quiet ghost notes between and
 *             a snap layered on
 *   808       clipped and punchy, landing with the first snare hits, root and ♭2,
 *             sliding and jumping octaves
 *   around it claps on 2 and 4, open hats with the 808s, a "hey" chant, Jersey
 *             bounce percs, risers into the hook
 *   synths    a dirty hollow arp down low; a gliding lead whose catchy half-step
 *             line goes up an octave the second time round; brass stabs or
 *             trembling strings under the hook
 *   form      Intro, Hook, Verse, Breakdown (claps on every beat, the melody
 *             chopped), Hook: the same parts, layers in and out
 *
 * Everything comes from a seed, so the same seed makes the same beat (and the
 * tests can check it). "New melody" rewrites the melodic parts with a fresh seed
 * and leaves the drums alone; "New drums" does the reverse.
 */

import { emptySong, ROOT, STEPS_PER_BAR } from './model.js';
import { SCALES } from '../studio/sounds.js';

export const STYLE = 'cynmixx';
export const SECTIONS = ['intro', 'hook', 'verse', 'breakdown'];
export const SECTION_LABELS = { intro: 'Intro', hook: 'Hook', verse: 'Verse', breakdown: 'Breakdown' };
export const SECTION_BARS = 4;
export const TEMPOS = [144, 146, 148, 150];

/** The song's form: [section, first bar, bars]. Each section's pattern is 4 bars. */
export const ARRANGEMENT = [
  ['intro', 0, 4],
  ['hook', 4, 8],
  ['verse', 12, 8],
  ['breakdown', 20, 4],
  ['hook', 24, 8]
];

/** The signature snare: steps 1, 7, 13 of bar one; 7 and 13 of bar two (0-based). */
export const BOUNCE = [0, 6, 12, 22, 28];
export const CLAPS = [4, 12, 20, 28];

const MELODIC = ['bass', 'arp', 'lead', 'counter'];
const DRUM_ROLES = ['kick', 'snare', 'snap', 'clap', 'chant', 'hat', 'openhat', 'perc', 'crash', 'riser'];
const PHRYGIAN = SCALES.phrygian.steps;
const PHRASE = 2 * STEPS_PER_BAR;            // the 2-bar phrase everything is built from
const LENGTH = SECTION_BARS * STEPS_PER_BAR; // one section's pattern

/** Seeded random numbers in [0, 1) (mulberry32): small, fast, and the same every time. */
export function random(seed) {
  let a = (Number(seed) >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (r, list) => list[Math.floor(r() * list.length)];
const chance = (r, p) => r() < p;

/** A shuffled copy (Fisher–Yates). */
function shuffle(r, list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Semitones above the tonic for a Phrygian scale degree (0 = root, 1 = ♭2, 7 = the octave, -2 = ♭6 below). */
export function degree(d) {
  return PHRYGIAN[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7);
}

/* ---------------------------------- drums ---------------------------------- */

const hit = (start, velocity = 0.8, length = 1) => ({ start, length, velocity, midi: ROOT });

/** Repeat a 2-bar phrase over a section, shifting each copy along. */
function twice(list, offset = PHRASE) {
  return [...list, ...list.map((n) => ({ ...n, start: n.start + offset }))];
}

/** A hat roll on a step: two quick hits, or three (a triplet). */
function roll(step, triplet) {
  const n = triplet ? 3 : 2;
  return Array.from({ length: n }, (_, i) => hit(step + i / n, 0.5 - i * 0.06, 1 / n));
}

/** The drums for each section: { section: { role: [notes] } }. */
export function writeDrums(r) {
  const ghosts = shuffle(r, [3, 9, 10, 15, 19, 25, 26]).slice(0, 3 + Math.floor(r() * 2)).sort((a, b) => a - b);
  const rollSpots = shuffle(r, [7, 14, 15, 23, 30, 31]).slice(0, 2);
  const triplets = chance(r, 0.5);
  const percRow = pick(r, ['...x..x...x..x..', '..x..x....x..x.x', '...x..x..x..x...']);
  const extraKick = chance(r, 0.4);

  const kick = [hit(0, 0.95), hit(22, 0.9), ...(extraKick ? [hit(10, 0.7)] : [])];
  const snare = BOUNCE.map((s) => hit(s, 0.95));
  const ghostNotes = ghosts.map((s) => hit(s, 0.22 + r() * 0.12));
  const snap = BOUNCE.map((s) => hit(s, 0.7));
  const clap = CLAPS.map((s) => hit(s, 0.85));
  const openhat = [hit(6, 0.7), hit(22, 0.7)];
  const hatsOn = (rolls) => {
    const out = [];
    for (let s = 0; s < PHRASE; s++) {
      if (rolls.includes(s)) out.push(...roll(s, triplets));
      else if (s % 2 === 0 && s !== 6 && s !== 22) out.push(hit(s, s % 4 === 0 ? 0.75 : 0.55));
    }
    return out;
  };
  const perc = [];
  for (let s = 0; s < PHRASE; s++) if (percRow[s % 16] === 'x') perc.push(hit(s, 0.5 + (s % 16 === 3 ? 0.15 : 0)));

  // Hook: everything. Bar four ends on a hat fill and a ghost roll into the next round.
  const fill = [56, 58, 60, 62].flatMap((s) => roll(s, triplets && s >= 60));
  const hook = {
    kick: twice(kick),
    snare: [...twice([...snare, ...ghostNotes]), hit(62, 0.3), hit(63, 0.4)],
    snap: twice(snap),
    clap: twice(clap),
    chant: [hit(28, 0.85), hit(60, 0.9)],
    hat: [...hatsOn(rollSpots), ...hatsOn([]).filter((n) => n.start < 24).map((n) => ({ ...n, start: n.start + PHRASE })), ...fill],
    openhat: twice(openhat),
    perc: twice(perc),
    crash: [hit(0, 0.8)],
    riser: []
  };
  // Verse: the bounce without the extras, so there's room for vocals.
  const verse = {
    kick: twice(kick),
    snare: twice(snare),
    snap: [],
    clap: twice(clap),
    chant: [],
    hat: twice(hatsOn(rollSpots.slice(0, 1))),
    openhat: twice(openhat),
    perc: [],
    crash: [],
    riser: []
  };
  // Breakdown: a clap on every beat, the chant, a riser into the hook.
  const breakdown = {
    kick: [hit(0, 0.9), hit(32, 0.9)],
    snare: [],
    snap: [],
    clap: Array.from({ length: LENGTH / 4 }, (_, i) => hit(i * 4, i % 4 === 0 ? 0.9 : 0.75)),
    chant: [hit(0, 0.85), hit(32, 0.85)],
    hat: [],
    openhat: [],
    perc: [],
    crash: [hit(0, 0.6)],
    riser: [hit(48, 0.9)]
  };
  // Intro: the melody alone, hats creeping in, then the riser and a "hey".
  const intro = {
    kick: [],
    snare: [],
    snap: [],
    clap: [],
    chant: [hit(60, 0.9)],
    hat: hatsOn([]).map((n) => ({ ...n, start: n.start + PHRASE, velocity: n.velocity * 0.7 })),
    openhat: [],
    perc: [],
    crash: [],
    riser: [hit(48, 0.9)]
  };
  return { intro, hook, verse, breakdown };
}

/* --------------------------------- melody ---------------------------------- */

const ARP_RHYTHMS = ['x.xx.xx.x.xx.xx.', 'x.x.xx.xx.x.xx.x', 'xx.x.xx.xx.x.xx.', 'x..x..x.x..x..x.', 'x.xxx.x.x.xxx.x.'];
const ARP_CELLS = [[0, 1, 4, 5], [4, 5, 4, 0], [7, 5, 4, 1], [0, 4, 5, 1], [0, 1, 0, 4, 5], [4, 5, 7, 5], [0, 7, 5, 4, 1]];
/** Lead rhythms over a 2-bar phrase: [start, length]. */
const LEAD_RHYTHMS = [
  [[0, 3], [3, 3], [6, 4], [10, 2], [12, 4], [16, 3], [19, 3], [22, 6], [28, 4]],
  [[0, 2], [2, 2], [4, 4], [8, 2], [10, 6], [16, 2], [18, 2], [20, 4], [24, 8]],
  [[0, 6], [6, 6], [12, 4], [16, 6], [22, 4], [26, 2], [28, 4]],
  [[2, 2], [4, 2], [6, 4], [10, 2], [12, 4], [18, 2], [20, 2], [22, 4], [26, 6]],
  [[0, 3], [3, 3], [6, 2], [8, 4], [12, 4], [16, 3], [19, 3], [22, 2], [24, 8]]
];
/** Chords under each bar of the phrase, as scale degrees of the root: i–♭II, i–♭VI, i–♭VII. */
const PROGRESSIONS = [[0, 1], [0, -2], [0, 1], [0, -1]];

/** The arp: a short cell of half-step-heavy notes on a syncopated 16th rhythm, moving with the chords. */
function arpPhrase(r, prog) {
  const rhythm = pick(r, ARP_RHYTHMS);
  const cell = pick(r, ARP_CELLS);
  const out = [];
  let n = 0;
  for (let s = 0; s < PHRASE; s++) {
    if (rhythm[s % 16] !== 'x') continue;
    const bar = Math.floor(s / 16);
    if (s % 16 === 0) n = 0;
    out.push({ start: s, length: 1, degree: cell[n % cell.length] + prog[bar], velocity: s % 4 === 0 ? 0.85 : 0.65 });
    n++;
  }
  return out;
}

/**
 * The lead: a short catchy line that walks by half steps around the root and
 * the fifth. Bar two answers bar one: the same start, a different ending, home.
 * Neighbouring notes overlap now and then, so the mono lead glides between them.
 */
function leadPhrase(r) {
  const rhythm = pick(r, LEAD_RHYTHMS);
  const anchors = [0, 4, 4, 1];
  let d = pick(r, anchors);
  const first = [];
  const firstBar = rhythm.filter(([s]) => s < 16);
  for (let i = 0; i < firstBar.length; i++) {
    first.push(d);
    const x = r();
    if (x < 0.3) d += 1;
    else if (x < 0.6) d -= 1;
    else if (x >= 0.75) d = pick(r, anchors); // otherwise a repeat, which lands the hook
    d = Math.max(-2, Math.min(5, d));
  }
  const secondBar = rhythm.filter(([s]) => s >= 16);
  const keep = Math.min(first.length, Math.max(1, secondBar.length - 2));
  const second = first.slice(0, keep);
  while (second.length < secondBar.length - 1) second.push(second[second.length - 1] + pick(r, [-1, 1]));
  second.push(pick(r, [0, 0, 4, 1])); // home, or hanging on the dark ♭2
  const degrees = [...first, ...second];
  return rhythm.map(([start, length], i) => {
    const next = rhythm[i + 1];
    let len = length - 0.25;
    if (next && next[0] === start + length && chance(r, 0.45)) len = length + 0.5; // overlap: glide
    return { start, length: len, degree: degrees[i], velocity: i === 0 || start % 16 === 0 ? 0.9 : 0.75 };
  });
}

/** The 808: with the snare bounce, root and ♭2, an octave jump or two, and slides. */
function bassPhrase(r, prog) {
  const out = [];
  for (let i = 0; i < BOUNCE.length; i++) {
    const s = BOUNCE[i];
    const bar = Math.floor(s / 16);
    const next = BOUNCE[i + 1] ?? PHRASE;
    let d = prog[bar];
    let octave = 0;
    if (i === 1 && chance(r, 0.45)) octave = 1;
    if (i === 2 && chance(r, 0.5)) d = prog[bar] + 1; // the ♭2 bump
    if (i === 4 && chance(r, 0.4)) d = prog[bar] + pick(r, [1, -1]);
    const slide = i < BOUNCE.length - 1 && chance(r, 0.35);
    out.push({ start: s, length: slide ? next - s + 0.5 : Math.min(next - s, 8) - 0.25, degree: d + octave * 7, velocity: 0.95 });
  }
  return out;
}

/** Brass stabs on the bounce, or trembling strings held through each bar: triads in the scale. */
function counterPhrase(kind, prog) {
  const triad = (d) => [d, d + 2, d + 4];
  const out = [];
  if (kind === 'brass') {
    for (const s of BOUNCE) {
      const bar = Math.floor(s / 16);
      for (const d of triad(prog[bar])) out.push({ start: s, length: 2, degree: d, velocity: 0.75 });
    }
  } else {
    for (let bar = 0; bar < 2; bar++) for (const d of triad(prog[bar])) out.push({ start: bar * 16, length: 15.75, degree: d, velocity: 0.6 });
  }
  return out;
}

/** Cut held notes into sixteenths, on and off: the breakdown's chopped melody. */
export function chop(notes) {
  const out = [];
  for (const n of notes) {
    for (let s = Math.ceil(n.start); s < n.start + Math.min(n.length, 8); s += 2) out.push({ ...n, start: s, length: 1 });
  }
  return out;
}

/**
 * The melodic parts for each section, as scale degrees: { section: { role: [notes] } }.
 * `counter` is 'brass' or 'strings'.
 */
export function writeMelody(r, counter) {
  const prog = pick(r, PROGRESSIONS);
  const arp = arpPhrase(r, prog);
  const lead = leadPhrase(r);
  const bass = bassPhrase(r, prog);
  const pad = counterPhrase(counter, prog);
  const up = (list, by) => list.map((n) => ({ ...n, degree: n.degree + by }));
  const at = (list, offset) => list.map((n) => ({ ...n, start: n.start + offset }));
  const leadHook = [...lead, ...at(up(lead, 7), PHRASE)]; // the second time round, an octave up
  return {
    intro: { arp: twice(arp), lead: at(lead, PHRASE), counter: counter === 'strings' ? twice(pad) : [], bass: [] },
    hook: { arp: twice(arp), lead: leadHook, counter: twice(pad), bass: twice(bass) },
    verse: { arp: twice(arp), lead: [], counter: [], bass: twice(bass) },
    breakdown: { arp: [], lead: chop(twice(lead)), counter: counter === 'strings' ? twice(pad) : [], bass: [{ start: 0, length: 15.5, degree: 0, velocity: 0.9 }, { start: 32, length: 15.5, degree: prog[1], velocity: 0.9 }] }
  };
}

/** Where each melodic part sits, in semitones over the tonic (the 808's sound sits an octave under what's written). */
const REGISTER = { bass: 0, arp: 12, lead: 12, counter: 12 };

/** The tonic for a key (pitch class): F♯2 up to F3, so every key sits in about the same place. */
export const tonicOf = (key) => 42 + ((((key - 6) % 12) + 12) % 12);

const toMidi = (key, role, n) => ({ start: n.start, length: n.length, velocity: n.velocity, midi: tonicOf(key) + REGISTER[role] + degree(n.degree) });

/* ----------------------------------- song ---------------------------------- */

/** Replace a channel's notes in a pattern. */
function put(song, patternId, channelId, notes) {
  const p = song.pattern(patternId);
  if (!p || !song.channel(channelId)) return;
  p.notes[channelId] = [];
  for (const n of notes) song.addNote(patternId, channelId, n);
}

/** Write the melodic parts (from `seed`) into a generated song's sections. */
export function applyMelody(song, seed) {
  const gen = song.data.gen;
  const counter = song.channel(gen.roles.counter)?.sound === 'tremstr' ? 'strings' : 'brass';
  const parts = writeMelody(random(seed), counter);
  for (const section of SECTIONS) {
    for (const role of MELODIC) {
      put(song, gen.sections[section], gen.roles[role], parts[section][role].map((n) => toMidi(gen.key, role, n)));
    }
  }
}

/** Write the drums (from `seed`) into a generated song's sections. */
export function applyDrums(song, seed) {
  const gen = song.data.gen;
  const parts = writeDrums(random(seed));
  for (const section of SECTIONS) for (const role of DRUM_ROLES) put(song, gen.sections[section], gen.roles[role], parts[section][role]);
}

/** Can this song be re-rolled: was it made here, and are its sections still there? */
export function isGenerated(song) {
  const gen = song.data.gen;
  return !!gen && gen.style === STYLE && SECTIONS.some((s) => song.pattern(gen.sections?.[s]));
}

/**
 * A whole Cynmixx-type beat: channels on the hood kit and sounds, a mixed
 * mixer, four sections and the arrangement in the playlist, in song mode.
 */
export function makeCynmixx({ seed = Date.now(), key, bpm } = {}) {
  const r = random(seed);
  key = Number.isInteger(key) ? ((key % 12) + 12) % 12 : Math.floor(r() * 12);
  bpm = Number.isFinite(bpm) ? bpm : pick(r, TEMPOS);
  const counterKind = chance(r, 0.5) ? 'brass' : 'strings';
  const song = emptySong('Cynmixx type beat', bpm);

  const drum = (drumName, insert, volume, extra = {}) => song.addChannel({ kind: 'drum', drum: drumName, kit: 'hood', insert, volume, ...extra }).id;
  const synth = (sound, name, insert, volume, extra = {}) => song.addChannel({ kind: 'synth', sound, name, insert, volume, ...extra }).id;
  const roles = {
    kick: drum('kick', 1, 0.75),
    snare: drum('snare', 2, 0.8),
    snap: drum('snap', 2, 0.55),
    clap: drum('clap', 3, 0.65),
    chant: drum('chant', 3, 0.6),
    hat: drum('hat', 4, 0.6),
    openhat: drum('openhat', 4, 0.45),
    perc: drum('perc', 4, 0.5, { pan: 0.25 }),
    crash: drum('crash', 5, 0.45),
    riser: drum('riser', 5, 0.55),
    bass: synth('spinz808', '808', 6, 0.8),
    arp: synth('hollow', 'Arp', 7, 0.7),
    lead: synth('glider', 'Lead', 8, 0.65),
    counter: synth(counterKind === 'brass' ? 'globrass' : 'tremstr', counterKind === 'brass' ? 'Brass' : 'Strings', 8, 0.5, { pan: -0.15 })
  };

  const sections = {};
  for (const s of SECTIONS) {
    const p = song.addPattern(SECTION_LABELS[s]);
    p.bars = SECTION_BARS;
    sections[s] = p.id;
  }
  song.data.gen = { style: STYLE, seed, key, scale: 'phrygian', roles, sections };
  applyDrums(song, seed);
  applyMelody(song, seed + 1);

  // The arrangement: one track per section, FL style.
  const track = { intro: 0, hook: 1, verse: 2, breakdown: 3 };
  for (const [s, bar, bars] of ARRANGEMENT) {
    song.addClip({ track: track[s], pattern: sections[s], start: bar * STEPS_PER_BAR, length: bars * STEPS_PER_BAR });
  }

  // The mix: a clipped 808, cracking snares, the melodies in echo and hall, a touch of clip on the master.
  const mixer = song.data.mixer;
  const set = (i, name, fx, volume) => {
    mixer[i].name = name;
    Object.assign(mixer[i].fx, fx);
    if (volume !== undefined) mixer[i].volume = volume;
  };
  set(0, 'Master', { clip: 0.12 });
  set(1, 'Kick', { clip: 0.15 });
  set(2, 'Snare', { clip: 0.25, space: 0.08 });
  set(3, 'Clap', { space: 0.15 });
  set(4, 'Hats', {});
  set(5, 'FX', { space: 0.35 }, 0.7);
  set(6, '808', { clip: 0.3 });
  set(7, 'Arp', { echo: 0.18, space: 0.2 });
  set(8, 'Lead', { echo: 0.25, space: 0.3 });

  song.data.mode = 'song';
  song.data.position = 0;
  song.data.current = { pattern: sections.hook, channel: roles.lead };
  song.past = [];
  return song;
}
