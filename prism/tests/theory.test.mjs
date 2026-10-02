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

const { TRACKS, renderTrack, encodeWav } = await import('../src/js/scope/tracks.js');
console.log('\nbuilt-in oscilloscope music');
const crossings = (a, from, to) => { let c = 0; for (let i = from + 1; i < to; i++) if (a[i - 1] < 0 && a[i] >= 0) c++; return c; };
check('every track renders in range, with no clicks between samples', () => {
  for (const { id } of TRACKS) {
    const t0 = performance.now();
    const { left, right } = renderTrack(id, 48000);
    const ms = performance.now() - t0;
    assert.ok(left.length > 48000 * 8 && left.length === right.length, `${id} length`);
    let peak = 0, jump = 0;
    for (let i = 1; i < left.length; i++) {
      peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
      jump = Math.max(jump, Math.abs(left[i] - left[i - 1]), Math.abs(right[i] - right[i - 1]));
    }
    assert.ok(peak <= 1 && peak > 0.3, `${id} peak ${peak}`);
    assert.ok(jump < 0.5, `${id} has a ${jump.toFixed(2)} step`);
    assert.ok(ms < 2000, `${id} took ${ms.toFixed(0)} ms to render`);
  }
});
check('the intervals track plays its fifth as 3:2 between the channels', () => {
  const { left, right } = renderTrack('intervals', 48000);
  const from = 48000 * 6.5, to = 48000 * 8.5; // the fifth section
  const ratio = crossings(right, from, to) / crossings(left, from, to);
  assert.ok(Math.abs(ratio - 1.5) < 0.02, `ratio ${ratio.toFixed(3)}`);
});
check('WAV encoding has the right header and size', async () => {
  const blob = encodeWav(new Float32Array(100), new Float32Array(100), 48000);
  assert.equal(blob.size, 44 + 400);
});

const live = await import('../src/js/scope/live.js');
console.log('\nlive circles');
check('petals step with the Circle of Fifths: C 2, G 3, D 4 … and wrap', () => {
  assert.equal(live.lobesFor(60), 2);
  assert.equal(live.lobesFor(67), 3);
  assert.equal(live.lobesFor(62), 4);
  for (let m = 36; m < 96; m++) assert.ok(live.lobesFor(m) >= 2 && live.lobesFor(m) <= 7);
});
check('louder spins faster and blooms further; rising pitch spins one way, falling the other', () => {
  const quiet = new live.Driver(), loud = new live.Driver();
  let q, l;
  for (let i = 0; i < 60; i++) { q = quiet.update({ level: 0.1, midi: 60 }, 1 / 60); l = loud.update({ level: 0.9, midi: 60 }, 1 / 60); }
  assert.ok(Math.abs(l.spin) > 2 * Math.abs(q.spin) && l.m > 2 * q.m, `quiet ${q.spin.toFixed(2)}/${q.m.toFixed(2)} loud ${l.spin.toFixed(2)}/${l.m.toFixed(2)}`);
  const d = new live.Driver();
  d.update({ level: 0.5, midi: 60 }, 1 / 60);
  const up = d.update({ level: 0.5, midi: 64 }, 1 / 60).spin;
  const down = d.update({ level: 0.5, midi: 57 }, 1 / 60).spin;
  assert.ok(up > 0 && down < 0, `up ${up} down ${down}`);
});
check('an onset kicks the spin and size', () => {
  const d = new live.Driver();
  for (let i = 0; i < 60; i++) d.update({ level: 0.2, midi: 60 }, 1 / 60);
  const before = d.update({ level: 0.2, midi: 60 }, 1 / 60);
  const hit = d.update({ level: 0.8, midi: 60 }, 1 / 60);
  assert.ok(hit.scale > before.scale + 0.2 && Math.abs(hit.spin) > Math.abs(before.spin) + 2);
});
check('rendered circles stay on screen, never click, and sit at their two centres', () => {
  const g = new live.LiveCircles(48000);
  const n = 48000;
  const L = new Float32Array(n), R = new Float32Array(n);
  // Hammer it with changing targets, as live input would.
  for (let block = 0; block < n / 128; block++) {
    if (block % 20 === 0) g.setTargets([{ k: 2 + (block / 20) % 6, m: 0.55, spin: 6, scale: 1.45 }, { k: 7 - (block / 20) % 6, m: 0.55, spin: -6, scale: 1.45 }], 110 + block % 100);
    g.render(L.subarray(block * 128), R.subarray(block * 128), 128);
  }
  let step = 0, peak = 0, sumL = 0, sumR = 0, nL = 0;
  for (let i = 1; i < n; i++) {
    step = Math.max(step, Math.abs(L[i] - L[i - 1]), Math.abs(R[i] - R[i - 1]));
    peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  }
  assert.ok(peak <= 0.92 + 1e-6, `peak ${peak}`);
  assert.ok(step < 0.35, `largest sample step ${step.toFixed(3)}`);
  const low = [...L].filter((x) => x < 0).length / n;
  assert.ok(low > 0.35 && low < 0.65, `time split between circles ${low.toFixed(2)}`);
});

const { LoopCore, MAX_LAYERS } = await import('../src/js/studio/looper.js');
console.log('\nlooper');
const run = (core, seconds, signal = () => 0) => {
  const n = Math.round(core.sr * seconds), out = new Float32Array(n), inp = new Float32Array(n);
  for (let i = 0; i < n; i++) inp[i] = signal(i);
  for (let i = 0; i < n; i += 128) core.process(inp.subarray(i, Math.min(n, i + 128)), out.subarray(i, Math.min(n, i + 128)), Math.min(128, n - i));
  return out;
};
check('one button: record → loop → overdub → play', () => {
  const c = new LoopCore(8000);
  assert.equal(c.state, 'empty'); c.press(); assert.equal(c.state, 'recording');
  run(c, 1.0, () => 0.5); c.press();
  assert.equal(c.state, 'playing'); assert.equal(c.length, 8000);
  c.press(); assert.equal(c.state, 'overdub'); c.press(); assert.equal(c.state, 'playing');
  assert.equal(c.status().layers, 2);
});
check('with a beat, a sloppy take snaps to whole bars (1, 2, 4 or 8)', () => {
  const c = new LoopCore(8000);
  c.barSamples = 8000 * 2;          // 2 s bars (120 bpm)
  c.press(); run(c, 3.7); c.press(); // 1.85 bars -> 2 bars
  assert.equal(c.length, 32000);
  const d = new LoopCore(8000); d.barSamples = 16000;
  d.press(); run(d, 1.2); d.press(); // 0.6 bars -> 1 bar
  assert.equal(d.length, 16000);
});
check('playback repeats the take exactly, seamlessly', () => {
  const c = new LoopCore(8000);
  c.press(); run(c, 0.5, (i) => (i % 400) / 400); c.press();
  const out = run(c, 1.0);
  for (let i = 0; i < 8000; i++) assert.ok(Math.abs(out[i] - ((i % 400) / 400)) < 1e-6, `sample ${i}`);
});
check('overdubs land in time despite latency, and undo removes only the last layer', () => {
  const c = new LoopCore(8000);
  c.latency = 160;                                  // 20 ms round trip
  // A click sung at loop position 1000 reaches us 160 samples later.
  c.press(); run(c, 1.0, (i) => (i === 1000 + 160 ? 1 : 0)); c.press();
  run(c, 160 / 8000);                               // the take's tail arrives
  const first = run(c, 1.0);
  const hit1 = first.indexOf(1);
  assert.equal(hit1, 1000 - 160, `first take: click at ${hit1}`); // run began 160 into the loop
  c.press();
  // Overdub a click heard at loop position 3000 (this run starts at position 160).
  run(c, 1.0, (i) => (i === 3000 - 160 + 160 ? 1 : 0));
  c.press();
  const both = run(c, 1.0);
  assert.equal(both[3000 - 160], 1, 'overdub not aligned');
  c.undo();
  const undone = run(c, 1.0);
  assert.equal(undone[3000 - 160], 0); assert.equal(undone[1000 - 160], 1);
});
check('the end of a take still arriving after the press is kept, not cut off', () => {
  const c = new LoopCore(8000);
  c.latency = 400;
  // Sung right at the end of the loop, so it reaches us after the closing press.
  c.press(); run(c, 1.0, () => 0); c.press();
  run(c, 0.1, (i) => (i === 200 ? 1 : 0));          // musical time 8000 + 200 - 400 = 7800
  const out = run(c, 1.0);                          // starts at loop position 800
  assert.equal(out[(7800 - 800 + 8000) % 8000], 1);
});
check('with a beat, the loop starts on the downbeat even if pressed late', () => {
  const c = new LoopCore(8000);
  c.barSamples = 8000; c.origin = 0;                // one bar a second, downbeats at 0, 8000, …
  run(c, 1.0);
  run(c, 0.0375, (i) => (i === 0 ? 0.5 : i === 100 ? 1 : 0)); // notes at 8000 and 8100…
  c.press();                                        // …but the press comes at 8300
  run(c, 1.1625); c.press();                        // closed at 17600: 1.2 bars -> 1 bar
  assert.equal(c.length, 8000);
  const out = run(c, 2.0);                          // frames 17600…
  const at = (frame) => out[frame - 17600];
  assert.equal(at(24000), 0.5, 'the downbeat note plays on the downbeat');
  assert.equal(at(32000), 0.5, 'and on every one after');
  assert.equal(at(24100), 1, 'notes from before the press are kept');
});
check('clear empties; stop holds the loop and restarts from the top', () => {
  const c = new LoopCore(8000);
  c.press(); run(c, 0.5, (i) => (i === 0 ? 0.25 : 0)); c.press();
  c.toggleStop(); assert.equal(c.state, 'stopped');
  assert.ok(run(c, 0.2).every((v) => v === 0));
  c.toggleStop(); assert.equal(c.state, 'playing');
  assert.equal(run(c, 0.1)[0], 0.25, 'restarts at the top');
  c.clear(); assert.equal(c.state, 'empty'); assert.equal(c.layers.length, 0);
});

/** Record a loop of a click at 0, then one overdub layer per value, each a click at 100·k. */
const layered = (values) => {
  const c = new LoopCore(8000);
  c.press(); run(c, 1.0, (i) => (i === 0 ? 1 : 0)); c.press();
  values.forEach((v, k) => { c.press(); run(c, 1.0, (i) => (i === 100 * (k + 1) ? v : 0)); c.press(); });
  return c;
};
check('redo puts back exactly what undo took; a new layer ends redo', () => {
  const c = layered([0.5, 0.25]);
  const before = run(c, 1.0);
  c.undo(); assert.equal(c.status().redo, 1);
  assert.equal(run(c, 1.0)[200], 0);
  c.redo(); assert.equal(c.status().redo, 0);
  assert.deepEqual(run(c, 1.0), before);
  c.undo(); c.press(); run(c, 1.0); c.press();   // record something new instead
  assert.equal(c.status().redo, 0); c.redo(); assert.equal(c.status().layers, 3);
});
check('undoing every layer keeps the loop, so redo can bring it all back', () => {
  const c = layered([0.5]);
  c.undo(); c.undo();
  assert.equal(c.state, 'empty'); assert.equal(c.status().redo, 2);
  assert.ok(run(c, 1.0).every((v) => v === 0));
  c.redo(); c.redo();
  assert.equal(c.state, 'playing');
  const out = run(c, 1.0);
  assert.equal(out[0], 1); assert.equal(out[100], 0.5);
});
check('each layer plays out of its own output, so it can have its own effects', () => {
  const c = layered([0.5, 0.25]);
  const slots = Array.from({ length: MAX_LAYERS }, () => new Float32Array(8000));
  c.process(null, slots, 8000);
  assert.equal(slots[0][0], 1); assert.equal(slots[1][100], 0.5); assert.equal(slots[2][200], 0.25);
  assert.equal(slots[0][100] + slots[1][0] + slots[2][100], 0);
  assert.ok(slots.slice(3).every((s) => s.every((v) => v === 0)));
});
check(`the loop holds ${MAX_LAYERS} layers; past that, overdub waits for an undo`, () => {
  const c = layered(Array(MAX_LAYERS - 1).fill(0.1));
  assert.equal(c.status().layers, MAX_LAYERS); assert.equal(c.status().full, true);
  c.press(); assert.equal(c.state, 'playing');
  c.undo(); c.press(); assert.equal(c.state, 'overdub');
});

const fx = await import('../src/js/studio/fx.js');
const drums = await import('../src/js/studio/drums.js');
const sounds = await import('../src/js/studio/sounds.js');
console.log('\nstudio');
check('every effect is silent at rest: no curve, filter wide open at centre, no echo', () => {
  assert.equal(fx.driveCurve(0), null);
  assert.equal(fx.crushCurve(0), null);
  const { lp, hp } = fx.filterSetting(0.5);
  assert.ok(lp >= 20000 && hp <= 20, `${lp} / ${hp}`);
  assert.equal(fx.echoSetting(0).send, 0);
});
check('drive saturates smoothly and keeps full scale full', () => {
  const c = fx.driveCurve(1);
  assert.ok(Math.abs(c[c.length - 1] - 1) < 1e-6 && Math.abs(c[0] + 1) < 1e-6);
  for (let i = 1; i < c.length; i++) assert.ok(c[i] >= c[i - 1], 'monotonic');
  const quiet = c[Math.round((c.length - 1) * 0.55)]; // input 0.1
  assert.ok(quiet > 0.5, `quiet input pushed up to ${quiet.toFixed(2)}`);
});
check('crush leaves 2^bits levels: 3 bits at full', () => {
  assert.equal(fx.crushBits(1), 3);
  const levels = new Set(fx.crushCurve(1));
  assert.equal(levels.size, 2 ** 3 + 1); // −1 … +1 inclusive
});
check('filter: left darkens (low-pass falls), right thins (high-pass rises), both exponential', () => {
  const l1 = fx.filterSetting(0.3).lp, l2 = fx.filterSetting(0.1).lp, l3 = fx.filterSetting(0).lp;
  assert.ok(l1 > l2 && l2 > l3 && Math.abs(l3 - 150) < 1, `${l1} ${l2} ${l3}`);
  const h1 = fx.filterSetting(0.7).hp, h2 = fx.filterSetting(1).hp;
  assert.ok(h1 < h2 && Math.abs(h2 - 5000) < 1);
  assert.equal(fx.filterSetting(0.2).hp, 10); // only one filter moves at a time
});
check('echo is a dotted eighth at the tempo', () => {
  assert.ok(Math.abs(fx.echoSeconds(120) - 0.375) < 1e-9);
});
check('beat steps land on the sixteenth grid, each exactly once, swing pushes odd steps late', () => {
  const bpm = 120, step = drums.stepSeconds(bpm);
  const seen = [];
  for (let t = 0; t < 2; t += 0.025) seen.push(...drums.stepsBetween(0.1, bpm, 0, t, t + 0.025)); // 25 ms ticks
  assert.deepEqual(seen.map((s) => s.k), [...Array(seen.length).keys()]);
  seen.forEach(({ k, t }) => assert.ok(Math.abs(t - (0.1 + k * step)) < 1e-9));
  const swung = drums.stepsBetween(0, bpm, 0.2, 0, 1);
  assert.ok(Math.abs(swung[1].t - 1.2 * step) < 1e-9 && Math.abs(swung[2].t - 2 * step) < 1e-9);
});
check('the beat can lock to a free loop: tempo where the loop is whole bars', () => {
  assert.equal(drums.fitTempo(4, 100), 120);           // 4 s = 2 bars at 120
  assert.ok(Math.abs(drums.fitTempo(3.1, 90) - 240 / 3.1) < 1e-9);
  assert.equal(drums.fitTempo(0.5, 100), null);        // nothing sensible fits
});
check('every beat: known parts, 16 or 32 steps of known symbols, a kit and a tempo in range', () => {
  for (const [name, b] of Object.entries(drums.BEATS)) {
    const parts = drums.PARTS.filter((p) => b[p]);
    assert.ok(parts.length >= 2, `${name}: parts`);
    for (const part of parts) assert.match(b[part], /^([xor.]{16}|[xor.]{32})$/, `${name}.${part}`);
    assert.ok(b.kit in drums.KITS, `${name}: kit ${b.kit}`);
    assert.ok(b.tempo >= drums.TEMPO_MIN && b.tempo <= drums.TEMPO_MAX, `${name}: tempo ${b.tempo}`);
  }
  assert.ok(Object.keys(drums.BEATS).length >= 9);
});
check('chord mode: each note of the key gets its own chord from the key', () => {
  const names = [60, 62, 64, 65, 67, 69, 71].map((m) => sounds.chordName(sounds.chordFor(m, 0)));
  assert.deepEqual(names, ['C', 'Dm', 'Em', 'F', 'G', 'Am', 'B°']);
  // In G, the white-key shapes move with the key: G A B C D E F♯.
  const inG = [67, 69, 71, 72, 74, 76, 78].map((m) => sounds.chordName(sounds.chordFor(m, 7)));
  assert.deepEqual(inG, ['G', 'Am', 'Bm', 'C', 'D', 'Em', 'F♯°']);
  assert.deepEqual(sounds.chordFor(61, 0), [61, 65, 68]); // between the scale notes: major
});
check('every sound is a complete recipe in a known group', () => {
  const groups = new Set(sounds.GROUPS.map((g) => g.id));
  const ids = Object.keys(sounds.SOUNDS);
  assert.ok(ids.length >= 20, `${ids.length} sounds`);
  for (const [id, p] of Object.entries(sounds.SOUNDS)) {
    assert.ok(groups.has(p.group), `${id}: group ${p.group}`);
    assert.equal(p.env.length, 4, `${id}: env`);
    assert.ok(p.env.every((v) => Number.isFinite(v) && v >= 0), `${id}: env values`);
    assert.ok(p.level > 0 && p.cutoff > 0, `${id}: level/cutoff`);
    for (const o of sounds.oscillatorsOf(p)) assert.ok(['sine', 'triangle', 'sawtooth', 'square'].includes(o.type) && o.gain > 0, `${id}: osc`);
  }
  for (const g of groups) assert.ok(ids.filter((id) => sounds.SOUNDS[id].group === g).length >= 4, `group ${g}`);
});
check('a supersaw spreads its saws evenly around the note', () => {
  const saws = sounds.oscillatorsOf({ osc: [{ saws: 5, spread: 20 }] });
  assert.deepEqual(saws.map((o) => o.detune), [-20, -10, 0, 10, 20]);
});
check('shape knobs: centre plays the sound as designed, the ends scale it 8x either way', () => {
  assert.equal(sounds.shapeFactor(0.5), 1);
  assert.ok(Math.abs(sounds.shapeFactor(1) - 8) < 1e-9 && Math.abs(sounds.shapeFactor(0) - 1 / 8) < 1e-9);
});
check('a layer level at its default is unity gain', () => {
  assert.equal(fx.levelGain(fx.FX_DEFAULTS.level), 1);
  assert.equal(fx.levelGain(0), 0);
});

const project = await import('../src/js/studio/project.js');
const perfMod = await import('../src/js/studio/perf.js');
const voiceFx = await import('../src/js/studio/voice-fx.js');
console.log('\nsave, load and performance');
check('a saved loop comes back with every layer, its effects and the session', () => {
  const len = 4000;
  const a = new Float32Array(len).map((_, i) => Math.sin(i / 7) * 0.5);
  const b = new Float32Array(len).map((_, i) => (i % 100 === 0 ? 0.01 : 0));  // quiet: keeps its own scale
  const meta = { name: 'Rage ✦ test', sampleRate: 8000, length: len, bpm: 150, beat: 'rage', session: { sound: 'ragelead', key: 7 } };
  const bytes = project.encodeProject(meta, [a, b], [{ crush: 0.7, mute: true }, { tape: 0.5 }]);
  const back = project.decodeProject(bytes.buffer.slice(0));
  assert.equal(back.meta.name, 'Rage ✦ test'); assert.equal(back.meta.bpm, 150); assert.equal(back.meta.session.sound, 'ragelead');
  assert.deepEqual(back.layerFx, [{ crush: 0.7, mute: true }, { tape: 0.5 }]);
  for (let i = 0; i < len; i++) assert.ok(Math.abs(back.layers[0][i] - a[i]) < 0.5 / 32767 + 1e-6, `a[${i}]`);
  assert.ok(Math.abs(back.layers[1][100] - 0.01) < 1e-6 && back.layers[1][101] === 0);
  assert.equal(bytes.length, 12 + new DataView(bytes.buffer).getUint32(8, true) + 2 * len * 2);
});
check('anything that is not a loop file is refused, not half-loaded', () => {
  assert.throws(() => project.decodeProject(new TextEncoder().encode('hello world, not a loop')), /not a PRISM loop/);
  const good = project.encodeProject({ name: 'x', sampleRate: 8000, length: 100 }, [new Float32Array(100)]);
  assert.throws(() => project.decodeProject(good.slice(0, good.length - 10)), /cut short/);
});
check('a loop saved at another sample rate is resampled to the same length in time', () => {
  const r = project.resample(new Float32Array(44100).fill(0.25), 44100, 48000);
  assert.equal(r.length, 48000); assert.ok(r.every((v) => Math.abs(v - 0.25) < 1e-6));
  assert.equal(project.fileNameFor('my: loop/<1>?'), 'my loop 1.prism');
  assert.equal(project.fileNameFor('Ragé ✦ loop'), 'Rage loop.prism');   // plain ASCII, or Chromium renames it
  assert.equal(project.fileNameFor('✦✦'), 'PRISM loop.prism');
});
check('the looper hands its layers out and takes them back, playing from the top', () => {
  const c = layered([0.5]);
  const saved = c.exportLoop();
  const d = new LoopCore(8000);
  d.importLoop(saved.layers, saved.length);
  assert.equal(d.state, 'playing'); assert.equal(d.status().layers, 2);
  const out = run(d, 1.0);
  assert.equal(out[0], 1); assert.equal(out[100], 0.5);
});
const pump = (core, seconds, signal) => {
  const n = Math.round(core.sr * seconds), L = new Float32Array(n), R = new Float32Array(n), inp = new Float32Array(n).map((_, i) => signal(core.frame + i));
  for (let i = 0; i < n; i += 128) { const m = Math.min(128, n - i); core.process(inp.subarray(i, i + m), null, L.subarray(i, i + m), R.subarray(i, i + m), m); }
  return L;
};
check('stutter repeats the last whole slice, in time, then lets go exactly where the music is', () => {
  const p = new perfMod.PerfCore(8000);
  p.setGrid(500, 0);                                   // a sixteenth = 500 samples
  const ramp = (f) => (f % 8000) / 8000;               // a signal that says where it is
  pump(p, 1.05, ramp);                                 // now at 8400: slice 8000-8999 holds us
  p.stutter(2);                                        // eighths: 1000 samples; repeat 7000-7999
  const out = pump(p, 0.5, ramp);                      // 8400…12399
  assert.ok(Math.abs(out[1000] - ramp(7000 + ((9400 - 8000) % 1000))) < 1e-3, 'repeats the slice before, keeping its phase');
  assert.ok(Math.abs(out[2000] - out[1000]) < 1e-3, 'every slice the same');
  p.stutter(0);
  const after = pump(p, 0.2, ramp);
  assert.ok(Math.abs(after[400] - ramp(12400 + 400)) < 1e-6, 'back in time once released');
});
check('tape stop winds down to silence and comes straight back', () => {
  const p = new perfMod.PerfCore(8000);
  const tone = (f) => Math.sin((2 * Math.PI * 440 * f) / 8000);
  pump(p, 0.5, tone);
  p.tape(true);
  const out = pump(p, 1.2, tone);
  const energy = (a, from, to) => Math.sqrt(a.slice(from, to).reduce((s, v) => s + v * v, 0) / (to - from));
  assert.ok(energy(out, 200, 1000) > 0.3, 'still sounding as it slows');
  assert.ok(energy(out, 7400, 9600) < 1e-6, 'stopped');
  p.tape(false);
  const back = pump(p, 0.1, tone);
  assert.ok(energy(back, 300, 800) > 0.6, 'back');
});
check('pitch: a ratio of 1 passes the voice straight through; 2 doubles the pitch', () => {
  const sr = 16000, n = sr;
  const sine = new Float32Array(n).map((_, i) => Math.sin((2 * Math.PI * 200 * i) / sr));
  const ps = new voiceFx.PitchShifter(sr);
  const same = new Float32Array(n); ps.process(sine, same, n);
  assert.deepEqual(same, sine);
  const up = new voiceFx.PitchShifter(sr); up.target = 2;
  const out = new Float32Array(n); up.process(sine, out, n);
  let crossings = 0; for (let i = sr / 2 + 1; i < n; i++) if (out[i - 1] < 0 && out[i] >= 0) crossings++;
  assert.ok(Math.abs(crossings - 200) <= 12, `${crossings} upward crossings in 0.5 s (want ~200 for 400 Hz)`);
});
check('tune: pulls a sung pitch onto the key — fully at 1, partly in between, not at all at 0', () => {
  const cents = (r) => 1200 * Math.log2(r);
  const sharpC = 261.63 * Math.pow(2, 30 / 1200);         // C4, 30 cents sharp
  assert.ok(Math.abs(cents(voiceFx.tuneRatio(sharpC, 0, 1)) + 30) < 0.5);
  assert.ok(Math.abs(cents(voiceFx.tuneRatio(sharpC, 0, 0.5)) + 15) < 0.5);
  assert.equal(voiceFx.tuneRatio(sharpC, 0, 0), 1);
  const cSharp = 277.18;                                   // C♯ is not in C major: goes to C or D
  assert.ok(Math.abs(Math.abs(cents(voiceFx.tuneRatio(cSharp, 0, 1))) - 100) < 1);
  assert.ok(Math.abs(cents(voiceFx.tuneRatio(cSharp, 1, 1))) < 1, 'but it is in D♭ major');
});
check('the tape knob is silent at zero and wobbles more as it turns', () => {
  const zero = fx.tapeSetting(0), full = fx.tapeSetting(1);
  assert.equal(zero.wow + zero.flutter, 0); assert.equal(zero.tone, 20000);
  assert.ok(full.wow > 0.002 && full.tone < 5000);
});

const roll = await import('../src/js/studio/roll.js');
console.log('\npiano roll');
check('notes repeat with the pattern, each landing once, wrapping cleanly at the end', () => {
  const notes = [{ start: 0, length: 1, midi: 60 }, { start: 15, length: 1, midi: 64 }, { start: 40, length: 2, midi: 67 }];
  const hits = roll.notesBetween(notes, 16, 14, 34).map((h) => `${h.note.midi}@${h.step}`);
  assert.deepEqual(hits, ['64@15', '60@16', '64@31', '60@32']);    // 67 is past a 1-bar pattern: kept, not played
  let all = [];
  for (let i = 0; i * 0.37 < 64; i++) all.push(...roll.notesBetween(notes, 32, i * 0.37, Math.min(64, (i + 1) * 0.37)));
  assert.deepEqual(all.map((h) => h.step), [0, 15, 32, 47]);       // tiny windows: still exactly once each
});
check('snapping: a click lands on the cell it is in, a drag moves by whole cells', () => {
  assert.equal(roll.snapDown(5.9, 4), 4); assert.equal(roll.snapDown(5.9, 0.5), 5.5);
  assert.equal(roll.snapNearest(2.6, 2), 2); assert.equal(roll.snapNearest(3.1, 2), 4);
});
check('pattern edits undo and redo as whole gestures; a gesture that changes nothing leaves no step', () => {
  const p = new roll.Pattern();
  p.checkpoint(); const a = p.add({ start: 0, length: 2, midi: 60 }); p.settle();
  p.checkpoint(); a.start = 4; a.midi = 62; p.settle();
  p.checkpoint(); p.settle();                                      // a click that moved nothing
  assert.equal(p.past.length, 2);
  p.undo(); assert.deepEqual([p.notes[0].start, p.notes[0].midi], [0, 60]);
  p.undo(); assert.equal(p.notes.length, 0);
  p.redo(); p.redo(); assert.deepEqual([p.notes[0].start, p.notes[0].midi], [4, 62]);
  p.checkpoint(); p.quantize(4); p.settle(); assert.equal(p.past.length, 2, 'already on the grid: no step');
});
check('a pattern saves and loads; anything malformed is dropped', () => {
  const p = new roll.Pattern(); p.setBars(4);
  p.add({ start: 1.5, length: 0.5, midi: 72, velocity: 0.4 });
  const q = new roll.Pattern(); q.load(JSON.parse(JSON.stringify(p.toJSON())));
  assert.equal(q.bars, 4); assert.deepEqual(q.toJSON(), p.toJSON());
  q.load({ bars: 3, notes: [{ start: 'x', length: 1, midi: 60 }, { start: 0, length: 1, midi: 200 }] });
  assert.equal(q.bars, 2); assert.equal(q.notes.length, 1); assert.equal(q.notes[0].midi, roll.ROLL_HIGH);
});
check('the player books each note once, on the clock, as time goes by', () => {
  const ctx = { currentTime: 0 };
  const booked = [];
  const synth = { schedule: (midi, v, at, dur) => booked.push({ midi, at: +at.toFixed(6), dur }), cancelBooked() {} };
  const p = new roll.Pattern(); p.setBars(1);
  p.add({ start: 0, length: 4, midi: 60 }); p.add({ start: 8, length: 2, midi: 67 });
  const player = new roll.RollPlayer(ctx, synth, p, () => ({ origin: 0.5, bpm: 120 }));  // a sixteenth = 0.125 s
  player.start(); clearInterval(player.timer);
  for (let t = 0; t < 4.6; t += 0.025) { ctx.currentTime = t; player.tick(); }
  assert.deepEqual(booked.map((b) => `${b.midi}@${b.at}`), ['60@0.5', '67@1.5', '60@2.5', '67@3.5', '60@4.5']);
  assert.ok(Math.abs(booked[0].dur - 0.48) < 1e-9, 'held for its length (a hair short, so repeats re-strike)');
  ctx.currentTime = 1.25; assert.equal(player.position(), 6);
});
console.log(`\n${passed} checks passed${process.exitCode ? ' (with failures above)' : ''}\n`);
