/**
 * Just-intonation frequency ratios.
 *
 * Equal temperament only approximates the small-integer ratios the ear hears as
 * consonant (a tempered fifth is 1.4983, a just one exactly 3/2). The harmonic curve
 * modes draw the just ratio, because that is the figure the interval is "trying" to
 * be: integer ratios close into clean Lissajous loops.
 */

import { pitchClass, NOTE_NAMES } from './circle.js';
import { nameChord } from './chords.js';

/** [numerator, denominator] above the root, indexed by semitones 0..11. */
const JUST = [
  [1, 1], [16, 15], [9, 8], [6, 5], [5, 4], [4, 3],
  [7, 5], [3, 2], [8, 5], [5, 3], [16, 9], [15, 8]
];

const INTERVAL_NAMES = [
  'UNISON', 'MINOR SECOND', 'MAJOR SECOND', 'MINOR THIRD', 'MAJOR THIRD', 'PERFECT FOURTH',
  'TRITONE', 'PERFECT FIFTH', 'MINOR SIXTH', 'MAJOR SIXTH', 'MINOR SEVENTH', 'MAJOR SEVENTH'
];

export function gcd(a, b) {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

const lcm = (a, b) => (a / gcd(a, b)) * b;

/** Just ratio for an interval of `semitones` (>= 0), compound intervals included. */
export function ratioForSemitones(semitones) {
  const n = Math.max(0, Math.round(semitones));
  const octaves = Math.floor(n / 12);
  let [p, q] = JUST[n % 12];
  p *= 2 ** octaves;
  const g = gcd(p, q);
  return [p / g, q / g];
}

/**
 * Integer frequency ratios for a set of notes, lowest first, reduced so they share
 * no common factor. C E G -> [4, 5, 6]; C G -> [2, 3].
 */
export function chordRatios(midis) {
  const sorted = [...new Set(midis)].sort((a, b) => a - b);
  if (!sorted.length) return [];
  const fractions = sorted.map((m) => ratioForSemitones(m - sorted[0]));
  const denominator = fractions.reduce((acc, [, q]) => lcm(acc, q), 1);
  const ints = fractions.map(([p, q]) => p * (denominator / q));
  const g = ints.reduce((acc, v) => gcd(acc, v), ints[0]);
  return ints.map((v) => v / g);
}

/** "THE PERFECT FIFTH" for two notes a fifth apart. */
export function intervalTitle(lowMidi, highMidi) {
  const n = Math.abs(highMidi - lowMidi);
  if (n === 0) return 'A SINGLE TONE';
  if (n % 12 === 0) return n === 12 ? 'THE OCTAVE' : `${n / 12} OCTAVES`;
  return `THE ${INTERVAL_NAMES[n % 12]}`;
}

/** "A MAJOR CHORD" — English article included, since "an" chords exist too. */
export function chordTitle(midis) {
  const chord = nameChord(midis);
  if (!chord) return 'A MAJOR CHORD';
  const root = NOTE_NAMES[chord.root];
  const quality = {
    maj: 'MAJOR', m: 'MINOR', '°': 'DIMINISHED', '+': 'AUGMENTED',
    sus4: 'SUSPENDED FOURTH', sus2: 'SUSPENDED SECOND',
    maj7: 'MAJOR SEVENTH', '7': 'DOMINANT SEVENTH', m7: 'MINOR SEVENTH',
    'm7♭5': 'HALF-DIMINISHED', '°7': 'DIMINISHED SEVENTH',
    '6': 'MAJOR SIXTH', m6: 'MINOR SIXTH', add9: 'ADDED NINTH'
  }[chord.quality];
  if (!quality) return `${root} ${chord.quality.toUpperCase()}`.trim();
  return `${/^[AEIOU]/.test(quality) ? 'AN' : 'A'} ${quality} CHORD`;
}

export { pitchClass };
