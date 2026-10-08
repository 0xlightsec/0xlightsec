/**
 * Channel Rack: one row per channel, FL style.
 *
 *   [●] (pan) (vol) [ins] [ Name ]  ▮▯▯▯ ▮▯▯▯ ▮▯▯▯ ▮▯▯▯ …
 *
 *   LED          click mutes; right-click (or Ctrl+click) solos
 *   name         click selects the channel (the keys and MIDI play it);
 *                double-click opens it in the piano roll
 *   steps        click to toggle, drag to paint; a channel with pitched or long
 *                notes shows them in miniature instead (click to open the roll)
 *
 * Beside it, the inspector edits the selected channel: its sound or drum and kit,
 * shape, volume, pan, mixer insert, and quick fills.
 */

import { SOUNDS, GROUPS } from '../../studio/sounds.js';
import { KITS } from '../../studio/drums.js';
import { Knob } from '../../studio/knob.js';
import { DRUMS, PATTERN_BARS, INSERTS, ROOT, hueOf } from '../model.js';
import { hueFor, pitchClass } from '../../theory/circle.js';

const KIT_LABELS = { classic: 'Classic', boom: 'Boom (trap)', lofi: 'Lo-fi', hyper: 'Hyper', rage: 'Rage', club: 'Club', rock: 'Rock' };

const el = (tag, cls, attrs = {}) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') e.textContent = v;
    else if (k === 'html') e.innerHTML = v;
    else e.setAttribute(k, v);
  }
  return e;
};

/** A <select> of every sound, grouped. */
export function soundSelect(value) {
  const s = el('select', 'sound-select', { 'aria-label': 'Sound' });
  for (const g of GROUPS) {
    const og = el('optgroup', '', { label: g.label });
    for (const [id, p] of Object.entries(SOUNDS)) if (p.group === g.id) og.appendChild(el('option', '', { value: id, text: p.label }));
    s.appendChild(og);
  }
  s.value = value;
  return s;
}

export class ChannelRack {
  constructor(root, studio) {
    this.root = root;
    this.studio = studio;
    this.rows = root.querySelector('.rack-rows');
    this.inspector = root.querySelector('.inspector');
    this.head = root.querySelector('.rack-head');
    this.painting = null;
    this.lit = -1;
    window.addEventListener('pointerup', () => this.endPaint());
    this.buildHead();
  }

  get song() {
    return this.studio.song;
  }

  /* --------------------------------- header ---------------------------------- */

  buildHead() {
    const h = this.head;
    h.innerHTML = '';
    this.nameInput = el('input', 'pattern-name', { type: 'text', maxlength: '40', spellcheck: 'false', 'aria-label': 'Pattern name' });
    this.nameInput.addEventListener('change', () => {
      const p = this.song.currentPattern;
      const v = this.nameInput.value.trim();
      if (p && v) this.studio.edit(() => (p.name = v));
      this.nameInput.blur();
    });
    this.nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.nameInput.blur();
    });
    this.bars = el('div', 'seg rack-seg', { 'aria-label': 'Pattern length' });
    for (const b of PATTERN_BARS) {
      const btn = el('button', '', { 'data-bars': String(b), text: `${b} bar${b > 1 ? 's' : ''}` });
      btn.addEventListener('click', () => this.studio.edit(() => this.song.setBars(this.song.currentPattern.id, b)));
      this.bars.appendChild(btn);
    }
    const swingBox = el('div', 'swing-box');
    swingBox.appendChild(el('span', 'ctl-label', { text: 'Swing' }));
    const knobEl = el('div');
    swingBox.appendChild(knobEl);
    this.swing = new Knob(knobEl, {
      label: 'Swing', value: this.song.data.swing, def: 0, tiny: true, hue: 300,
      format: (v) => `${Math.round(v * 100)}%`,
      onChange: (v) => this.studio.tweak(() => (this.song.data.swing = v))
    });
    const clear = el('button', 'pill', { text: 'Clear pattern', title: 'Remove every note in this pattern (click twice)' });
    clear.addEventListener('click', () => {
      if (clear.dataset.armed !== '1') {
        clear.dataset.armed = '1';
        clear.textContent = 'Sure?';
        setTimeout(() => { clear.dataset.armed = ''; clear.textContent = 'Clear pattern'; }, 3000);
        return;
      }
      clear.dataset.armed = '';
      clear.textContent = 'Clear pattern';
      this.studio.edit(() => (this.song.currentPattern.notes = {}));
    });
    const add = el('select', 'add-channel', { 'aria-label': 'Add a channel', title: 'Add a channel' });
    add.appendChild(el('option', '', { value: '', text: '+ Add channel…' }));
    const drums = el('optgroup', '', { label: 'Drums' });
    for (const [id, d] of Object.entries(DRUMS)) drums.appendChild(el('option', '', { value: `drum:${id}`, text: d.label }));
    add.appendChild(drums);
    for (const g of GROUPS) {
      const og = el('optgroup', '', { label: g.label });
      for (const [id, p] of Object.entries(SOUNDS)) if (p.group === g.id) og.appendChild(el('option', '', { value: `synth:${id}`, text: p.label }));
      add.appendChild(og);
    }
    add.addEventListener('change', () => {
      const [kind, id] = add.value.split(':');
      add.value = '';
      add.blur();
      if (kind) this.studio.addChannel(kind === 'drum' ? { kind: 'drum', drum: id } : { kind: 'synth', sound: id });
    });
    h.append(this.nameInput, this.bars, swingBox, add, el('span', 'spacer'), clear);
  }

  /* ---------------------------------- rows ----------------------------------- */

  render() {
    const song = this.song;
    const p = song.currentPattern;
    if (!p) return;
    if (document.activeElement !== this.nameInput) this.nameInput.value = p.name;
    for (const b of this.bars.children) b.classList.toggle('is-on', Number(b.dataset.bars) === p.bars);
    if (Math.abs(this.swing.value - song.data.swing) > 1e-6) this.swing.set(song.data.swing, false);

    const steps = song.steps(p);
    this.rows.innerHTML = '';
    this.rows.style.setProperty('--steps', String(steps));
    song.channels.forEach((ch, i) => this.rows.appendChild(this.row(ch, i, p, steps)));
    this.lit = -1;
    this.renderInspector();
  }

  row(ch, index, p, steps) {
    const song = this.song;
    const selected = ch.id === song.data.current.channel;
    const r = el('div', `ch-row${selected ? ' is-selected' : ''}${song.audible(ch) ? '' : ' is-silent'}`, { 'data-id': ch.id });
    r.style.setProperty('--hue', String(hueOf(index)));

    const led = el('button', `ch-led${ch.solo ? ' is-solo' : ''}${ch.mute ? ' is-muted' : ''}`, { title: 'Mute (click) · solo (right-click or Ctrl+click)', 'aria-label': `Mute ${ch.name}` });
    const toggle = (solo) => this.studio.edit(() => (solo ? (ch.solo = !ch.solo) : (ch.mute = !ch.mute)));
    led.addEventListener('click', (e) => toggle(e.ctrlKey || e.metaKey));
    led.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      toggle(true);
    });

    const pan = el('div', 'ch-knob');
    new Knob(pan, {
      label: `${ch.name} pan`, value: (ch.pan + 1) / 2, def: 0.5, bipolar: true, tiny: true, hue: 200,
      format: (v) => (Math.abs(v - 0.5) < 0.01 ? 'centre' : v < 0.5 ? `${Math.round((0.5 - v) * 200)}% left` : `${Math.round((v - 0.5) * 200)}% right`),
      onChange: (v) => this.studio.tweak(() => (ch.pan = Math.round((v * 2 - 1) * 100) / 100))
    });
    const vol = el('div', 'ch-knob');
    new Knob(vol, {
      label: `${ch.name} volume`, value: ch.volume, def: 0.8, tiny: true, hue: 40,
      format: (v) => `${Math.round(v * 100)}%`,
      onChange: (v) => this.studio.tweak(() => (ch.volume = v))
    });

    const ins = el('button', 'ch-insert', { text: ch.insert ? String(ch.insert) : 'M', title: `Mixer insert ${ch.insert || '(master)'} — click to show it in the mixer` });
    ins.addEventListener('click', () => this.studio.showInsert(ch.insert));

    const name = el('button', 'ch-name', { text: ch.name, title: 'Select (the keys play it) · double-click for the piano roll' });
    name.addEventListener('click', () => this.studio.selectChannel(ch.id));
    name.addEventListener('dblclick', () => this.studio.openRoll(ch.id));

    r.append(led, pan, vol, ins, name);
    if (song.isSteps(p.id, ch.id)) r.appendChild(this.stepButtons(ch, p, steps));
    else r.appendChild(this.preview(ch, p, steps));
    return r;
  }

  stepButtons(ch, p, steps) {
    const wrap = el('div', 'ch-steps');
    const on = new Set(this.song.notes(p.id, ch.id).map((n) => n.start));
    for (let s = 0; s < steps; s++) {
      const b = el('button', `step${on.has(s) ? ' is-on' : ''}${Math.floor(s / 4) % 2 ? ' is-odd' : ''}`, { 'data-step': String(s), 'aria-label': `${ch.name} step ${s + 1}` });
      b.tabIndex = -1;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const value = e.button === 2 ? false : !b.classList.contains('is-on');
        this.studio.begin();
        this.painting = { ch, p, value };
        this.paint(b, s);
      });
      b.addEventListener('pointerover', () => {
        if (this.painting?.ch === ch) this.paint(b, s);
      });
      b.addEventListener('contextmenu', (e) => e.preventDefault());
      wrap.appendChild(b);
    }
    return wrap;
  }

  paint(button, step) {
    const { ch, p, value } = this.painting;
    if (button.classList.contains('is-on') === value) return;
    this.song.toggleStep(p.id, ch.id, step, value);
    button.classList.toggle('is-on', value);
    if (value) this.studio.preview(ch.id, ROOT);
    this.studio.change({ quiet: true });
  }

  endPaint() {
    if (!this.painting) return;
    this.painting = null;
    this.studio.commit();
  }

  /** Pitched or long notes, in miniature; click to open the piano roll. */
  preview(ch, p, steps) {
    const c = el('canvas', 'ch-preview', { title: 'Notes — click to open the piano roll' });
    c.addEventListener('click', () => this.studio.openRoll(ch.id));
    requestAnimationFrame(() => {
      const rect = c.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      c.width = Math.max(1, Math.round(rect.width * dpr));
      c.height = Math.max(1, Math.round(rect.height * dpr));
      const g = c.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const notes = this.song.notes(p.id, ch.id);
      if (!notes.length) return;
      let lo = Math.min(...notes.map((n) => n.midi));
      let hi = Math.max(...notes.map((n) => n.midi));
      if (hi - lo < 6) {
        lo -= 3;
        hi += 3;
      }
      const sw = rect.width / steps;
      for (const n of notes) {
        if (n.start >= steps) continue;
        g.fillStyle = `hsl(${hueFor(pitchClass(n.midi))}, 90%, 65%)`;
        const y = (1 - (n.midi - lo) / (hi - lo)) * (rect.height - 4) + 1;
        g.fillRect(n.start * sw + 0.5, y, Math.max(2, n.length * sw - 1), 3);
      }
    });
    return c;
  }

  /** Light the column the playhead is on. */
  highlight(step) {
    const col = step === null ? -1 : Math.floor(step);
    if (col === this.lit) return;
    for (const b of this.rows.querySelectorAll('.step.is-now')) b.classList.remove('is-now');
    if (col >= 0) for (const b of this.rows.querySelectorAll(`.step[data-step="${col}"]`)) b.classList.add('is-now');
    this.lit = col;
  }

  /* -------------------------------- inspector -------------------------------- */

  renderInspector() {
    const box = this.inspector;
    const ch = this.song.currentChannel;
    box.innerHTML = '';
    if (!ch) return;
    const index = this.song.channels.indexOf(ch);
    box.style.setProperty('--hue', String(hueOf(index)));

    const name = el('input', 'insp-name', { type: 'text', maxlength: '40', spellcheck: 'false', 'aria-label': 'Channel name' });
    name.value = ch.name;
    name.addEventListener('change', () => {
      const v = name.value.trim();
      if (v) this.studio.edit(() => (ch.name = v));
    });
    name.addEventListener('keydown', (e) => e.key === 'Enter' && name.blur());
    box.appendChild(name);

    const field = (label, control) => {
      const f = el('label', 'insp-field');
      f.append(el('span', 'ctl-label', { text: label }), control);
      box.appendChild(f);
      return control;
    };
    if (ch.kind === 'synth') {
      const s = field('Sound', soundSelect(ch.sound));
      s.addEventListener('change', () => {
        this.studio.edit(() => {
          const old = SOUNDS[ch.sound]?.label;
          ch.sound = s.value;
          if (ch.name === old) ch.name = SOUNDS[s.value].label;
        });
        s.blur();
      });
      const knobs = el('div', 'insp-knobs');
      for (const [k, label, hue] of [['tone', 'Tone', 48], ['attack', 'Attack', 120], ['release', 'Release', 200]]) {
        const d = el('div');
        knobs.appendChild(d);
        new Knob(d, {
          label, value: ch.shape[k], def: 0.5, bipolar: true, small: true, hue,
          format: (v) => (Math.abs(v - 0.5) < 0.01 ? 'as is' : `${v < 0.5 ? '−' : '+'}${Math.round(Math.abs(v - 0.5) * 200)}%`),
          onChange: (v) => this.studio.tweak(() => (ch.shape[k] = v))
        });
      }
      box.appendChild(knobs);
    } else {
      const d = el('select', '', { 'aria-label': 'Drum' });
      for (const [id, dr] of Object.entries(DRUMS)) d.appendChild(el('option', '', { value: id, text: dr.label }));
      d.value = ch.drum;
      field('Drum', d).addEventListener('change', () => {
        this.studio.edit(() => {
          const old = DRUMS[ch.drum]?.label;
          ch.drum = d.value;
          if (ch.name === old) ch.name = DRUMS[d.value].label;
        });
        d.blur();
      });
      const k = el('select', '', { 'aria-label': 'Kit' });
      for (const id of Object.keys(KITS)) k.appendChild(el('option', '', { value: id, text: KIT_LABELS[id] ?? id }));
      k.value = ch.kit;
      field('Kit', k).addEventListener('change', () => {
        this.studio.edit(() => (ch.kit = k.value));
        this.studio.preview(ch.id, ROOT);
        k.blur();
      });
    }

    const ins = el('select', '', { 'aria-label': 'Mixer insert' });
    ins.appendChild(el('option', '', { value: '0', text: 'Master' }));
    for (let i = 1; i <= INSERTS; i++) ins.appendChild(el('option', '', { value: String(i), text: `${i} · ${this.song.data.mixer[i].name}` }));
    ins.value = String(ch.insert);
    field('Mixer', ins).addEventListener('change', () => {
      this.studio.edit(() => (ch.insert = Number(ins.value)));
      ins.blur();
    });

    const fill = el('div', 'insp-row');
    fill.appendChild(el('span', 'ctl-label', { text: 'Fill' }));
    for (const [n, label] of [[2, '⅛'], [4, '¼'], [8, '½'], [16, 'bar']]) {
      const b = el('button', 'pill', { text: label, title: `A step every ${n} sixteenths` });
      b.addEventListener('click', () => this.studio.edit(() => this.song.fillSteps(this.song.currentPattern.id, ch.id, n)));
      fill.appendChild(b);
    }
    const none = el('button', 'pill', { text: 'Clear', title: "Clear this channel's notes in this pattern" });
    none.addEventListener('click', () => this.studio.edit(() => (this.song.currentPattern.notes[ch.id] = [])));
    fill.appendChild(none);
    box.appendChild(fill);

    const acts = el('div', 'insp-row');
    const act = (text, title, fn) => {
      const b = el('button', 'pill', { text, title });
      b.addEventListener('click', fn);
      acts.appendChild(b);
      return b;
    };
    act('Piano roll', 'Edit its notes (F7)', () => this.studio.openRoll(ch.id));
    act('↑', 'Move up', () => this.studio.edit(() => this.song.moveChannel(ch.id, -1)));
    act('↓', 'Move down', () => this.studio.edit(() => this.song.moveChannel(ch.id, 1)));
    act('Clone', 'Duplicate the channel and its notes', () => this.studio.edit(() => {
      const c = this.song.duplicateChannel(ch.id);
      if (c) this.song.data.current.channel = c.id;
    }));
    const del = act('Delete', 'Delete the channel (click twice)', () => {
      if (del.dataset.armed !== '1') {
        del.dataset.armed = '1';
        del.textContent = 'Sure?';
        setTimeout(() => { del.dataset.armed = ''; del.textContent = 'Delete'; }, 3000);
        return;
      }
      this.studio.edit(() => this.song.removeChannel(ch.id));
    });
    box.appendChild(acts);
  }
}
