/**
 * The visualisation stage. Three output modes share one voice model:
 *
 *   crystal — a faceted geometric structure; each note is a shard sitting at its
 *             Circle of Fifths angle. Consonance pulls the shards into a single
 *             tight gem, dissonance throws them outward into a spread star.
 *   field   — full-screen colour field; overlapping light lobes that merge into one
 *             wash when consonant and separate into distinct zones when dissonant.
 *   prism   — particle bursts fired along each note's angle, scatter widening
 *             with tension.
 */

import { circleAngle, css, clamp, lerp, TAU } from '../theory/circle.js';
import { HarmonicRenderer } from './harmonic.js';

const MAX_PARTICLES = 2600;
const FIELD_SCALE = 0.25;

export class Stage {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    this.mode = 'crystal';
    this.rotation = 0;
    this.spin = 0;
    this.trail = 0.62;       // 0 = hard cut, 1 = long smear
    this.brightness = 1;
    this.particles = [];
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.time = 0;
    this.smoothTension = 0;
    this.smoothEnergy = 0;
    this.buffer = null;
    this.bufferCtx = null;
    this.harmonic = new HarmonicRenderer();
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (w === this.canvas.width && h === this.canvas.height) return;
    this.canvas.width = w;
    this.canvas.height = h;
    this.width = rect.width;
    this.height = rect.height;
    this.dpr = dpr;
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#05060a';
    ctx.fillRect(0, 0, this.width, this.height);
  }

  /**
   * Scratch canvas at a fraction of the stage resolution. The field is nothing but
   * wide, soft gradients, so it is painted small and scaled back up: at quarter
   * scale with cheap filtering that is visually identical and measured 2.4x faster
   * than filling the lobes at full resolution.
   */
  scratch(scale) {
    if (!this.buffer) {
      this.buffer = document.createElement('canvas');
      this.bufferCtx = this.buffer.getContext('2d');
    }
    const w = Math.max(1, Math.round(this.canvas.width * scale));
    const h = Math.max(1, Math.round(this.canvas.height * scale));
    if (this.buffer.width !== w || this.buffer.height !== h) {
      this.buffer.width = w;
      this.buffer.height = h;
    }
    const ctx = this.bufferCtx;
    const unit = w / Math.max(this.width, 1); // keep drawing in CSS pixels
    ctx.setTransform(unit, 0, 0, unit, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    return ctx;
  }

  setMode(mode) {
    this.mode = mode;
    this.clear();
  }

  clear() {
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#05060a';
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.restore();
    this.particles.length = 0;
  }

  /** Fire a burst of particles for a new note (prism mode). */
  strike(voice, analysis) {
    if (this.mode !== 'prism') return;
    const color = analysis.colors.get(voice.midi);
    if (!color) return;
    const angle = circleAngle(voice.pc, this.rotation * 57.2958);
    const scatter = lerp(0.06, 1.5, analysis.tension);
    const count = Math.round(lerp(14, 46, voice.velocity));
    const minDim = Math.min(this.width, this.height);
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= MAX_PARTICLES) break;
      const a = angle + (Math.random() - 0.5) * scatter;
      const speed = (0.4 + Math.random() * 1.1) * minDim * 0.006 * (0.5 + voice.velocity);
      this.particles.push({
        x: this.width / 2,
        y: this.height / 2,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        life: 1,
        decay: 0.004 + Math.random() * 0.008,
        size: lerp(1.2, 3.6, Math.random()) * (0.6 + voice.velocity),
        h: color.h,
        s: color.s,
        l: color.l
      });
    }
  }

  draw(voices, analysis, dt) {
    this.resize();
    this.time += dt;
    this.smoothTension += (analysis.tension - this.smoothTension) * Math.min(1, dt * 6);
    this.smoothEnergy += (analysis.energy - this.smoothEnergy) * Math.min(1, dt * 8);
    this.rotation += this.spin * dt;

    const ctx = this.ctx;
    if (this.mode === 'lissajous' || this.mode === 'orbital') {
      // Curve modes own the whole frame: pure black, no trails, no colour field.
      this.harmonic.update(this.mode, voices, this.smoothEnergy, dt);
      this.harmonic.draw(ctx, this.width, this.height, this.mode, this.brightness);
      return;
    }

    ctx.globalCompositeOperation = 'source-over';
    const fade = lerp(0.55, 0.045, clamp(this.trail));
    ctx.fillStyle = `rgba(5, 6, 10, ${fade})`;
    ctx.fillRect(0, 0, this.width, this.height);

    if (this.mode === 'field') this.drawField(voices, analysis);
    else if (this.mode === 'prism') this.drawPrism(voices, analysis, dt);
    else this.drawCrystal(voices, analysis);

    ctx.globalCompositeOperation = 'source-over';
  }

  /* ------------------------------ crystal ------------------------------ */

  drawCrystal(voices, analysis) {
    const ctx = this.ctx;
    const cx = this.width / 2;
    const cy = this.height / 2;
    const minDim = Math.min(this.width, this.height);
    // Longest a crystal can reach is R * 1.18 (root + length at full velocity and
    // tension), so this keeps the cluster inside the frame at any chord.
    const R = minDim * 0.38;
    const rotDeg = this.rotation * 57.2958;
    const tension = this.smoothTension;

    const gems = [];

    for (const v of voices) {
      const color = analysis.colors.get(v.midi);
      if (!color || v.env < 0.002) continue;

      const angle = circleAngle(v.pc, rotDeg) + ((v.midi - 60) / 36) * 0.05;
      // Consonance keeps the cluster tight around the seed; dissonance pushes the
      // crystals out and lets them grow longer.
      const root = R * lerp(0.10, 0.28, tension) * (0.6 + 0.4 * v.env);
      const length = R * lerp(0.48, 0.82, v.velocity) * lerp(0.9, 1.1, tension) * (0.3 + 0.7 * v.env);
      const halfWidth = R * 0.105 * (0.6 + 0.4 * v.velocity) * (0.5 + 0.5 * v.env);
      // Terminations stay in proportion, so the shaft is never all point.
      const cap = Math.min(length * 0.22, halfWidth * 2.0);

      gems.push({
        color,
        env: clamp(v.env),
        velocity: v.velocity,
        angle,
        halfWidth,
        length,
        cap,
        phase: v.pc * 1.7,
        // Midpoint of the shaft, in screen space.
        mx: cx + Math.cos(angle) * (root + length / 2),
        my: cy + Math.sin(angle) * (root + length / 2),
        tip: { x: cx + Math.cos(angle) * (root + length), y: cy + Math.sin(angle) * (root + length) },
        base: { x: cx + Math.cos(angle) * root, y: cy + Math.sin(angle) * root }
      });
    }

    for (const gem of gems) this.drawGem(gem);

    if (gems.length > 1) {
      // Interval lattice: the closer two notes sit on the circle, the stronger the
      // filament of light strung between their tips.
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < gems.length; i++) {
        for (let j = i + 1; j < gems.length; j++) {
          const p = gems[i];
          const q = gems[j];
          const d = Math.abs(p.angle - q.angle);
          const sep = Math.min(d, TAU - d) / Math.PI; // 0 = same, 1 = opposite
          const strength = (1 - sep) * Math.min(p.env, q.env);
          if (strength < 0.04) continue;
          const g = ctx.createLinearGradient(p.tip.x, p.tip.y, q.tip.x, q.tip.y);
          g.addColorStop(0, css(p.color, strength * 0.26));
          g.addColorStop(0.5, css(p.color, strength * 0.05));
          g.addColorStop(1, css(q.color, strength * 0.26));
          ctx.strokeStyle = g;
          ctx.lineWidth = 0.5 + strength * 1.8;
          ctx.beginPath();
          ctx.moveTo(p.tip.x, p.tip.y);
          ctx.lineTo(q.tip.x, q.tip.y);
          ctx.stroke();
        }
      }
    }

    if (gems.length) {
      // The seed the cluster grows out of, tinted by the chord's blended colour.
      const centroid = { h: analysis.centroidHue, s: lerp(0.12, 0.8, tension), l: 0.7 };
      const seed = R * lerp(0.10, 0.26, tension) * (0.55 + this.smoothEnergy * 0.55);
      ctx.globalCompositeOperation = 'lighter';
      const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, seed);
      core.addColorStop(0, css({ ...centroid, s: centroid.s * 0.5, l: 0.88 }, 0.55 * this.brightness));
      core.addColorStop(0.35, css(centroid, 0.22 * this.brightness));
      core.addColorStop(1, css(centroid, 0));
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(cx, cy, seed, 0, TAU);
      ctx.fill();
    }

    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * One crystal: a long shaft with pointed terminations at both ends, lit from
   * inside. Built in four passes — the light escaping into the air, the dense body,
   * the inner light along its spine, then the cut facets and rim.
   */
  drawGem(gem) {
    const ctx = this.ctx;
    const { color, env, halfWidth: w, length, cap } = gem;
    const half = length / 2;
    const shaft = Math.max(half - cap, half * 0.08); // where the terminations begin
    const a = env;

    const body = { h: color.h, s: clamp(color.s * 1.15, 0, 1), l: clamp(color.l * 0.36, 0.04, 0.55) };
    const inner = { h: color.h, s: clamp(color.s * 0.85, 0, 1), l: clamp(color.l + 0.16, 0, 0.9) };
    const flare = { h: color.h, s: clamp(color.s * 0.5, 0, 1), l: clamp(color.l + 0.36, 0, 0.95) };
    const rim = { h: color.h, s: clamp(color.s * 0.75, 0, 1), l: clamp(color.l + 0.22, 0, 0.88) };

    // Slow breathing so the light inside never looks like a static fill.
    const pulse = 0.85 + Math.sin(this.time * 1.6 + gem.phase) * 0.15;

    ctx.save();
    ctx.translate(gem.mx, gem.my);
    ctx.rotate(gem.angle);
    // Local space: the crystal runs along +/-x, its width along +/-y.

    // 1. Light escaping into the air around the crystal.
    ctx.globalCompositeOperation = 'lighter';
    ctx.save();
    ctx.scale(half + w * 3, w * 3.4);
    const bloom = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    bloom.addColorStop(0, css(inner, 0.22 * a * pulse * this.brightness));
    bloom.addColorStop(0.45, css(color, 0.08 * a * this.brightness));
    bloom.addColorStop(1, css(color, 0));
    ctx.fillStyle = bloom;
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();

    const outline = () => {
      ctx.beginPath();
      ctx.moveTo(-half, 0);        // lower termination point
      ctx.lineTo(-shaft, -w);
      ctx.lineTo(shaft, -w);
      ctx.lineTo(half, 0);         // upper termination point
      ctx.lineTo(shaft, w);
      ctx.lineTo(-shaft, w);
      ctx.closePath();
    };

    ctx.save();
    outline();
    ctx.clip();

    // 2. Dense body, so the crystal reads as material rather than a glow.
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = css(body, 0.92 * a);
    ctx.fillRect(-half, -w, length, w * 2);

    // 3. The light inside: an elongated core down the spine, falling off toward the
    //    faces, plus a hotter pool at the rooted end where the cluster is brightest.
    ctx.globalCompositeOperation = 'lighter';
    ctx.save();
    ctx.scale(half * 0.76, w * 0.62);
    const core = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    core.addColorStop(0, css(flare, 0.72 * a * pulse * this.brightness));
    core.addColorStop(0.35, css(inner, 0.4 * a * pulse * this.brightness));
    core.addColorStop(1, css(inner, 0));
    ctx.fillStyle = core;
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();

    const spine = ctx.createLinearGradient(-half, 0, half, 0);
    spine.addColorStop(0, css(flare, 0.34 * a * this.brightness));
    spine.addColorStop(0.4, css(inner, 0.10 * a * this.brightness));
    spine.addColorStop(1, css(inner, 0.03 * a * this.brightness));
    ctx.fillStyle = spine;
    ctx.fillRect(-half, -w * 0.20, length, w * 0.40);

    // 4. Prism faces: two longitudinal strips catching light at different angles.
    ctx.globalCompositeOperation = 'source-over';
    const faceLit = ctx.createLinearGradient(0, -w, 0, 0);
    faceLit.addColorStop(0, css(rim, 0.20 * a));
    faceLit.addColorStop(1, css(rim, 0));
    ctx.fillStyle = faceLit;
    ctx.fillRect(-half, -w, length, w);

    const faceShade = ctx.createLinearGradient(0, w * 0.25, 0, w);
    faceShade.addColorStop(0, 'rgba(0,0,0,0)');
    faceShade.addColorStop(1, `rgba(0,0,0,${(0.34 * a).toFixed(3)})`);
    ctx.fillStyle = faceShade;
    ctx.fillRect(-half, w * 0.25, length, w * 0.75);

    ctx.restore(); // drop the clip

    // Facet edges and the rim that catches the light.
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineJoin = 'round';

    ctx.strokeStyle = css(rim, 0.34 * a);
    ctx.lineWidth = 1;
    outline();
    ctx.stroke();

    ctx.globalCompositeOperation = 'lighter';

    // The two edges where the prism faces meet, and the termination seams.
    ctx.strokeStyle = css(rim, 0.15 * a);
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(-shaft, -w * 0.3);
    ctx.lineTo(shaft, -w * 0.3);
    ctx.moveTo(-shaft, w * 0.3);
    ctx.lineTo(shaft, w * 0.3);
    ctx.moveTo(half, 0);
    ctx.lineTo(shaft, -w * 0.3);
    ctx.moveTo(half, 0);
    ctx.lineTo(shaft, w * 0.3);
    ctx.moveTo(-half, 0);
    ctx.lineTo(-shaft, -w * 0.3);
    ctx.moveTo(-half, 0);
    ctx.lineTo(-shaft, w * 0.3);
    ctx.stroke();

    // A single glint where the outward termination catches the light.
    const glint = w * 0.8;
    const g = ctx.createRadialGradient(half - glint * 0.5, 0, 0, half - glint * 0.5, 0, glint);
    g.addColorStop(0, css(inner, 0.34 * a * pulse * this.brightness));
    g.addColorStop(1, css(inner, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(half - glint * 0.4, 0, glint, 0, TAU);
    ctx.fill();

    ctx.restore();
  }

  /* ------------------------------- field ------------------------------- */

  drawField(voices, analysis) {
    const cx = this.width / 2;
    const cy = this.height / 2;
    const minDim = Math.min(this.width, this.height);
    const rotDeg = this.rotation * 57.2958;
    const tension = this.smoothTension;

    const ctx = this.scratch(FIELD_SCALE);
    ctx.globalCompositeOperation = 'lighter';

    for (const v of voices) {
      const color = analysis.colors.get(v.midi);
      if (!color || v.env < 0.002) continue;
      const angle = circleAngle(v.pc, rotDeg);
      // Consonance: wide lobes stacked on the centre, merging into a single wash.
      // Dissonance: tighter lobes pushed apart, so each colour keeps its own zone.
      const offset = minDim * lerp(0.02, 0.52, tension);
      const breathe = 1 + Math.sin(this.time * 0.9 + v.pc) * 0.035;
      const x = cx + Math.cos(angle) * offset;
      const y = cy + Math.sin(angle) * offset;
      const radius = minDim * lerp(0.80, 0.40, tension) * lerp(0.72, 1, v.velocity) * (0.55 + 0.45 * v.env) * breathe;

      // Only cover the lobe's own footprint — the gradient is transparent past it.
      const x0 = Math.max(0, x - radius);
      const y0 = Math.max(0, y - radius);
      const x1 = Math.min(this.width, x + radius);
      const y1 = Math.min(this.height, y + radius);
      if (x1 <= x0 || y1 <= y0) continue;

      const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
      const a = clamp((v.env * 0.55 * this.brightness) / Math.max(1, Math.sqrt(voices.length * 0.7)));
      g.addColorStop(0, css(color, a));
      g.addColorStop(0.35, css(color, a * 0.45));
      g.addColorStop(0.7, css(color, a * 0.12));
      g.addColorStop(1, css(color, 0));
      ctx.fillStyle = g;
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    }

    const main = this.ctx;
    main.globalCompositeOperation = 'lighter';
    main.imageSmoothingQuality = 'low';
    main.drawImage(this.buffer, 0, 0, this.width, this.height);
    main.globalCompositeOperation = 'source-over';
  }

  /* ------------------------------- prism ------------------------------- */

  drawPrism(voices, analysis, dt) {
    const ctx = this.ctx;
    const cx = this.width / 2;
    const cy = this.height / 2;
    const minDim = Math.min(this.width, this.height);
    const rotDeg = this.rotation * 57.2958;
    const step = Math.min(dt, 0.05) * 60;

    // Sustained notes keep feeding the stream.
    for (const v of voices) {
      if (!v.gate || v.env < 0.05) continue;
      const color = analysis.colors.get(v.midi);
      if (!color || this.particles.length >= MAX_PARTICLES) continue;
      const angle = circleAngle(v.pc, rotDeg);
      const scatter = lerp(0.05, 1.3, this.smoothTension);
      const a = angle + (Math.random() - 0.5) * scatter;
      const speed = (0.35 + Math.random() * 0.8) * minDim * 0.005;
      this.particles.push({
        x: cx, y: cy,
        vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
        life: 1, decay: 0.006 + Math.random() * 0.01,
        size: lerp(1, 3, Math.random()) * (0.5 + v.velocity),
        h: color.h, s: color.s, l: color.l
      });
    }

    ctx.globalCompositeOperation = 'lighter';
    const alive = [];
    for (const p of this.particles) {
      p.x += p.vx * step;
      p.y += p.vy * step;
      p.vx *= 0.995;
      p.vy *= 0.995;
      p.life -= p.decay * step;
      if (p.life <= 0) continue;
      if (p.x < -60 || p.x > this.width + 60 || p.y < -60 || p.y > this.height + 60) continue;
      alive.push(p);
      const a = p.life * p.life * this.brightness;
      ctx.fillStyle = `hsla(${p.h.toFixed(0)}, ${(p.s * 100).toFixed(0)}%, ${(p.l * 100).toFixed(0)}%, ${a.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.4 + p.life * 0.8), 0, TAU);
      ctx.fill();
    }
    this.particles = alive;

    if (voices.length) {
      const centroid = { h: analysis.centroidHue, s: lerp(0.12, 0.8, this.smoothTension), l: 0.7 };
      const r = minDim * (0.04 + this.smoothEnergy * 0.1);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 3);
      g.addColorStop(0, css(centroid, 0.6 * this.brightness));
      g.addColorStop(1, css(centroid, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 3, 0, TAU);
      ctx.fill();
    }
  }
}
