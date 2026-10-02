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


const { ratioForSemitones, chordRatios, intervalTitle, chordTitle } = await import('../src/js/theory/ratios.js');
console.log('just ratios');
check('fifth is 3:2, third 5:4, octave 2:1, twelfth 3:1', () => {
  assert.deepEqual(ratioForSemitones(7), [3, 2]);
  assert.deepEqual(ratioForSemitones(4), [5, 4]);
  assert.deepEqual(ratioForSemitones(12), [2, 1]);
  assert.deepEqual(ratioForSemitones(19), [3, 1]);
});
check('C+G -> 2:3 (low:high), titled THE PERFECT FIFTH', () => {
  assert.deepEqual(chordRatios([60, 67]), [2, 3]);
  assert.equal(intervalTitle(60, 67), 'THE PERFECT FIFTH');
});
check('major triad -> 4:5:6, titled A MAJOR CHORD', () => {
  assert.deepEqual(chordRatios([60, 64, 67]), [4, 5, 6]);
  assert.deepEqual(chordRatios([62, 66, 69]), [4, 5, 6]); // transposition-invariant
  assert.equal(chordTitle([60, 64, 67]), 'A MAJOR CHORD');
});
check('minor triad -> 10:12:15, dominant 7th -> 36:45:54:64', () => {
  assert.deepEqual(chordRatios([60, 63, 67]), [10, 12, 15]);
  assert.deepEqual(chordRatios([60, 64, 67, 70]), [36, 45, 54, 64]);
  assert.equal(chordTitle([60, 63, 67]), 'A MINOR CHORD');
  assert.equal(chordTitle([60, 63, 66]), 'A DIMINISHED CHORD');
  assert.equal(chordTitle([60, 64, 68]), 'AN AUGMENTED CHORD');
});

const { stretchCents, inharmonicity, pianoFrequency } = await import('../src/js/theory/piano.js');
console.log('\npiano tuning');
check('A4 stays at 440 Hz, middle C unstretched', () => {
  assert.equal(pianoFrequency(69).toFixed(6), '440.000000');
  assert.ok(Math.abs(stretchCents(60)) < 0.01);
});
check('Railsback curve: bass flat, treble sharp, within typical bounds', () => {
  assert.ok(stretchCents(21) < -20 && stretchCents(21) > -60, `A0 ${stretchCents(21).toFixed(1)}`);
  assert.ok(stretchCents(108) > 20 && stretchCents(108) < 60, `C8 ${stretchCents(108).toFixed(1)}`);
  for (let m = 72; m <= 108; m += 12) assert.ok(stretchCents(m) > stretchCents(m - 12), `not rising at ${m}`);
});
check('inharmonicity near 3e-4 at middle C, rising into the treble', () => {
  assert.ok(inharmonicity(60) > 1e-4 && inharmonicity(60) < 1e-3);
  assert.ok(inharmonicity(108) > 10 * inharmonicity(60));
});
check('octaves are wide, so they beat (pure ET would not)', () => {
  assert.ok(pianoFrequency(72) > 2 * pianoFrequency(60));
  assert.ok(pianoFrequency(96) - 2 * pianoFrequency(84) > 1);
});

const { HarmonicRenderer } = await import('../src/js/render/harmonic.js');
console.log('\nfigure spin');
const spinOver = (midis, seconds = 1) => {
  const r = new HarmonicRenderer();
  const voices = midis.map((m) => ({ midi: m, gate: true, env: 1 }));
  const before = [...r.phases];
  for (let i = 0; i < seconds * 60; i++) r.update('lissajous', voices, 1, 1 / 60);
  return r.phases.map((p, i) => p - before[i]);
};
check('a fifth at middle C rolls at its real beat rate (~0.44 Hz)', () => {
  const d = spinOver([60, 67]);
  const hz = (d[1] - d[0]) / (2 * Math.PI);
  assert.ok(Math.abs(Math.abs(hz) - 0.443) < 0.01, `rolled ${hz.toFixed(3)} Hz`);
});
check('an octave spins on a stretched piano (pure ET would freeze it)', () => {
  const d = spinOver([60, 72]);
  const hz = (d[1] - d[0]) / (2 * Math.PI);
  assert.ok(Math.abs(hz - 0.671) < 0.01, `rolled ${hz.toFixed(3)} Hz`);
});
check('a major third shimmers faster than a fifth', () => {
  const third = Math.abs(spinOver([60, 64])[1]);
  const fifth = Math.abs(spinOver([60, 67])[1]);
  assert.ok(third > 4 * fifth, `third ${third.toFixed(2)} vs fifth ${fifth.toFixed(2)} rad`);
});

const { findTrigger, peakToPeak, rms, toDb } = await import('../src/js/scope/measure.js');
console.log('\noscilloscope measurement');
const sine = (hz, n, sr = 48000, amp = 0.5, phase = 0.3) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin(2 * Math.PI * hz * i / sr + phase));
check('trigger lands on a rising zero crossing, interpolated', () => {
  const buf = sine(440, 4800);
  const t = findTrigger(buf);
  assert.ok(t > 0, 'no trigger');
  const i = Math.floor(t);
  assert.ok(buf[i] < 0 && buf[i + 1] >= 0, 'not a rising edge');
  // the true crossing of sin(2*pi*f*t + phase) is at a known position
  const period = 48000 / 440;
  const exact = ((2 * Math.PI - 0.3) / (2 * Math.PI)) * period;
  const k = Math.round((t - exact) / period);
  assert.ok(Math.abs(t - (exact + k * period)) < 0.05, `off by ${(t - exact - k * period).toFixed(3)} samples`);
});
check('trigger ignores noise below the hysteresis band and reports silence as -1', () => {
  const noise = Float32Array.from({ length: 2000 }, () => (Math.random() - 0.5) * 0.004);
  assert.equal(findTrigger(noise, { hysteresis: 0.01 }), -1);
  assert.equal(findTrigger(new Float32Array(2000)), -1);
});
check('respects the search window, returning the latest crossing inside it', () => {
  const buf = sine(100, 4800);
  const all = findTrigger(buf);
  const early = findTrigger(buf, { to: 2400 });
  assert.ok(early < 2400 && early < all);
});
check('peak-to-peak, RMS and dBFS of a sine are what the maths says', () => {
  const buf = sine(1000, 48000, 48000, 0.5);
  assert.ok(Math.abs(peakToPeak(buf).vpp - 1) < 1e-3);
  assert.ok(Math.abs(rms(buf) - 0.5 / Math.SQRT2) < 1e-3);
  assert.ok(Math.abs(toDb(1) - 0) < 1e-9 && toDb(0) === -90);
});

const { createRequire } = await import('node:module');
const security = createRequire(import.meta.url)('../security.js');
const pathMod = await import('node:path');
console.log('\nmain-process security');
const ROOT = pathMod.resolve('src');
check('app URLs are recognised by scheme and host, not by .origin', () => {
  assert.ok(security.isAppUrl('prism://app/index.html'));
  assert.ok(security.isAppUrl('prism://app'));
  assert.ok(!security.isAppUrl('prism://evil/index.html'));
  assert.ok(!security.isAppUrl('https://app/'));
  assert.ok(!security.isAppUrl('file:///etc/passwd'));
  assert.ok(!security.isAppUrl('not a url'));
});
check('the protocol handler refuses traversal, malformed and null-byte paths', () => {
  assert.equal(security.resolveRequest('prism://app/js/app.js', ROOT), pathMod.join(ROOT, 'js/app.js'));
  assert.equal(security.resolveRequest('prism://app/', ROOT), pathMod.join(ROOT, 'index.html'));
  for (const bad of ['prism://app/..%2fmain.js', 'prism://app/%2e%2e%2fpackage.json', 'prism://app/js/..%2f..%2fmain.js', 'prism://app/%E0%A4%A', 'prism://app/index.html%00.js'])
    assert.equal(security.resolveRequest(bad, ROOT), null, bad);
});
check('permissions: mic audio and MIDI for the app only; never camera or anything else', () => {
  const app = 'prism://app/scope.html';
  assert.ok(security.permitted('media', app, { mediaTypes: ['audio'] }));
  assert.ok(!security.permitted('media', app, { mediaTypes: ['video'] }));
  assert.ok(!security.permitted('media', app, { mediaTypes: ['audio', 'video'] }));
  assert.ok(!security.permitted('media', app, {}));
  assert.ok(security.permitted('midi', app) && security.permitted('midiSysex', app));
  for (const p of ['geolocation', 'notifications', 'clipboard-read', 'fullscreen', 'openExternal'])
    assert.ok(!security.permitted(p, app), p);
  assert.ok(!security.permitted('media', 'https://evil.example', { mediaTypes: ['audio'] }));
  assert.ok(!security.permitted('midi', 'https://evil.example'));
});
check('only https leaves the app', () => {
  assert.ok(security.isExternalAllowed('https://example.com'));
  for (const u of ['http://example.com', 'file:///etc/passwd', 'javascript:alert(1)', 'smb://host/share', 'nope'])
    assert.ok(!security.isExternalAllowed(u), u);
});
console.log(`\n${passed} checks passed${process.exitCode ? ' (with failures above)' : ''}\n`);
