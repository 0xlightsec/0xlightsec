/**
 * Drawn waves: one cycle of a synth's waveform as WAVE_N samples (−1 … 1), the
 * way FL's Sytrus or Harmor let you draw the shape or set its harmonics.
 *
 * A wave and its harmonics are the same thing two ways round: the Fourier series
 * (cosine and sine coefficients per harmonic) goes to Web Audio's PeriodicWave,
 * which the browser band-limits so a drawn saw doesn't alias. Everything here is
 * pure, so the tests check it directly.
 */

export const WAVE_N = 128;        // samples per cycle
export const HARMONICS = 32;      // bars in the harmonics editor
const TOP = WAVE_N / 2 - 1;       // the highest harmonic a cycle of WAVE_N samples can hold

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** The classic shapes, and a few more, at peak 1. */
export const WAVE_SHAPES = {
  sine: { label: 'Sine', make: (x) => Math.sin(2 * Math.PI * x) },
  triangle: { label: 'Triangle', make: (x) => 1 - 4 * Math.abs(((x + 0.75) % 1) - 0.5) },
  sawtooth: { label: 'Saw', make: (x) => 2 * ((x + 0.5) % 1) - 1 },
  square: { label: 'Square', make: (x) => (x < 0.5 ? 1 : -1) },
  pulse: { label: 'Pulse', make: (x) => (x < 0.25 ? 1 : -1 / 3) },
  organ: { label: 'Organ', make: (x) => (Math.sin(2 * Math.PI * x) + 0.5 * Math.sin(4 * Math.PI * x) + 0.33 * Math.sin(6 * Math.PI * x) + 0.25 * Math.sin(8 * Math.PI * x)) / 1.6 },
  fold: { label: 'Fold', make: (x) => Math.sin(2 * Math.PI * x) * Math.cos(6 * Math.PI * x) }
};

/** One cycle of a named shape (a sine if the name is unknown). */
export function shapeWave(name) {
  const shape = WAVE_SHAPES[name] ?? WAVE_SHAPES.sine;
  return normalizeWave(Array.from({ length: WAVE_N }, (_, n) => shape.make(n / WAVE_N)));
}

/** Random harmonics, falling off with pitch: a new timbre every time. */
export function randomWave(rand = Math.random) {
  const real = new Float32Array(HARMONICS + 1);
  const imag = new Float32Array(HARMONICS + 1);
  for (let k = 1; k <= HARMONICS; k++) {
    const amount = Math.pow(rand(), 1.5) / Math.pow(k, 0.4 + rand() * 0.8);
    const phase = rand() * 2 * Math.PI;
    real[k] = amount * Math.cos(phase);
    imag[k] = amount * Math.sin(phase);
  }
  return normalizeWave(harmonicsToWave(real, imag));
}

/**
 * Fourier series of a cycle: cosine (real) and sine (imag) coefficients for
 * harmonics 1 … count, the way createPeriodicWave takes them (index 0 unused).
 */
export function waveToHarmonics(samples, count = TOP) {
  const N = samples.length;
  const real = new Float32Array(count + 1);
  const imag = new Float32Array(count + 1);
  for (let k = 1; k <= count; k++) {
    let a = 0, b = 0;
    for (let n = 0; n < N; n++) {
      const t = (2 * Math.PI * k * n) / N;
      a += samples[n] * Math.cos(t);
      b += samples[n] * Math.sin(t);
    }
    real[k] = (2 / N) * a;
    imag[k] = (2 / N) * b;
  }
  return { real, imag };
}

/** Back from the series to a cycle. */
export function harmonicsToWave(real, imag, N = WAVE_N) {
  const out = new Array(N).fill(0);
  for (let k = 1; k < real.length; k++) {
    if (!real[k] && !imag[k]) continue;
    for (let n = 0; n < N; n++) {
      const t = (2 * Math.PI * k * n) / N;
      out[n] += real[k] * Math.cos(t) + imag[k] * Math.sin(t);
    }
  }
  return out;
}

/** The size of each harmonic (0 … about 1): the bars. */
export function harmonicLevels(samples, count = HARMONICS) {
  const { real, imag } = waveToHarmonics(samples, count);
  return Array.from({ length: count }, (_, i) => Math.hypot(real[i + 1], imag[i + 1]));
}

/**
 * Set one harmonic's size, keeping its phase (a sine's, if it had none), and the
 * rest as they were. The result is scaled down if it would go past ±1.
 */
export function setHarmonic(samples, k, level) {
  const { real, imag } = waveToHarmonics(samples, TOP);
  const have = Math.hypot(real[k], imag[k]);
  const phase = have > 1e-6 ? Math.atan2(imag[k], real[k]) : Math.PI / 2;
  real[k] = level * Math.cos(phase);
  imag[k] = level * Math.sin(phase);
  const out = harmonicsToWave(real, imag, samples.length);
  const peak = Math.max(...out.map(Math.abs));
  return peak > 1 ? out.map((v) => v / peak) : out;
}

/** Scale so the loudest point is at 1 (silence stays silence). */
export function normalizeWave(samples) {
  const peak = Math.max(...samples.map(Math.abs));
  return peak > 1e-6 ? samples.map((v) => v / peak) : [...samples];
}

/** Take out the DC offset, so the wave sits around zero. */
export function centreWave(samples) {
  const mean = samples.reduce((s, v) => s + v, 0) / samples.length;
  return samples.map((v) => v - mean);
}

/** A circular 3-point moving average, `passes` times: rounds corners off. */
export function smoothWave(samples, passes = 2) {
  let s = [...samples];
  const N = s.length;
  for (let p = 0; p < passes; p++) s = s.map((_, n) => (s[(n + N - 1) % N] + 2 * s[n] + s[(n + 1) % N]) / 4);
  return s;
}

/** Half-wave symmetry: the second half is the first upside down, which leaves only odd harmonics (hollow, square-like). */
export function symmetricWave(samples) {
  const N = samples.length;
  const half = N / 2;
  return samples.map((v, n) => (n < half ? v : -samples[n - half]));
}

export const invertWave = (samples) => samples.map((v) => -v);

/**
 * A wave as saved: WAVE_N numbers in −1 … 1 (resampled if it was another
 * length), rounded to keep the file small; null for anything that isn't one.
 */
export function cleanWave(raw) {
  if (!Array.isArray(raw) || raw.length < 16 || raw.length > 4096) return null;
  if (!raw.every((v) => Number.isFinite(v))) return null;
  const N = raw.length;
  const out = new Array(WAVE_N);
  for (let n = 0; n < WAVE_N; n++) {
    const x = (n / WAVE_N) * N;
    const i = Math.floor(x);
    const f = x - i;
    out[n] = Math.round(clamp(raw[i % N] * (1 - f) + raw[(i + 1) % N] * f, -1, 1) * 1000) / 1000;
  }
  return out;
}

/** The wave a sound's first oscillator makes on its own (what a drawn wave starts from). */
export function baseWaveOf(preset) {
  const first = preset?.osc?.[0];
  return shapeWave(first?.saws ? 'sawtooth' : first?.type ?? 'sine');
}

const tables = new WeakMap(); // ctx -> Map(key -> PeriodicWave)

/** A PeriodicWave for a drawn cycle on this context, made once per distinct wave. */
export function periodicWave(ctx, samples) {
  let cache = tables.get(ctx);
  if (!cache) tables.set(ctx, (cache = new Map()));
  const key = samples.join(',');
  let wave = cache.get(key);
  if (!wave) {
    const { real, imag } = waveToHarmonics(samples, TOP);
    wave = ctx.createPeriodicWave(real, imag);
    if (cache.size > 64) cache.clear();
    cache.set(key, wave);
  }
  return wave;
}
