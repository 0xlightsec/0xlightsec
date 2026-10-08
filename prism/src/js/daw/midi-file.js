/**
 * Standard MIDI Files: read and write .mid, so beats move between PRISM and any
 * other DAW (FL Studio, Ableton, Logic …) or a hardware sequencer.
 *
 * Writing makes a type-1 file: a tempo track, then one track per channel. Drum
 * channels go out on MIDI channel 10 with their General MIDI note numbers, which
 * is what every drum machine expects; synths get channels 1–9, 11–16.
 *
 * Reading accepts types 0 and 1, running status, note-ons with velocity 0 as
 * note-offs, and the first tempo it finds. Pure code, tested round-trip.
 */

export const PPQ = 96; // ticks per quarter note: 24 per sixteenth step

/* ---------------------------------- writing --------------------------------- */

function vlq(n) {
  const out = [n & 0x7f];
  while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80);
  return out;
}

const text = (s) => [...new TextEncoder().encode(String(s).slice(0, 120))];

function chunk(type, body) {
  const len = body.length;
  return [...text(type), (len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255, ...body];
}

/** Events [{ tick, bytes }] to a track chunk, sorted, with an end-of-track. */
function track(events) {
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const body = [];
  let last = 0;
  for (const e of events) {
    body.push(...vlq(Math.max(0, e.tick - last)), ...e.bytes);
    last = e.tick;
  }
  body.push(0, 0xff, 0x2f, 0);
  return chunk('MTrk', body);
}

/**
 * @param {object} song  { name, bpm, tracks: [{ name, channel (0-15), notes: [{ start, length, midi, velocity }] }] }
 *                       with start and length in sixteenth steps
 */
export function encodeMidi({ name = 'PRISM', bpm = 120, tracks = [] }) {
  const perStep = PPQ / 4;
  const tempo = Math.round(60000000 / bpm);
  const head = [
    { tick: 0, order: 0, bytes: [0xff, 0x03, ...vlq(text(name).length), ...text(name)] },
    { tick: 0, order: 1, bytes: [0xff, 0x51, 3, (tempo >> 16) & 255, (tempo >> 8) & 255, tempo & 255] },
    { tick: 0, order: 2, bytes: [0xff, 0x58, 4, 4, 2, 24, 8] } // 4/4
  ];
  const chunks = [track(head)];
  for (const t of tracks) {
    const ch = t.channel & 15;
    const events = [{ tick: 0, order: 0, bytes: [0xff, 0x03, ...vlq(text(t.name).length), ...text(t.name)] }];
    for (const n of t.notes) {
      const on = Math.round(n.start * perStep);
      const off = Math.max(on + 1, Math.round((n.start + n.length) * perStep));
      const vel = Math.max(1, Math.min(127, Math.round(n.velocity * 127)));
      // At equal ticks, offs go before ons, so a repeated note re-strikes cleanly.
      events.push({ tick: on, order: 2, bytes: [0x90 | ch, n.midi & 127, vel] });
      events.push({ tick: off, order: 1, bytes: [0x80 | ch, n.midi & 127, 0] });
    }
    chunks.push(track(events));
  }
  const header = chunk('MThd', [0, 1, 0, chunks.length, (PPQ >> 8) & 255, PPQ & 255]);
  return new Uint8Array([...header, ...chunks.flat()]);
}

/* ---------------------------------- reading --------------------------------- */

/**
 * @returns {{ bpm: number, ppq: number, tracks: { name, channel, notes: { start, length, midi, velocity }[] }[] }}
 *          start and length in sixteenth steps. A track playing on several MIDI
 *          channels is split, one track per channel.
 */
export function decodeMidi(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  const str = (at, n) => String.fromCharCode(...b.subarray(at, at + n));
  const u32 = (at) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
  const u16 = (at) => (b[at] << 8) | b[at + 1];
  if (b.length < 14 || str(0, 4) !== 'MThd') throw new Error('not a MIDI file');
  const format = u16(8);
  const count = u16(10);
  const division = u16(12);
  if (division & 0x8000) throw new Error('SMPTE-timed MIDI files are not supported');
  if (format > 1) throw new Error('type 2 MIDI files are not supported');
  const ppq = division || 96;
  let at = 8 + u32(4);
  let bpm = null;
  const tracks = [];

  for (let t = 0; t < count && at + 8 <= b.length; t++) {
    const type = str(at, 4);
    const len = u32(at + 4);
    const start = at + 8;
    const end = Math.min(b.length, start + len);
    at = start + len;
    if (type !== 'MTrk') continue;
    let p = start;
    let tick = 0;
    let status = 0;
    let name = '';
    const open = new Map();   // channel*128+note -> [{ tick, vel }]
    const byChannel = new Map();
    const read = () => {
      let v = 0;
      for (let i = 0; i < 4 && p < end; i++) {
        const c = b[p++];
        v = (v << 7) | (c & 0x7f);
        if (!(c & 0x80)) break;
      }
      return v;
    };
    const close = (ch, note, when) => {
      const stack = open.get(ch * 128 + note);
      if (!stack?.length) return;
      const on = stack.shift();
      if (!byChannel.has(ch)) byChannel.set(ch, []);
      byChannel.get(ch).push({ tick: on.tick, ticks: Math.max(1, when - on.tick), midi: note, velocity: on.vel / 127 });
    };
    while (p < end) {
      tick += read();
      let s = b[p];
      if (s & 0x80) p++;
      else s = status; // running status
      if (s === 0xff) {
        const meta = b[p++];
        const n = read();
        if (meta === 0x51 && n === 3 && bpm === null) bpm = 60000000 / ((b[p] << 16) | (b[p + 1] << 8) | b[p + 2]);
        if (meta === 0x03 && !name) name = new TextDecoder().decode(b.subarray(p, p + n));
        p += n;
        continue;
      }
      if (s === 0xf0 || s === 0xf7) {
        p += read();
        continue;
      }
      status = s;
      const kind = s & 0xf0;
      const ch = s & 0x0f;
      const d1 = b[p++];
      const d2 = kind === 0xc0 || kind === 0xd0 ? 0 : b[p++];
      if (kind === 0x90 && d2 > 0) {
        const key = ch * 128 + d1;
        if (!open.has(key)) open.set(key, []);
        open.get(key).push({ tick, vel: d2 });
      } else if (kind === 0x80 || (kind === 0x90 && d2 === 0)) {
        close(ch, d1, tick);
      }
    }
    for (const key of open.keys()) while (open.get(key).length) close(Math.floor(key / 128), key % 128, tick);
    const perStep = ppq / 4;
    for (const [ch, list] of [...byChannel].sort((x, y) => x[0] - y[0])) {
      tracks.push({
        name: name || `Track ${tracks.length + 1}`,
        channel: ch,
        notes: list.sort((x, y) => x.tick - y.tick || x.midi - y.midi).map((n) => ({
          start: n.tick / perStep,
          length: n.ticks / perStep,
          midi: n.midi,
          velocity: n.velocity
        }))
      });
    }
  }
  return { bpm: bpm ?? 120, ppq, tracks };
}
