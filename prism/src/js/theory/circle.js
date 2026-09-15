/**
 * The Circle of Fifths as a circular array, and the note -> hue mapping.
 *
 * Position k on the circle holds pitch class (7k mod 12): C G D A E B F# C# G# D# A# F.
 * Because 7 is its own inverse mod 12, the reverse lookup is just (pc * 7) mod 12.
 * Each of the 12 positions owns a 30 degree slice of the hue wheel, so "adjacent on
 * the circle" and "adjacent in colour" become the same statement.
 */

export const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
export const FLAT_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];

/** Pitch classes in circle-of-fifths order, starting at C. */
export const FIFTHS = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];

export const TAU = Math.PI * 2;

export const pitchClass = (midi) => ((midi % 12) + 12) % 12;
export const octaveOf = (midi) => Math.floor(midi / 12) - 1;
export const noteName = (midi) => NOTE_NAMES[pitchClass(midi)] + octaveOf(midi);
export const midiToFreq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
export const freqToMidi = (hz) => 69 + 12 * Math.log2(hz / 440);

/** Index of a pitch class on the circle of fifths (0..11). */
export const circleIndex = (pc) => (pitchClass(pc) * 7) % 12;

/** Shortest number of fifth-steps between two pitch classes (0..6). */
export function circleDistance(a, b) {
  const d = Math.abs(circleIndex(a) - circleIndex(b));
  return Math.min(d, 12 - d);
}

/** Hue in degrees for a pitch class, `offset` rotates the whole wheel. */
export function hueFor(pc, offset = 0) {
  return wrapDeg(circleIndex(pc) * 30 + offset);
}

/** Angle (radians) of a pitch class on screen, 12 o'clock = C by default. */
export function circleAngle(pc, rotationDeg = 0) {
  return ((circleIndex(pc) * 30 + rotationDeg - 90) * Math.PI) / 180;
}

export const wrapDeg = (deg) => ((deg % 360) + 360) % 360;

/** Signed shortest difference a - b, in (-180, 180]. */
export function angleDelta(a, b) {
  let d = wrapDeg(a - b);
  if (d > 180) d -= 360;
  return d;
}

/** Circular (vector) mean of hues, weighted. Returns degrees, or null if empty. */
export function circularMeanHue(hues, weights) {
  let x = 0;
  let y = 0;
  for (let i = 0; i < hues.length; i++) {
    const w = weights ? weights[i] : 1;
    const r = (hues[i] * Math.PI) / 180;
    x += Math.cos(r) * w;
    y += Math.sin(r) * w;
  }
  if (x === 0 && y === 0) return hues.length ? hues[0] : null;
  return wrapDeg((Math.atan2(y, x) * 180) / Math.PI);
}

/**
 * Width of the smallest arc of the circle of fifths that contains every note.
 * 0 for a unison, 1 for a perfect fifth, 6 for a tritone, 7+ for chromatic clusters.
 */
export function fifthsSpan(pcs) {
  const idx = [...new Set(pcs.map(circleIndex))].sort((a, b) => a - b);
  if (idx.length < 2) return 0;
  let largestGap = 12 - idx[idx.length - 1] + idx[0];
  for (let i = 1; i < idx.length; i++) largestGap = Math.max(largestGap, idx[i] - idx[i - 1]);
  return 12 - largestGap;
}

export const clamp = (v, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;

/** HSL (h in degrees, s/l in 0..1) -> {r,g,b} in 0..255. */
export function hslToRgb(h, s, l) {
  const hp = wrapDeg(h) / 60;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255)
  };
}

export function css(color, alpha = 1) {
  return `hsla(${wrapDeg(color.h).toFixed(1)}, ${(clamp(color.s) * 100).toFixed(1)}%, ${(clamp(color.l) * 100).toFixed(1)}%, ${clamp(alpha).toFixed(3)})`;
}
