/**
 * Mixer: the master and the inserts, side by side, FL style. Each strip has a
 * fader, pan, mute and solo, a meter, and lists the channels playing into it.
 * Click a strip to edit its effects on the right: Drive, Crush, Filter, Echo,
 * Space, Tape, Clip and Gate, or start from one of the presets.
 */

import { Knob } from '../../studio/knob.js';
import { crushBits, filterSetting, levelGain, clipGain, FX_DEFAULTS } from '../../studio/fx.js';
import { INSERTS } from '../model.js';

const FX = [
  ['drive', 'Drive', 340, (v) => (v < 0.005 ? 'off' : `${Math.round(v * 100)}%`)],
  ['crush', 'Crush', 285, (v) => (v < 0.005 ? 'off' : `${crushBits(v)} bit`)],
  ['filter', 'Filter', 196, formatFilter, 0.5, true],
  ['echo', 'Echo', 160, (v) => (v < 0.005 ? 'off' : `${Math.round(v * 100)}%`)],
  ['space', 'Space', 255, (v) => (v < 0.005 ? 'off' : `${Math.round(v * 100)}%`)],
  ['tape', 'Tape', 28, (v) => (v < 0.005 ? 'off' : `${Math.round(v * 100)}%`)],
  ['clip', 'Clip', 8, (v) => (v < 0.005 ? 'off' : `+${(20 * Math.log10(clipGain(v))).toFixed(1)} dB`)],
  ['gate', 'Gate', 120, (v) => (v < 0.005 ? 'off' : `1/16 · ${Math.round(v * 100)}%`)]
];

/** One-click starting points: a whole effects setting each. */
export const FX_PRESETS = [
  { id: 'clean', label: 'Clean', title: 'Every effect off', fx: {} },
  { id: 'loud808', label: 'Loud 808', title: 'Drive and a hard clip: the Spinz-style 808 that cuts through', fx: { drive: 0.15, clip: 0.4 } },
  { id: 'chop', label: 'Chop', title: 'A 1/16 gate chopping the sound, ShaperBox style', fx: { gate: 0.85, space: 0.15 } },
  { id: 'dusty', label: 'Dusty', title: 'Bit-crushed, worn tape, dark', fx: { crush: 0.3, tape: 0.45, filter: 0.38 } },
  { id: 'wide', label: 'Big room', title: 'Echo and a lot of hall', fx: { echo: 0.35, space: 0.6 } },
  { id: 'phone', label: 'Phone', title: 'Thin and crunchy, for a breakdown', fx: { filter: 0.78, drive: 0.4, crush: 0.15 } }
];

const PRESET_BASE = (() => {
  const { level, mute, ...sound } = FX_DEFAULTS;
  return { ...sound, space: 0 };
})();

function formatFilter(v) {
  if (Math.abs(v - 0.5) < 0.04) return 'off';
  const { lp, hp } = filterSetting(v);
  const hz = (f) => (f >= 1000 ? `${(f / 1000).toFixed(1)}k` : `${Math.round(f)}`);
  return v < 0.5 ? `low ${hz(lp)}` : `high ${hz(hp)}`;
}

export const dbOf = (fader) => {
  const g = levelGain(fader);
  return g < 0.001 ? '−∞' : `${20 * Math.log10(g) >= 0 ? '+' : '−'}${Math.abs(20 * Math.log10(g)).toFixed(1)}`;
};

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

export class MixerView {
  constructor(root, studio) {
    this.root = root;
    this.studio = studio;
    this.strips = root.querySelector('.mx-strips');
    this.fxBox = root.querySelector('.mx-fx');
    this.selected = 1;
    this.levels = new Float32Array(INSERTS + 1);
    this.holds = new Float32Array(INSERTS + 1);
    this.meters = [];
  }

  get song() {
    return this.studio.song;
  }

  select(i) {
    this.selected = Math.max(0, Math.min(INSERTS, i));
    this.render();
  }

  render() {
    const song = this.song;
    const mixer = song.data.mixer;
    this.strips.innerHTML = '';
    this.meters = [];
    mixer.forEach((t, i) => {
      const s = el('div', `mx-strip${i === 0 ? ' is-master' : ''}${i === this.selected ? ' is-selected' : ''}${t.mute ? ' is-muted' : ''}`);
      s.addEventListener('pointerdown', () => {
        if (this.selected !== i) this.select(i);
      });
      const name = el('div', 'mx-name', t.name);
      name.title = 'Double-click to rename';
      name.addEventListener('dblclick', () => this.rename(i, name));
      const pan = el('div', 'mx-pan');
      new Knob(pan, {
        label: `${t.name} pan`, value: (t.pan + 1) / 2, def: 0.5, bipolar: true, tiny: true, hue: 200,
        format: (v) => (Math.abs(v - 0.5) < 0.01 ? 'centre' : v < 0.5 ? `${Math.round((0.5 - v) * 200)}% L` : `${Math.round((v - 0.5) * 200)}% R`),
        onChange: (v) => this.studio.tweak(() => (t.pan = Math.round((v * 2 - 1) * 100) / 100))
      });
      const body = el('div', 'mx-body');
      const meter = el('canvas', 'mx-meter');
      const fader = el('input', 'mx-fader');
      Object.assign(fader, { type: 'range', min: '0', max: '1000', value: String(Math.round(t.volume * 1000)) });
      fader.setAttribute('aria-label', `${t.name} volume`);
      const db = el('div', 'mx-db', `${dbOf(t.volume)} dB`);
      fader.addEventListener('input', () => {
        const v = Number(fader.value) / 1000;
        db.textContent = `${dbOf(v)} dB`;
        this.studio.tweak(() => (t.volume = v));
      });
      fader.addEventListener('dblclick', () => {
        fader.value = '800';
        db.textContent = `${dbOf(0.8)} dB`;
        this.studio.edit(() => (t.volume = 0.8));
      });
      body.append(meter, fader);
      const btns = el('div', 'mx-btns');
      const mute = el('button', `mx-mute${t.mute ? ' is-on' : ''}`, 'M');
      mute.title = 'Mute';
      mute.addEventListener('click', () => this.studio.edit(() => (t.mute = !t.mute)));
      btns.appendChild(mute);
      if (i > 0) {
        const solo = el('button', `mx-solo${t.solo ? ' is-on' : ''}`, 'S');
        solo.title = 'Solo';
        solo.addEventListener('click', () => this.studio.edit(() => (t.solo = !t.solo)));
        btns.appendChild(solo);
      }
      const routed = song.channels.filter((c) => c.insert === i).map((c) => c.name);
      const from = el('div', 'mx-routed', i === 0 ? 'all inserts' : routed.join(' · ') || '—');
      from.title = from.textContent;
      const num = el('div', 'mx-num', i === 0 ? 'M' : String(i));
      s.append(num, name, pan, body, db, btns, from);
      this.strips.appendChild(s);
      this.meters.push(meter);
    });
    this.renderFx();
  }

  rename(i, node) {
    const input = el('input', 'mx-rename');
    input.value = this.song.data.mixer[i].name;
    input.maxLength = 24;
    node.replaceWith(input);
    input.focus();
    input.select();
    const done = () => {
      const v = input.value.trim();
      if (v && v !== this.song.data.mixer[i].name) this.studio.edit(() => (this.song.data.mixer[i].name = v));
      else this.render();
    };
    input.addEventListener('blur', done, { once: true });
    input.addEventListener('keydown', (e) => e.key === 'Enter' && input.blur());
  }

  renderFx() {
    const box = this.fxBox;
    const t = this.song.data.mixer[this.selected];
    box.innerHTML = '';
    const head = el('div', 'mx-fx-head');
    head.append(el('span', 'panel-title', 'Effects'), el('span', 'mx-fx-who', `${this.selected === 0 ? 'Master' : `Insert ${this.selected}`} · ${t.name}`));
    box.appendChild(head);
    const knobs = el('div', 'knobs');
    for (const [k, label, hue, format, def = 0, bipolar = false] of FX) {
      const d = el('div');
      knobs.appendChild(d);
      new Knob(d, { label, value: t.fx[k], def, bipolar, hue, format, onChange: (v) => this.studio.tweak(() => (t.fx[k] = v)) });
    }
    box.appendChild(knobs);
    const presets = el('div', 'mx-presets');
    for (const p of FX_PRESETS) {
      const b = el('button', 'pill', p.label);
      b.title = p.title;
      b.addEventListener('click', () => this.studio.edit(() => Object.assign(t.fx, PRESET_BASE, p.fx)));
      presets.appendChild(b);
    }
    box.appendChild(presets);
    box.appendChild(el('p', 'mx-fx-note', 'Double-click a knob to reset it. Space is a shared hall: every strip sends to it. Gate chops in time with the song while it plays.'));
  }

  /** Meters, every frame: fast up, slower down, with a peak hold. */
  drawMeters(peaks, dt) {
    if (!peaks) return;
    this.meters.forEach((c, i) => {
      const p = peaks[i] ?? 0;
      this.levels[i] = Math.max(p, this.levels[i] - dt * 1.6);
      this.holds[i] = Math.max(p, this.holds[i] - dt * 0.35);
      const rect = c.getBoundingClientRect();
      if (!rect.height) return;
      if (c.width !== Math.round(rect.width) || c.height !== Math.round(rect.height)) {
        c.width = Math.round(rect.width);
        c.height = Math.round(rect.height);
      }
      const g = c.getContext('2d');
      const h = c.height;
      const y = (v) => h - Math.min(1, Math.sqrt(v / 1.1)) * h; // a rough loudness curve
      g.clearRect(0, 0, c.width, h);
      g.fillStyle = 'rgba(255, 255, 255, 0.05)';
      g.fillRect(0, 0, c.width, h);
      const grad = g.createLinearGradient(0, h, 0, 0);
      grad.addColorStop(0, '#2fd29a');
      grad.addColorStop(0.7, '#e6e65a');
      grad.addColorStop(0.9, '#ff5f6d');
      g.fillStyle = grad;
      const top = y(this.levels[i]);
      g.fillRect(0, top, c.width, h - top);
      g.fillStyle = this.holds[i] >= 1 ? '#ff5f6d' : 'rgba(255, 255, 255, 0.8)';
      g.fillRect(0, y(this.holds[i]), c.width, 1.5);
    });
  }
}
