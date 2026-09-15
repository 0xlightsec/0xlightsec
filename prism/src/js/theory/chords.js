/** Chord and interval naming, for the heads-up readout. */

import { NOTE_NAMES, pitchClass } from './circle.js';

const QUALITIES = [
  { iv: [0, 4, 7], name: '' },
  { iv: [0, 3, 7], name: 'm' },
  { iv: [0, 3, 6], name: '°' },
  { iv: [0, 4, 8], name: '+' },
  { iv: [0, 5, 7], name: 'sus4' },
  { iv: [0, 2, 7], name: 'sus2' },
  { iv: [0, 4, 7, 11], name: 'maj7' },
  { iv: [0, 4, 7, 10], name: '7' },
  { iv: [0, 3, 7, 10], name: 'm7' },
  { iv: [0, 3, 7, 11], name: 'm(maj7)' },
  { iv: [0, 3, 6, 10], name: 'm7♭5' },
  { iv: [0, 3, 6, 9], name: '°7' },
  { iv: [0, 4, 7, 9], name: '6' },
  { iv: [0, 3, 7, 9], name: 'm6' },
  { iv: [0, 2, 4, 7], name: 'add9' },
  { iv: [0, 4, 7, 10, 2], name: '9' },
  { iv: [0, 4, 7, 11, 2], name: 'maj9' },
  { iv: [0, 3, 7, 10, 2], name: 'm9' },
  { iv: [0, 4, 7, 10, 5], name: '11' },
  { iv: [0, 4, 7, 10, 9], name: '13' },
  { iv: [0, 4, 7, 10, 1], name: '7♭9' },
  { iv: [0, 4, 7, 10, 3], name: '7♯9' },
  { iv: [0, 4, 6, 10], name: '7♭5' },
  { iv: [0, 4, 8, 10], name: '7♯5' }
];

const INTERVALS = [
  'unison', 'minor 2nd', 'major 2nd', 'minor 3rd', 'major 3rd', 'perfect 4th',
  'tritone', 'perfect 5th', 'minor 6th', 'major 6th', 'minor 7th', 'major 7th'
];

const key = (set) => [...set].sort((a, b) => a - b).join(',');

const TABLE = new Map();
for (const q of QUALITIES) {
  const k = key(new Set(q.iv.map(pitchClass)));
  if (!TABLE.has(k)) TABLE.set(k, q.name);
}

/**
 * Name a set of sounding midi notes.
 * Returns { name, root, quality, inversion } or null when nothing is sounding.
 */
export function nameChord(midiNotes) {
  if (!midiNotes.length) return null;
  const sorted = [...midiNotes].sort((a, b) => a - b);
  const bass = pitchClass(sorted[0]);
  const pcs = [...new Set(sorted.map(pitchClass))];

  if (pcs.length === 1) {
    return { name: NOTE_NAMES[bass], root: bass, quality: 'note', inversion: false };
  }

  if (pcs.length === 2) {
    const semis = (pcs[1] - pcs[0] + 12) % 12;
    const ic = Math.min(semis, 12 - semis);
    const lowest = pitchClass(sorted[0]);
    const other = pcs.find((p) => p !== lowest) ?? pcs[1];
    const label = semis === 7 || (12 - semis) === 7 ? '5' : INTERVALS[ic];
    return {
      name: `${NOTE_NAMES[lowest]}${NOTE_NAMES[other] ? '–' + NOTE_NAMES[other] : ''}`,
      root: lowest,
      quality: label,
      inversion: false
    };
  }

  // Try every member as the root; prefer a root that is also the bass.
  let fallback = null;
  for (const root of pcs) {
    const k = key(new Set(pcs.map((p) => (p - root + 12) % 12)));
    const quality = TABLE.get(k);
    if (quality === undefined) continue;
    const hit = {
      name: NOTE_NAMES[root] + quality + (root === bass ? '' : `/${NOTE_NAMES[bass]}`),
      root,
      quality: quality || 'maj',
      inversion: root !== bass
    };
    if (root === bass) return hit;
    if (!fallback) fallback = hit;
  }
  if (fallback) return fallback;

  return {
    name: pcs.sort((a, b) => a - b).map((p) => NOTE_NAMES[p]).join(' '),
    root: bass,
    quality: `${pcs.length}-note cluster`,
    inversion: false
  };
}

export { INTERVALS };
