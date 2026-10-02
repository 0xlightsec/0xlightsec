/**
 * Saved loops: a `.prism` file holds everything needed to pick a loop back up —
 * every layer's audio and effects, the beat and tempo, and the sound you were
 * playing.
 *
 *   bytes 0-7   "PRISMLP1"
 *   bytes 8-11  header length (uint32, little-endian)
 *   header      JSON (UTF-8), padded with spaces to an even length
 *   audio       each layer as 16-bit PCM (little-endian), `length` samples, in order
 *
 * Each layer is scaled to its own peak before it's rounded to 16 bits, so a quiet
 * layer keeps its detail, and the scale is stored in the header.
 *
 * Pure code, so the tests round-trip it directly.
 */

const MAGIC = 'PRISMLP1';
export const PROJECT_VERSION = 1;
export const FILE_EXTENSION = '.prism';

/**
 * @param {object} meta        header fields: name, sampleRate, length, bpm, beat, session, …
 * @param {Float32Array[]} layers  one per layer, each `meta.length` samples
 * @param {object[]} layerFx   effects for each layer
 */
export function encodeProject(meta, layers, layerFx = []) {
  const length = meta.length;
  const scales = layers.map((data) => {
    let peak = 0;
    for (let i = 0; i < length; i++) peak = Math.max(peak, Math.abs(data[i] ?? 0));
    return peak > 0 ? peak / 32767 : 1;
  });
  const header = {
    ...meta,
    version: PROJECT_VERSION,
    layers: layers.map((_, k) => ({ scale: scales[k], fx: layerFx[k] ?? {} }))
  };
  let json = JSON.stringify(header);
  const enc = new TextEncoder();
  let head = enc.encode(json);
  if (head.length % 2) head = enc.encode((json += ' ')); // keep the PCM 2-byte aligned
  const bytes = new Uint8Array(12 + head.length + layers.length * length * 2);
  bytes.set(enc.encode(MAGIC), 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, head.length, true);
  bytes.set(head, 12);
  let at = 12 + head.length;
  layers.forEach((data, k) => {
    const s = scales[k];
    for (let i = 0; i < length; i++) {
      const v = Math.round((data[i] ?? 0) / s);
      view.setInt16(at, v > 32767 ? 32767 : v < -32768 ? -32768 : v, true);
      at += 2;
    }
  });
  return bytes;
}

/** The header and layers back out of a file; throws on anything that isn't one. */
export function decodeProject(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < 12 || new TextDecoder().decode(bytes.subarray(0, 8)) !== MAGIC) {
    throw new Error('not a PRISM loop file');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headLen = view.getUint32(8, true);
  if (12 + headLen > bytes.length) throw new Error('this loop file is cut short');
  const meta = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + headLen)));
  if (!(meta.version <= PROJECT_VERSION)) throw new Error('this loop was saved by a newer PRISM');
  const length = meta.length | 0;
  const count = meta.layers?.length ?? 0;
  if (12 + headLen + count * length * 2 > bytes.length) throw new Error('this loop file is cut short');
  let at = 12 + headLen;
  const layers = meta.layers.map(({ scale }) => {
    const data = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      data[i] = view.getInt16(at, true) * scale;
      at += 2;
    }
    return data;
  });
  return { meta, layers, layerFx: meta.layers.map((l) => l.fx ?? {}) };
}

/** Linear-interpolated resampling, for a loop saved at another sample rate. */
export function resample(data, from, to) {
  if (from === to) return data;
  const n = Math.max(1, Math.round((data.length * to) / from));
  const out = new Float32Array(n);
  const step = from / to;
  for (let i = 0; i < n; i++) {
    const x = i * step;
    const k = Math.floor(x);
    const a = data[k] ?? 0;
    const b = data[k + 1] ?? data[0] ?? 0; // wrap: it's a loop
    out[i] = a + (b - a) * (x - k);
  }
  return out;
}

/** A name for a new save: "Loop - Oct 2, 17:58". */
export function defaultName(date = new Date()) {
  const month = date.toLocaleString('en', { month: 'short' });
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `Loop - ${month} ${date.getDate()}, ${hh}:${mm}`;
}

/**
 * A file name that's safe on every platform. Plain ASCII: Chromium quietly names
 * a download "download" if the suggested name has anything else in it.
 */
export function fileNameFor(name) {
  const clean = String(name)
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '') // é -> e
    .replace(/[^\x20-\x7e]+/g, ' ')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, 80);
  return `${clean || 'PRISM loop'}${FILE_EXTENSION}`;
}
