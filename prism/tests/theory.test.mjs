/** Checks on the Circle of Fifths mapping and the tension -> colour spread. */

import assert from 'node:assert/strict';
import {
  circleIndex, circleDistance, hueFor, fifthsSpan, FIFTHS, angleDelta
} from '../src/js/theory/circle.js';
import { tensionOf, analyze } from '../src/js/theory/harmony.js';
import { nameChord } from '../src/js/theory/chords.js';

let passed = 0;
const check = (label, fn) => {
  try {
    fn();
    passed++;
    console.log(`  ok   ${label}`);
  } catch (err) {
    console.error(`  FAIL ${label}\n       ${err.message}`);
    process.exitCode = 1;
  }
};

const C = 60, Cs = 61, D = 62, Ds = 63, E = 64, F = 65, Fs = 66, G = 67, Gs = 68, A = 69, As = 70, B = 71;
const hueSpread = (midis) => {
  const a = analyze(midis.map((m) => ({ midi: m, weight: 1 })));
  const hues = [...a.colors.values()].map((c) => c.h);
  let max = 0;
  for (let i = 0; i < hues.length; i++)
    for (let j = i + 1; j < hues.length; j++) max = Math.max(max, Math.abs(angleDelta(hues[i], hues[j])));
  return max;
};

console.log('\ncircle of fifths');
check('positions walk in fifths from C', () => {
  FIFTHS.forEach((pc, k) => assert.equal(circleIndex(pc), k));
  assert.deepEqual(FIFTHS.slice(0, 5), [0, 7, 2, 9, 4]);
});
check('distance: C-G = 1, C-F = 1, C-F# = 6', () => {
  assert.equal(circleDistance(0, 7), 1);
  assert.equal(circleDistance(0, 5), 1);
  assert.equal(circleDistance(0, 6), 6);
});
check('adjacent notes get adjacent hues (30 degrees apart)', () => {
  assert.equal(Math.abs(angleDelta(hueFor(0), hueFor(7))), 30);
  assert.equal(Math.abs(angleDelta(hueFor(0), hueFor(6))), 180);
});
check('span: fifth = 1, tritone = 6, chromatic cluster = 7', () => {
  assert.equal(fifthsSpan([0, 7]), 1);
  assert.equal(fifthsSpan([0, 6]), 6);
  assert.equal(fifthsSpan([0, 1, 2]), 7);
});

console.log('\ntension ordering');
const cases = [
  ['single note', [C], 0.00, 0.01],
  ['perfect fifth', [C, G], 0.10, 0.22],
  ['stack of fifths C G D', [C, G, D], 0.18, 0.33],
  ['major triad', [C, E, G], 0.42, 0.60],
  ['dominant 7th', [C, E, G, As], 0.60, 0.78],
  ['tritone', [C, Fs], 0.85, 1.00],
  ['chromatic cluster', [C, Cs, D], 0.75, 1.00]
];
for (const [label, midis, lo, hi] of cases) {
  check(`${label} in [${lo}, ${hi}]`, () => {
    const t = tensionOf(midis);
    assert.ok(t >= lo && t <= hi, `got ${t.toFixed(3)}`);
  });
}
check('tension increases monotonically across those cases', () => {
  const ordered = ['single note', 'perfect fifth', 'stack of fifths C G D', 'major triad', 'dominant 7th', 'tritone'];
  const vals = ordered.map((l) => tensionOf(cases.find((c) => c[0] === l)[1]));
  for (let i = 1; i < vals.length; i++)
    assert.ok(vals[i] > vals[i - 1], `${ordered[i]} (${vals[i].toFixed(2)}) <= ${ordered[i - 1]} (${vals[i - 1].toFixed(2)})`);
});

console.log('\ncolour output');
check('consonant pair stays tight in hue, dissonant pair spreads', () => {
  const consonant = hueSpread([C, G]);
  const dissonant = hueSpread([C, Fs]);
  assert.ok(consonant < 15, `fifth spread ${consonant.toFixed(1)} deg should be tight`);
  assert.ok(dissonant > 120, `tritone spread ${dissonant.toFixed(1)} deg should be wide`);
});
check('a consonant pair reads as colour + white', () => {
  const a = analyze([C, G].map((m) => ({ midi: m, weight: 1 })));
  const [low, high] = [...a.colors.values()].sort((x, y) => x.rank - y.rank);
  assert.ok(low.s > 0.35, `anchor voice desaturated (${low.s.toFixed(2)})`);
  assert.ok(high.l > 0.75 && high.s < 0.30, `upper voice not bleached (l=${high.l.toFixed(2)} s=${high.s.toFixed(2)})`);
});
check('a dissonant chord keeps every voice saturated', () => {
  const a = analyze([C, Fs, As].map((m) => ({ midi: m, weight: 1 })));
  for (const c of a.colors.values()) assert.ok(c.s > 0.6, `voice too washed out (${c.s.toFixed(2)})`);
});
check('hue spread grows with tension across the whole range', () => {
  const spreads = [[C, G], [C, G, D], [C, E, G], [C, E, G, As], [C, Fs]].map(hueSpread);
  for (let i = 1; i < spreads.length; i++)
    assert.ok(spreads[i] > spreads[i - 1], `spread did not grow: ${spreads.map((s) => s.toFixed(0)).join(' -> ')}`);
});
check('brightness scales lightness without touching hue', () => {
  const dim = analyze([C, E, G].map((m) => ({ midi: m, weight: 1 })), { brightness: 0.4 });
  const full = analyze([C, E, G].map((m) => ({ midi: m, weight: 1 })), { brightness: 1 });
  assert.ok(dim.colors.get(C).l < full.colors.get(C).l);
  assert.equal(dim.colors.get(C).h.toFixed(4), full.colors.get(C).h.toFixed(4));
});
check('empty input is safe', () => {
  const a = analyze([]);
  assert.equal(a.count, 0);
  assert.equal(a.colors.size, 0);
});

console.log('\nchord naming');
const names = [
  [[C, E, G], 'C'],
  [[C, Ds, G], 'Cm'],
  [[C, E, G, B], 'Cmaj7'],
  [[C, E, G, As], 'C7'],
  [[C, Ds, Fs, As], 'Cm7♭5'],
  [[C, F, G], 'Csus4'],
  [[E, G, C + 12], 'C/E'],
  [[C], 'C'],
  [[D, Gs], null]
];
for (const [midis, expected] of names) {
  check(`names ${midis.join(',')}${expected ? ' as ' + expected : ' without crashing'}`, () => {
    const got = nameChord(midis);
    assert.ok(got && got.name, 'no name produced');
    if (expected) assert.equal(got.name, expected);
  });
}
check('dyad reports its interval quality', () => {
  assert.equal(nameChord([C, Fs]).quality, 'tritone');
  assert.equal(nameChord([C, G]).quality, '5');
});

console.log(`\n${passed} checks passed${process.exitCode ? ' (with failures above)' : ''}\n`);
