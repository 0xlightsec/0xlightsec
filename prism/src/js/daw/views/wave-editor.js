/**
 * Wave editor: draw the waveform a synth channel plays, FL Sytrus style.
 *
 *   Draw        drag across the cycle to reshape it; the first stroke starts from
 *               the sound's own shape
 *   Harmonics   bars for the first 32 harmonics: drag them up and down
 *   Shapes      sine, triangle, saw, square, pulse, organ, fold, random
 *   Smooth · Symmetry · Normalize · Invert · Reset to sound
 *
 * Hear is on by default: the editor holds a note while you drag, so the sound
 * changes under your hand (a note you hold on the keyboard changes too).
 */

import { SOUNDS } from '../../studio/sounds.js';
import { WAVE_N, HARMONICS, WAVE_SHAPES, shapeWave, randomWave, harmonicLevels, setHarmonic, smoothWave, symmetricWave, normalizeWave, centreWave, invertWave, baseWaveOf } from '../../studio/wave.js';
import { hueOf } from '../model.js';

const PAD = 10;
const BAR_GAP = 3;
const HEAR_NOTE = 60; // C4, held while you draw

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

export class WaveEditor {
  /**
   * @param {object} els    { veil, win, who, closeBtn, mode, shapes, ops, canvas, hearBtn }
   * @param {object} studio the app: song, begin(), change(), commit(), preview()
   */
  constructor(els, studio) {
    Object.assign(this, els);
    this.studio = studio;
    this.g = this.canvas.getContext('2d');
    this.channelId = null;
    this.view = 'draw';
    this.drag = null;
    this.hearing = false;
    this.build();
    this.wire();
  }

  get song() {
    return this.studio.song;
  }

  get channel() {
    return this.channelId ? this.song.channel(this.channelId) : null;
  }

  get isOpen() {
    return !this.veil.hidden;
  }

  /** The cycle on show: the drawn one, or the sound's own shape. */
  get samples() {
    const ch = this.channel;
    return ch?.wave ?? baseWaveOf(SOUNDS[ch?.sound]);
  }

  build() {
    for (const [id, label] of [['draw', 'Draw'], ['harm', 'Harmonics']]) {
      const b = el('button', '', label);
      b.dataset.mode = id;
      b.addEventListener('click', () => {
        this.view = id;
        this.render();
      });
      this.mode.appendChild(b);
    }
    for (const [id, shape] of Object.entries(WAVE_SHAPES)) {
      const b = el('button', 'pill', shape.label);
      b.title = `Start from a ${shape.label.toLowerCase()} wave`;
      b.addEventListener('click', () => this.set(shapeWave(id), true));
      this.shapes.appendChild(b);
    }
    const rnd = el('button', 'pill wave-random', 'Random');
    rnd.title = 'Random harmonics: a new timbre every click';
    rnd.addEventListener('click', () => this.set(randomWave(), true));
    this.shapes.appendChild(rnd);
    const ops = [
      ['Smooth', 'Round the corners off', (w) => smoothWave(w)],
      ['Symmetry', 'Make the second half the first upside down: only odd harmonics, hollow like a square', (w) => symmetricWave(w)],
      ['Normalize', 'Scale it to full height, centred on zero', (w) => normalizeWave(centreWave(w))],
      ['Invert', 'Flip it upside down', (w) => invertWave(w)]
    ];
    for (const [label, title, fn] of ops) {
      const b = el('button', 'pill', label);
      b.title = title;
      b.addEventListener('click', () => this.set(fn(this.samples), true));
      this.ops.appendChild(b);
    }
    const reset = el('button', 'pill wave-reset', 'Reset to sound');
    reset.title = "Forget the drawing: the sound's own shapes again";
    reset.addEventListener('click', () => this.set(null, true));
    this.ops.appendChild(reset);
  }

  open(channelId) {
    const ch = this.song.channel(channelId);
    if (!ch || ch.kind !== 'synth') return;
    this.channelId = channelId;
    this.veil.hidden = false;
    this.render();
  }

  close() {
    this.stopHearing();
    this.veil.hidden = true;
    this.channelId = null;
  }

  /** Put a wave on the channel (null clears it), as one edit, and hear it. */
  set(samples, blip = false) {
    const ch = this.channel;
    if (!ch) return;
    this.studio.edit(() => this.song.setWave(ch.id, samples));
    if (blip) this.studio.preview(ch.id, HEAR_NOTE);
    this.render();
  }

  render() {
    const ch = this.channel;
    if (!ch) return this.close();
    this.who.textContent = `${ch.name} · ${SOUNDS[ch.sound]?.label ?? ch.sound}${ch.wave ? ' · drawn' : ''}`;
    for (const b of this.mode.children) b.classList.toggle('is-on', b.dataset.mode === this.view);
    this.win.classList.toggle('is-drawn', !!ch.wave);
    this.draw();
  }

  /* --------------------------------- drawing --------------------------------- */

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (this.canvas.width !== Math.round(r.width * dpr) || this.canvas.height !== Math.round(r.height * dpr)) {
      this.canvas.width = Math.round(r.width * dpr);
      this.canvas.height = Math.round(r.height * dpr);
    }
    this.w = r.width;
    this.h = r.height;
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  get hue() {
    const ch = this.channel;
    return ch ? hueOf(this.song.channels.indexOf(ch)) : 190;
  }

  xOf(n) {
    return PAD + (n / WAVE_N) * (this.w - 2 * PAD);
  }

  yOf(v) {
    return this.h / 2 - v * (this.h / 2 - PAD);
  }

  nAt(x) {
    return Math.round(((x - PAD) / (this.w - 2 * PAD)) * WAVE_N);
  }

  vAt(y) {
    return Math.max(-1, Math.min(1, (this.h / 2 - y) / (this.h / 2 - PAD)));
  }

  draw() {
    this.resize();
    const { g, w, h } = this;
    if (!w || !h) return;
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#060b12';
    g.fillRect(0, 0, w, h);
    if (this.view === 'harm') return this.drawBars();
    const hue = this.hue;
    const ch = this.channel;
    // Grid: quarters of the cycle, and the zero line.
    g.fillStyle = 'rgba(140, 220, 255, 0.07)';
    for (let q = 1; q < 8; q++) g.fillRect(Math.round(this.xOf((WAVE_N * q) / 8)), 0, 1, h);
    g.fillStyle = 'rgba(140, 220, 255, 0.18)';
    g.fillRect(PAD, Math.round(h / 2), w - 2 * PAD, 1);
    g.fillStyle = 'rgba(140, 220, 255, 0.07)';
    g.fillRect(PAD, Math.round(this.yOf(0.5)), w - 2 * PAD, 1);
    g.fillRect(PAD, Math.round(this.yOf(-0.5)), w - 2 * PAD, 1);
    // The sound's own shape, faintly, under a drawing.
    const samples = this.samples;
    if (ch?.wave) {
      const base = baseWaveOf(SOUNDS[ch.sound]);
      g.strokeStyle = 'rgba(200, 230, 245, 0.18)';
      g.lineWidth = 1;
      g.setLineDash([3, 3]);
      this.trace(base);
      g.stroke();
      g.setLineDash([]);
    }
    // The wave: filled to the zero line, a glowing line on top.
    const grad = g.createLinearGradient(0, PAD, 0, h - PAD);
    grad.addColorStop(0, `hsla(${hue}, 90%, 62%, 0.35)`);
    grad.addColorStop(0.5, `hsla(${hue}, 90%, 62%, 0.06)`);
    grad.addColorStop(1, `hsla(${hue}, 90%, 62%, 0.35)`);
    this.trace(samples, true);
    g.fillStyle = grad;
    g.fill();
    this.trace(samples);
    g.strokeStyle = `hsl(${hue}, 95%, 68%)`;
    g.lineWidth = 2.2;
    g.shadowColor = `hsla(${hue}, 95%, 60%, 0.8)`;
    g.shadowBlur = 8;
    g.stroke();
    g.shadowBlur = 0;
    g.font = '9px ui-monospace, Consolas, monospace';
    g.fillStyle = 'rgba(180, 215, 236, 0.4)';
    g.textBaseline = 'top';
    g.fillText('one cycle', PAD + 2, 3);
    g.textAlign = 'right';
    g.fillText(ch?.wave ? 'drawn' : `${SOUNDS[ch?.sound]?.label ?? ''}'s own shape (drag to change it)`, w - PAD - 2, 3);
    g.textAlign = 'left';
  }

  /** The path of a cycle (closed to the zero line when filling). */
  trace(samples, closed = false) {
    const g = this.g;
    g.beginPath();
    g.moveTo(this.xOf(0), this.yOf(samples[0]));
    for (let n = 1; n <= WAVE_N; n++) g.lineTo(this.xOf(n), this.yOf(samples[n % WAVE_N]));
    if (closed) {
      g.lineTo(this.xOf(WAVE_N), this.h / 2);
      g.lineTo(this.xOf(0), this.h / 2);
      g.closePath();
    }
  }

  barX(k) {
    const bw = (this.w - 2 * PAD) / HARMONICS;
    return { x: PAD + k * bw + BAR_GAP / 2, w: bw - BAR_GAP };
  }

  drawBars() {
    const { g, w, h } = this;
    const hue = this.hue;
    const levels = harmonicLevels(this.samples);
    const bottom = h - 16;
    const top = 8;
    g.fillStyle = 'rgba(140, 220, 255, 0.07)';
    for (const f of [0.25, 0.5, 0.75]) g.fillRect(PAD, Math.round(bottom - (bottom - top) * f), w - 2 * PAD, 1);
    g.font = '9px ui-monospace, Consolas, monospace';
    g.textBaseline = 'top';
    g.textAlign = 'center';
    levels.forEach((v, i) => {
      const { x, w: bw } = this.barX(i);
      const bh = Math.min(1, v) * (bottom - top);
      g.fillStyle = `hsla(${hue}, 80%, 60%, 0.12)`;
      g.fillRect(x, top, bw, bottom - top);
      const grad = g.createLinearGradient(0, bottom - bh, 0, bottom);
      grad.addColorStop(0, `hsl(${hue}, 95%, 72%)`);
      grad.addColorStop(1, `hsla(${hue}, 90%, 55%, 0.6)`);
      g.fillStyle = grad;
      g.fillRect(x, bottom - bh, bw, bh);
      g.fillStyle = i % 2 === 0 || bw > 16 ? 'rgba(180, 215, 236, 0.45)' : 'transparent';
      g.fillText(String(i + 1), x + bw / 2, bottom + 3);
    });
    g.textAlign = 'left';
    g.fillStyle = 'rgba(180, 215, 236, 0.4)';
    g.fillText('harmonics: drag the bars', PAD + 2, top - 6 < 0 ? 0 : top - 6);
  }

  /* -------------------------------- interaction ------------------------------- */

  pointer(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  hear() {
    if (this.hearing || this.hearBtn.getAttribute('aria-pressed') !== 'true') return;
    this.hearing = true;
    this.studio.preview(this.channelId, HEAR_NOTE, true);
  }

  stopHearing() {
    if (!this.hearing) return;
    this.hearing = false;
    if (this.channelId) this.studio.preview(this.channelId, HEAR_NOTE, false);
  }

  wire() {
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => this.down(e));
    c.addEventListener('pointermove', (e) => this.move(e));
    c.addEventListener('pointerup', () => this.up());
    c.addEventListener('pointercancel', () => this.up());
    this.closeBtn.addEventListener('click', () => this.close());
    this.veil.addEventListener('pointerdown', (e) => {
      if (e.target === this.veil) this.close();
    });
    this.hearBtn.addEventListener('click', () => {
      const on = this.hearBtn.getAttribute('aria-pressed') !== 'true';
      this.hearBtn.setAttribute('aria-pressed', String(on));
      if (!on) this.stopHearing();
    });
  }

  down(e) {
    e.preventDefault();
    const ch = this.channel;
    if (!ch) return;
    this.resize();
    this.canvas.setPointerCapture(e.pointerId);
    const { x, y } = this.pointer(e);
    this.studio.begin();
    // The first stroke on a sound's own shape makes it a drawing.
    if (!ch.wave) this.song.setWave(ch.id, this.samples);
    this.drag = { x, y, n: this.nAt(x) };
    this.hear();
    this.apply(x, y);
  }

  move(e) {
    if (!this.drag) return;
    const { x, y } = this.pointer(e);
    this.apply(x, y);
  }

  up() {
    if (!this.drag) return;
    this.drag = null;
    this.stopHearing();
    this.studio.commit();
    this.render();
  }

  /** Draw mode: the samples from the last pointer spot to this one take the line between them. Harmonics: the bar under the pointer. */
  apply(x, y) {
    const ch = this.channel;
    if (!ch?.wave) return;
    const d = this.drag;
    if (this.view === 'harm') {
      const { w: bw } = this.barX(0);
      const k = Math.floor((x - PAD) / (bw + BAR_GAP));
      if (k >= 0 && k < HARMONICS) {
        const bottom = this.h - 16, top = 8;
        const level = Math.max(0, Math.min(1, (bottom - y) / (bottom - top)));
        this.song.setWave(ch.id, setHarmonic(ch.wave, k + 1, level));
      }
    } else {
      const n1 = Math.max(0, Math.min(WAVE_N - 1, this.nAt(x)));
      const v1 = this.vAt(y);
      const n0 = Math.max(0, Math.min(WAVE_N - 1, d.n));
      const v0 = this.vAt(d.y);
      const wave = [...ch.wave];
      const span = Math.max(1, Math.abs(n1 - n0));
      for (let i = 0; i <= span; i++) {
        const n = n0 + Math.sign(n1 - n0) * i;
        wave[n] = v0 + (v1 - v0) * (i / span);
      }
      this.song.setWave(ch.id, wave);
      d.n = n1;
    }
    d.x = x;
    d.y = y;
    this.studio.change();
    this.draw();
  }
}
