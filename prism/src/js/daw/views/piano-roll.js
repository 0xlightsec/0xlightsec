/**
 * Piano roll: one channel's notes in the current pattern, drawn on a canvas and
 * styled after FL Studio's: a real keyboard down the side that lights up as
 * notes play, a slate grid with the scale's rows lit, bevelled green notes
 * labelled with their names and shaded by velocity (red when selected, grey when
 * muted), an orange song-position marker and a lollipop velocity lane.
 *
 *   ┌──────┬──────────────────────── ruler (bars, beats, playhead)
 *   │ keys │ grid: pitch up, time across; other channels' notes shown faintly
 *   ├──────┼──────────────────────── velocity lane
 *
 * FL's tools (the toolbar above picks one):
 *   Draw     click to draw (the last note's length; a whole chord in chord mode),
 *            drag a note to move it, drag its end to resize
 *   Paint    drag to lay notes as you go, one every note-length
 *   Delete   click or drag over notes
 *   Mute     click or drag over notes to silence them (again to bring them back)
 *   Slice    drag a line down through notes to cut them there
 *   Select   drag a box; drag the selection to move it
 * In every tool: right-click / -drag deletes, Ctrl+drag box-selects (Shift adds),
 * Shift+click adds a note to the selection, the velocity lane sets velocity.
 * Wheel scrolls pitch; Shift+wheel scrolls time; Ctrl+wheel zooms time (smaller or
 * bigger boxes, past the end of the pattern if you like); Alt+wheel zooms the rows.
 * The header's zoom buttons do the same.
 * Keys (while the roll is showing): Delete, Ctrl+A, Ctrl+C, Ctrl+X, Ctrl+V,
 * Ctrl+B (duplicate), ↑↓ transpose (Shift: an octave), ←→ nudge by the snap.
 */

import { STEPS_PER_BAR, NOTE_LOW, NOTE_HIGH } from '../model.js';
import { pitchClass, noteName } from '../../theory/circle.js';

const KEYS_W = 76;
const RULER_H = 24;
const EDGE_PX = 7;
const ROW_MIN = 8;
const ROW_MAX = 28;
export const STEP_MIN = 4;    // px per sixteenth, zoomed all the way out …
export const STEP_MAX = 160;  // … and all the way in
const STEP_FIT = [14, 32];    // the default: fit the pattern, but never boxes smaller or bigger than this
const BLACK = new Set([1, 3, 6, 8, 10]);
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
export const TOOLS = ['draw', 'paint', 'erase', 'mute', 'slice', 'select'];

/** FL's piano roll colours. */
const FL = {
  rowWhite: '#34434b',
  rowBlack: '#2b393f',
  rowWhiteOut: '#2c393f',  // rows outside the scale sit back a little
  rowBlackOut: '#253136',
  octave: '#1a2327',
  step: 'rgba(0, 0, 0, 0.16)',
  beat: 'rgba(0, 0, 0, 0.34)',
  bar: 'rgba(0, 0, 0, 0.7)',
  beyond: 'rgba(8, 12, 14, 0.5)',
  ruler: '#232c31',
  rulerText: '#c9d4da',
  lane: '#1d2529',
  marker: '#ff9f2e',
  keyLabel: '#56636b'
};

export const snapDown = (step, snap) => Math.floor(step / snap + 1e-9) * snap;
export const snapNearest = (step, snap) => Math.round(step / snap) * snap;

/** A note's colours: FL green, lighter the harder it's hit; red when selected, grey when muted. */
function noteColours(n, selected) {
  if (n.muted) return { fill: 'hsl(150, 6%, 46%)', edge: 'hsl(150, 6%, 26%)', text: 'rgba(20, 26, 28, 0.85)' };
  const hue = selected ? 356 : 104;
  const sat = selected ? 78 : 62;
  const light = 40 + 22 * n.velocity;
  return { fill: `hsl(${hue}, ${sat}%, ${light}%)`, edge: `hsl(${hue}, ${sat}%, ${selected ? 30 : 20}%)`, text: selected ? '#3a0710' : '#122d0c' };
}

export class PianoRoll {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} studio  the app: song, begin(), change(), commit(), preview(), …
   * @param {object} opts    { snap(), inKey(midi) or key(), chords(), chordFor(midi), ghosts() }
   */
  constructor(canvas, studio, opts) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.studio = studio;
    this.opts = opts;
    this.w = 0;
    this.h = 0;
    this.rowH = 14;
    this.scroll = null;     // px from the top row
    this.view = { from: 0, stepW: null }; // first step shown, and px per step (null: fit the pattern)
    this.selected = new Set();
    this.clipboard = null;
    this.lastLength = 1;
    this.drag = null;
    this.keyDown = null;
    this.hoverKey = null;
    this.tool = 'draw';
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

  /** The velocity lane: smaller in a short window, so the notes keep the room. */
  get velH() {
    return this.h < 420 ? 44 : 64;
  }

  get gridH() {
    return this.h - RULER_H - this.velH;
  }

  /** px per sixteenth: the zoom you chose, or the pattern fitted in, within comfortable bounds. */
  get stepW() {
    return this.view.stepW ?? Math.min(STEP_FIT[1], Math.max(STEP_FIT[0], this.gridW / this.steps));
  }

  /** How many steps fit across. */
  get shown() {
    return this.gridW / this.stepW;
  }

  /** How far the timeline scrolls: the pattern and a little past it, or the last note if it's further. */
  get extent() {
    const end = this.notes.reduce((m, n) => Math.max(m, n.start + n.length), 0);
    return Math.max(this.steps + STEPS_PER_BAR, end + 4);
  }

  /** Zoom time by a factor around an x position (the middle of the grid if none). */
  zoomTime(factor, x = KEYS_W + this.gridW / 2) {
    const at = this.stepAt(x);
    this.view.stepW = Math.min(STEP_MAX, Math.max(STEP_MIN, this.stepW * factor));
    this.view.from = at - (x - KEYS_W) / this.view.stepW;
    this.clampView();
    this.opts.onZoom?.(this.view.stepW, this.rowH);
  }

  /** Taller or shorter rows, keeping the note at y where it is. */
  zoomRows(by, y = RULER_H + this.gridH / 2) {
    const midi = NOTE_HIGH - (y - RULER_H + this.scroll) / this.rowH;
    this.rowH = Math.min(ROW_MAX, Math.max(ROW_MIN, this.rowH + by));
    this.scroll = (NOTE_HIGH - midi) * this.rowH - (y - RULER_H);
    this.scroll = Math.min(Math.max(0, this.scroll), this.maxScroll);
    this.opts.onZoom?.(this.view.stepW, this.rowH);
  }

  clampView() {
    this.view.from = Math.min(Math.max(0, this.view.from), Math.max(0, this.extent - this.shown));
  }

  get maxScroll() {
    return Math.max(0, (NOTE_HIGH - NOTE_LOW + 1) * this.rowH - this.gridH);
  }

  xOf(step) {
    return KEYS_W + (step - this.view.from) * this.stepW;
  }

  yOf(midi) {
    return RULER_H + (NOTE_HIGH - midi) * this.rowH - this.scroll;
  }

  stepAt(x) {
    return this.view.from + (x - KEYS_W) / this.stepW;
  }

  midiAt(y) {
    return NOTE_HIGH - Math.floor((y - RULER_H + this.scroll) / this.rowH);
  }

  region(x, y) {
    if (y >= this.h - this.velH) return x >= KEYS_W ? 'velocity' : 'none';
    if (y < RULER_H) return 'ruler';
    return x < KEYS_W ? 'keys' : 'grid';
  }

  visible(midi) {
    const y = this.yOf(midi);
    return y <= RULER_H + this.gridH && y + this.rowH >= RULER_H;
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
    if (this.scroll === null && this.gridH > 0) this.scroll = (NOTE_HIGH - 66) * this.rowH - this.gridH / 2;
    if (this.revealing && this.gridH > 0) this.reveal();
    this.scroll = Math.min(Math.max(0, this.scroll ?? 0), this.maxScroll);
    this.clampView();
  }

  /** Bring this channel's notes into view if most of them are out of sight (opening the roll on a channel, say). */
  revealIfHidden() {
    if (!(this.gridH > 0)) return this.reveal();
    const notes = this.notes;
    const seen = notes.filter((n) => this.visible(n.midi)).length;
    if (seen * 2 < notes.length) this.reveal();
  }

  /** Scroll so these notes are in view (after a channel switch, say); before the first layout, as soon as there is one. */
  reveal(notes = this.notes) {
    if (!(this.gridH > 0)) {
      this.revealing = true;
      return;
    }
    this.revealing = false;
    if (!notes.length) return;
    const mid = notes.reduce((s, n) => s + n.midi, 0) / notes.length;
    this.scroll = (NOTE_HIGH - mid) * this.rowH - this.gridH / 2;
  }

  /* --------------------------------- drawing --------------------------------- */

  inKey(midi) {
    if (this.opts.inKey) return this.opts.inKey(midi);
    return MAJOR.includes((((midi - this.opts.key()) % 12) + 12) % 12);
  }

  draw(playhead) {
    this.resize();
    const g = this.g;
    const { w, h } = this;
    if (!w || !h) return;
    const sw = this.stepW;
    const steps = this.steps;
    const rowH = this.rowH;
    const playing = playhead !== null && playhead !== undefined;
    g.clearRect(0, 0, w, h);

    g.save();
    g.beginPath();
    g.rect(KEYS_W, RULER_H, this.gridW, this.gridH);
    g.clip();
    // Rows: black keys darker, the scale's rows lit, a dark line under every C.
    for (let m = NOTE_LOW; m <= NOTE_HIGH; m++) {
      if (!this.visible(m)) continue;
      const y = this.yOf(m);
      const pc = pitchClass(m);
      const black = BLACK.has(pc);
      const lit = this.inKey(m);
      g.fillStyle = black ? (lit ? FL.rowBlack : FL.rowBlackOut) : lit ? FL.rowWhite : FL.rowWhiteOut;
      g.fillRect(KEYS_W, y, this.gridW, rowH);
      g.fillStyle = pc === 0 ? FL.octave : 'rgba(0, 0, 0, 0.12)';
      g.fillRect(KEYS_W, y + rowH - 1, this.gridW, 1);
    }
    // Columns: sixteenths, beats, bars.
    this.columns(g, RULER_H, this.gridH);
    // Past the end of the pattern.
    const end = this.xOf(steps);
    if (end < w) {
      g.fillStyle = FL.beyond;
      g.fillRect(end, RULER_H, w - end, this.gridH);
    }

    // Ghost notes: the pattern's other melodic channels, as faint outlines (drums
    // would only stack up on one row).
    if (this.opts.ghosts() && this.pattern) {
      g.lineWidth = 1;
      for (const [cid, list] of Object.entries(this.pattern.notes)) {
        if (cid === this.channel?.id || this.song.channel(cid)?.kind === 'drum') continue;
        for (const n of list) {
          if (!this.visible(n.midi)) continue;
          const y = this.yOf(n.midi);
          const nw = Math.max(3, n.length * sw - 1);
          g.fillStyle = 'rgba(210, 230, 220, 0.07)';
          g.strokeStyle = 'rgba(210, 230, 220, 0.2)';
          roundRect(g, this.xOf(n.start) + 0.5, y + 1.5, nw, rowH - 3, 2);
          g.fill();
          g.stroke();
        }
      }
    }

    // This channel's notes.
    const label = rowH >= 11;
    g.font = `600 ${Math.min(10, rowH - 4)}px ${MONO}`;
    g.textBaseline = 'middle';
    for (const n of this.notes) {
      if (!this.visible(n.midi)) continue;
      const y = this.yOf(n.midi);
      const x = this.xOf(n.start) + 0.5;
      const nw = Math.max(4, n.length * sw - 1);
      const c = noteColours(n, this.selected.has(n.id));
      g.globalAlpha = n.start >= steps ? 0.3 : 1;
      g.fillStyle = c.fill;
      roundRect(g, x, y + 0.5, nw, rowH - 1, 2);
      g.fill();
      // Bevel: light along the top, shade along the bottom, like FL's.
      g.fillStyle = 'rgba(255, 255, 255, 0.32)';
      g.fillRect(x + 1.5, y + 1.5, nw - 3, Math.max(1, rowH * 0.18));
      g.fillStyle = 'rgba(0, 0, 0, 0.18)';
      g.fillRect(x + 1.5, y + rowH - 3, nw - 3, 1.5);
      g.strokeStyle = c.edge;
      g.lineWidth = 1;
      roundRect(g, x, y + 0.5, nw, rowH - 1, 2);
      g.stroke();
      if (label && nw > 22) {
        g.fillStyle = c.text;
        g.fillText(noteName(n.midi), x + 4, y + rowH / 2 + 0.5, nw - 6);
      }
      g.globalAlpha = 1;
    }

    // Box selection, or the slice being dragged.
    const d = this.drag;
    if (d?.mode === 'box') {
      g.fillStyle = 'rgba(255, 120, 140, 0.1)';
      g.strokeStyle = 'rgba(255, 150, 165, 0.9)';
      g.lineWidth = 1;
      g.setLineDash([4, 3]);
      g.fillRect(Math.min(d.x0, d.x1), Math.min(d.y0, d.y1), Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
      g.strokeRect(Math.min(d.x0, d.x1) + 0.5, Math.min(d.y0, d.y1) + 0.5, Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
      g.setLineDash([]);
    } else if (d?.mode === 'slice') {
      const x = Math.round(this.xOf(d.at)) + 0.5;
      g.strokeStyle = '#ff6b7d';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(x, Math.min(d.y0, d.y1) - 4);
      g.lineTo(x, Math.max(d.y0, d.y1) + 4);
      g.stroke();
    }

    if (playing) {
      const x = this.xOf(playhead);
      g.fillStyle = 'rgba(255, 236, 210, 0.85)';
      g.fillRect(x, RULER_H, 1.5, this.gridH);
    }
    g.restore();

    // Keys light up for what's sounding under the playhead (and what you press).
    const sounding = new Set();
    if (playing) for (const n of this.notes) if (!n.muted && playhead >= n.start && playhead < n.start + n.length) sounding.add(n.midi);
    if (this.keyDown !== null) sounding.add(this.keyDown);
    this.drawKeys(sounding);
    this.drawRuler(playhead);
    this.drawVelocity();
  }

  /** Grid lines for sixteenths, beats and bars between top and top + height. */
  columns(g, top, height) {
    const sw = this.stepW;
    const first = Math.floor(this.view.from);
    for (let s = first; s <= this.view.from + this.shown + 1; s++) {
      const bar = s % STEPS_PER_BAR === 0;
      const beat = s % 4 === 0;
      if (sw < 5 && !beat) continue;
      const x = Math.round(this.xOf(s));
      g.fillStyle = bar ? FL.bar : beat ? FL.beat : FL.step;
      g.fillRect(x - (bar ? 1 : 0), top, bar ? 2 : 1, height);
    }
  }

  /**
   * A keyboard on its side, drawn like a real one: white keys share the rows of
   * the black keys between them, black keys sit on top, shorter.
   */
  drawKeys(sounding) {
    const g = this.g;
    const rowH = this.rowH;
    g.save();
    g.beginPath();
    g.rect(0, RULER_H, KEYS_W, this.gridH);
    g.clip();
    g.fillStyle = '#0c1012';
    g.fillRect(0, RULER_H, KEYS_W, this.gridH);
    const ivory = g.createLinearGradient(0, 0, KEYS_W, 0);
    ivory.addColorStop(0, '#b9bec2');
    ivory.addColorStop(0.08, '#e9ecee');
    ivory.addColorStop(0.85, '#f7f8f9');
    ivory.addColorStop(1, '#cfd4d7');
    const ebony = g.createLinearGradient(0, 0, KEYS_W * 0.6, 0);
    ebony.addColorStop(0, '#060708');
    ebony.addColorStop(0.75, '#25292c');
    ebony.addColorStop(0.92, '#4a5156');
    ebony.addColorStop(1, '#16191b');
    const lit = (m) => (sounding.has(m) ? (this.keyDown === m ? '#ffb15c' : '#8be06f') : null);
    const hovered = (m) => this.hoverKey === m && !sounding.has(m);
    // White keys: a C or F starts at the bottom of its own row; an E or B ends at the
    // top of its row; everything else meets its neighbour halfway across a black key.
    for (let m = NOTE_LOW; m <= NOTE_HIGH; m++) {
      const pc = pitchClass(m);
      if (BLACK.has(pc)) continue;
      const bottom = pc === 0 || pc === 5 ? this.yOf(m) + rowH : this.yOf(m - 1) + rowH / 2;
      const top = pc === 4 || pc === 11 ? this.yOf(m) : this.yOf(m + 1) + rowH / 2;
      if (bottom < RULER_H || top > RULER_H + this.gridH) continue;
      g.fillStyle = lit(m) ?? ivory;
      g.fillRect(0, top, KEYS_W - 1, bottom - top);
      if (hovered(m)) {
        g.fillStyle = 'rgba(120, 200, 255, 0.18)';
        g.fillRect(0, top, KEYS_W - 1, bottom - top);
      }
      g.fillStyle = '#8f979c';
      g.fillRect(0, top, KEYS_W - 1, 1);
      if (pc === 0 && rowH >= 9) {
        g.fillStyle = sounding.has(m) ? '#1d3312' : FL.keyLabel;
        g.font = `600 ${Math.min(10, rowH - 3)}px ${MONO}`;
        g.textBaseline = 'middle';
        g.textAlign = 'right';
        g.fillText(noteName(m), KEYS_W - 6, this.yOf(m) + rowH / 2 + 0.5);
        g.textAlign = 'left';
      }
    }
    for (let m = NOTE_LOW; m <= NOTE_HIGH; m++) {
      if (!BLACK.has(pitchClass(m)) || !this.visible(m)) continue;
      const y = this.yOf(m);
      const bw = KEYS_W * 0.6;
      g.fillStyle = lit(m) ?? ebony;
      roundRect(g, -3, y + 0.5, bw + 3, rowH - 1, 2);
      g.fill();
      if (hovered(m)) {
        g.fillStyle = 'rgba(120, 200, 255, 0.25)';
        g.fill();
      }
      g.fillStyle = 'rgba(255, 255, 255, 0.12)';
      g.fillRect(bw - 4, y + 1.5, 2, rowH - 3);
    }
    // The keys' shadow on the grid.
    const shade = g.createLinearGradient(KEYS_W - 1, 0, KEYS_W + 6, 0);
    shade.addColorStop(0, 'rgba(0, 0, 0, 0.45)');
    shade.addColorStop(1, 'rgba(0, 0, 0, 0)');
    g.restore();
    g.fillStyle = shade;
    g.fillRect(KEYS_W - 1, RULER_H, 7, this.gridH);
  }

  drawRuler(playhead) {
    const g = this.g;
    g.fillStyle = FL.ruler;
    g.fillRect(0, 0, this.w, RULER_H);
    g.fillStyle = 'rgba(0, 0, 0, 0.5)';
    g.fillRect(0, RULER_H - 1, this.w, 1);
    g.save();
    g.beginPath();
    g.rect(KEYS_W, 0, this.gridW, RULER_H);
    g.clip();
    // The pattern's length as a band along the top, like FL's loop marker.
    const end = this.xOf(this.steps);
    g.fillStyle = 'rgba(140, 220, 120, 0.16)';
    g.fillRect(this.xOf(0), 0, end - this.xOf(0), 3);
    if (end < this.w) {
      // Past the pattern's end: still there to see and draw on, but it doesn't play.
      g.fillStyle = 'rgba(0, 0, 0, 0.3)';
      g.fillRect(end, 0, this.w - end, RULER_H);
    }
    g.font = `600 10px ${MONO}`;
    g.textBaseline = 'middle';
    const sw = this.stepW;
    for (let s = Math.floor(this.view.from / 4) * 4; s <= this.view.from + this.shown + 4; s += 4) {
      const x = Math.round(this.xOf(s));
      if (x < KEYS_W - 1 || x > this.w) continue;
      if (s % STEPS_PER_BAR === 0) {
        g.fillStyle = 'rgba(220, 232, 238, 0.55)';
        g.fillRect(x, 6, 1, RULER_H - 6);
        g.fillStyle = FL.rulerText;
        g.fillText(String(s / STEPS_PER_BAR + 1), x + 4, RULER_H / 2 + 1);
      } else if (sw * 4 > 18) {
        g.fillStyle = 'rgba(220, 232, 238, 0.25)';
        g.fillRect(x, RULER_H - 7, 1, 6);
        if (sw * 4 > 40) {
          g.fillStyle = 'rgba(201, 212, 218, 0.45)';
          g.font = `9px ${MONO}`;
          g.fillText(`${Math.floor(s / STEPS_PER_BAR) + 1}.${(s % STEPS_PER_BAR) / 4 + 1}`, x + 3, RULER_H / 2 + 2);
          g.font = `600 10px ${MONO}`;
        }
      }
    }
    if (playhead !== null && playhead !== undefined) {
      const x = this.xOf(playhead);
      g.fillStyle = FL.marker;
      g.beginPath();
      g.moveTo(x - 6, 4);
      g.lineTo(x + 6, 4);
      g.lineTo(x + 6, RULER_H - 9);
      g.lineTo(x, RULER_H - 2);
      g.lineTo(x - 6, RULER_H - 9);
      g.closePath();
      g.fill();
    }
    g.restore();
    // The corner: which channel this is.
    g.fillStyle = '#1b2226';
    g.fillRect(0, 0, KEYS_W, RULER_H);
    g.fillStyle = '#8be06f';
    g.fillRect(6, RULER_H / 2 - 3, 6, 6);
    g.fillStyle = 'rgba(214, 226, 232, 0.8)';
    g.font = `600 10px ${MONO}`;
    g.textBaseline = 'middle';
    g.fillText(this.channel ? this.channel.name.slice(0, 8) : '', 17, RULER_H / 2 + 0.5);
  }

  drawVelocity() {
    const g = this.g;
    const top = this.h - this.velH;
    g.fillStyle = FL.lane;
    g.fillRect(0, top, this.w, this.velH);
    g.fillStyle = 'rgba(0, 0, 0, 0.6)';
    g.fillRect(0, top, this.w, 2);
    g.fillStyle = '#1b2226';
    g.fillRect(0, top + 2, KEYS_W, this.velH - 2);
    g.fillStyle = 'rgba(214, 226, 232, 0.6)';
    g.font = `600 9px ${MONO}`;
    g.textBaseline = 'middle';
    g.fillText('VELOCITY', 8, top + 14);
    g.fillStyle = 'rgba(214, 226, 232, 0.3)';
    g.fillText('drag to set', 8, top + 28);
    g.save();
    g.beginPath();
    g.rect(KEYS_W, top + 2, this.gridW, this.velH - 2);
    g.clip();
    this.columns(g, top + 2, this.velH - 2);
    // Guide lines at 25 / 50 / 75 %.
    g.fillStyle = 'rgba(255, 255, 255, 0.04)';
    for (const f of [0.25, 0.5, 0.75]) g.fillRect(KEYS_W, this.h - 6 - (this.velH - 14) * f, this.gridW, 1);
    // Lollipops: a stem up to the velocity, a head on top.
    for (const n of this.notes) {
      if (n.start >= this.steps) continue;
      const x = Math.round(this.xOf(n.start)) + 2;
      const y = this.h - 6 - (this.velH - 14) * n.velocity;
      const c = noteColours(n, this.selected.has(n.id));
      g.fillStyle = c.fill;
      g.fillRect(x - 0.5, y, 2, this.h - 6 - y);
      g.beginPath();
      g.arc(x + 0.5, y, 3.5, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = c.edge;
      g.lineWidth = 1;
      g.stroke();
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
    c.addEventListener('pointerleave', () => (this.hoverKey = null));
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const { x, y } = this.pointer(e);
      if (e.altKey) {
        this.zoomRows(e.deltaY > 0 ? -2 : 2, y);
      } else if (e.ctrlKey || e.metaKey) {
        this.zoomTime(e.deltaY > 0 ? 0.8 : 1.25, Math.max(KEYS_W, x));
      } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        this.view.from += ((e.deltaX || e.deltaY) / this.stepW) * 0.5;
        this.clampView();
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
    const hit = this.noteAt(step, midi);
    const tool = e.button === 2 ? 'erase' : this.tool;

    if (e.ctrlKey || e.metaKey || (tool === 'select' && !hit)) {
      this.drag = { mode: 'box', x0: x, y0: y, x1: x, y1: y, add: e.shiftKey || e.ctrlKey, before: new Set(this.selected) };
      if (!this.drag.add) this.selected.clear();
      return;
    }
    if (tool === 'erase') {
      this.studio.begin();
      this.drag = { mode: 'erase' };
      this.erase(step, midi);
      return;
    }
    if (tool === 'mute') {
      if (!hit) return;
      this.studio.begin();
      this.drag = { mode: 'mute', to: !hit.muted };
      this.setMuted(hit, this.drag.to);
      return;
    }
    if (tool === 'slice') {
      this.drag = { mode: 'slice', at: Math.min(this.steps, Math.max(0, snapNearest(step, snap))), y0: y, y1: y };
      return;
    }

    if (hit) {
      if (e.shiftKey) {
        if (this.selected.has(hit.id)) this.selected.delete(hit.id);
        else this.selected.add(hit.id);
        return;
      }
      this.grab(hit, x, step, midi);
      return;
    }

    if (tool === 'paint') {
      // Lay a note here, and more as the pointer moves along, one every note-length.
      this.studio.begin();
      const every = Math.max(snap, this.lastLength);
      const start = snapDown(step, snap);
      this.drag = { mode: 'paint', first: start, every, last: start };
      this.place(start, midi);
      return;
    }

    // Draw a note, or the chord that fits the key.
    this.studio.begin();
    const start = snapDown(step, snap);
    const pitches = this.opts.chords() ? this.opts.chordFor(midi) : [midi];
    const made = pitches.map((m) => this.song.addNote(this.pattern.id, c, { start, length: this.lastLength, midi: m }));
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

  /** Pick up a note (and the selection it's in) to move it, or by its end to resize it. */
  grab(hit, x, step, midi) {
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
    if (!nearEnd) this.studio.preview(this.channel.id, hit.midi);
  }

  /** Paint: a note (or chord) at a step, unless one already starts there. */
  place(start, midi) {
    if (start < 0 || start >= this.steps) return;
    const pitches = this.opts.chords() ? this.opts.chordFor(midi) : [midi];
    const made = [];
    for (const m of pitches) {
      if (this.notes.some((n) => n.midi === m && Math.abs(n.start - start) < 1e-6)) continue;
      made.push(this.song.addNote(this.pattern.id, this.channel.id, { start, length: this.lastLength, midi: m }));
    }
    if (made.length) {
      this.studio.preview(this.channel.id, pitches[0]);
      this.studio.change();
    }
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
    } else if (d.mode === 'mute') {
      const hit = this.region(x, y) === 'grid' ? this.noteAt(this.stepAt(x), this.midiAt(y)) : null;
      if (hit) this.setMuted(hit, d.to);
    } else if (d.mode === 'paint') {
      const s = d.first + Math.floor((this.stepAt(x) - d.first) / d.every) * d.every;
      if (s !== d.last) {
        d.last = s;
        this.place(s, this.midiAt(y));
      }
    } else if (d.mode === 'slice') {
      d.y1 = y;
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
    if (d.mode === 'slice') {
      this.slice(d.at, this.midiAt(Math.max(d.y0, d.y1)), this.midiAt(Math.min(d.y0, d.y1)));
      return;
    }
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

  setMuted(note, on) {
    if (!!note.muted === on) return;
    if (on) note.muted = true;
    else delete note.muted;
    this.studio.change();
  }

  /** Cut every note between two pitches that spans `at` into two notes there. */
  slice(at, low, high) {
    const cut = this.notes.filter((n) => n.midi >= low && n.midi <= high && n.start < at - 1e-6 && n.start + n.length > at + 1e-6);
    if (!cut.length) return;
    this.studio.begin();
    for (const n of cut) {
      const end = n.start + n.length;
      n.length = at - n.start;
      this.song.addNote(this.pattern.id, this.channel.id, { start: at, length: end - at, midi: n.midi, velocity: n.velocity, muted: n.muted });
    }
    this.studio.commit();
  }

  /** The note starting nearest the pointer takes the new velocity, with any chord (or selection) it's part of. */
  setVelocity(x, y) {
    const step = this.stepAt(x);
    const v = Math.min(1, Math.max(0.05, (this.h - 6 - y) / (this.velH - 14)));
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
    this.hoverKey = where === 'keys' ? this.midiAt(y) : null;
    let c = 'default';
    if (where === 'grid') {
      const hit = this.noteAt(this.stepAt(x), this.midiAt(y));
      const t = this.tool;
      if (t === 'erase') c = hit ? 'pointer' : 'default';
      else if (t === 'mute') c = hit ? 'pointer' : 'default';
      else if (t === 'slice') c = 'col-resize';
      else if (hit) c = this.xOf(hit.start + hit.length) - x < EDGE_PX ? 'ew-resize' : 'grab';
      else c = t === 'select' ? 'default' : 'crosshair';
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
      notes: list.map(({ start, length, midi, velocity, muted }) => ({ start, length, midi, velocity, muted }))
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
