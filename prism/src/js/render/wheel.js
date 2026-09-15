/**
 * The Circle of Fifths readout: twelve segments in fifth order, each painted with
 * the hue that position owns. Sounding notes light up; the spokes between them show
 * the intervals actually being played, and the centre fills with the chord's
 * blended colour.
 */

import { FIFTHS, NOTE_NAMES, hueFor, css, clamp, lerp, TAU } from '../theory/circle.js';

export class Wheel {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.rotation = 0;
    this.size = 0;
    this.dpr = 1;
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = Math.max(1, Math.round(Math.min(rect.width, rect.height) * dpr));
    if (size === this.canvas.width && size === this.canvas.height) return;
    this.canvas.width = size;
    this.canvas.height = size;
    this.size = Math.min(rect.width, rect.height);
    this.dpr = dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  draw(activePcs, analysis) {
    this.resize();
    const ctx = this.ctx;
    const s = this.size;
    if (!s) return;
    const cx = s / 2;
    const cy = s / 2;
    const outer = s * 0.46;
    const inner = s * 0.31;

    ctx.clearRect(0, 0, s, s);

    const active = activePcs instanceof Set ? activePcs : new Set(activePcs);
    const seg = TAU / 12;

    for (let k = 0; k < 12; k++) {
      const pc = FIFTHS[k];
      const on = active.has(pc);
      const hue = hueFor(pc, this.rotation);
      const mid = k * seg - Math.PI / 2;
      const a0 = mid - seg / 2 + 0.012;
      const a1 = mid + seg / 2 - 0.012;

      ctx.beginPath();
      ctx.arc(cx, cy, outer, a0, a1);
      ctx.arc(cx, cy, inner, a1, a0, true);
      ctx.closePath();
      ctx.fillStyle = on
        ? `hsla(${hue}, 88%, 62%, 0.95)`
        : `hsla(${hue}, 42%, 48%, 0.13)`;
      ctx.fill();

      if (on) {
        ctx.strokeStyle = `hsla(${hue}, 95%, 82%, 0.9)`;
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }

      const lx = cx + Math.cos(mid) * (outer + inner) / 2;
      const ly = cy + Math.sin(mid) * (outer + inner) / 2;
      ctx.save();
      ctx.font = `600 ${Math.max(9, s * 0.052)}px ui-monospace, "SF Mono", Menlo, monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = on ? 'rgba(4,5,9,0.92)' : 'rgba(224,232,255,0.42)';
      ctx.fillText(NOTE_NAMES[pc], lx, ly);
      ctx.restore();
    }

    // Spokes between sounding notes: short arc = consonant, long = dissonant.
    const lit = FIFTHS.map((pc, k) => ({ pc, k })).filter(({ pc }) => active.has(pc));
    if (lit.length > 1) {
      ctx.save();
      for (let i = 0; i < lit.length; i++) {
        for (let j = i + 1; j < lit.length; j++) {
          const d = Math.abs(lit[i].k - lit[j].k);
          const steps = Math.min(d, 12 - d);
          const strength = 1 - steps / 6;
          const a = lit[i].k * seg - Math.PI / 2;
          const b = lit[j].k * seg - Math.PI / 2;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(a) * inner * 0.94, cy + Math.sin(a) * inner * 0.94);
          ctx.lineTo(cx + Math.cos(b) * inner * 0.94, cy + Math.sin(b) * inner * 0.94);
          ctx.strokeStyle = `hsla(${analysis.centroidHue}, ${lerp(20, 85, analysis.tension)}%, 78%, ${0.16 + strength * 0.5})`;
          ctx.lineWidth = 0.7 + strength * 2.2;
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    // Centre disc = the chord's blended colour, sized by how much is sounding.
    if (analysis.count) {
      const r = inner * (0.34 + clamp(analysis.energy) * 0.42);
      const centroid = { h: analysis.centroidHue, s: lerp(0.18, 0.85, analysis.tension), l: 0.62 };
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, css(centroid, 0.95));
      g.addColorStop(1, css(centroid, 0.05));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TAU);
      ctx.fill();
    }
  }
}
