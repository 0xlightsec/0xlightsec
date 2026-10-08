/**
 * Piano roll: one channel's notes in the current pattern, drawn on a canvas.
 *
 *   ┌──────┬──────────────────────── ruler (bars, playhead)
 *   │ keys │ grid: pitch up, time across; other channels' notes shown faintly
 *   ├──────┼──────────────────────── velocity lane
 *
 * Mouse, FL style:
 *   click empty            draw (the last note's length; a whole chord in chord mode)
 *   drag a note            move it, and every selected note with it
 *   drag a note's end      resize (every selected note)
 *   Ctrl+drag              box-select (Shift adds)
 *   Shift+click a note     add it to the selection
 *   right-click / -drag    delete
 *   velocity lane          drag a note's bar
 *   wheel                  scroll pitch; Shift+wheel scrolls time; Ctrl+wheel zooms
 * Keys (while the roll is showing): Delete, Ctrl+A, Ctrl+C, Ctrl+V, Ctrl+B
 * (duplicate), ↑↓ transpose (Shift: an octave), ←→ nudge by the snap.
 */

import { STEPS_PER_BAR, NOTE_LOW, NOTE_HIGH } from '../model.js';
import { hueFor, pitchClass, noteName } from '../../theory/circle.js';

const KEYS_W = 54;
const RULER_H = 20;
const VEL_H = 46;
const ROW_H = 14;
const EDGE_PX = 7;
const BLACK = new Set([1, 3, 6, 8, 10]);
const MAJOR = [0, 2, 4, 5, 7, 9, 11];

export const snapDown = (step, snap) => Math.floor(step / snap + 1e-9) * snap;
export const snapNearest = (step, snap) => Math.round(step / snap) * snap;

export class PianoRoll {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} studio  the app: song, begin(), change(), commit(), preview(), …
   * @param {object} opts    { snap(), key(), chords(), chordFor(midi), ghosts() }
   */
  constructor(canvas, studio, opts) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.studio = studio;
    this.opts = opts;
    this.w = 0;
    this.h = 0;
    this.scroll = null;     // px from the top row
    this.view = { from: 0, steps: null }; // visible time window; steps null = the whole pattern
    this.selected = new Set();
    this.clipboard = null;
    this.lastLength = 1;
    this.drag = null;
    this.keyDown = null;
    this.wire();
  }

  /* -------------------------------- the data -------------------------------- */

  get song() {
    return this.studio.song;
  }

  get pattern() {
    return this.song.currentPattern;
  }

  get channel() {
    return this.song.currentChannel;
  }

  get notes() {
    return this.pattern && this.channel ? this.song.notes(this.pattern.id, this.channel.id) : [];
  }

  get steps() {
    return this.pattern ? this.song.steps(this.pattern) : STEPS_PER_BAR;
  }

  /* --------------------------------- geometry -------------------------------- */

  get gridW() {
    return this.w - KEYS_W;
  }

  get gridH() {
    return this.h - RULER_H - VEL_H;
  }

  get shown() {
    return Math.min(this.steps, this.view.steps ?? this.steps);
  }

  get stepW() {
    return this.gridW / this.shown;
  }

  get maxScroll() {
    return Math.max(0, (NOTE_HIGH - NOTE_LOW + 1) * ROW_H - this.gridH);
  }

  xOf(step) {
    return KEYS_W + (step - this.view.from) * this.stepW;
  }

  yOf(midi) {
    return RULER_H + (NOTE_HIGH - midi) * ROW_H - this.scroll;
  }

  stepAt(x) {
    return this.view.from + (x - KEYS_W) / this.stepW;
  }

  midiAt(y) {
    return NOTE_HIGH - Math.floor((y - RULER_H + this.scroll) / ROW_H);
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
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.scroll === null && this.gridH > 0) this.scroll = (NOTE_HIGH - 66) * ROW_H - this.gridH / 2;
    this.scroll = Math.min(Math.max(0, this.scroll ?? 0), this.maxScroll);
    this.view.from = Math.min(Math.max(0, this.view.from), Math.max(0, this.steps - this.shown));
  }

  /** Scroll so these notes are in view (after a channel switch, say). */
  reveal(notes = this.notes) {
    if (!notes.length || !this.gridH) return;
    const mid = notes.reduce((s, n) => s + n.midi, 0) / notes.length;
    this.scroll = (NOTE_HIGH - mid) * ROW_H - this.gridH / 2;
  }

  /* --------------------------------- drawing --------------------------------- */

  inKey(midi) {
    return MAJOR.includes((((midi - this.opts.key()) % 12) + 12) % 12);
  }

  draw(playhead) {
    this.resize();
    const g = this.g;
    const { w, h } = this;
    if (!w || !h) return;
    const sw = this.stepW;
    const steps = this.steps;
    g.clearRect(0, 0, w, h);

    g.save();
    g.beginPath();
    g.rect(KEYS_W, RULER_H, this.gridW, this.gridH);
    g.clip();
    // Rows: black keys darker, the key's notes lit, a line under every C.
    for (let m = NOTE_LOW; m <= NOTE_HIGH; m++) {
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
    // Columns: sixteenths, beats, bars.
    const first = Math.floor(this.view.from);
    for (let s = first; s <= Math.min(steps, this.view.from + this.shown + 1); s++) {
      if (sw < 5 && s % 4) continue;
      const x = Math.round(this.xOf(s)) + 0.5;
      g.fillStyle = s % STEPS_PER_BAR === 0 ? 'rgba(255, 200, 240, 0.32)' : s % 4 === 0 ? 'rgba(255, 200, 240, 0.13)' : 'rgba(255, 200, 240, 0.045)';
      g.fillRect(x - 0.5, RULER_H, 1, this.gridH);
    }

    // Ghost notes: the pattern's other channels, faint.
    if (this.opts.ghosts() && this.pattern) {
      g.fillStyle = 'rgba(255, 220, 245, 0.07)';
      for (const [cid, list] of Object.entries(this.pattern.notes)) {
        if (cid === this.channel?.id) continue;
        for (const n of list) {
          const y = this.yOf(n.midi);
          if (y > RULER_H + this.gridH || y + ROW_H < RULER_H) continue;
          g.fillRect(this.xOf(n.start) + 0.5, y + 2, Math.max(2, n.length * sw - 1), ROW_H - 4);
        }
      }
    }

    // This channel's notes.
    for (const n of this.notes) {
      const y = this.yOf(n.midi);
      if (y > RULER_H + this.gridH || y + ROW_H < RULER_H) continue;
      const x = this.xOf(n.start);
      const nw = Math.max(3, n.length * sw - 1);
      const hue = hueFor(pitchClass(n.midi));
      const beyond = n.start >= steps;
      const sel = this.selected.has(n.id);
      g.fillStyle = `hsla(${hue}, 95%, ${sel ? 76 : 60}%, ${beyond ? 0.25 : 0.55 + 0.45 * n.velocity})`;
      roundRect(g, x + 0.5, y + 1, nw, ROW_H - 2, 3);
      g.fill();
      g.strokeStyle = sel ? '#ffffff' : `hsla(${hue}, 100%, 85%, ${beyond ? 0.2 : 0.9})`;
      g.lineWidth = sel ? 1.5 : 1;
      g.stroke();
      g.fillStyle = 'rgba(0, 0, 0, 0.28)';
      g.fillRect(x + nw - 3, y + 3, 1.5, ROW_H - 6);
      if (nw > 26) {
        g.fillStyle = 'rgba(20, 0, 16, 0.85)';
        g.font = '9px ui-monospace, Menlo, Consolas, monospace';
        g.textBaseline = 'middle';
        g.fillText(noteName(n.midi), x + 4, y + ROW_H / 2 + 0.5);
      }
    }

    // Box selection.
    if (this.drag?.mode === 'box') {
      const { x0, y0, x1, y1 } = this.drag;
      g.fillStyle = 'rgba(255, 95, 210, 0.12)';
      g.strokeStyle = 'rgba(255, 140, 220, 0.8)';
      g.lineWidth = 1;
      g.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
      g.strokeRect(Math.min(x0, x1) + 0.5, Math.min(y0, y1) + 0.5, Math.abs(x1 - x0), Math.abs(y1 - y0));
    }

    if (playhead !== null && playhead !== undefined) {
      const x = this.xOf(playhead);
      g.fillStyle = 'rgba(255, 255, 255, 0.9)';
      g.fillRect(x, RULER_H, 1.5, this.gridH);
    }
    g.restore();

    this.drawKeys();
    this.drawRuler(playhead);
    this.drawVelocity();
  }

  drawKeys() {
    const g = this.g;
    g.save();
    g.beginPath();
    g.rect(0, RULER_H, KEYS_W, this.gridH);
    g.clip();
    g.fillStyle = '#0c0410';
    g.fillRect(0, RULER_H, KEYS_W, this.gridH);
    for (let m = NOTE_LOW; m <= NOTE_HIGH; m++) {
      const y = this.yOf(m);
      if (y > RULER_H + this.gridH || y + ROW_H < RULER_H) continue;
      const pc = pitchClass(m);
      const black = BLACK.has(pc);
      const down = this.keyDown === m;
      g.fillStyle = down ? '#ff8fe0' : black ? '#1b1d27' : '#d8dcea';
      g.fillRect(0, y + 0.5, black ? KEYS_W * 0.62 : KEYS_W - 1, ROW_H - 1);
      if (pc === 0) {
        g.fillStyle = down ? '#2a0622' : '#5a6078';
        g.font = '9px ui-monospace, Menlo, Consolas, monospace';
        g.textBaseline = 'middle';
        g.fillText(noteName(m), KEYS_W - 26, y + ROW_H / 2 + 0.5);
      }
    }
    g.restore();
  }

  drawRuler(playhead) {
    const g = this.g;
    g.fillStyle = '#12050f';
    g.fillRect(0, 0, this.w, RULER_H);
    g.font = '10px ui-monospace, Menlo, Consolas, monospace';
    g.textBaseline = 'middle';
    const bars = this.steps / STEPS_PER_BAR;
    for (let bar = 0; bar < bars; bar++) {
      const x = this.xOf(bar * STEPS_PER_BAR);
      if (x < KEYS_W - 1 || x > this.w) continue;
      g.fillStyle = 'rgba(255, 200, 240, 0.35)';
      g.fillRect(Math.round(x), 0, 1, RULER_H);
      g.fillStyle = 'rgba(255, 220, 245, 0.7)';
      g.fillText(String(bar + 1), x + 5, RULER_H / 2);
    }
    if (playhead !== null && playhead !== undefined) {
      const x = this.xOf(playhead);
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
    g.fillStyle = 'rgba(255, 220, 245, 0.5)';
    g.font = '9px ui-monospace, Menlo, Consolas, monospace';
    g.fillText(this.channel ? this.channel.name.slice(0, 8) : '', 6, RULER_H / 2);
  }

  drawVelocity() {
    const g = this.g;
    const top = this.h - VEL_H;
    g.fillStyle = '#0d040b';
    g.fillRect(0, top, this.w, VEL_H);
    g.fillStyle = 'rgba(255, 200, 240, 0.12)';
    g.fillRect(0, top, this.w, 1);
    g.fillStyle = 'rgba(255, 220, 245, 0.4)';
    g.font = '9px ui-monospace, Menlo, Consolas, monospace';
    g.textBaseline = 'middle';
    g.fillText('VEL', 8, top + VEL_H / 2);
    g.save();
    g.beginPath();
    g.rect(KEYS_W, top, this.gridW, VEL_H);
    g.clip();
    for (const n of this.notes) {
      if (n.start >= this.steps) continue;
      const x = this.xOf(n.start);
      const bh = (VEL_H - 8) * n.velocity;
      g.fillStyle = `hsla(${hueFor(pitchClass(n.midi))}, 95%, ${this.selected.has(n.id) ? 80 : 65}%, 0.85)`;
      g.fillRect(x + 1, this.h - 4 - bh, Math.max(2, Math.min(5, this.stepW * n.length - 2)), bh);
      g.beginPath();
      g.arc(x + 2.5, this.h - 4 - bh, 2.5, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }

  /* ------------------------------- interaction ------------------------------- */

  pointer(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  noteAt(step, midi) {
    const list = this.notes;
    for (let i = list.length - 1; i >= 0; i--) {
      const n = list[i];
      if (n.midi === midi && step >= n.start && step < n.start + n.length) return n;
    }
    return null;
  }

  wire() {
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => this.down(e));
    c.addEventListener('pointermove', (e) => this.move(e));
    c.addEventListener('pointerup', () => this.up());
    c.addEventListener('pointercancel', () => this.up());
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        // Zoom time around the pointer.
        const { x } = this.pointer(e);
        const at = this.stepAt(x);
        const next = Math.min(this.steps, Math.max(8, this.shown * (e.deltaY > 0 ? 1.25 : 0.8)));
        this.view.steps = next >= this.steps ? null : next;
        this.view.from = at - ((x - KEYS_W) / this.gridW) * this.shown;
      } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        this.view.from += ((e.deltaX || e.deltaY) / this.stepW) * 0.5;
      } else {
        this.scroll = Math.min(Math.max(0, this.scroll + e.deltaY * 0.6), this.maxScroll);
      }
    }, { passive: false });
  }

  down(e) {
    e.preventDefault();
    this.resize();
    if (!this.channel || !this.pattern) return;
    const { x, y } = this.pointer(e);
    const where = this.region(x, y);
    this.canvas.setPointerCapture(e.pointerId);
    const snap = this.opts.snap();
    const p = this.pattern.id;
    const c = this.channel.id;

    if (where === 'keys') {
      this.keyDown = this.midiAt(y);
      this.studio.preview(c, this.keyDown, true);
      this.drag = { mode: 'key' };
      return;
    }
    if (where === 'velocity') {
      this.studio.begin();
      this.drag = { mode: 'velocity' };
      this.setVelocity(x, y);
      return;
    }
    if (where !== 'grid') return;

    const step = this.stepAt(x);
    const midi = this.midiAt(y);

    if (e.button === 2) {
      this.studio.begin();
      this.drag = { mode: 'erase' };
      this.erase(step, midi);
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      this.drag = { mode: 'box', x0: x, y0: y, x1: x, y1: y, add: e.shiftKey, before: new Set(this.selected) };
      return;
    }

    const hit = this.noteAt(step, midi);
    if (hit) {
      if (e.shiftKey) {
        if (this.selected.has(hit.id)) this.selected.delete(hit.id);
        else this.selected.add(hit.id);
        return;
      }
      if (!this.selected.has(hit.id)) this.selected = new Set([hit.id]);
      const group = this.notes.filter((n) => this.selected.has(n.id));
      const nearEnd = this.xOf(hit.start + hit.length) - x < EDGE_PX;
      this.studio.begin();
      this.drag = {
        mode: nearEnd ? 'resize' : 'move',
        notes: group.map((n) => ({ note: n, start: n.start, midi: n.midi, length: n.length })),
        anchor: hit,
        fromStep: step,
        fromMidi: midi
      };
      if (!nearEnd) this.studio.preview(c, hit.midi);
      return;
    }

    // Draw a note, or the chord that fits the key.
    this.studio.begin();
    const start = snapDown(step, snap);
    const pitches = this.opts.chords() ? this.opts.chordFor(midi) : [midi];
    const made = pitches.map((m) => this.song.addNote(p, c, { start, length: this.lastLength, midi: m }));
    this.selected = new Set(made.map((n) => n.id));
    this.drag = {
      mode: 'move',
      notes: made.map((n) => ({ note: n, start: n.start, midi: n.midi, length: n.length })),
      anchor: made[0],
      fromStep: step,
      fromMidi: midi,
      fresh: true
    };
    pitches.forEach((m) => this.studio.preview(c, m));
    this.studio.change();
  }

  move(e) {
    const { x, y } = this.pointer(e);
    const d = this.drag;
    if (!d) {
      this.cursor(x, y);
      return;
    }
    const snap = this.opts.snap();
    if (d.mode === 'erase') {
      if (this.region(x, y) === 'grid') this.erase(this.stepAt(x), this.midiAt(y));
    } else if (d.mode === 'velocity') {
      this.setVelocity(x, y);
    } else if (d.mode === 'box') {
      d.x1 = x;
      d.y1 = y;
      const s0 = this.stepAt(Math.min(d.x0, x)), s1 = this.stepAt(Math.max(d.x0, x));
      const top = this.midiAt(Math.min(d.y0, y)), bottom = this.midiAt(Math.max(d.y0, y));
      const inside = this.notes.filter((n) => n.start < s1 && n.start + n.length > s0 && n.midi <= top && n.midi >= bottom).map((n) => n.id);
      this.selected = new Set([...(d.add ? d.before : []), ...inside]);
    } else if (d.mode === 'move') {
      const ds = snapNearest(this.stepAt(x) - d.fromStep, snap);
      const dm = this.midiAt(y) - d.fromMidi;
      const lowest = Math.min(...d.notes.map((n) => n.start));
      const shift = Math.max(-lowest, ds);
      let pitched = false;
      for (const n of d.notes) {
        n.note.start = n.start + shift;
        const m = Math.min(NOTE_HIGH, Math.max(NOTE_LOW, n.midi + dm));
        if (m !== n.note.midi) pitched = true;
        n.note.midi = m;
      }
      if (pitched) this.studio.preview(this.channel.id, d.anchor.midi);
      this.studio.change();
    } else if (d.mode === 'resize') {
      const anchor = d.notes.find((n) => n.note === d.anchor);
      const grow = snapNearest(this.stepAt(x) - (anchor.start + anchor.length), snap);
      for (const n of d.notes) n.note.length = Math.max(snap, n.length + grow);
      this.studio.change();
    }
  }

  up() {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (d.mode === 'key') {
      this.studio.preview(this.channel.id, this.keyDown, false);
      this.keyDown = null;
      return;
    }
    if (d.mode === 'box') return;
    if (d.mode === 'resize' || (d.mode === 'move' && d.fresh)) this.lastLength = d.anchor.length;
    this.studio.commit();
  }

  erase(step, midi) {
    const hit = this.noteAt(step, midi);
    if (!hit) return;
    this.song.removeNotes(this.pattern.id, this.channel.id, [hit.id]);
    this.selected.delete(hit.id);
    this.studio.change();
  }

  /** The note starting nearest the pointer takes the new velocity, with any chord (or selection) it's part of. */
  setVelocity(x, y) {
    const step = this.stepAt(x);
    const v = Math.min(1, Math.max(0.05, (this.h - 4 - y) / (VEL_H - 8)));
    let best = null;
    for (const n of this.notes) {
      const dist = Math.abs(n.start - step);
      if (step >= n.start - 0.5 && step <= n.start + Math.max(1, n.length) && (!best || dist < best.dist)) best = { n, dist };
    }
    if (!best) return;
    const group = this.selected.has(best.n.id) ? (n) => this.selected.has(n.id) : (n) => n.start === best.n.start;
    for (const n of this.notes) if (group(n)) n.velocity = v;
    this.studio.change();
  }

  cursor(x, y) {
    const where = this.region(x, y);
    let c = 'default';
    if (where === 'grid') {
      const hit = this.noteAt(this.stepAt(x), this.midiAt(y));
      c = hit ? (this.xOf(hit.start + hit.length) - x < EDGE_PX ? 'ew-resize' : 'grab') : 'crosshair';
    } else if (where === 'keys') c = 'pointer';
    else if (where === 'velocity') c = 'ns-resize';
    this.canvas.style.cursor = c;
  }

  /* ------------------------------ keyboard edits ----------------------------- */

  /** Handle an editing key; returns true if it was one. */
  key(e) {
    if (!this.channel || !this.pattern) return false;
    const mod = e.ctrlKey || e.metaKey;
    const p = this.pattern.id;
    const c = this.channel.id;
    const chosen = () => this.notes.filter((n) => this.selected.has(n.id));
    const edit = (fn) => {
      this.studio.begin();
      fn();
      this.studio.commit();
    };
    if (mod && e.code === 'KeyA') {
      this.selected = new Set(this.notes.map((n) => n.id));
    } else if (mod && e.code === 'KeyC') {
      this.copy();
    } else if (mod && e.code === 'KeyX') {
      this.copy();
      edit(() => this.song.removeNotes(p, c, [...this.selected]));
      this.selected.clear();
    } else if (mod && e.code === 'KeyV') {
      if (this.clipboard) edit(() => this.paste());
    } else if (mod && (e.code === 'KeyB' || e.code === 'KeyD')) {
      if (this.selected.size) edit(() => {
        this.copy();
        this.paste();
      });
    } else if (!mod && (e.code === 'Delete' || e.code === 'Backspace')) {
      if (!this.selected.size) return false;
      edit(() => this.song.removeNotes(p, c, [...this.selected]));
      this.selected.clear();
    } else if (!mod && (e.code === 'ArrowUp' || e.code === 'ArrowDown')) {
      if (!this.selected.size) return false;
      const by = (e.code === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 12 : 1);
      edit(() => chosen().forEach((n) => (n.midi = Math.min(NOTE_HIGH, Math.max(NOTE_LOW, n.midi + by)))));
      this.studio.preview(c, chosen()[0]?.midi);
    } else if (!mod && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
      if (!this.selected.size) return false;
      const by = (e.code === 'ArrowRight' ? 1 : -1) * this.opts.snap();
      edit(() => {
        const list = chosen();
        if (Math.min(...list.map((n) => n.start)) + by < 0) return;
        list.forEach((n) => (n.start += by));
      });
    } else return false;
    e.preventDefault();
    return true;
  }

  /** Copy the selection, remembering where it sits and the span it repeats over. */
  copy() {
    const list = this.notes.filter((n) => this.selected.has(n.id));
    if (!list.length) return;
    const from = Math.min(...list.map((n) => n.start));
    const to = Math.max(...list.map((n) => n.start + n.length));
    // Repeat on the beat: the span rounds up to whole beats, or whole bars past half a bar.
    const unit = to - from > 8 ? 16 : 4;
    this.clipboard = {
      from,
      span: Math.ceil((to - from) / unit - 1e-9) * unit,
      notes: list.map(({ start, length, midi, velocity }) => ({ start, length, midi, velocity }))
    };
  }

  /** Paste right after the copied span, selecting what's pasted; paste again to keep going. */
  paste() {
    const cb = this.clipboard;
    const at = cb.from + cb.span;
    const made = cb.notes.map((n) => this.song.addNote(this.pattern.id, this.channel.id, { ...n, start: n.start - cb.from + at }));
    this.selected = new Set(made.map((n) => n.id));
    cb.from = at;
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
