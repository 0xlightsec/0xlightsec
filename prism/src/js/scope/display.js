/**
 * Oscilloscope rendering: a 10 x 8 division graticule, triggered dual-channel YT
 * traces, and an XY mode that plots CH1 against CH2.
 *
 * Two stacked canvases. The graticule is static and redrawn only on resize; the
 * beam canvas is never cleared, only faded, which gives the phosphor persistence
 * of a CRT. When a window holds more samples than there are pixels, each pixel
 * column draws the min-max span of its samples, so a fast wave on a slow timebase
 * reads as the filled band a real scope shows instead of aliasing into a false
 * low-frequency squiggle.
 */

import { sampleAt } from './measure.js';

const DIV_X = 10;
const DIV_Y = 8;
export const CHANNEL_HUE = { 1: 52, 2: 186 }; // the usual scope colours: CH1 yellow, CH2 cyan
const XY_HUE = 40;
const TRIGGER_DIV = 1; // trigger point sits one division in from the left
const STATUS_BAND = 34; // px kept clear above and below the graticule

export class ScopeDisplay {
  constructor(gridCanvas, beamCanvas) {
    this.grid = gridCanvas;
    this.beam = beamCanvas;
    this.gctx = gridCanvas.getContext('2d');
    this.bctx = beamCanvas.getContext('2d');
    this.w = 0;
    this.h = 0;
    this.dpr = 1;
  }

  resize() {
    const rect = this.beam.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (w === this.beam.width && h === this.beam.height) return false;
    for (const c of [this.grid, this.beam]) {
      c.width = w;
      c.height = h;
    }
    this.w = rect.width;
    this.h = rect.height;
    this.dpr = dpr;
    this.gctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.layout();
    this.drawGrid();
    return true;
  }

  /**
   * Divisions as large as fit. They may stretch up to 1.6x wider than tall so a
   * wide window isn't mostly empty bezel; X-Y scales both axes by the vertical
   * division, so circles stay round.
   */
  layout() {
    // Vertical margin leaves room for the status lines above and below the screen.
    this.divY = Math.max(8, Math.floor((this.h - 2 * STATUS_BAND) / DIV_Y));
    this.divX = Math.max(8, Math.min(Math.floor((this.w - 48) / DIV_X), Math.floor(this.divY * 1.6)));
    this.sw = this.divX * DIV_X;
    this.sh = this.divY * DIV_Y;
    this.left = Math.round((this.w - this.sw) / 2);
    this.top = Math.round((this.h - this.sh) / 2);
    this.cx = this.left + this.sw / 2;
    this.cy = this.top + this.sh / 2;
  }

  /** Pixel rectangle of the graticule, in CSS pixels relative to the canvas. */
  get screen() {
    return { left: this.left, top: this.top, width: this.sw, height: this.sh, divX: this.divX, divY: this.divY };
  }

  drawGrid() {
    const g = this.gctx;
    g.clearRect(0, 0, this.w, this.h);
    const { left, top, sw, sh, divX, divY, cx, cy } = this;

    g.strokeStyle = 'rgba(150, 190, 170, 0.10)';
    g.lineWidth = 1;
    g.beginPath();
    for (let i = 1; i < DIV_X; i++) {
      const x = Math.round(left + i * divX) + 0.5;
      g.moveTo(x, top);
      g.lineTo(x, top + sh);
    }
    for (let j = 1; j < DIV_Y; j++) {
      const y = Math.round(top + j * divY) + 0.5;
      g.moveTo(left, y);
      g.lineTo(left + sw, y);
    }
    g.stroke();

    // Centre axes, with fifth-of-a-division ticks like a real graticule.
    g.strokeStyle = 'rgba(170, 210, 190, 0.22)';
    g.beginPath();
    g.moveTo(left, Math.round(cy) + 0.5);
    g.lineTo(left + sw, Math.round(cy) + 0.5);
    g.moveTo(Math.round(cx) + 0.5, top);
    g.lineTo(Math.round(cx) + 0.5, top + sh);
    const tick = Math.max(3, divY * 0.08);
    for (let i = 0; i <= DIV_X * 5; i++) {
      const x = Math.round(left + (i * divX) / 5) + 0.5;
      g.moveTo(x, cy - tick);
      g.lineTo(x, cy + tick);
    }
    for (let j = 0; j <= DIV_Y * 5; j++) {
      const y = Math.round(top + (j * divY) / 5) + 0.5;
      g.moveTo(cx - tick, y);
      g.lineTo(cx + tick, y);
    }
    g.stroke();

    g.strokeStyle = 'rgba(170, 210, 190, 0.28)';
    g.strokeRect(left + 0.5, top + 0.5, sw - 1, sh - 1);
  }

  /** Fade the previous frame toward transparent: 0 = instant, 1 = long afterglow. */
  fade(persistence) {
    const b = this.bctx;
    b.save();
    b.globalCompositeOperation = 'destination-out';
    b.fillStyle = `rgba(0,0,0,${(0.62 - 0.57 * persistence).toFixed(3)})`;
    b.fillRect(0, 0, this.w, this.h);
    b.restore();
  }

  clear() {
    this.bctx.clearRect(0, 0, this.w, this.h);
  }

  /**
   * Dual-trace YT. `start` is the fractional sample index at the left edge and
   * `span` the number of samples across the screen; both channels share them, so
   * they stay time-aligned to the one trigger.
   */
  drawYT(channels, start, span, intensity) {
    const b = this.bctx;
    b.save();
    b.beginPath();
    b.rect(this.left, this.top, this.sw, this.sh);
    b.clip();
    for (const ch of channels) {
      if (!ch.visible) continue;
      const path = this.tracePath(ch.buf, start, span, ch.voltsPerDiv, ch.position);
      beam(b, path, CHANNEL_HUE[ch.id], intensity);
    }
    b.restore();
  }

  tracePath(buf, start, span, vpd, position) {
    const { left, sw, divY } = this;
    const mid = this.cy - position * divY;
    const scale = divY / vpd;
    const path = new Path2D();
    const cols = Math.ceil(sw);

    if (span <= cols * 2) {
      // Few samples: draw them as a line, sampled at fractional positions so the
      // interpolated trigger offset carries through.
      const n = Math.max(2, Math.ceil(span));
      for (let k = 0; k <= n; k++) {
        const s = start + (k / n) * span;
        const x = left + (k / n) * sw;
        const y = mid - sampleAt(buf, s) * scale;
        if (k === 0) path.moveTo(x, y);
        else path.lineTo(x, y);
      }
      return path;
    }

    // Many samples: one vertical min-max stroke per pixel column, joined.
    const per = span / cols;
    let lastY = null;
    for (let c = 0; c < cols; c++) {
      const a = Math.floor(start + c * per);
      const z = Math.min(buf.length, Math.max(a + 1, Math.floor(start + (c + 1) * per)));
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = Math.max(0, a); i < z; i++) {
        const v = buf[i];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      if (lo === Infinity) continue;
      const x = left + c + 0.5;
      const yHi = mid - hi * scale;
      const yLo = mid - lo * scale;
      // Enter the column from whichever end is nearer the previous one.
      if (lastY === null) path.moveTo(x, yHi);
      if (lastY !== null && Math.abs(lastY - yLo) < Math.abs(lastY - yHi)) {
        path.lineTo(x, yLo);
        path.lineTo(x, yHi);
        lastY = yHi;
      } else {
        path.lineTo(x, yHi);
        path.lineTo(x, yLo);
        lastY = yLo;
      }
    }
    return path;
  }

  /** CH1 on the horizontal axis, CH2 on the vertical: the Lissajous of the two. */
  drawXY(ch1, ch2, count, intensity) {
    const b = this.bctx;
    const n = Math.min(count, ch1.buf.length);
    const from = ch1.buf.length - n;
    const sx = this.divY / ch1.voltsPerDiv;
    const sy = this.divY / ch2.voltsPerDiv;
    const step = Math.max(1, Math.floor(n / 6000));
    const path = new Path2D();
    for (let i = from, k = 0; i < ch1.buf.length; i += step, k++) {
      const x = this.cx + ch1.buf[i] * sx;
      const y = this.cy - ch2.buf[i] * sy;
      if (k === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    }
    b.save();
    b.beginPath();
    b.rect(this.left, this.top, this.sw, this.sh);
    b.clip();
    beam(b, path, XY_HUE, intensity);
    b.restore();
  }

  /**
   * Shapes: one channel plotted against itself a quarter-period later (a phase
   * portrait), so a single signal draws a figure. A sine becomes a circle, a square
   * a square, a triangle a diamond; chords and voices draw knots and loops. `cx` is
   * the figure's centre in divisions from the screen centre, so two channels can
   * sit side by side. Scaled by the vertical division on both axes so circles stay
   * round.
   */
  drawShape(ch, delay, count, offsetDiv, intensity) {
    const b = this.bctx;
    const buf = ch.buf;
    const n = Math.min(count, buf.length - Math.ceil(delay) - 1);
    if (n < 4) return;
    const from = buf.length - n;
    const scale = this.divY / ch.voltsPerDiv;
    const ox = this.cx + offsetDiv * this.divX;
    const step = Math.max(1, Math.floor(n / 6000));
    const path = new Path2D();
    for (let i = from, k = 0; i < buf.length; i += step, k++) {
      const x = ox + buf[i] * scale;
      const y = this.cy - sampleAt(buf, i - delay) * scale;
      if (k === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    }
    b.save();
    b.beginPath();
    b.rect(this.left, this.top, this.sw, this.sh);
    b.clip();
    beam(b, path, CHANNEL_HUE[ch.id], intensity);
    b.restore();
  }

  /** Small fixed markers: channel ground arrows and the trigger point. */
  drawMarkers(channels, triggerChannel, triggerLevel, mode) {
    const b = this.bctx;
    b.save();
    b.globalCompositeOperation = 'source-over';
    const s = Math.max(5, this.divY * 0.13);
    if (mode === 'yt') {
      for (const ch of channels) {
        if (!ch.visible) continue;
        const y = this.cy - ch.position * this.divY;
        b.fillStyle = `hsl(${CHANNEL_HUE[ch.id]}, 95%, 58%)`;
        b.beginPath();
        b.moveTo(this.left - 2, y);
        b.lineTo(this.left - 2 - s * 1.4, y - s);
        b.lineTo(this.left - 2 - s * 1.4, y + s);
        b.closePath();
        b.fill();
      }
      const tc = channels.find((c) => c.id === triggerChannel);
      if (tc) {
        const x = this.left + TRIGGER_DIV * this.divX;
        b.fillStyle = 'rgba(255, 150, 60, 0.95)';
        b.beginPath();
        b.moveTo(x, this.top + 2 + s);
        b.lineTo(x - s, this.top + 2);
        b.lineTo(x + s, this.top + 2);
        b.closePath();
        b.fill();
        const ty = this.cy - (tc.position + triggerLevel / tc.voltsPerDiv) * this.divY;
        b.beginPath();
        b.moveTo(this.left + this.sw + 2, ty);
        b.lineTo(this.left + this.sw + 2 + s * 1.4, ty - s);
        b.lineTo(this.left + this.sw + 2 + s * 1.4, ty + s);
        b.closePath();
        b.fill();
      }
    }
    b.restore();
  }
}

export { TRIGGER_DIV, DIV_X };

/** Phosphor beam: soft wide bloom down to a bright thin core. */
function beam(ctx, path, hue, intensity) {
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const passes = [
    { width: 7, alpha: 0.07, light: 52 },
    { width: 2.6, alpha: 0.32, light: 56 },
    { width: 1.1, alpha: 0.95, light: 78 }
  ];
  for (const p of passes) {
    ctx.strokeStyle = `hsla(${hue}, 100%, ${p.light}%, ${Math.min(1, p.alpha * intensity).toFixed(3)})`;
    ctx.lineWidth = p.width;
    ctx.stroke(path);
  }
}

/**
 * A small single-channel trace for the readout cards: triggered on its own
 * channel, cleared every frame, no persistence.
 */
export class MiniTrace {
  constructor(canvas, hue) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.hue = hue;
  }

  draw(buf, start, span, gain) {
    const c = this.canvas;
    const rect = c.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(rect.width * dpr);
    const h = Math.round(rect.height * dpr);
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(rect.height / 2) + 0.5);
    ctx.lineTo(rect.width, Math.round(rect.height / 2) + 0.5);
    ctx.stroke();

    if (!buf || span <= 1) return;
    const n = Math.min(Math.ceil(rect.width * 1.5), Math.ceil(span));
    const path = new Path2D();
    const half = rect.height / 2;
    for (let k = 0; k <= n; k++) {
      const v = sampleAt(buf, start + (k / n) * span) * gain;
      const y = half - Math.max(-1, Math.min(1, v)) * (half - 3);
      const x = (k / n) * rect.width;
      if (k === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    }
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = `hsla(${this.hue}, 100%, 55%, 0.25)`;
    ctx.lineWidth = 4;
    ctx.stroke(path);
    ctx.strokeStyle = `hsla(${this.hue}, 100%, 72%, 0.95)`;
    ctx.lineWidth = 1.2;
    ctx.stroke(path);
    ctx.globalCompositeOperation = 'source-over';
  }
}
