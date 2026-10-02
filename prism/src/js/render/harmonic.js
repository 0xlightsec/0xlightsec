/**
 * Harmonic curve modes: the frequency ratio of what you are playing, drawn as a
 * glowing wireframe on pure black.
 *
 *   lissajous — two notes as a 2D Lissajous figure: x follows the lower note, y the
 *               upper, at their just ratio (3:2 for a fifth).
 *   orbital   — a chord as a 3D Lissajous (4:5:6 for a major triad), one axis per
 *               voice, projected and slowly drifting inside a wireframe cube.
 *
 * Motion is physical rather than decorative. A piano misses the just ratios slightly
 * — equal temperament, plus the stretch its stiff strings force on the tuning — and
 * on an oscilloscope that mistuning makes the figure roll through its phase at the
 * beat rate. The spin here runs at that real rate from the piano tuning model, so a
 * fifth at middle C turns about once every two seconds, a major third shimmers, and
 * octaves roll too (pure equal temperament would freeze them).
 * Each axis also follows its own note's envelope: release the top note and the
 * vertical axis collapses while the horizontal holds.
 */

import { NOTE_NAMES, pitchClass, clamp, lerp, TAU } from '../theory/circle.js';
import { pianoFrequency } from '../theory/piano.js';
import { chordRatios, intervalTitle, chordTitle } from '../theory/ratios.js';

const MAX_SPIN_HZ = 6;        // beyond this the frame rate aliases the roll into noise
const SINGLE_DRIFT = 0.12;    // rad/s for a lone note, which has nothing to beat against
const IDLE_AMP = 0.62;        // axis amplitude once its note has released
const CROSSFADE = 0.35;       // seconds to fade between figures
const RINGING = 0.06;         // envelope below which a released note leaves the figure
const PRECESSION = 0.035;     // rad of phase per rad of t: successive loops nest, offset
const PRECESSION_3D = [0.045, 0.07, 0.026]; // per axis, so the 3D trace sweeps a shell
const DENSE_RATIO = 20;       // above this the halo pass is overdraw, not glow
const SPHERICAL = 0.5;        // how far each orbital point is pulled toward the unit sphere
const CANONICAL = { lissajous: [60, 67], orbital: [60, 64, 67] };

// Golden-orange glow, built from widest/faintest to thinnest/hottest.
const PASSES = [
  { width: 11, alpha: 0.045, sat: 100, light: 48 },
  { width: 4.5, alpha: 0.12, sat: 100, light: 54 },
  { width: 1.7, alpha: 0.6, sat: 100, light: 60 },
  { width: 0.7, alpha: 0.8, sat: 70, light: 86 }
];

export class HarmonicRenderer {
  constructor() {
    this.time = 0;
    this.phases = [0, 0.6, 1.3, 2.1, 2.9, 3.7];
    this.yaw = 0.6;
    this.intensity = 0.5;
    this.current = null;
    this.previous = null;
    this.blend = 1;
    this.memory = {};           // last figure played in each mode, kept after release
  }

  /** Which notes to draw, their ratio, and the words for the header. */
  describe(mode, voices) {
    // Notes still ringing after release stay in the figure, so letting go of one
    // collapses its axis as it fades rather than snapping to a different figure.
    const sounding = voices.filter((v) => v.gate || v.env > RINGING).sort((a, b) => a.midi - b.midi);
    const distinct = [...new Map(sounding.map((v) => [v.midi, v])).keys()];
    const held = voices.some((v) => v.gate);

    // A new figure is only taken while a key is held; once everything is released
    // the last figure stays and its axes shrink as the notes die away. Without the
    // held check, a tail still ringing from another mode would hijack this one.
    let midis;
    if (held && distinct.length) {
      midis = mode === 'lissajous'
        ? (distinct.length === 1 ? [distinct[0]] : [distinct[0], distinct[distinct.length - 1]])
        : distinct.slice(0, 6);
      this.memory[mode] = midis;
    } else {
      midis = this.memory[mode] ?? CANONICAL[mode];
    }

    const ratios = midis.length === 1 ? [1, 1] : chordRatios(midis);
    let title;
    let ratioText;
    if (mode === 'lissajous') {
      const [lo, hi] = midis.length === 1 ? [midis[0], midis[0]] : midis;
      title = intervalTitle(lo, hi);
      ratioText = `${ratios[ratios.length - 1]} : ${ratios[0]}`; // upper : lower, as in "3 : 2"
    } else {
      title = midis.length >= 3 ? chordTitle(midis) : midis.length === 2 ? intervalTitle(midis[0], midis[1]) : 'A SINGLE TONE';
      ratioText = midis.length === 1 ? '1 : 1' : ratios.join(' : ');
    }

    return {
      key: `${mode}:${midis.join(',')}`,
      mode,
      midis,
      ratios: midis.length === 1 ? [1, 1, 1] : ratios,
      title,
      ratioText,
      labels: midis.map((m) => NOTE_NAMES[pitchClass(m)]),
      playing: held
    };
  }

  /** How far each voice misses its just position above the bass on a real piano, in Hz. */
  detunes(desc) {
    const f0 = pianoFrequency(desc.midis[0]);
    return desc.midis.map((m, i) => pianoFrequency(m) - f0 * (desc.ratios[i] / desc.ratios[0]));
  }

  amps(desc, voices) {
    const byMidi = new Map(voices.map((v) => [v.midi, v]));
    const amps = desc.midis.map((m) => {
      const v = byMidi.get(m);
      return v ? lerp(IDLE_AMP, 1, clamp(v.env)) : IDLE_AMP;
    });
    while (amps.length < desc.ratios.length) amps.push(amps[amps.length - 1] ?? IDLE_AMP);
    return amps;
  }

  update(mode, voices, energy, dt) {
    this.time += dt;
    const desc = this.describe(mode, voices);

    if (!this.current || this.current.key !== desc.key) {
      this.previous = this.current && this.current.mode === mode ? this.current : null;
      this.current = desc;
      this.blend = this.previous ? 0 : 1;
    } else {
      this.current.playing = desc.playing;
    }
    this.blend = Math.min(1, this.blend + dt / CROSSFADE);

    for (const fig of [this.current, this.previous]) {
      if (fig) fig.amps = this.amps(fig, voices);
    }

    const detune = this.detunes(this.current);
    const single = this.current.midis.length === 1;
    for (let i = 0; i < this.phases.length; i++) {
      const hz = clamp(detune[i] ?? 0, -MAX_SPIN_HZ, MAX_SPIN_HZ);
      this.phases[i] += (TAU * hz + (single ? SINGLE_DRIFT * (i % 2 ? 1 : -1) : 0)) * dt;
    }

    this.yaw += dt * 0.16;
    const target = this.current.playing ? 0.78 + 0.22 * energy : 0.45;
    this.intensity += (target - this.intensity) * Math.min(1, dt * 4);
  }

  draw(ctx, width, height, mode, brightness) {
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);

    const figures = [];
    if (this.previous && this.blend < 1) figures.push([this.previous, 1 - this.blend]);
    figures.push([this.current, this.blend]);

    for (const [fig, weight] of figures) {
      const strength = this.intensity * brightness * easeInOut(weight);
      if (strength < 0.01) continue;
      if (mode === 'orbital') this.drawOrbital(ctx, width, height, fig, strength);
      else this.drawLissajous(ctx, width, height, fig, strength);
    }

    if (mode === 'orbital') this.drawCage(ctx, width, height, brightness);
    else this.drawAxes(ctx, width, height, this.current, brightness);

    ctx.globalCompositeOperation = 'source-over';
  }

  /* ------------------------------ 2D: lissajous ------------------------------ */

  lissajousFrame(width, height) {
    // Leave the top band for the title and ratio; the axes reach r * 1.12.
    const top = height * 0.25;
    const size = Math.min(width * 0.62, (height - top) * 0.8);
    return { cx: width / 2, cy: top + (height - top) / 2, r: size / 2 };
  }

  drawLissajous(ctx, width, height, fig, strength) {
    const { cx, cy, r } = this.lissajousFrame(width, height);
    const lo = fig.ratios[0];
    const hi = fig.ratios[fig.ratios.length - 1];
    const [ax, ay] = fig.amps.length > 1 ? [fig.amps[0], fig.amps[fig.amps.length - 1]] : [fig.amps[0], fig.amps[0]];
    const top = Math.max(lo, hi);

    // A few slowly decaying passes nest the loops inside one another and pull the
    // eye to the centre, harmonograph-style. Denser ratios get fewer passes.
    const passes = clamp(Math.round(12 / top), 1, 4);
    const decay = Math.log(1 / 0.6) / (TAU * passes);
    const steps = Math.max(420, top * 64);
    const px = this.phases[0];
    const py = this.phases[1] + Math.PI / 4;

    for (let k = 0; k < passes; k++) {
      const path = new Path2D();
      for (let i = 0; i <= steps; i++) {
        const t = TAU * (k + i / steps);
        const d = Math.exp(-decay * t);
        const x = cx + r * ax * d * Math.sin(lo * t + px);
        const y = cy - r * ay * d * Math.sin(hi * t + py + PRECESSION * t);
        if (i === 0) path.moveTo(x, y);
        else path.lineTo(x, y);
      }
      // Outer loop deepest orange, inner loops paler gold.
      const hue = lerp(26, 44, passes === 1 ? 0.5 : k / (passes - 1));
      glow(ctx, path, hue, strength * lerp(1, 0.55, passes === 1 ? 0 : k / (passes - 1)), top > DENSE_RATIO);
    }
  }

  drawAxes(ctx, width, height, fig, brightness) {
    const { cx, cy, r } = this.lissajousFrame(width, height);
    const ext = r * 1.12;

    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = `rgba(255,255,255,${(0.07 * brightness).toFixed(3)})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - ext, cy);
    ctx.lineTo(cx + ext, cy);
    ctx.moveTo(cx, cy - ext);
    ctx.lineTo(cx, cy + ext);
    ctx.stroke();

    const [xLabel, yLabel] = fig.labels.length > 1 ? [fig.labels[0], fig.labels[fig.labels.length - 1]] : [fig.labels[0], fig.labels[0]];
    const size = Math.max(14, Math.round(r * 0.075));
    ctx.font = `400 ${size}px "Inter", -apple-system, "Segoe UI", system-ui, sans-serif`;
    ctx.fillStyle = `rgba(255,255,255,${(0.92 * Math.min(brightness, 1)).toFixed(3)})`;
    ctx.textBaseline = 'middle';

    // Vertical axis = upper note, labelled near its bottom end.
    ctx.textAlign = 'left';
    ctx.fillText(yLabel, cx + size * 0.55, cy + ext - size * 0.4);
    // Horizontal axis = lower note, labelled above its right end.
    ctx.textAlign = 'right';
    ctx.fillText(xLabel, cx + ext, cy - size * 0.95);
  }

  /* ------------------------------- 3D: orbital ------------------------------- */

  orbitalFrame(width, height) {
    const top = height * 0.24;
    const size = Math.min(width * 0.5, (height - top) * 0.78);
    return { cx: width / 2, cy: top + (height - top) / 2, s: size / 2 / 1.55 };
  }

  project(x, y, z, frame) {
    const pitch = -0.42 + Math.sin(this.time * 0.13) * 0.16;
    const cosY = Math.cos(this.yaw);
    const sinY = Math.sin(this.yaw);
    const x1 = x * cosY + z * sinY;
    const z1 = -x * sinY + z * cosY;
    const cosP = Math.cos(pitch);
    const sinP = Math.sin(pitch);
    const y2 = y * cosP - z1 * sinP;
    const z2 = y * sinP + z1 * cosP;
    const persp = 3.4 / (3.4 + z2);
    return [frame.cx + x1 * persp * frame.s, frame.cy - y2 * persp * frame.s, z2];
  }

  drawOrbital(ctx, width, height, fig, strength) {
    const frame = this.orbitalFrame(width, height);
    const n = fig.ratios.length;
    const top = Math.max(...fig.ratios);
    // Simple ratios close quickly and look sparse, so they get several precessing
    // loops; dense ones (a minor triad is 10:12:15) are already volumetric.
    const loops = clamp(Math.round(18 / top), 1, 3);
    const steps = clamp(top * 36 * loops, 900, 5000);

    // One axis per voice; with fewer than three voices the missing axes reuse a
    // voice a quarter-turn out of phase so the figure still has depth. Voices past
    // the third ride on the three axes as smaller modulations.
    const axes = [[], [], []];
    for (let a = 0; a < 3; a++) {
      const i = a % n;
      axes[a].push({ r: fig.ratios[i], amp: fig.amps[i] ?? IDLE_AMP, phase: this.phases[i] + (a >= n ? (a * Math.PI) / 2 : 0), w: 1 });
    }
    for (let i = 3; i < n; i++) {
      axes[i % 3].push({ r: fig.ratios[i], amp: fig.amps[i] ?? IDLE_AMP, phase: this.phases[i % this.phases.length], w: 0.32 });
    }
    const coord = (list, t, drift) => {
      let sum = 0;
      let wsum = 0;
      for (const c of list) {
        sum += c.w * c.amp * Math.sin(c.r * t + c.phase + drift);
        wsum += c.w;
      }
      return sum / wsum;
    };
    // Round the cube-filling Lissajous toward a shell: blend each point with its
    // direction on the unit sphere, keeping its own radius as the other half.
    const orbit = (t) => {
      const x = coord(axes[0], t, PRECESSION_3D[0] * t);
      const y = coord(axes[1], t, PRECESSION_3D[1] * t);
      const z = coord(axes[2], t, PRECESSION_3D[2] * t);
      const len = Math.hypot(x, y, z) || 1;
      const k = lerp(1, Math.min(1.25, 0.92 / len), SPHERICAL);
      return [x * k, y * k, z * k];
    };

    // Split the line into depth bands so the near side burns brighter than the far.
    // Runs stay continuous and only break where the band changes: one subpath per
    // segment would give every segment its own round cap, which beads the line and
    // costs orders of magnitude more to stroke.
    const bands = [new Path2D(), new Path2D(), new Path2D()];
    let prev = null;
    let current = -1;
    for (let i = 0; i <= steps; i++) {
      const t = (TAU * loops * i) / steps;
      const [ox, oy, oz] = orbit(t);
      const p = this.project(ox, oy, oz, frame);
      if (prev) {
        const z = (prev[2] + p[2]) / 2;
        const band = z < -0.35 ? 2 : z > 0.35 ? 0 : 1;
        if (band !== current) {
          bands[band].moveTo(prev[0], prev[1]);
          current = band;
        }
        bands[band].lineTo(p[0], p[1]);
      }
      prev = p;
    }
    const depth = [0.38, 0.68, 1];
    const hue = [26, 33, 42];
    for (let b = 0; b < 3; b++) glow(ctx, bands[b], hue[b], strength * depth[b], top > DENSE_RATIO);
  }

  drawCage(ctx, width, height, brightness) {
    const frame = this.orbitalFrame(width, height);
    const k = 1.08;
    const corners = [];
    for (const x of [-k, k]) for (const y of [-k, k]) for (const z of [-k, k]) corners.push(this.project(x, y, z, frame));
    const edges = [[0, 1], [0, 2], [0, 4], [1, 3], [1, 5], [2, 3], [2, 6], [3, 7], [4, 5], [4, 6], [5, 7], [6, 7]];

    const path = new Path2D();
    for (const [a, b] of edges) {
      path.moveTo(corners[a][0], corners[a][1]);
      path.lineTo(corners[b][0], corners[b][1]);
    }
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.strokeStyle = `hsla(36, 90%, 60%, ${(0.05 * brightness).toFixed(3)})`;
    ctx.lineWidth = 4;
    ctx.stroke(path);
    ctx.strokeStyle = `hsla(38, 80%, 72%, ${(0.22 * brightness).toFixed(3)})`;
    ctx.lineWidth = 0.8;
    ctx.stroke(path);
  }
}

/**
 * Stroke a path as a glowing filament: wide faint halo down to a hot thin core.
 * Dense figures skip the widest halo — their lines already overlap into a glow, and
 * that pass is where nearly all the overdraw goes.
 */
function glow(ctx, path, hue, strength, dense = false) {
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const p of dense ? PASSES.slice(1) : PASSES) {
    ctx.strokeStyle = `hsla(${hue.toFixed(1)}, ${p.sat}%, ${p.light}%, ${clamp(p.alpha * strength).toFixed(3)})`;
    ctx.lineWidth = p.width;
    ctx.stroke(path);
  }
}

const easeInOut = (t) => t * t * (3 - 2 * t);
