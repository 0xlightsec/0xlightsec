/**
 * An automation lane: one effect's knob drawn over the whole song.
 *
 *   ┌ Intro ─────┬ Hook ───────────────────┬ Verse ───── …   section names, bars
 *   │      ●╮              ╭─◦─╮                            the curve, its points (●)
 *   │       ╰──◦──╮   ╭──╯     ╰──◦──●                      and a bend handle (◦) mid-way
 *   │             ╰─●─╯                                     along every segment
 *
 *   drag the line         puts a point there and moves it: the curve flows
 *                         through it smoothly, like an EQ band
 *   drag a point          moves it in time and value
 *   drag a ◦ handle       bends that segment into a parabola: sharp, spiky
 *                         peaks one way, fat round ones the other
 *   right-click a segment pick its shape: smooth, bend, hold, stairs, pulse, wave
 *   right-click / double-click a point   deletes it
 *
 * Steps snap to sixteenths (Shift: free). The lane reads and writes the curve
 * through `hooks`, so undo, saving and the sound all follow.
 */

import { autoValue, autoPower, AUTO_SHAPES, STEPS_PER_BAR } from '../model.js';

const PAD = 8;       // left and right margin, px
const RULER = 16;    // the bar ruler along the top
const HIT = 8;       // how close a point or handle must be to catch it
const SHAPE_LABELS = { smooth: 'Smooth', bend: 'Bend (parabola)', hold: 'Hold', stairs: 'Stairs', pulse: 'Pulse', wave: 'Wave' };

export class AutomationLane {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} hooks { points(), steps(), sections(), hue, format(v), playhead(), begin(), change(), commit() }
   */
  constructor(canvas, hooks) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.hooks = hooks;
    this.drag = null;
    this.hover = null;
    this.menu = null;
    this.wire();
  }

  get points() {
    return this.hooks.points();
  }

  /** The timeline: the song, or further if a point sits past its end. */
  get span() {
    const pts = this.points;
    return Math.max(this.hooks.steps(), pts.length ? pts[pts.length - 1].t : 0, STEPS_PER_BAR);
  }

  xOf(t) {
    return PAD + (t / this.span) * (this.w - 2 * PAD);
  }

  tAt(x) {
    return ((x - PAD) / (this.w - 2 * PAD)) * this.span;
  }

  yOf(v) {
    return RULER + 4 + (1 - v) * (this.h - RULER - 10);
  }

  vAt(y) {
    return 1 - (y - RULER - 4) / (this.h - RULER - 10);
  }

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

  /** Where each segment's bend handle sits: on the curve, half-way across. */
  handle(i) {
    const a = this.points[i], b = this.points[i + 1];
    const t = (a.t + b.t) / 2;
    return { x: this.xOf(t), y: this.yOf(autoValue(this.points, t)), t };
  }

  draw() {
    this.resize();
    const { g, w, h } = this;
    if (!w || !h) return;
    const hue = this.hooks.hue ?? 190;
    const pts = this.points;
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#060b12';
    g.fillRect(0, 0, w, h);
    // Bars, with every fourth labelled, and the song's sections.
    const bars = this.span / STEPS_PER_BAR;
    const every = bars > 48 ? 8 : bars > 16 ? 4 : 1;
    g.font = '9px ui-monospace, Consolas, monospace';
    g.textBaseline = 'middle';
    const sections = this.hooks.sections?.() ?? [];
    const labelled = sections.map((s) => [this.xOf(s.start), this.xOf(s.start) + g.measureText(s.label).width + 10]);
    for (let b = 0; b <= bars; b++) {
      const x = Math.round(this.xOf(b * STEPS_PER_BAR)) + 0.5;
      g.fillStyle = b % every === 0 ? 'rgba(140, 220, 255, 0.16)' : 'rgba(140, 220, 255, 0.05)';
      g.fillRect(x, RULER, 1, h - RULER);
      // Bar numbers, where a section's name isn't already.
      if (b % every === 0 && b < bars && !labelled.some(([a, z]) => x + 14 > a && x < z)) {
        g.fillStyle = 'rgba(180, 215, 236, 0.45)';
        g.fillText(String(b + 1), x + 3, RULER / 2);
      }
    }
    for (const s of sections) {
      const x = this.xOf(s.start);
      g.fillStyle = 'rgba(255, 159, 46, 0.55)';
      g.fillRect(x, 0, 1.5, RULER);
      g.fillStyle = 'rgba(255, 200, 140, 0.8)';
      g.fillText(s.label, x + 4, RULER / 2);
    }
    g.fillStyle = 'rgba(0, 0, 0, 0.35)';
    g.fillRect(0, RULER - 1, w, 1);
    // Past the end of the song.
    const end = this.xOf(this.hooks.steps());
    if (end < w - PAD) {
      g.fillStyle = 'rgba(0, 0, 0, 0.4)';
      g.fillRect(end, RULER, w - end, h - RULER);
    }
    if (!pts.length) return;
    // The curve, sampled a pixel at a time, filled underneath like an FL automation clip.
    const path = new Path2D();
    for (let x = PAD; x <= w - PAD; x++) {
      const y = this.yOf(autoValue(pts, this.tAt(x)));
      if (x === PAD) path.moveTo(x, y);
      else path.lineTo(x, y);
    }
    const fill = new Path2D(path);
    fill.lineTo(w - PAD, h);
    fill.lineTo(PAD, h);
    fill.closePath();
    const grad = g.createLinearGradient(0, RULER, 0, h);
    grad.addColorStop(0, `hsla(${hue}, 90%, 60%, 0.32)`);
    grad.addColorStop(1, `hsla(${hue}, 90%, 60%, 0.02)`);
    g.fillStyle = grad;
    g.fill(fill);
    g.strokeStyle = `hsl(${hue}, 95%, 66%)`;
    g.lineWidth = 2;
    g.shadowColor = `hsla(${hue}, 95%, 60%, 0.7)`;
    g.shadowBlur = 6;
    g.stroke(path);
    g.shadowBlur = 0;
    // Bend handles: hollow, mid-way along each segment.
    for (let i = 0; i < pts.length - 1; i++) {
      const hd = this.handle(i);
      const hot = this.hover?.kind === 'handle' && this.hover.i === i;
      g.beginPath();
      g.arc(hd.x, hd.y, hot ? 5 : 3.5, 0, Math.PI * 2);
      g.fillStyle = '#060b12';
      g.fill();
      g.strokeStyle = pts[i].s && pts[i].s !== 'smooth' ? '#ffb15c' : `hsla(${hue}, 90%, 75%, 0.9)`;
      g.lineWidth = 1.5;
      g.stroke();
    }
    // Points.
    pts.forEach((p, i) => {
      const hot = (this.hover?.kind === 'point' && this.hover.i === i) || (this.drag?.kind === 'point' && this.drag.i === i);
      g.beginPath();
      g.arc(this.xOf(p.t), this.yOf(p.v), hot ? 6 : 4.5, 0, Math.PI * 2);
      g.fillStyle = hot ? '#ffffff' : `hsl(${hue}, 95%, 72%)`;
      g.fill();
      g.strokeStyle = '#03070c';
      g.lineWidth = 1.5;
      g.stroke();
    });
    // The value being dragged, or under the pointer.
    const show = this.drag?.kind === 'point' ? pts[this.drag.i] : this.hover?.kind === 'point' ? pts[this.hover.i] : null;
    if (show) {
      const text = `${this.hooks.format(show.v)} · bar ${(show.t / STEPS_PER_BAR + 1).toFixed(2)}`;
      const x = Math.min(w - PAD - g.measureText(text).width - 8, this.xOf(show.t) + 8);
      g.fillStyle = 'rgba(3, 7, 12, 0.85)';
      g.fillRect(x - 3, RULER + 2, g.measureText(text).width + 6, 14);
      g.fillStyle = '#e6f8ff';
      g.fillText(text, x, RULER + 9);
    } else if (this.drag?.kind === 'handle') {
      const a = pts[this.drag.i];
      const text = `${SHAPE_LABELS[a.s ?? 'smooth']} · ${a.s === 'bend' ? `x^${autoPower(a.c).toFixed(2)}` : `tension ${(a.c ?? 0).toFixed(2)}`}`;
      g.fillStyle = '#ffcf96';
      g.fillText(text, PAD + 4, RULER + 9);
    }
    // The playhead.
    const ph = this.hooks.playhead();
    if (ph !== null && ph !== undefined) {
      const x = this.xOf(ph);
      g.fillStyle = 'rgba(255, 236, 210, 0.9)';
      g.fillRect(x, RULER, 1.5, h - RULER);
      g.beginPath();
      g.arc(x + 0.75, this.yOf(autoValue(pts, ph)), 3, 0, Math.PI * 2);
      g.fill();
    }
  }

  /* -------------------------------- interaction -------------------------------- */

  pointer(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  /** What's under the pointer: a point, a bend handle, or a segment of the line. */
  hit(x, y) {
    const pts = this.points;
    for (let i = 0; i < pts.length; i++) {
      if (Math.hypot(this.xOf(pts[i].t) - x, this.yOf(pts[i].v) - y) <= HIT) return { kind: 'point', i };
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const hd = this.handle(i);
      if (Math.hypot(hd.x - x, hd.y - y) <= HIT) return { kind: 'handle', i };
    }
    const t = this.tAt(x);
    let i = 0;
    while (i < pts.length - 2 && t >= pts[i + 1].t) i++;
    return { kind: 'line', i, t };
  }

  snap(t, e) {
    const s = e.shiftKey ? t : Math.round(t);
    return Math.max(0, Math.min(this.span, s));
  }

  wire() {
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => this.down(e));
    c.addEventListener('pointermove', (e) => this.move(e));
    c.addEventListener('pointerup', () => this.up());
    c.addEventListener('pointercancel', () => this.up());
    c.addEventListener('pointerleave', () => {
      this.hover = null;
      this.draw();
    });
    c.addEventListener('dblclick', (e) => {
      const { x, y } = this.pointer(e);
      const h = this.hit(x, y);
      if (h.kind === 'point') this.removePoint(h.i);
      else if (h.kind === 'handle') this.edit(() => {
        const a = this.points[h.i];
        delete a.c;
        delete a.s;
      });
    });
  }

  edit(fn) {
    this.hooks.begin();
    fn();
    this.hooks.change();
    this.hooks.commit();
    this.draw();
  }

  removePoint(i) {
    if (this.points.length <= 1) return;
    this.edit(() => this.points.splice(i, 1));
  }

  down(e) {
    e.preventDefault();
    e.stopPropagation();
    this.closeMenu();
    this.resize();
    const { x, y } = this.pointer(e);
    const h = this.hit(x, y);
    if (e.button === 2) {
      if (h.kind === 'point') this.removePoint(h.i);
      else this.shapeMenu(h.i, e.clientX, e.clientY);
      return;
    }
    this.canvas.setPointerCapture(e.pointerId);
    this.hooks.begin();
    const pts = this.points;
    if (h.kind === 'handle') {
      // Bending a smooth segment turns it into a parabola-like bend.
      const a = pts[h.i];
      if (!a.s || a.s === 'smooth') a.s = 'bend';
      this.drag = { kind: 'handle', i: h.i, y, c: a.c ?? 0, up: pts[h.i + 1].v >= a.v };
    } else if (h.kind === 'point') {
      this.drag = { kind: 'point', i: h.i };
    } else {
      // Grab the line: a new point here, moving with the pointer.
      const t = this.snap(this.tAt(x), e);
      const at = pts.findIndex((p) => p.t > t);
      const i = at < 0 ? pts.length : at;
      const before = pts[i - 1];
      pts.splice(i, 0, { t, v: Math.min(1, Math.max(0, this.vAt(y))), ...(before?.s ? { s: before.s, c: before.c } : {}) });
      this.drag = { kind: 'point', i };
      this.hooks.change();
    }
    this.draw();
  }

  move(e) {
    const { x, y } = this.pointer(e);
    const d = this.drag;
    if (!d) {
      const h = this.hit(x, y);
      const was = this.hover;
      this.hover = h.kind === 'line' ? null : h;
      this.canvas.style.cursor = h.kind === 'point' ? 'grab' : h.kind === 'handle' ? 'ns-resize' : 'crosshair';
      if (was?.kind !== this.hover?.kind || was?.i !== this.hover?.i) this.draw();
      return;
    }
    const pts = this.points;
    if (d.kind === 'point') {
      const p = pts[d.i];
      const lo = d.i > 0 ? pts[d.i - 1].t : 0;
      const hi = d.i < pts.length - 1 ? pts[d.i + 1].t : this.span;
      p.t = Math.min(hi, Math.max(lo, this.snap(this.tAt(x), e)));
      p.v = Math.min(1, Math.max(0, this.vAt(y)));
    } else if (d.kind === 'handle') {
      // Up bulges a rising segment, down sags it (and the other way for a falling one).
      const a = pts[d.i];
      const dy = (d.y - y) / 60;
      a.c = Math.min(1, Math.max(-1, d.c + (d.up ? dy : -dy)));
      if (Math.abs(a.c) < 0.02) delete a.c;
    }
    this.hooks.change();
    this.draw();
  }

  up() {
    if (!this.drag) return;
    this.drag = null;
    this.hooks.commit();
    this.draw();
  }

  /** A small menu of segment shapes, next to the pointer. */
  shapeMenu(i, cx, cy) {
    const pts = this.points;
    if (i >= pts.length - 1) return;
    const menu = document.createElement('div');
    menu.className = 'menu auto-menu';
    menu.style.left = `${cx}px`;
    menu.style.top = `${cy}px`;
    for (const s of AUTO_SHAPES) {
      const b = document.createElement('button');
      b.textContent = SHAPE_LABELS[s];
      b.classList.toggle('is-on', (pts[i].s ?? 'smooth') === s);
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeMenu();
        this.edit(() => {
          const a = this.points[i];
          if (s === 'smooth') delete a.s;
          else a.s = s;
          if (s === 'bend' && !a.c) a.c = 1 / 3;
          if ((s === 'pulse' || s === 'wave' || s === 'stairs') && a.c === undefined) a.c = -0.6;
        });
      });
      menu.appendChild(b);
    }
    document.body.appendChild(menu);
    this.menu = menu;
    const close = (e) => {
      if (menu.contains(e.target)) return;
      this.closeMenu();
    };
    this.closeOnDown = close;
    setTimeout(() => document.addEventListener('pointerdown', close, true), 0);
  }

  closeMenu() {
    if (!this.menu) return;
    this.menu.remove();
    this.menu = null;
    document.removeEventListener('pointerdown', this.closeOnDown, true);
  }
}
