/**
 * The keyboard at the bottom of the Studio: a real-looking piano you play with
 * the mouse (slide across it for a glissando), the computer keyboard or MIDI.
 *
 *   ┌ whole piano ───────────[▒▒▒▒▒▒]──────────────┐  the slider: all 88 keys, with a
 *   │                                                │  window you drag to choose which
 *   │   the keys in the window, as big as they fit   │  part of the piano is below
 *
 * The window follows the computer keyboard's octave (Z / X move it), so the keys
 * you see always include the ones A … ' play; those show their letter. Every C
 * is labelled. The keyboard can be dragged taller or shorter by its top edge and
 * folded away to its title strip.
 */

import { WHITE_KEYS, BLACK_KEYS } from '../../io/keyboard.js';
import { pitchClass, noteName } from '../../theory/circle.js';

export const PIANO_LOW = 21;   // A0
export const PIANO_HIGH = 108; // C8
export const HEIGHT_MIN = 56;
export const HEIGHT_MAX = 300;
export const HEIGHT_DEFAULT = 116;
const KEY_MIN_PX = 30;          // narrowest a white key gets before we show fewer octaves
const BLACK = new Set([1, 3, 6, 8, 10]);
const COMPUTER = [...WHITE_KEYS, ...BLACK_KEYS];

/**
 * Which keys to show: `span` octaves from a C, placed so the computer keyboard's
 * keys (C of `octave` and the 17 notes above it) are in view, one octave in from
 * the left when there's room for four or more.
 */
export function keyRange(octave, span) {
  const lead = span >= 4 ? 1 : 0;
  const start = Math.min(Math.max(12, (octave + 1 - lead) * 12), PIANO_HIGH - span * 12);
  return { start, end: start + span * 12 };
}

/** How many octaves fit across `width` pixels, between 2 and 5. */
export function octavesFor(width) {
  const whites = Math.floor(width / KEY_MIN_PX);
  return Math.max(2, Math.min(5, Math.floor((whites - 1) / 7)));
}

/** The octave that centres the window on a note. */
export function octaveCentredOn(midi, span) {
  const lead = span >= 4 ? 1 : 0;
  return Math.max(0, Math.min(8, Math.round((midi - span * 6) / 12) + lead - 1));
}

export class PianoKeys {
  /**
   * @param {object} els   { row, bed, overview, canvas, grip }
   * @param {object} hooks { octave(), setOctave(n), play(midi), stop(midi), label(midi): string|null,
   *                         height, onHeight(px), onLayout({ start, end }) }
   */
  constructor(els, hooks) {
    Object.assign(this, els);
    this.hooks = hooks;
    this.held = new Set();
    this.range = null;
    this.span = 3;
    this.mouse = null; // the note the pointer is holding
    this.setHeight(hooks.height ?? HEIGHT_DEFAULT);
    this.wire();
    new ResizeObserver(() => this.layout()).observe(this.bed);
  }

  /* ---------------------------------- layout --------------------------------- */

  setHeight(px) {
    this.height = Math.round(Math.min(HEIGHT_MAX, Math.max(HEIGHT_MIN, px)));
    this.row.style.setProperty('--kb-h', `${this.height}px`);
  }

  /** Build the keys for the current octave and width (only when they change). */
  layout(force = false) {
    const width = this.bed.clientWidth;
    if (!width) return;
    this.span = octavesFor(width);
    const range = keyRange(this.hooks.octave(), this.span);
    if (!force && this.range && range.start === this.range.start && range.end === this.range.end) {
      this.drawOverview();
      return;
    }
    this.range = range;
    this.build();
    this.hooks.onLayout?.(range);
    this.drawOverview();
  }

  build() {
    const { start, end } = this.range;
    const bed = this.bed;
    bed.innerHTML = '';
    let whites = 0;
    const blacks = [];
    for (let m = start; m <= end; m++) {
      const b = document.createElement('button');
      b.tabIndex = -1;
      b.dataset.midi = String(m);
      b.innerHTML = '<span class="key-cap"></span><span class="key-note"></span>';
      if (BLACK.has(pitchClass(m))) {
        b.className = 'key black';
        b.style.setProperty('--after', String(whites - 1));
        blacks.push(b);
      } else {
        b.className = 'key white';
        if (pitchClass(m) === 0) b.classList.add('is-c');
        whites++;
        bed.appendChild(b);
      }
    }
    blacks.forEach((b) => bed.appendChild(b));
    bed.style.setProperty('--whites', String(whites));
    this.refresh();
  }

  /** Letters on the computer keyboard's keys, note or chord names, every C named. */
  refresh() {
    const octaveC = (this.hooks.octave() + 1) * 12;
    for (const b of this.bed.children) {
      const m = Number(b.dataset.midi);
      const key = COMPUTER.find((k) => octaveC + k.semitone === m);
      b.querySelector('.key-cap').textContent = key ? key.label : '';
      b.classList.toggle('is-mapped', !!key);
      const label = this.hooks.label?.(m, !!key);
      b.querySelector('.key-note').textContent = label ?? (pitchClass(m) === 0 ? noteName(m) : '');
      b.classList.toggle('is-down', this.held.has(m));
    }
  }

  /** Light the keys being played (by any hand: mouse, computer keys, MIDI). */
  setHeld(midis) {
    this.held = new Set(midis);
    for (const b of this.bed.children) b.classList.toggle('is-down', this.held.has(Number(b.dataset.midi)));
    this.drawOverview();
  }

  /* ------------------------------ the whole piano ------------------------------ */

  /** x of a note's left edge on the overview, as a fraction of its width (white-key units). */
  static whiteIndex(midi) {
    // White keys from A0: count whites below this note.
    let n = 0;
    for (let m = PIANO_LOW; m < midi; m++) if (!BLACK.has(pitchClass(m))) n++;
    return n;
  }

  drawOverview() {
    const c = this.canvas;
    const r = this.overview.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (c.width !== Math.round(r.width * dpr) || c.height !== Math.round(r.height * dpr)) {
      c.width = Math.round(r.width * dpr);
      c.height = Math.round(r.height * dpr);
    }
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = r.width, H = r.height;
    const total = PianoKeys.whiteIndex(PIANO_HIGH) + 1; // 52 white keys
    const kw = W / total;
    const xOf = (m) => PianoKeys.whiteIndex(m) * kw;
    g.clearRect(0, 0, W, H);
    // White keys, then black ones.
    for (let m = PIANO_LOW; m <= PIANO_HIGH; m++) {
      if (BLACK.has(pitchClass(m))) continue;
      const x = xOf(m);
      g.fillStyle = this.held.has(m) ? '#ffb15c' : '#d9dcde';
      g.fillRect(x + 0.5, 0, kw - 1, H);
      if (pitchClass(m) === 0 && kw * 7 > 26) {
        g.fillStyle = '#7d878d';
        g.font = `600 ${Math.min(8, H - 6)}px ui-monospace, Consolas, monospace`;
        g.textBaseline = 'bottom';
        g.fillText(String(Math.floor(m / 12) - 1), x + 1.5, H - 1);
      }
    }
    for (let m = PIANO_LOW; m <= PIANO_HIGH; m++) {
      if (!BLACK.has(pitchClass(m))) continue;
      const x = xOf(m) - kw * 0.32;
      g.fillStyle = this.held.has(m) ? '#ff9f2e' : '#1a1d20';
      g.fillRect(x, 0, kw * 0.64, H * 0.6);
    }
    if (!this.range) return;
    // The window: what's on the big keys below; inside it, what the computer keys play.
    const x0 = xOf(this.range.start), x1 = xOf(this.range.end) + kw;
    g.fillStyle = 'rgba(0, 0, 0, 0.45)';
    g.fillRect(0, 0, x0, H);
    g.fillRect(x1, 0, W - x1, H);
    const octaveC = (this.hooks.octave() + 1) * 12;
    g.fillStyle = 'rgba(63, 230, 255, 0.28)';
    g.fillRect(xOf(octaveC), H - 3, xOf(octaveC + 17) + kw - xOf(octaveC), 3);
    g.strokeStyle = '#3fe6ff';
    g.lineWidth = 2;
    g.shadowColor = 'rgba(63, 230, 255, 0.8)';
    g.shadowBlur = 6;
    g.strokeRect(x0 + 1, 1, x1 - x0 - 2, H - 2);
    g.shadowBlur = 0;
  }

  /* -------------------------------- interaction -------------------------------- */

  keyAt(x, y) {
    const el = document.elementFromPoint(x, y)?.closest?.('.key');
    return el && this.bed.contains(el) ? Number(el.dataset.midi) : null;
  }

  press(midi) {
    if (midi === this.mouse) return;
    if (this.mouse !== null) this.hooks.stop(this.mouse);
    this.mouse = midi;
    if (midi !== null) this.hooks.play(midi);
  }

  wire() {
    // Play with the mouse; slide across the keys for a glissando.
    const bed = this.bed;
    bed.addEventListener('pointerdown', (e) => {
      const m = this.keyAt(e.clientX, e.clientY);
      if (m === null) return;
      e.preventDefault();
      bed.setPointerCapture(e.pointerId);
      this.press(m);
    });
    bed.addEventListener('pointermove', (e) => {
      if (this.mouse === null || !e.buttons) return;
      const m = this.keyAt(e.clientX, e.clientY);
      if (m !== null) this.press(m);
    });
    const release = () => this.press(null);
    bed.addEventListener('pointerup', release);
    bed.addEventListener('pointercancel', release);
    bed.addEventListener('lostpointercapture', release);

    // The whole-piano slider: press or drag anywhere on it to move the window there.
    const ov = this.overview;
    const slide = (e) => {
      const r = ov.getBoundingClientRect();
      const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      const whites = Math.round(frac * (PianoKeys.whiteIndex(PIANO_HIGH) + 1));
      let midi = PIANO_LOW;
      for (let n = 0; midi < PIANO_HIGH && n < whites; midi++) if (!BLACK.has(pitchClass(midi))) n++;
      this.hooks.setOctave(octaveCentredOn(midi, this.span));
    };
    ov.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      ov.setPointerCapture(e.pointerId);
      ov.classList.add('is-dragging');
      slide(e);
    });
    ov.addEventListener('pointermove', (e) => {
      if (ov.hasPointerCapture(e.pointerId)) slide(e);
    });
    const end = () => ov.classList.remove('is-dragging');
    ov.addEventListener('pointerup', end);
    ov.addEventListener('lostpointercapture', end);
    ov.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.hooks.setOctave(this.hooks.octave() + (e.deltaY > 0 || e.deltaX > 0 ? 1 : -1));
    }, { passive: false });

    // Resize by the top edge.
    const grip = this.grip;
    let drag = null;
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      grip.setPointerCapture(e.pointerId);
      drag = { y: e.clientY, h: this.height };
      this.row.classList.add('is-resizing');
    });
    grip.addEventListener('pointermove', (e) => {
      if (!drag) return;
      this.setHeight(drag.h + (drag.y - e.clientY));
    });
    const done = () => {
      if (!drag) return;
      drag = null;
      this.row.classList.remove('is-resizing');
      this.hooks.onHeight?.(this.height);
    };
    grip.addEventListener('pointerup', done);
    grip.addEventListener('lostpointercapture', done);
    grip.addEventListener('dblclick', () => {
      this.setHeight(HEIGHT_DEFAULT);
      this.hooks.onHeight?.(this.height);
    });
  }
}
