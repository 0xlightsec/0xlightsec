/**
 * Built-in oscilloscope music, generated on demand rather than shipped as audio
 * files, so it adds nothing to the download.
 *
 * In oscilloscope music the left channel is X and the right is Y, and the rate at
 * which a picture is redrawn is the pitch you hear. Each track here is a picture
 * traced by a phase accumulator (so pitch changes never click) at the frequency
 * of the note being played, with a short envelope per note.
 */

const TAU = Math.PI * 2;
const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

/* ------------------------------- path tracing ------------------------------ */

/**
 * Turn a set of strokes into a function of u in [0, 1) that walks them at
 * constant speed. The beam's jumps between strokes count for a fraction of their
 * length, so it crosses gaps quickly — that is what keeps them faint on screen.
 */
function tracer(strokes, jumpWeight = 0.06) {
  const segs = [];
  let last = null;
  for (const stroke of strokes) {
    if (last) segs.push({ a: last, b: stroke[0], jump: true });
    for (let i = 1; i < stroke.length; i++) segs.push({ a: stroke[i - 1], b: stroke[i], jump: false });
    last = stroke[stroke.length - 1];
  }
  if (last) segs.push({ a: last, b: strokes[0][0], jump: true }); // back to the start
  const lengths = segs.map((s) => {
    const len = Math.hypot(...s.b.map((v, i) => v - s.a[i]));
    return s.jump ? len * jumpWeight : len;
  });
  const total = lengths.reduce((a, b) => a + b, 0) || 1;
  const cumulative = [];
  lengths.reduce((acc, l) => (cumulative.push(acc + l), acc + l), 0);
  return (u) => {
    const d = (((u % 1) + 1) % 1) * total;
    let i = 0;
    while (i < cumulative.length - 1 && cumulative[i] < d) i++;
    const start = i === 0 ? 0 : cumulative[i - 1];
    const f = lengths[i] ? (d - start) / lengths[i] : 0;
    const { a, b } = segs[i];
    return a.map((v, k) => v + (b[k] - v) * f);
  };
}

/** Per-note envelope: quick attack, short release, so each note pulses the picture. */
function envelope(t, length, attack = 0.012, release = 0.04) {
  return Math.min(1, t / attack, Math.max(0, (length - t) / release));
}

/**
 * Play `notes` ([midi, beats]) at `bpm`, calling draw(u, time, noteIndex) per
 * sample. `env` sets the per-note attack and release in seconds.
 */
function sequence(sr, bpm, notes, draw, transpose = 0, env = { attack: 0.012, release: 0.04 }) {
  const beat = 60 / bpm;
  const total = notes.reduce((a, [, b]) => a + b * beat, 0);
  const n = Math.round(total * sr);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  let i = 0;
  let phase = 0;
  notes.forEach(([midi, beats], index) => {
    const len = beats * beat;
    const count = Math.round(len * sr);
    const f = hz(midi + transpose);
    for (let k = 0; k < count && i < n; k++, i++) {
      const t = k / sr;
      const [x, y] = draw(phase, i / sr, index);
      const e = envelope(t, len, env.attack, env.release) * 0.86;
      left[i] = x * e;
      right[i] = y * e;
      phase += f / sr;
    }
  });
  return { left, right };
}

const rotate = ([x, y], a) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];

/* --------------------------------- tracks --------------------------------- */

/** Two tones at a just interval: the left tone is X, the right is Y. */
function intervals(sr) {
  const steps = [
    [1, 1, 'unison'], [2, 1, 'octave'], [3, 2, 'fifth'], [4, 3, 'fourth'],
    [5, 4, 'major third'], [6, 5, 'minor third'], [5, 3, 'major sixth'], [3, 2, 'fifth']
  ];
  const roots = [45, 45, 45, 45, 41, 43, 45, 45]; // A2 most of the way, a turn through F and G
  const per = 3; // seconds per interval
  const n = Math.round(steps.length * per * sr);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const s = Math.min(steps.length - 1, Math.floor(t / per));
    const [hi, lo] = steps[s];
    const local = t - s * per;
    // A slow drift of the upper tone's phase makes the figure turn, as a
    // slightly out-of-tune interval does on a real scope.
    const drift = 0.5 * t;
    const e = envelope(local, per, 0.05, 0.12) * 0.82;
    left[i] = Math.sin(TAU * lo * phase) * e;
    right[i] = Math.sin(TAU * hi * phase + drift) * e;
    phase += hz(roots[s]) / 2 / sr;
  }
  return { left, right };
}

/** A wireframe cube, rotating, drawn at the pitch of a bassline. */
function cube(sr) {
  const v = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) v.push([x, y, z]);
  // One continuous walk that covers all twelve edges (three are retraced).
  const order = [0, 1, 3, 2, 0, 4, 5, 1, 5, 7, 3, 7, 6, 2, 6, 4];
  const walk = tracer([order.map((k) => v[k])], 1);
  const bass = [[33, 2], [33, 1], [40, 1], [36, 2], [36, 1], [43, 1], [38, 2], [38, 1], [45, 1], [40, 2], [43, 1], [40, 1]];
  return sequence(sr, 112, [...bass, ...bass], (u, t) => {
    let [x, y, z] = walk(u);
    const a = t * 0.9;
    const b = t * 0.53;
    [x, z] = [x * Math.cos(a) + z * Math.sin(a), -x * Math.sin(a) + z * Math.cos(a)];
    [y, z] = [y * Math.cos(b) - z * Math.sin(b), y * Math.sin(b) + z * Math.cos(b)];
    const p = 3.2 / (3.2 + z);
    return [x * p * 0.5, y * p * 0.5];
  }, 12);
}

/** Rose curves r = cos(kθ); the petal count follows the arpeggio. */
function rose(sr) {
  const notes = [];
  const chords = [[48, 52, 55, 60], [45, 48, 52, 57], [41, 45, 48, 53], [43, 47, 50, 55]];
  for (const chord of [...chords, ...chords]) for (const m of chord) notes.push([m, 0.5]);
  const petals = [3, 2, 5, 4, 7, 3, 5, 2];
  return sequence(sr, 96, notes, (u, t, index) => {
    const k = petals[Math.floor(index / 4) % petals.length];
    const th = TAU * u;
    const r = Math.cos(k * th);
    return rotate([r * Math.cos(th) * 0.9, r * Math.sin(th) * 0.9], t * 0.4);
  });
}

/** The word PRISM in beam-drawn letters. */
function word(sr) {
  const glyphs = {
    P: [[[0, 0], [0, 1], [0.55, 1], [0.7, 0.85], [0.7, 0.65], [0.55, 0.5], [0, 0.5]]],
    R: [[[0, 0], [0, 1], [0.55, 1], [0.7, 0.85], [0.7, 0.65], [0.55, 0.5], [0, 0.5]], [[0.3, 0.5], [0.7, 0]]],
    I: [[[0.1, 1], [0.6, 1]], [[0.35, 1], [0.35, 0]], [[0.1, 0], [0.6, 0]]],
    S: [[[0.7, 0.88], [0.55, 1], [0.15, 1], [0, 0.85], [0, 0.65], [0.15, 0.5], [0.55, 0.5], [0.7, 0.35], [0.7, 0.15], [0.55, 0], [0.15, 0], [0, 0.12]]],
    M: [[[0, 0], [0, 1], [0.35, 0.45], [0.7, 1], [0.7, 0]]]
  };
  const strokes = [];
  [...'PRISM'].forEach((ch, i) => {
    for (const s of glyphs[ch]) strokes.push(s.map(([x, y]) => [(x + i * 0.95 - 2.25) * 0.36, (y - 0.5) * 0.5]));
  });
  const walk = tracer(strokes);
  const melody = [[43, 1], [43, 0.5], [46, 0.5], [48, 1], [50, 1], [43, 1], [41, 1], [43, 2]];
  return sequence(sr, 100, [...melody, ...melody], (u, t) => {
    const [x, y] = walk(u);
    // A gentle tilt, as if the word were turning on a card.
    const tilt = Math.sin(t * 0.8) * 0.35;
    return [x * Math.cos(tilt), y + x * Math.sin(tilt) * 0.25];
  });
}

/** A rotating star, then a square and a circle drawn alternately. */
function starAndShapes(sr) {
  const star = [];
  for (let k = 0; k <= 10; k++) {
    const r = k % 2 ? 0.34 : 0.85;
    const a = Math.PI / 2 + (k * Math.PI) / 5;
    star.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  const starWalk = tracer([star], 1);
  const circle = [];
  for (let k = 0; k <= 48; k++) circle.push([0.45 + 0.4 * Math.cos((k / 48) * TAU), 0.4 * Math.sin((k / 48) * TAU)]);
  // Square and circle as two strokes, so the beam crosses between them quickly
  // but continuously — an instant jump would be a click in the audio.
  const pair = tracer([[[-0.85, -0.4], [-0.05, -0.4], [-0.05, 0.4], [-0.85, 0.4], [-0.85, -0.4]], circle]);
  const melody = [[48, 2], [52, 2], [55, 2], [52, 2], [50, 2], [53, 2], [55, 4]];
  // Sixteen seconds: the star for the first half, the square and circle after.
  return sequence(sr, 120, [...melody, ...melody], (u, t) => {
    if (t < 8) return rotate(starWalk(u), 0.6 * t);
    return pair(u);
  });
}

/**
 * The classic first lesson: a sine on X and a cosine on Y draw a circle. Add the
 * same square wave to both channels and the beam jumps between two places every
 * other turn, so you see two circles — and hear the square wave as a buzz an
 * octave below the tone. The jump is eased over a few samples rather than taken
 * instantly, which would be a click.
 */
function twoCircles(sr) {
  const notes = [[45, 4], [45, 4], [43, 4], [41, 4], [45, 4], [48, 4], [43, 4], [45, 4]];
  const ease = 0.008; // fraction of a turn spent crossing: fast enough to stay faint
  return sequence(sr, 100, notes, (u) => {
    const turn = Math.floor(u);
    const w = u - turn;
    const side = turn % 2 ? 1 : -1;
    let s = side;
    if (w < ease) {
      const k = w / ease;
      s = -side + (side - -side) * k * k * (3 - 2 * k);
    }
    const th = TAU * u;
    return [0.34 * Math.cos(th) + s * 0.4, 0.34 * Math.sin(th) + s * 0.3];
    // Almost no fade between notes: a longer one shrinks the picture, and the
    // persistence leaves rings of smaller circles behind.
  }, 0, { attack: 0.003, release: 0.006 });
}

export const TRACKS = [
  { id: 'circles', name: 'Two Circles', render: twoCircles },
  { id: 'intervals', name: 'Lissajous Intervals', render: intervals },
  { id: 'cube', name: 'Spinning Cube', render: cube },
  { id: 'rose', name: 'Rose Garden', render: rose },
  { id: 'prism', name: 'PRISM', render: word },
  { id: 'star', name: 'Star & Shapes', render: starAndShapes }
];

/** 16-bit stereo WAV, so a generated track plays through the same player as a file. */
export function encodeWav(left, right, sr) {
  const n = left.length;
  const buf = new ArrayBuffer(44 + n * 4);
  const dv = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); dv.setUint32(4, 36 + n * 4, true); str(8, 'WAVE');
  str(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 2, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * 4, true); dv.setUint16(32, 4, true); dv.setUint16(34, 16, true);
  str(36, 'data'); dv.setUint32(40, n * 4, true);
  for (let i = 0, o = 44; i < n; i++, o += 4) {
    dv.setInt16(o, Math.max(-1, Math.min(1, left[i])) * 32767, true);
    dv.setInt16(o + 2, Math.max(-1, Math.min(1, right[i])) * 32767, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

export function renderTrack(id, sr) {
  const track = TRACKS.find((t) => t.id === id);
  if (!track) throw new Error(`no track ${id}`);
  return track.render(sr);
}
