/**
 * Harmony -> colour.
 *
 * Tension is measured purely in fifths: how far apart the sounding notes sit on the
 * Circle of Fifths, both on average and at their widest. That single number then
 * drives how far the individual note hues are allowed to spread away from the chord's
 * colour centroid:
 *
 *   consonant  -> hues collapse toward one another, some voices bleach toward white
 *                 (a fifth reads as "blue + white")
 *   dissonant  -> hues sit at their true positions, fully saturated and distinct
 *                 (a tritone cluster reads as "red + green + blue")
 */

import {
  circleDistance, fifthsSpan, hueFor, circularMeanHue, angleDelta,
  wrapDeg, clamp, lerp, pitchClass
} from './circle.js';

export const PALETTES = {
  spectral: { label: 'Spectral', rotation: 0, spread: 1.0, satLow: 0.42, satHigh: 0.96, lightBias: 0.0 },
  ice:      { label: 'Ice',      rotation: 170, spread: 0.55, satLow: 0.30, satHigh: 0.78, lightBias: 0.08 },
  ember:    { label: 'Ember',    rotation: 330, spread: 0.45, satLow: 0.48, satHigh: 0.99, lightBias: -0.02 },
  bloom:    { label: 'Bloom',    rotation: 265, spread: 0.72, satLow: 0.38, satHigh: 0.88, lightBias: 0.05 },
  mono:     { label: 'Mono',     rotation: 200, spread: 0.12, satLow: 0.22, satHigh: 0.55, lightBias: 0.10 }
};

/** Mean of all pairwise circle-of-fifths distances (0..6). */
export function meanFifthsDistance(pcs) {
  const uniq = [...new Set(pcs.map(pitchClass))];
  if (uniq.length < 2) return 0;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < uniq.length; i++) {
    for (let j = i + 1; j < uniq.length; j++) {
      sum += circleDistance(uniq[i], uniq[j]);
      n++;
    }
  }
  return sum / n;
}

/**
 * 0 = one pitch class or a stack of fifths, 1 = tritones / chromatic clusters.
 * Half from the average separation, half from the total width of the chord.
 */
export function tensionOf(pcs) {
  const uniq = [...new Set(pcs.map(pitchClass))];
  if (uniq.length < 2) return 0;
  const mean = meanFifthsDistance(uniq);
  const span = fifthsSpan(uniq);
  return clamp(0.5 * (mean / 6) + 0.5 * (span / 7));
}

/**
 * Analyse the sounding voices and hand back everything the renderer needs.
 * `voices` is [{ midi, weight }] ordered however you like; weights are 0..1.
 */
export function analyze(voices, options = {}) {
  const palette = PALETTES[options.palette] ?? PALETTES.spectral;
  const rotation = (options.rotation ?? 0) + palette.rotation;
  const brightness = options.brightness ?? 1;

  if (!voices.length) {
    return {
      count: 0, tension: 0, meanDistance: 0, span: 0,
      centroidHue: wrapDeg(rotation), cohesion: 0, energy: 0,
      colors: new Map(), palette
    };
  }

  const pcs = voices.map((v) => pitchClass(v.midi));
  const tension = tensionOf(pcs);
  const meanDistance = meanFifthsDistance(pcs);
  const span = fifthsSpan(pcs);

  const trueHues = pcs.map((pc) => hueFor(pc, rotation));
  const weights = voices.map((v) => Math.max(v.weight ?? 1, 0.001));
  const centroidHue = circularMeanHue(trueHues, weights);

  // How much of each note's real hue offset survives. Near 0 => one colour.
  const cohesion = lerp(0.16, 1.0, Math.pow(tension, 0.85)) * palette.spread;

  // Low voices anchor the colour, upper voices bleach toward white when consonant.
  const order = voices
    .map((v, i) => ({ i, midi: v.midi }))
    .sort((a, b) => a.midi - b.midi)
    .map((e, rank) => ({ ...e, rank }));

  const colors = new Map();
  let energy = 0;

  for (const { i, rank } of order) {
    const voice = voices[i];
    const delta = angleDelta(trueHues[i], centroidHue);
    const hue = wrapDeg(centroidHue + delta * cohesion);

    const saturation = lerp(palette.satLow, palette.satHigh, Math.pow(tension, 0.7));
    const whiten = (1 - tension) * (rank % 2 === 1 ? 0.85 : 0.12);

    const l = clamp(0.50 + whiten * 0.40 + palette.lightBias, 0.06, 0.97) * clamp(brightness, 0.15, 1.6);
    const s = clamp(saturation * (1 - whiten * 0.72), 0, 1);

    colors.set(voice.midi, {
      h: hue,
      s,
      l: clamp(l, 0.04, 0.98),
      trueHue: trueHues[i],
      rank,
      weight: weights[i]
    });
    energy += weights[i];
  }

  return {
    count: voices.length,
    tension,
    meanDistance,
    span,
    centroidHue,
    cohesion,
    energy: clamp(energy / 4, 0, 1),
    colors,
    palette
  };
}

/** Plain-English label for a tension value, used in the HUD. */
export function tensionLabel(t) {
  if (t < 0.12) return 'UNISON';
  if (t < 0.26) return 'CONSONANT';
  if (t < 0.45) return 'WARM';
  if (t < 0.62) return 'COLOURED';
  if (t < 0.80) return 'TENSE';
  return 'DISSONANT';
}
