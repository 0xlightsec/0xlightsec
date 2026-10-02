/**
 * The piano roll editor, drawn on one canvas.
 *
 *   ┌──────┬──────────────────────────────── ruler (bars)
 *   │ keys │  grid: pitch up, time across
 *   │      │
 *   ├──────┼──────────────────────────────── velocity lane
 *
 * Mouse, FL style:
 *   left-click empty      draw a note (the length of the last one); keep dragging to place it
 *   drag a note           move it (time and pitch, snapped)
 *   drag a note's end     resize it
 *   right-click / -drag   delete
 *   velocity lane         drag a note's bar up or down
 *   click a key           hear it
 *   wheel                 scroll up and down
 *
 * Rows in the current key are lit, so it's easy to stay in key; in chord mode a
 * click draws the whole chord. Notes are coloured by their place on the Circle of
 * Fifths, like everything else in PRISM.
 */

import { ROLL_LOW, ROLL_HIGH, BAR_STEPS, snapDown, snapNearest } from './roll.js';
import { hueFor, pitchClass, noteName } from '../theory/circle.js';

const KEYS_W = 54;
const RULER_H = 20;
const VEL_H = 46;
const ROW_H = 13;
const EDGE_PX = 7;
const BLACK = new Set([1, 3, 6, 8, 10]);
const MAJOR = [0, 2, 4, 5, 7, 9, 11];

export class RollView {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {Pattern} pattern
   * @param {object} hooks { snap(), key(), chords(), chordFor(midi), playhead(), preview(midi, on), changed() }
   */
  constructor(canvas, pattern, hooks) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.pattern = pattern;
    this.hooks = hooks;
    this.w = 0;
    this.h = 0;
    this.scroll = null; // set on first layout: the middle of the keyboard (around E4) in view
    this.lastLength = 2;
    this.drag = null;
    this.hover = null;
    this.wire();
  }

  /* --------------------------------- geometry -------------------------------- */

  get gridW() {
    return this.w - KEYS_W;
  }

  get gridH() {
    return this.h - RULER_H - VEL_H;
  }

  get stepW() {
    return this.gridW / this.pattern.steps;
  }

  get maxScroll() {
    return Math.max(0, (ROLL_HIGH - ROLL_LOW + 1) * ROW_H - this.gridH);
  }

  xOf(step) {
    return KEYS_W + step * this.stepW;
  }

  yOf(midi) {
    return RULER_H + (ROLL_HIGH - midi) * ROW_H - this.scroll;
  }

  stepAt(x) {
    return (x - KEYS_W) / this.stepW;
  }

  midiAt(y) {
    return ROLL_HIGH - Math.floor((y - RULER_H + this.scroll) / ROW_H);
  }

  region(x, y) {
    if (y >= this.h - VEL_H) return x >= KEYS_W ? 'velocity' : 'none';
    if (y < RULER_H) return 'ruler';
    return x < KEYS_W ? 'keys' : 'grid';
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (w !== this.canvas.width || h !== this.canvas.height) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.w = rect.width;
    this.h = rect.height;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.scroll === null && this.gridH > 0) this.scroll = (ROLL_HIGH - 66) * ROW_H - this.gridH / 2;
    this.scroll = Math.min(Math.max(0, this.scroll ?? 0), this.maxScroll);
  }

  /* --------------------------------- drawing --------------------------------- */

  inKey(midi) {
    return MAJOR.includes((((midi - this.hooks.key()) % 12) + 12) % 12);
  }

  draw() {
    this.resize();
    const g = this.ctx;
    const { w, h } = this;
    if (!w || !h) return;
    const steps = this.pattern.steps;
    const sw = this.stepW;
    g.clearRect(0, 0, w, h);

    // Rows: black keys darker, notes of the key lit, a line under every C.
    g.save();
    g.beginPath();
    g.rect(KEYS_W, RULER_H, this.gridW, this.gridH);
    g.clip();
    for (let m = ROLL_LOW; m <= ROLL_HIGH; m++) {
      const y = this.yOf(m);
      if (y > RULER_H + this.gridH || y + ROW_H < RULER_H) continue;
      const pc = pitchClass(m);
      g.fillStyle = this.inKey(m) ? (BLACK.has(pc) ? '#1d0b1a' : '#24101f') : BLACK.has(pc) ? '#0f050d' : '#150813';
      g.fillRect(KEYS_W, y, this.gridW, ROW_H);
      if (pc === 0) {
        g.fillStyle = 'rgba(255, 160, 230, 0.16)';
        g.fillRect(KEYS_W, y + ROW_H - 1, this.gridW, 1);
      }
    }
    // Columns: sixteenths faint, beats stronger, bars strongest.
    for (let s = 0; s <= steps; s++) {
      const x = Math.round(this.xOf(s)) + 0.5;
      g.fillStyle = s % BAR_STEPS === 0 ? 'rgba(255, 200, 240, 0.32)' : s % 4 === 0 ? 'rgba(255, 200, 240, 0.13)' : 'rgba(255, 200, 240, 0.045)';
      if (sw < 5 && s % 4) continue;
      g.fillRect(x - 0.5, RULER_H, 1, this.gridH);
    }

    // Notes.
    for (const n of this.pattern.notes) {
      const y = this.yOf(n.midi);
      if (y > RULER_H + this.gridH || y + ROW_H < RULER_H) continue;
      const x = this.xOf(n.start);
      const nw = Math.max(3, n.length * sw - 1);
      const hue = hueFor(pitchClass(n.midi));
      const beyond = n.start >= steps;
      const active = this.drag?.notes?.some((d) => d.note === n);
      g.fillStyle = `hsla(${hue}, 95%, ${active ? 72 : 62}%, ${beyond ? 0.25 : 0.55 + 0.45 * n.velocity})`;
      roundRect(g, x + 0.5, y + 1, nw, ROW_H - 2, 3);
      g.fill();
      g.strokeStyle = `hsla(${hue}, 100%, 85%, ${beyond ? 0.2 : 0.9})`;
      g.lineWidth = 1;
      g.stroke();
      // The resize handle.
      g.fillStyle = 'rgba(0, 0, 0, 0.28)';
      g.fillRect(x + nw - 3, y + 3, 1.5, ROW_H - 6);
      if (nw > 26 && ROW_H >= 12) {
        g.fillStyle = 'rgba(20, 0, 16, 0.85)';
        g.font = '9px ui-monospace, Menlo, Consolas, monospace';
        g.textBaseline = 'middle';
        g.fillText(noteName(n.midi), x + 4, y + ROW_H / 2 + 0.5);
      }
    }

    // Playhead.
    const at = this.hooks.playhead();
    if (at !== null) {
      const x = this.xOf(at);
      g.fillStyle = 'rgba(255, 255, 255, 0.9)';
      g.fillRect(x, RULER_H, 1.5, this.gridH);
      g.fillStyle = 'rgba(255, 95, 210, 0.12)';
      g.fillRect(this.xOf(Math.floor(at)), RULER_H, sw, this.gridH);
    }
    g.restore();

    this.drawKeys();
    this.drawRuler(at);
    this.drawVelocity();
  }

  drawKeys() {
    const g = this.ctx;
    g.save();
    g.beginPath();
    g.rect(0, RULER_H, KEYS_W, this.gridH);
    g.clip();
    g.fillStyle = '#0c0410';
    g.fillRect(0, RULER_H, KEYS_W, this.gridH);
    for (let m = ROLL_LOW; m <= ROLL_HIGH; m++) {
      const y = this.yOf(m);
      if (y > RULER_H + this.gridH || y + ROW_H < RULER_H) continue;
      const pc = pitchClass(m);
      const black = BLACK.has(pc);
      const down = this.keyDown === m;
      g.fillStyle = down ? '#ff8fe0' : black ? '#1b1d27' : '#d8dcea';
      g.fillRect(black ? 0 : 0, y + 0.5, black ? KEYS_W * 0.62 : KEYS_W - 1, ROW_H - 1);
      if (pc === 0) {
        g.fillStyle = down ? '#2a0622' : '#5a6078';
        g.font = '9px ui-monospace, Menlo, Consolas, monospace';
        g.textBaseline = 'middle';
        g.fillText(noteName(m), KEYS_W - 26, y + ROW_H / 2 + 0.5);
      }
    }
    g.restore();
  }

  drawRuler(at) {
    const g = this.ctx;
    g.fillStyle = '#12050f';
    g.fillRect(0, 0, this.w, RULER_H);
    g.font = '10px ui-monospace, Menlo, Consolas, monospace';
    g.textBaseline = 'middle';
    for (let bar = 0; bar < this.pattern.bars; bar++) {
      const x = this.xOf(bar * BAR_STEPS);
      g.fillStyle = 'rgba(255, 200, 240, 0.35)';
      g.fillRect(Math.round(x), 0, 1, RULER_H);
      g.fillStyle = 'rgba(255, 220, 245, 0.7)';
      g.fillText(String(bar + 1), x + 5, RULER_H / 2);
      for (let b = 1; b < 4; b++) {
        g.fillStyle = 'rgba(255, 200, 240, 0.18)';
        g.fillRect(Math.round(this.xOf(bar * BAR_STEPS + b * 4)), RULER_H - 6, 1, 6);
      }
    }
    if (at !== null) {
      const x = this.xOf(at);
      g.fillStyle = '#ff5fd2';
      g.beginPath();
      g.moveTo(x - 5, 2);
      g.lineTo(x + 5, 2);
      g.lineTo(x, RULER_H - 4);
      g.closePath();
      g.fill();
    }
    g.fillStyle = '#12050f';
    g.fillRect(0, 0, KEYS_W, RULER_H);
  }

  drawVelocity() {
    const g = this.ctx;
    const top = this.h - VEL_H;
    g.fillStyle = '#0d040b';
    g.fillRect(0, top, this.w, VEL_H);
    g.fillStyle = 'rgba(255, 200, 240, 0.12)';
    g.fillRect(0, top, this.w, 1);
    g.fillStyle = 'rgba(255, 220, 245, 0.4)';
    g.font = '9px ui-monospace, Menlo, Consolas, monospace';
    g.textBaseline = 'middle';
    g.fillText('VEL', 8, top + VEL_H / 2);
    for (const n of this.pattern.notes) {
      if (n.start >= this.pattern.steps) continue;
      const x = this.xOf(n.start);
      const bh = (VEL_H - 8) * n.velocity;
      const hue = hueFor(pitchClass(n.midi));
      g.fillStyle = `hsla(${hue}, 95%, 65%, 0.85)`;
      g.fillRect(x + 1, this.h - 4 - bh, Math.max(2, Math.min(5, this.stepW * n.length - 2)), bh);
      g.beginPath();
      g.arc(x + 2.5, this.h - 4 - bh, 2.5, 0, Math.PI * 2);
      g.fill();
    }
  }

  /* ------------------------------- interaction ------------------------------- */

  pointer(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  wire() {
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => this.down(e));
    c.addEventListener('pointermove', (e) => this.move(e));
    const up = (e) => this.up(e);
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.scroll = Math.min(Math.max(0, this.scroll + e.deltaY * 0.6), this.maxScroll);
    }, { passive: false });
  }

  down(e) {
    e.preventDefault();
    this.resize(); // in case it hasn't been drawn since it opened or the window changed
    const { x, y } = this.pointer(e);
    const where = this.region(x, y);
    this.canvas.setPointerCapture(e.pointerId);
    const p = this.pattern;
    const snap = this.hooks.snap();

    if (where === 'keys') {
      this.keyDown = this.midiAt(y);
      this.hooks.preview(this.keyDown, true);
      this.drag = { mode: 'key' };
      return;
    }
    if (where === 'velocity') {
      p.checkpoint();
      this.drag = { mode: 'velocity' };
      this.setVelocity(x, y);
      return;
    }
    if (where !== 'grid') return;

    const step = this.stepAt(x);
    const midi = this.midiAt(y);
    p.checkpoint();

    if (e.button === 2) {
      this.drag = { mode: 'erase' };
      this.erase(step, midi);
      return;
    }

    const hit = p.noteAt(step, midi);
    if (hit) {
      const nearEnd = this.xOf(hit.start + hit.length) - x < EDGE_PX;
      this.drag = {
        mode: nearEnd ? 'resize' : 'move',
        notes: [{ note: hit, start: hit.start, midi: hit.midi, length: hit.length }],
        fromStep: step,
        fromMidi: midi
      };
      if (!nearEnd) this.hooks.preview(hit.midi);
      return;
    }

    // Draw: a note, or in chord mode the chord that fits the key.
    const start = snapDown(step, snap);
    const pitches = this.hooks.chords() ? this.hooks.chordFor(midi) : [midi];
    const made = pitches.map((m) => p.add({ start, length: this.lastLength, midi: m }));
    this.drag = {
      mode: 'move',
      notes: made.map((n) => ({ note: n, start: n.start, midi: n.midi, length: n.length })),
      fromStep: step,
      fromMidi: midi,
      fresh: true
    };
    pitches.forEach((m) => this.hooks.preview(m));
  }

  move(e) {
    const { x, y } = this.pointer(e);
    const d = this.drag;
    if (!d) {
      this.cursor(x, y);
      return;
    }
    const snap = this.hooks.snap();
    if (d.mode === 'erase') {
      if (this.region(x, y) === 'grid') this.erase(this.stepAt(x), this.midiAt(y));
    } else if (d.mode === 'velocity') {
      this.setVelocity(x, y);
    } else if (d.mode === 'move') {
      const ds = snapNearest(this.stepAt(x) - d.fromStep, snap);
      const dm = this.midiAt(y) - d.fromMidi;
      const lowest = Math.min(...d.notes.map((n) => n.start));
      const shift = Math.max(-lowest, ds);
      let pitched = false;
      for (const n of d.notes) {
        n.note.start = n.start + shift;
        const m = Math.min(ROLL_HIGH, Math.max(ROLL_LOW, n.midi + dm));
        if (m !== n.note.midi) pitched = true;
        n.note.midi = m;
      }
      if (pitched) d.notes.forEach((n) => this.hooks.preview(n.note.midi));
    } else if (d.mode === 'resize') {
      for (const n of d.notes) {
        const end = snapNearest(this.stepAt(x) - n.start, snap);
        n.note.length = Math.max(snap, end);
      }
    }
  }

  up() {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (d.mode === 'key') {
      this.hooks.preview(this.keyDown, false);
      this.keyDown = null;
      return;
    }
    if (d.mode === 'resize' || (d.mode === 'move' && d.fresh)) this.lastLength = d.notes[0].note.length;
    this.pattern.settle();
    this.hooks.changed();
  }

  erase(step, midi) {
    const hit = this.pattern.noteAt(step, midi);
    if (hit) this.pattern.remove(hit.id);
  }

  /** The velocity lane: the note starting nearest the pointer takes the new height. */
  setVelocity(x, y) {
    const step = this.stepAt(x);
    const v = Math.min(1, Math.max(0.05, (this.h - 4 - y) / (VEL_H - 8)));
    let best = null;
    for (const n of this.pattern.notes) {
      const dist = Math.abs(n.start - step);
      if (step >= n.start - 0.5 && step <= n.start + Math.max(1, n.length) && (!best || dist < best.dist)) best = { n, dist };
    }
    if (!best) return;
    // Every note starting at the same moment (a chord) moves together.
    for (const n of this.pattern.notes) if (n.start === best.n.start) n.velocity = v;
  }

  cursor(x, y) {
    const where = this.region(x, y);
    let c = 'default';
    if (where === 'grid') {
      const hit = this.pattern.noteAt(this.stepAt(x), this.midiAt(y));
      c = hit ? (this.xOf(hit.start + hit.length) - x < EDGE_PX ? 'ew-resize' : 'grab') : 'crosshair';
    } else if (where === 'keys') c = 'pointer';
    else if (where === 'velocity') c = 'ns-resize';
    this.canvas.style.cursor = c;
  }
}

function roundRect(g, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}
