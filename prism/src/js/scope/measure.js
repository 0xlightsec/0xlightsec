/**
 * Oscilloscope measurements. Pure functions over sample buffers, so they can be
 * tested without an audio context.
 */

/**
 * Find a rising-edge trigger: the signal must first drop below `level - hysteresis`
 * (arming), then cross `level`. Hysteresis stops noise around the level from
 * firing on every wobble.
 *
 * Searches [from, to) and returns the LAST crossing found, so the display shows the
 * most recent audio. The return value is fractional: the crossing is interpolated
 * between samples, which removes the one-sample jitter a high note would otherwise
 * show as a shimmering trace. Returns -1 when nothing triggers.
 */
export function findTrigger(buf, { level = 0, hysteresis = 0.01, from = 1, to = buf.length } = {}) {
  let armed = false;
  let found = -1;
  const lo = level - hysteresis;
  for (let i = Math.max(1, from); i < Math.min(to, buf.length); i++) {
    const prev = buf[i - 1];
    const cur = buf[i];
    if (prev < lo) armed = true;
    if (armed && prev < level && cur >= level) {
      const frac = cur === prev ? 0 : (level - prev) / (cur - prev);
      found = i - 1 + frac;
      armed = false;
    }
  }
  return found;
}

/** Min, max and peak-to-peak over [from, to). */
export function peakToPeak(buf, from = 0, to = buf.length) {
  let min = Infinity;
  let max = -Infinity;
  for (let i = from; i < to; i++) {
    const v = buf[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (min === Infinity) return { min: 0, max: 0, vpp: 0 };
  return { min, max, vpp: max - min };
}

/** Root-mean-square over [from, to). */
export function rms(buf, from = 0, to = buf.length) {
  let sum = 0;
  const n = Math.max(1, to - from);
  for (let i = from; i < to; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / n);
}

/** Linear amplitude to dBFS, floored so silence reads as a number, not -Infinity. */
export function toDb(x, floor = -90) {
  return x > 0 ? Math.max(floor, 20 * Math.log10(x)) : floor;
}

/** Read a sample at a fractional index by linear interpolation. */
export function sampleAt(buf, x) {
  const i = Math.floor(x);
  if (i < 0) return buf[0] ?? 0;
  if (i >= buf.length - 1) return buf[buf.length - 1] ?? 0;
  const f = x - i;
  return buf[i] * (1 - f) + buf[i + 1] * f;
}
