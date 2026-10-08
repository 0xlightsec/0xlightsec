/**
 * Mixer: the master and the inserts, side by side, FL style. Each strip has a
 * fader, pan, mute and solo, a meter, the effects in its slots, and lists the
 * channels playing into it.
 *
 *   + Insert            adds a strip (up to 24); "+ for <channel>" adds one and
 *                       sends the selected channel to it
 *   ⇢ on a strip        sends the selected channel there
 *   ✕ on a strip        removes it (click twice); its channels go to the master
 *
 * Click a strip to see its effects on the right. Like FL's slots, a strip lists
 * the effects on it, + Add effect puts another one in, × takes one out; or start
 * from a preset.
 */

import { Knob } from '../../studio/knob.js';
import { crushBits, filterSetting, levelGain, clipGain, FX_DEFAULTS } from '../../studio/fx.js';
import { MAX_INSERTS, FX_NEUTRAL, stripSlots } from '../model.js';

/** Every effect a slot can hold: [label, hue, what it does, value text, default, bipolar]. */
const EFFECTS = {
  drive: ['Drive', 340, 'Soft saturation: warmth up to grit', (v) => (v < 0.005 ? 'off' : `${Math.round(v * 100)}%`)],
  crush: ['Crush', 285, 'Fewer bits: lo-fi crunch', (v) => (v < 0.005 ? 'off' : `${crushBits(v)} bit`)],
  filter: ['Filter', 196, 'DJ filter: left darker, right thinner', formatFilter, 0.5, true],
  tape: ['Tape', 28, 'Wow, flutter and a dull top: a worn cassette', (v) => (v < 0.005 ? 'off' : `${Math.round(v * 100)}%`)],
  clip: ['Clip', 8, 'Gain into a hard ceiling: the loud-808 move', (v) => (v < 0.005 ? 'off' : `+${(20 * Math.log10(clipGain(v))).toFixed(1)} dB`)],
  gate: ['Gate', 120, 'A 1/16 chopper locked to the song (ShaperBox style)', (v) => (v < 0.005 ? 'off' : `1/16 · ${Math.round(v * 100)}%`)],
  echo: ['Echo', 160, 'A dotted-eighth delay in time with the song', (v) => (v < 0.005 ? 'off' : `${Math.round(v * 100)}%`)],
  space: ['Space', 255, 'A send to the shared hall reverb', (v) => (v < 0.005 ? 'off' : `${Math.round(v * 100)}%`)]
};

/** One-click starting points: a whole effects setting each. */
export const FX_PRESETS = [
  { id: 'clean', label: 'Clean', title: 'Every effect off', fx: {} },
  { id: 'loud808', label: 'Loud 808', title: 'Drive and a hard clip: the Spinz-style 808 that cuts through', fx: { drive: 0.15, clip: 0.4 } },
  { id: 'chop', label: 'Chop', title: 'A 1/16 gate chopping the sound, ShaperBox style', fx: { gate: 0.85, space: 0.15 } },
  { id: 'dusty', label: 'Dusty', title: 'Bit-crushed, worn tape, dark', fx: { crush: 0.3, tape: 0.45, filter: 0.38 } },
  { id: 'wide', label: 'Big room', title: 'Echo and a lot of hall', fx: { echo: 0.35, space: 0.6 } },
  { id: 'phone', label: 'Phone', title: 'Thin and crunchy, for a breakdown', fx: { filter: 0.78, drive: 0.4, crush: 0.15 } }
];

const UNITY = FX_DEFAULTS.level; // the fader position that is 0 dB

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

/** Ask twice: the first click arms the button for three seconds. */
function confirmTwice(button, armedText, act) {
  const text = button.textContent;
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    if (button.dataset.armed === '1') {
      act();
      return;
    }
    button.dataset.armed = '1';
    button.textContent = armedText;
    setTimeout(() => {
      button.dataset.armed = '';
      button.textContent = text;
    }, 3000);
  });
}

/**
 * A mixer fader: a slot with a cap. Drag the cap (Shift for fine moves), click the
 * slot to jump there, scroll or use the arrow keys to nudge, double-click for 0 dB.
 */
export function makeFader(value, { label, onInput }) {
  const wrap = el('div', 'mx-fader');
  wrap.tabIndex = 0;
  wrap.setAttribute('role', 'slider');
  wrap.setAttribute('aria-label', label);
  wrap.setAttribute('aria-valuemin', '0');
  wrap.setAttribute('aria-valuemax', '100');
  const slot = el('div', 'mx-fader-slot');
  const fill = el('div', 'mx-fader-fill');
  const unity = el('div', 'mx-fader-unity');
  const cap = el('div', 'mx-fader-cap');
  slot.append(fill, unity);
  wrap.append(slot, cap);
  let v = value;
  const show = () => {
    wrap.style.setProperty('--v', String(v));
    wrap.setAttribute('aria-valuenow', String(Math.round(v * 100)));
    wrap.setAttribute('aria-valuetext', `${dbOf(v)} dB`);
  };
  const set = (next) => {
    v = Math.min(1, Math.max(0, next));
    show();
    onInput(v);
  };
  show();
  const travel = () => wrap.clientHeight - cap.offsetHeight;
  let drag = null;
  wrap.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    wrap.focus();
    wrap.setPointerCapture(e.pointerId);
    if (e.target !== cap) {
      // Jump: the cap's middle lands where you clicked.
      const r = wrap.getBoundingClientRect();
      set(1 - (e.clientY - r.top - cap.offsetHeight / 2) / travel());
    }
    drag = { y: e.clientY, v };
    wrap.classList.add('is-dragging');
  });
  wrap.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const fine = e.shiftKey ? 0.25 : 1;
    set(drag.v + ((drag.y - e.clientY) / travel()) * fine);
  });
  const end = () => {
    if (!drag) return;
    drag = null;
    wrap.classList.remove('is-dragging');
  };
  wrap.addEventListener('pointerup', end);
  wrap.addEventListener('lostpointercapture', end);
  wrap.addEventListener('dblclick', () => set(UNITY));
  wrap.addEventListener('wheel', (e) => {
    e.preventDefault();
    set(v - Math.sign(e.deltaY) * (e.shiftKey ? 0.005 : 0.02));
  }, { passive: false });
  wrap.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 0.05 : 0.01;
    if (e.key === 'ArrowUp') set(v + step);
    else if (e.key === 'ArrowDown') set(v - step);
    else if (e.key === 'Home') set(1);
    else if (e.key === 'End') set(0);
    else return;
    e.preventDefault();
    e.stopPropagation();
  });
  return wrap;
}

export class MixerView {
  constructor(root, studio) {
    this.root = root;
    this.studio = studio;
    this.strips = root.querySelector('.mx-strips');
    this.fxBox = root.querySelector('.mx-fx');
    this.selected = 1;
    this.levels = [];
    this.holds = [];
    this.meters = [];
    this.menuOpen = false;
    document.addEventListener('click', () => {
      if (!this.menuOpen) return;
      this.menuOpen = false;
      this.fxBox.querySelector('.mx-add-menu')?.remove();
    });
  }

  get song() {
    return this.studio.song;
  }

  /** Pick a strip to edit. The strips stay as they are (rebuilding them mid-click would eat the click). */
  select(i) {
    this.selected = Math.max(0, Math.min(this.song.inserts, i));
    [...this.strips.querySelectorAll('.mx-strip')].forEach((s, k) => s.classList.toggle('is-selected', k === this.selected));
    this.renderFx();
  }

  render() {
    const song = this.song;
    const mixer = song.data.mixer;
    // Keep keyboard focus on a fader across the redraw.
    const focused = document.activeElement?.classList?.contains('mx-fader') ? document.activeElement.dataset.strip : null;
    this.selected = Math.min(this.selected, mixer.length - 1);
    this.strips.innerHTML = '';
    this.meters = [];
    this.levels.length = this.holds.length = mixer.length;
    const current = song.currentChannel;
    mixer.forEach((t, i) => {
      const s = el('div', `mx-strip${i === 0 ? ' is-master' : ''}${i === this.selected ? ' is-selected' : ''}${t.mute ? ' is-muted' : ''}`);
      s.addEventListener('pointerdown', () => {
        if (this.selected !== i) this.select(i);
      });
      const top = el('div', 'mx-top');
      top.appendChild(el('span', 'mx-num', i === 0 ? 'M' : String(i)));
      if (i > 0) {
        const del = el('button', 'mx-del', '✕');
        del.title = 'Remove this insert (click twice); its channels go to the master';
        confirmTwice(del, 'sure?', () => this.studio.edit(() => {
          song.removeInsert(i);
          this.selected = Math.min(this.selected, song.inserts);
        }));
        top.appendChild(del);
      }
      const name = el('div', 'mx-name', t.name);
      name.title = 'Double-click to rename';
      name.addEventListener('dblclick', () => this.rename(i, name));
      // The effects in its slots, as a row of coloured pips.
      const fx = el('div', 'mx-fxpips');
      for (const k of stripSlots(t)) {
        const pip = el('i');
        pip.style.setProperty('--hue', String(EFFECTS[k][1]));
        pip.title = EFFECTS[k][0];
        fx.appendChild(pip);
      }
      if (!fx.children.length) fx.appendChild(el('span', 'mx-nofx', 'no fx'));
      const pan = el('div', 'mx-pan');
      new Knob(pan, {
        label: `${t.name} pan`, value: (t.pan + 1) / 2, def: 0.5, bipolar: true, tiny: true, hue: 200,
        format: (v) => (Math.abs(v - 0.5) < 0.01 ? 'centre' : v < 0.5 ? `${Math.round((0.5 - v) * 200)}% L` : `${Math.round((v - 0.5) * 200)}% R`),
        onChange: (v) => this.studio.tweak(() => (t.pan = Math.round((v * 2 - 1) * 100) / 100))
      });
      const body = el('div', 'mx-body');
      const meter = el('canvas', 'mx-meter');
      const db = el('div', 'mx-db', `${dbOf(t.volume)} dB`);
      const fader = makeFader(t.volume, {
        label: `${t.name} volume`,
        onInput: (v) => {
          db.textContent = `${dbOf(v)} dB`;
          this.studio.tweak(() => (t.volume = v)); // one undo step once you let go
        }
      });
      fader.dataset.strip = String(i);
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
      // Send the selected channel here.
      const route = el('button', `mx-route${current?.insert === i ? ' is-on' : ''}`, '⇢');
      route.title = current ? (current.insert === i ? `${current.name} plays through here` : `Send ${current.name} here`) : 'Select a channel first';
      route.disabled = !current;
      route.addEventListener('click', (e) => {
        e.stopPropagation();
        if (current && current.insert !== i) this.studio.edit(() => (current.insert = i));
      });
      btns.appendChild(route);
      const routed = song.channels.filter((c) => c.insert === i).map((c) => c.name);
      const from = el('div', 'mx-routed', i === 0 ? (routed.length ? `all inserts · ${routed.join(' · ')}` : 'all inserts') : routed.join(' · ') || '—');
      from.title = from.textContent;
      s.append(top, name, fx, pan, body, db, btns, from);
      this.strips.appendChild(s);
      this.meters.push(meter);
    });
    this.strips.appendChild(this.addColumn());
    if (focused !== null) this.strips.querySelector(`.mx-fader[data-strip="${focused}"]`)?.focus();
    this.renderFx();
  }

  /** The column after the last strip: add an insert, or one for the selected channel. */
  addColumn() {
    const song = this.song;
    const col = el('div', 'mx-add');
    const full = song.inserts >= MAX_INSERTS;
    const add = el('button', 'mx-add-btn', '+ Insert');
    add.title = full ? `The mixer is full (${MAX_INSERTS} inserts)` : 'Add a mixer insert';
    add.disabled = full;
    add.addEventListener('click', () => this.studio.edit(() => {
      const i = song.addInsert();
      if (i) this.selected = i;
    }));
    col.appendChild(add);
    const ch = song.currentChannel;
    if (ch) {
      const mine = el('button', 'mx-add-btn is-for', `+ for ${ch.name}`);
      mine.title = `Add an insert and send ${ch.name} to it`;
      mine.disabled = full;
      mine.addEventListener('click', () => this.studio.edit(() => {
        const i = song.addInsert(ch.name.slice(0, 24));
        if (!i) return;
        ch.insert = i;
        this.selected = i;
      }));
      col.appendChild(mine);
    }
    col.appendChild(el('div', 'mx-add-note', `${song.inserts} / ${MAX_INSERTS}`));
    return col;
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

  /** The selected strip's effect slots, + Add effect, and the presets. */
  renderFx() {
    const box = this.fxBox;
    const i = this.selected;
    const t = this.song.data.mixer[i];
    box.innerHTML = '';
    this.menuOpen = false;
    const head = el('div', 'mx-fx-head');
    const who = el('span', 'mx-fx-who', `${i === 0 ? 'Master' : `Insert ${i}`} · ${t.name}`);
    const addBtn = el('button', 'pill mx-fx-add', '+ Add effect');
    addBtn.title = 'Put an effect on this strip';
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleMenu(box, i);
    });
    head.append(el('span', 'panel-title', 'Effects'), who, addBtn);
    box.appendChild(head);

    const slots = stripSlots(t);
    const list = el('div', 'mx-slots');
    if (!slots.length) {
      list.appendChild(el('p', 'mx-empty', 'Nothing on this strip yet. + Add effect, or start from a preset below.'));
    }
    slots.forEach((k, n) => {
      const [label, hue, what, format, def = FX_NEUTRAL[k], bipolar = false] = EFFECTS[k];
      const row = el('div', 'mx-slot');
      row.style.setProperty('--hue', String(hue));
      const info = el('div', 'mx-slot-info');
      info.append(el('span', 'mx-slot-num', String(n + 1)), el('b', '', label), el('small', '', what));
      const knob = el('div', 'mx-slot-knob');
      new Knob(knob, { label, value: t.fx[k], def, bipolar, small: true, hue, format, onChange: (v) => this.studio.tweak(() => (t.fx[k] = v)) });
      const remove = el('button', 'mx-slot-x', '×');
      remove.title = `Take ${label} off this strip`;
      remove.addEventListener('click', () => this.studio.edit(() => this.song.removeEffect(i, k)));
      row.append(info, knob, remove);
      list.appendChild(row);
    });
    box.appendChild(list);

    const presets = el('div', 'mx-presets');
    presets.appendChild(el('span', 'ctl-label', 'Presets'));
    for (const p of FX_PRESETS) {
      const b = el('button', 'pill', p.label);
      b.title = p.title;
      b.addEventListener('click', () => this.studio.edit(() => {
        Object.assign(t.fx, FX_NEUTRAL, p.fx);
        t.slots = stripSlots({ ...t, slots: Object.keys(p.fx) });
      }));
      presets.appendChild(b);
    }
    box.appendChild(presets);
    box.appendChild(el('p', 'mx-fx-note', 'The sound runs through the slots top to bottom; Echo and Space are sends. Double-click a knob to reset it. Gate chops in time with the song while it plays.'));
  }

  toggleMenu(box, i) {
    const open = box.querySelector('.mx-add-menu');
    if (open) {
      open.remove();
      this.menuOpen = false;
      return;
    }
    const t = this.song.data.mixer[i];
    const have = new Set(stripSlots(t));
    const menu = el('div', 'menu mx-add-menu');
    for (const [k, [label, hue, what]] of Object.entries(EFFECTS)) {
      const b = el('button', 'mx-add-item');
      b.style.setProperty('--hue', String(hue));
      b.append(el('b', '', label), el('small', '', have.has(k) ? 'on this strip' : what));
      b.disabled = have.has(k);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.studio.edit(() => this.song.addEffect(i, k));
      });
      menu.appendChild(b);
    }
    box.querySelector('.mx-fx-head').appendChild(menu);
    this.menuOpen = true;
  }

  /** Meters, every frame: fast up, slower down, with a peak hold. */
  drawMeters(peaks, dt) {
    if (!peaks) return;
    this.meters.forEach((c, i) => {
      const p = peaks[i] ?? 0;
      this.levels[i] = Math.max(p, (this.levels[i] ?? 0) - dt * 1.6);
      this.holds[i] = Math.max(p, (this.holds[i] ?? 0) - dt * 0.35);
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
