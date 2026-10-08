/**
 * Playlist: the song. Pattern clips on tracks along a timeline of bars.
 *
 *   click empty        place the current pattern (keep dragging to position it)
 *   drag a clip        move it (bars; hold Alt for beats)
 *   drag a clip's end  make it longer (the pattern repeats) or shorter
 *   right-click        delete (right-drag deletes as it goes)
 *   click a clip       make its pattern the current one; double-click opens it
 *   click the ruler    set where the song plays from
 *   wheel              scroll; Ctrl+wheel zooms
 */

import { STEPS_PER_BAR, hueOf } from '../model.js';

const HEAD_W = 92;
const RULER_H = 22;
const EDGE_PX = 8;

export class Playlist {
  constructor(canvas, studio) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.studio = studio;
    this.barW = 34;
    this.from = 0; // first visible bar
    this.drag = null;
    this.lastClick = { at: 0, clip: null };
    this.wire();
  }

  get song() {
    return this.studio.song;
  }

  get tracks() {
    return this.song.data.playlist.tracks;
  }

  get trackH() {
    return Math.max(16, Math.min(46, (this.h - RULER_H) / this.tracks));
  }

  get stepW() {
    return this.barW / STEPS_PER_BAR;
  }

  xOf(step) {
    return HEAD_W + (step / STEPS_PER_BAR - this.from) * this.barW;
  }

  stepAt(x) {
    return (this.from + (x - HEAD_W) / this.barW) * STEPS_PER_BAR;
  }

  trackAt(y) {
    return Math.floor((y - RULER_H) / this.trackH);
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
    this.from = Math.max(0, this.from);
  }

  patternIndex(id) {
    return this.song.patterns.findIndex((p) => p.id === id);
  }

  draw(playhead) {
    this.resize();
    const g = this.g;
    const { w, h } = this;
    if (!w || !h) return;
    const th = this.trackH;
    const songEnd = this.song.songSteps;
    g.clearRect(0, 0, w, h);

    // Tracks.
    g.save();
    g.beginPath();
    g.rect(HEAD_W, RULER_H, w - HEAD_W, h - RULER_H);
    g.clip();
    for (let t = 0; t < this.tracks; t++) {
      g.fillStyle = t % 2 ? '#08101a' : '#0b1420';
      g.fillRect(HEAD_W, RULER_H + t * th, w - HEAD_W, th);
    }
    // Past the end of the song, slightly darker.
    const endX = this.xOf(songEnd);
    if (endX < w) {
      g.fillStyle = 'rgba(0, 0, 0, 0.28)';
      g.fillRect(Math.max(HEAD_W, endX), RULER_H, w, h);
    }
    const bars = Math.ceil((w - HEAD_W) / this.barW) + 1;
    for (let b = Math.floor(this.from); b < this.from + bars; b++) {
      const x = Math.round(this.xOf(b * STEPS_PER_BAR)) + 0.5;
      g.fillStyle = b % 4 === 0 ? 'rgba(140, 220, 255, 0.2)' : 'rgba(140, 220, 255, 0.08)';
      g.fillRect(x - 0.5, RULER_H, 1, h);
      if (this.barW >= 48) {
        g.fillStyle = 'rgba(140, 220, 255, 0.035)';
        for (let q = 1; q < 4; q++) g.fillRect(Math.round(this.xOf(b * STEPS_PER_BAR + q * 4)), RULER_H, 1, h);
      }
    }

    // Clips.
    for (const clip of this.song.data.playlist.clips) {
      const p = this.song.pattern(clip.pattern);
      if (!p) continue;
      const x = this.xOf(clip.start);
      const cw = clip.length * this.stepW;
      if (x > w || x + cw < HEAD_W) continue;
      const y = RULER_H + clip.track * th;
      const hue = hueOf(this.patternIndex(p.id));
      const current = p.id === this.song.data.current.pattern;
      g.fillStyle = `hsla(${hue}, 70%, ${current ? 34 : 26}%, 0.95)`;
      roundRect(g, x + 1, y + 1.5, cw - 2, th - 3, 4);
      g.fill();
      g.strokeStyle = `hsla(${hue}, 90%, ${current ? 78 : 62}%, 0.9)`;
      g.lineWidth = current ? 1.5 : 1;
      g.stroke();
      this.drawNotes(p, x + 2, y + 13, cw - 4, th - 17, clip.length, hue);
      g.fillStyle = `hsla(${hue}, 100%, 88%, 0.95)`;
      g.font = '10px ui-sans-serif, system-ui, sans-serif';
      g.textBaseline = 'top';
      g.save();
      g.beginPath();
      g.rect(x + 2, y, cw - 4, th);
      g.clip();
      g.fillText(p.name, x + 6, y + 3);
      g.restore();
      // Pattern repeats inside the clip.
      const pl = this.song.steps(p);
      g.fillStyle = 'rgba(0, 0, 0, 0.35)';
      for (let r = pl; r < clip.length; r += pl) g.fillRect(this.xOf(clip.start + r), y + 3, 1, th - 6);
    }
    if (playhead !== null && playhead !== undefined) {
      g.fillStyle = 'rgba(255, 255, 255, 0.9)';
      g.fillRect(this.xOf(playhead), RULER_H, 1.5, h);
    }
    g.restore();

    this.drawRuler(playhead);
    this.drawHeads();
  }

  /** A clip's notes in miniature: the pattern, repeated for the clip's length. */
  drawNotes(p, x, y, w, h, length, hue) {
    if (h < 4) return;
    const all = Object.values(p.notes).flat();
    if (!all.length) return;
    let lo = Infinity, hi = -Infinity;
    for (const n of all) {
      lo = Math.min(lo, n.midi);
      hi = Math.max(hi, n.midi);
    }
    const span = Math.max(1, hi - lo);
    const pl = this.song.steps(p);
    const g = this.g;
    g.fillStyle = `hsla(${hue}, 100%, 82%, 0.75)`;
    for (let r = 0; r < length; r += pl) {
      for (const n of all) {
        const s = r + n.start;
        if (n.start >= pl || s >= length) continue;
        const nx = x + s * this.stepW;
        const ny = y + (hi === lo ? h / 2 : (1 - (n.midi - lo) / span) * (h - 2));
        g.fillRect(nx, ny, Math.max(1, Math.min(n.length, length - s) * this.stepW - 0.5), 1.5);
      }
    }
  }

  drawRuler(playhead) {
    const g = this.g;
    g.fillStyle = '#060b13';
    g.fillRect(0, 0, this.w, RULER_H);
    g.font = '10px ui-monospace, Menlo, Consolas, monospace';
    g.textBaseline = 'middle';
    const bars = Math.ceil((this.w - HEAD_W) / this.barW) + 1;
    const every = this.barW < 22 ? 4 : this.barW < 34 ? 2 : 1;
    for (let b = Math.floor(this.from); b < this.from + bars; b++) {
      if (b % every) continue;
      const x = this.xOf(b * STEPS_PER_BAR);
      if (x < HEAD_W) continue;
      g.fillStyle = 'rgba(190, 236, 255, 0.65)';
      g.fillText(String(b + 1), x + 4, RULER_H / 2);
    }
    // Where the song plays from.
    const px = this.xOf(this.song.data.position);
    if (px >= HEAD_W) {
      g.fillStyle = '#55e0a8';
      g.beginPath();
      g.moveTo(px, RULER_H - 2);
      g.lineTo(px - 6, 3);
      g.lineTo(px + 6, 3);
      g.closePath();
      g.fill();
    }
    if (playhead !== null && playhead !== undefined) {
      g.fillStyle = '#ff5fd2';
      g.fillRect(this.xOf(playhead) - 1, 0, 2, RULER_H);
    }
  }

  drawHeads() {
    const g = this.g;
    const th = this.trackH;
    g.fillStyle = '#050a11';
    g.fillRect(0, 0, HEAD_W, this.h);
    g.font = '10px ui-sans-serif, system-ui, sans-serif';
    g.textBaseline = 'middle';
    for (let t = 0; t < this.tracks; t++) {
      const y = RULER_H + t * th;
      g.fillStyle = 'rgba(255, 255, 255, 0.04)';
      g.fillRect(4, y + 2, HEAD_W - 8, th - 4);
      g.fillStyle = 'rgba(180, 215, 236, 0.6)';
      g.fillText(`Track ${t + 1}`, 12, y + th / 2);
    }
    g.fillStyle = 'rgba(180, 215, 236, 0.45)';
    g.font = '9px ui-monospace, Menlo, Consolas, monospace';
    g.fillText('PLAYLIST', 10, RULER_H / 2);
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
    c.addEventListener('pointerup', () => this.up());
    c.addEventListener('pointercancel', () => this.up());
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const { x } = this.pointer(e);
        const at = this.stepAt(x) / STEPS_PER_BAR;
        this.barW = Math.min(160, Math.max(10, this.barW * (e.deltaY > 0 ? 0.85 : 1.18)));
        this.from = Math.max(0, at - (x - HEAD_W) / this.barW);
      } else {
        this.from = Math.max(0, this.from + (e.deltaX || e.deltaY) / this.barW / 2);
      }
    }, { passive: false });
  }

  down(e) {
    e.preventDefault();
    this.resize();
    const { x, y } = this.pointer(e);
    this.canvas.setPointerCapture(e.pointerId);
    const snap = e.altKey ? 4 : STEPS_PER_BAR;
    if (y < RULER_H && x >= HEAD_W) {
      this.drag = { mode: 'position' };
      this.setPosition(x);
      return;
    }
    if (x < HEAD_W) return;
    const step = this.stepAt(x);
    const track = this.trackAt(y);
    if (track < 0 || track >= this.tracks) return;
    const song = this.song;

    if (e.button === 2) {
      this.studio.begin();
      this.drag = { mode: 'erase' };
      this.erase(track, step);
      return;
    }
    const hit = song.clipAt(track, step);
    if (hit) {
      const now = performance.now();
      if (this.lastClick.clip === hit.id && now - this.lastClick.at < 350) {
        this.lastClick = { at: 0, clip: null };
        this.studio.openPattern(hit.pattern);
        return;
      }
      this.lastClick = { at: now, clip: hit.id };
      this.studio.selectPattern(hit.pattern);
      const nearEnd = this.xOf(hit.start + hit.length) - x < EDGE_PX;
      this.studio.begin();
      this.drag = { mode: nearEnd ? 'resize' : 'move', clip: hit, start: hit.start, track: hit.track, length: hit.length, fromStep: step, fromTrack: track };
      return;
    }
    const p = song.currentPattern;
    if (!p) return;
    this.studio.begin();
    const clip = song.addClip({ track, pattern: p.id, start: Math.floor(step / snap) * snap, length: song.steps(p) });
    this.drag = { mode: 'move', clip, start: clip.start, track: clip.track, length: clip.length, fromStep: step, fromTrack: track };
    this.studio.change();
  }

  move(e) {
    const { x, y } = this.pointer(e);
    const d = this.drag;
    if (!d) {
      this.cursor(x, y);
      return;
    }
    const snap = e.altKey ? 4 : STEPS_PER_BAR;
    if (d.mode === 'position') this.setPosition(x);
    else if (d.mode === 'erase') {
      const t = this.trackAt(y);
      if (t >= 0 && t < this.tracks && x >= HEAD_W) this.erase(t, this.stepAt(x));
    } else if (d.mode === 'move') {
      const ds = Math.round((this.stepAt(x) - d.fromStep) / snap) * snap;
      d.clip.start = Math.max(0, d.start + ds);
      d.clip.track = Math.max(0, Math.min(this.tracks - 1, d.track + this.trackAt(y) - d.fromTrack));
      this.studio.change();
    } else if (d.mode === 'resize') {
      const end = Math.round(this.stepAt(x) / snap) * snap;
      d.clip.length = Math.max(snap, end - d.clip.start);
      this.studio.change();
    }
  }

  up() {
    const d = this.drag;
    this.drag = null;
    if (!d || d.mode === 'position') return;
    this.studio.commit();
  }

  setPosition(x) {
    const bar = Math.max(0, Math.round(this.stepAt(x) / STEPS_PER_BAR));
    this.studio.setPosition(bar * STEPS_PER_BAR);
  }

  erase(track, step) {
    const hit = this.song.clipAt(track, step);
    if (!hit) return;
    this.song.removeClip(hit.id);
    this.studio.change();
  }

  cursor(x, y) {
    let c = 'default';
    if (y < RULER_H && x >= HEAD_W) c = 'pointer';
    else if (x >= HEAD_W) {
      const t = this.trackAt(y);
      const hit = t >= 0 && t < this.tracks ? this.song.clipAt(t, this.stepAt(x)) : null;
      c = hit ? (this.xOf(hit.start + hit.length) - x < EDGE_PX ? 'ew-resize' : 'grab') : 'crosshair';
    }
    this.canvas.style.cursor = c;
  }
}

function roundRect(g, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}
