/**
 * PRISM Studio: an FL Studio–style beatmaker.
 *
 *   Browser       sounds, drums, kits and ready-made beats (F8 hides it)
 *   Playlist      the song: pattern clips on tracks (F5)
 *   Channel Rack  instruments and their steps (F6)
 *   Piano Roll    a channel's notes (F7)
 *   Mixer         inserts, faders, effects (F9)
 *
 * Play from the computer keyboard (the selected channel), a MIDI keyboard, or
 * MIDI drum pads (channel 10 goes to the drum channels). Arm record and what you
 * play lands in the pattern. Export WAV or MIDI; import MIDI.
 *
 * ⚡ Cynmixx makes a whole arranged hoodtrap beat in one click; ♪ Melody and
 * ◈ Drums re-roll its parts. The windows float over a live data-center backdrop
 * that pulses with the drums.
 *
 * Every edit goes through the studio object below, which keeps undo, the audio
 * engine and the views in step.
 */

import { newSong, loadSong, eventsBetween, formatPosition, STEPS_PER_BAR, ROOT, DRUMS, GM_TO_DRUM, PATTERN_BARS, hueOf } from './model.js';
import { DawEngine } from './engine.js';
import { encodeMidi, decodeMidi } from './midi-file.js';
import { ChannelRack } from './views/rack.js';
import { PianoRoll, TOOLS } from './views/piano-roll.js';
import { Playlist } from './views/playlist.js';
import { MixerView } from './views/mixer-view.js';
import { Browser } from './views/browser.js';
import { DataCenter } from './views/datacenter.js';
import { makeCynmixx, applyMelody, applyDrums, isGenerated } from './cynmixx.js';
import { saveSong, listSongs, loadSongData, deleteSong } from './songs-db.js';
import { KEY_NAMES, SCALES, chordFor, chordName, inScale } from '../studio/sounds.js';
import { BEATS } from '../studio/drums.js';
import { KeyboardInstrument, WHITE_KEYS, BLACK_KEYS } from '../io/keyboard.js';
import { MidiInput } from '../io/midi.js';
import { wireWindowChrome, renderFocusBadge, trackFocus } from '../chrome.js';
import { encodeWav } from '../scope/tracks.js';
import { ScopeDisplay, PHOSPHORS } from '../scope/display.js';
import { Driver, LiveCircles, levelFromDb } from '../scope/live.js';
import { rms, toDb } from '../scope/measure.js';
import { noteName } from '../theory/circle.js';
import { pianoFrequency } from '../theory/piano.js';

const $ = (id) => document.getElementById(id);
const SONG_KEY = 'prism.daw.song.v1';
const UI_KEY = 'prism.daw.ui.v1';
const SNAPS = [['1/4', 4], ['1/8', 2], ['1/16', 1], ['1/32', 0.5]];
const VIEWS = ['rack', 'roll', 'mixer'];

/* ---------------------------------- state ---------------------------------- */

const ui = {
  view: 'rack',
  playlist: true,
  browser: true,
  snap: 1,
  key: 0,
  scale: 'major',
  rollTool: 'draw',
  chords: false,
  ghosts: true,
  recQuantize: true,
  metronome: false,
  octave: 4,
  volume: 0.8,
  kit: 'classic',
  songId: null,
  ...read(UI_KEY)
};

let song;
try {
  const saved = localStorage.getItem(SONG_KEY);
  song = saved ? loadSong(saved) : newSong();
} catch {
  song = newSong();
}

const engine = new DawEngine(song);
engine.metronome = ui.metronome;
engine.volume = ui.volume;

let gesture = false;
let tweakTimer = 0;
let pointerHeld = false;
window.addEventListener('pointerdown', () => (pointerHeld = true), true);
window.addEventListener('pointerup', () => (pointerHeld = false), true);
window.addEventListener('pointercancel', () => (pointerHeld = false), true);

/** What the views call to read and change the song. */
const studio = {
  get song() {
    return song;
  },
  get kit() {
    return ui.kit;
  },
  /** Before a gesture: remember how things were, for undo. */
  begin() {
    if (!gesture) {
      song.checkpoint();
      gesture = true;
    }
  },
  /** Mid-gesture: the sound follows at once; the page catches up when it's done. */
  change() {
    engine.sync(song);
  },
  /** After a gesture: one undo step (if anything changed), saved and redrawn. */
  commit() {
    if (gesture) {
      song.settle();
      gesture = false;
    }
    clearTimeout(tweakTimer);
    engine.sync(song);
    saveSoon();
    renderAll();
  },
  edit(fn) {
    this.begin();
    fn();
    this.commit();
  },
  /** Knobs and faders: changes stream in; they become one undo step once you let go. */
  tweak(fn) {
    this.begin();
    fn();
    engine.sync(song);
    clearTimeout(tweakTimer);
    const settle = () => {
      if (pointerHeld) tweakTimer = setTimeout(settle, 200);
      else this.commit();
    };
    tweakTimer = setTimeout(settle, 450);
  },
  selectChannel(id) {
    if (song.data.current.channel === id) return;
    song.data.current.channel = id;
    saveSoon();
    renderAll();
  },
  selectPattern(id) {
    if (song.data.current.pattern === id) return;
    song.data.current.pattern = id;
    saveSoon();
    renderAll();
  },
  openPattern(id) {
    this.selectPattern(id);
    showView('rack');
  },
  openRoll(channelId) {
    song.data.current.channel = channelId;
    showView('roll');
    roll.selected.clear();
    roll.reveal();
    renderAll();
  },
  showInsert(i) {
    mixer.selected = i;
    showView('mixer');
  },
  preview(channelId, midi, on) {
    engine.preview(channelId, midi, on);
  },
  audition(spec) {
    engine.audition(spec);
  },
  addChannel(spec) {
    let ch;
    this.edit(() => {
      ch = song.addChannel(spec.kind === 'drum' ? { kit: ui.kit, ...spec } : spec);
      song.data.current.channel = ch.id;
    });
    engine.preview(ch.id, ROOT);
    toast(`Added ${ch.name}${ch.insert ? ` on insert ${ch.insert}` : ''}`);
  },
  /** Write a built-in beat into the current pattern (and take its tempo if the song was empty). */
  applyBeat(id) {
    const empty = song.patterns.every((p) => Object.values(p.notes).every((l) => !l.length));
    this.edit(() => {
      song.applyBeat(song.currentPattern.id, id);
      if (empty) song.data.bpm = BEATS[id].tempo;
    });
    toast(`${BEATS[id].label} beat in ${song.currentPattern.name}${empty ? ` · ${BEATS[id].tempo} BPM` : ''}`);
    if (!engine.playing) {
      engine.play();
      renderTransport();
    }
  },
  useKit(kit) {
    ui.kit = kit;
    saveUi();
    this.edit(() => song.channels.filter((c) => c.kind === 'drum').forEach((c) => (c.kit = kit)));
    engine.audition({ kind: 'drum', drum: 'kick', kit });
    setTimeout(() => engine.audition({ kind: 'drum', drum: 'snare', kit }), 220);
  },
  /** Where the song plays from (the green marker). */
  setPosition(step) {
    song.data.position = step;
    saveSoon();
    if (engine.playing && song.data.mode === 'song') engine.play(step);
  }
};

/* ---------------------------------- views ---------------------------------- */

const rack = new ChannelRack($('rackView'), studio);
const roll = new PianoRoll($('rollCanvas'), studio, {
  snap: () => ui.snap,
  inKey: (midi) => inScale(midi, ui.key, ui.scale),
  chords: () => ui.chords,
  chordFor: (midi) => chordFor(midi, ui.key, ui.scale),
  ghosts: () => ui.ghosts
});
roll.tool = TOOLS.includes(ui.rollTool) ? ui.rollTool : 'draw';
const playlist = new Playlist($('playlistCanvas'), studio);
const mixer = new MixerView($('mixerView'), studio);
const browser = new Browser($('browserList'), studio);

function showView(view) {
  if (view === 'browser') return toggleBrowser();
  if (view === 'playlist') {
    ui.playlist = !ui.playlist;
  } else if (VIEWS.includes(view)) {
    ui.view = view;
  }
  saveUi();
  layout();
  renderAll();
}

function layout() {
  $('playlistPane').hidden = !ui.playlist;
  $('browser').hidden = !ui.browser;
  $('workspace').classList.toggle('no-browser', !ui.browser);
  $('rackView').hidden = ui.view !== 'rack';
  $('rollView').hidden = ui.view !== 'roll';
  $('mixerView').hidden = ui.view !== 'mixer';
  for (const b of $('viewTabs').children) b.classList.toggle('is-on', b.dataset.view === ui.view);
  for (const b of document.querySelectorAll('.win-toggle')) b.classList.toggle('is-on', b.dataset.view === 'playlist' ? ui.playlist : ui.browser);
}

function renderAll() {
  if (ui.view === 'rack') rack.render();
  if (ui.view === 'mixer') mixer.render();
  renderToolbar();
  renderRollHead();
  renderKeysInfo();
}

function renderToolbar() {
  for (const b of $('modeSeg').children) b.classList.toggle('is-on', b.dataset.mode === song.data.mode);
  $('tempoValue').textContent = Number.isInteger(song.data.bpm) ? String(song.data.bpm) : song.data.bpm.toFixed(1);
  const sel = $('patternSelect');
  sel.innerHTML = '';
  song.patterns.forEach((p, i) => {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = p.name;
    o.style.color = `hsl(${hueOf(i)}, 80%, 75%)`;
    sel.appendChild(o);
  });
  sel.value = song.data.current.pattern;
  $('recBtn').setAttribute('aria-pressed', String(engine.recording));
  $('metroBtn').setAttribute('aria-pressed', String(engine.metronome));
  $('undoBtn').disabled = !song.past.length;
  $('redoBtn').disabled = !song.future.length;
  $('songTitle').textContent = song.data.name;
  const clips = song.data.playlist.clips.length;
  const empty = !clips && song.patterns.every((p) => Object.values(p.notes).every((l) => !l.length));
  $('emptyCta').hidden = !empty;
  $('playlistHint').classList.toggle('is-hidden', clips > 0 || empty);
  $('playlistMeta').textContent = `${song.songSteps / STEPS_PER_BAR} bars · ${clips} clip${clips === 1 ? '' : 's'} · ${song.patterns.length} pattern${song.patterns.length === 1 ? '' : 's'}`;
  const generated = isGenerated(song);
  $('newMelodyBtn').disabled = !generated;
  $('newDrumsBtn').disabled = !generated;
  const ch = song.currentChannel;
  $('mainMeta').textContent = ui.view === 'roll' ? `${ch?.name ?? ''} · ${song.currentPattern?.name ?? ''}`
    : ui.view === 'mixer' ? `${song.channels.length} channels → ${song.data.mixer.length - 1} inserts`
      : `${song.currentPattern?.name ?? ''} · ${song.channels.length} channels`;
}

function renderRollHead() {
  const sel = $('rollChannel');
  sel.innerHTML = '';
  for (const ch of song.channels) {
    const o = document.createElement('option');
    o.value = ch.id;
    o.textContent = ch.name;
    sel.appendChild(o);
  }
  sel.value = song.data.current.channel ?? '';
  for (const b of $('rollSnap').children) b.classList.toggle('is-on', Number(b.dataset.snap) === ui.snap);
  for (const b of $('rollTools').children) b.classList.toggle('is-on', b.dataset.tool === roll.tool);
  $('rollKey').value = String(ui.key);
  $('rollScale').value = ui.scale;
  $('rollChords').setAttribute('aria-pressed', String(ui.chords));
  $('chordBtn').setAttribute('aria-pressed', String(ui.chords));
  $('rollGhosts').setAttribute('aria-pressed', String(ui.ghosts));
  $('recQuantize').setAttribute('aria-pressed', String(ui.recQuantize));
}

function renderKeysInfo() {
  const ch = song.currentChannel;
  $('playsName').textContent = ch ? ch.name : '—';
  $('playsName').style.color = ch ? `hsl(${hueOf(song.channels.indexOf(ch))}, 85%, 75%)` : '';
  refreshKeyLabels();
}

/* ------------------------------ undo and redo ------------------------------ */

function undo() {
  if (gesture) studio.commit();
  if (song.undo()) afterHistory('Undone');
}

function redo() {
  if (song.redo()) afterHistory('Redone');
}

function afterHistory(what) {
  engine.sync(song);
  saveSoon();
  renderAll();
  toast(what);
}

/* -------------------------------- transport -------------------------------- */

function setMode(mode) {
  if (mode === song.data.mode) return;
  // Song mode with nothing in the playlist: start it off with the current pattern.
  if (mode === 'song' && !song.data.playlist.clips.length) {
    studio.edit(() => song.addClip({ track: 0, pattern: song.currentPattern.id, start: 0 }));
    toast('Put the current pattern in the playlist to start the song');
  }
  song.data.mode = mode;
  saveSoon();
  if (engine.playing) engine.play();
  renderToolbar();
}

function togglePlay() {
  engine.start();
  if (engine.playing) stop();
  else {
    if (engine.recording) studio.begin(); // a take is one undo step
    engine.play();
  }
  renderTransport();
}

function stop() {
  engine.stop();
  if (gesture) studio.commit();
  renderTransport();
}

function renderTransport() {
  $('playBtn').textContent = engine.playing ? '❚❚' : '▶';
  $('playBtn').classList.toggle('is-on', engine.playing);
  $('playBtn').setAttribute('aria-label', engine.playing ? 'Stop' : 'Play');
}

function toggleRecord() {
  engine.recording = !engine.recording;
  if (engine.recording && engine.playing) studio.begin();
  if (!engine.recording && gesture) studio.commit();
  renderToolbar();
  toast(engine.recording ? 'Recording: play to the beat and it lands in the pattern' : 'Recording off');
}

/** A recorded note from the engine: snap it if asked, add it to the pattern. */
engine.onRecorded = ({ channel, notes }) => {
  const p = song.currentPattern;
  if (!p || !song.channel(channel)) return;
  studio.begin();
  const steps = song.steps(p);
  const ch = song.channel(channel);
  for (const n of notes) {
    let start = n.start;
    let length = n.length;
    if (ui.recQuantize) {
      start = (Math.round(start / ui.snap) * ui.snap) % steps;
      length = Math.max(ui.snap, Math.round(length / ui.snap) * ui.snap);
    }
    if (ch.kind === 'drum') length = Math.min(length, 1);
    song.addNote(p.id, channel, { ...n, start, length });
  }
  engine.sync(song);
  if (ui.view === 'rack') rack.render();
};

/* --------------------------------- tempo ----------------------------------- */

function setTempo(bpm) {
  const v = Math.round(Math.min(240, Math.max(40, bpm)) * 10) / 10;
  if (v === song.data.bpm) return;
  studio.tweak(() => (song.data.bpm = v));
  $('tempoValue').textContent = Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function wireTempo() {
  const t = $('tempo');
  let drag = null;
  t.addEventListener('pointerdown', (e) => {
    if (e.detail > 1) return;
    t.setPointerCapture(e.pointerId);
    drag = { y: e.clientY, bpm: song.data.bpm };
  });
  t.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dy = drag.y - e.clientY;
    setTempo(drag.bpm + (e.shiftKey ? dy / 20 : Math.round(dy / 3)));
  });
  t.addEventListener('pointerup', () => (drag = null));
  t.addEventListener('wheel', (e) => {
    e.preventDefault();
    setTempo(song.data.bpm - Math.sign(e.deltaY) * (e.shiftKey ? 0.1 : 1));
  }, { passive: false });
  t.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      setTempo(song.data.bpm + (e.key === 'ArrowUp' ? 1 : -1));
    }
  });
  t.addEventListener('dblclick', () => {
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '40';
    input.max = '240';
    input.step = '0.1';
    input.value = String(song.data.bpm);
    input.className = 'tempo-input';
    t.replaceChildren(input);
    input.focus();
    input.select();
    const done = () => {
      const v = Number(input.value);
      t.innerHTML = '<span id="tempoValue"></span><small>BPM</small>';
      if (Number.isFinite(v)) setTempo(v);
      renderToolbar();
    };
    input.addEventListener('blur', done, { once: true });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        input.blur();
      }
    });
  });
}

/* --------------------------------- patterns -------------------------------- */

function stepPattern(by) {
  const list = song.patterns;
  const i = list.findIndex((p) => p.id === song.data.current.pattern);
  const next = list[(i + by + list.length) % list.length];
  studio.selectPattern(next.id);
}

function newPattern() {
  studio.edit(() => {
    const p = song.addPattern();
    p.bars = song.currentPattern?.bars ?? 1;
    song.data.current.pattern = p.id;
  });
  toast(`${song.currentPattern.name}: a fresh pattern`);
}

/* ------------------------------- make a beat ------------------------------- */

const newSeed = () => Math.floor(Math.random() * 2 ** 31);

/**
 * ⚡ Cynmixx: a whole arranged beat in place of the song, as one undo step (so
 * Ctrl+Z brings the old song back). It plays from the top straight away.
 */
function makeBeat(keepTempo = false) {
  const next = makeCynmixx({ seed: newSeed(), bpm: keepTempo ? song.data.bpm : undefined });
  if (gesture) studio.commit();
  studio.edit(() => {
    song.data = next.data;
  });
  const { key } = song.data.gen;
  Object.assign(ui, { key, scale: 'phrygian', kit: 'hood', songId: null, playlist: true });
  saveUi();
  roll.selected.clear();
  roll.reveal();
  layout();
  renderAll();
  browser.render();
  engine.play(0);
  renderTransport();
  toast(`Cynmixx-type beat · ${KEY_NAMES[key]} Phrygian · ${song.data.bpm} BPM — ♪ Melody and ◈ Drums re-roll it, Ctrl+Z goes back`);
}

/** Re-roll the melody (808, arp, lead, brass or strings) or the drums of a generated beat. */
function reroll(what) {
  if (!isGenerated(song)) return toast('Make a ⚡ Cynmixx beat first: re-rolling works on the beats it makes', true);
  studio.edit(() => (what === 'melody' ? applyMelody(song, newSeed()) : applyDrums(song, newSeed())));
  toast(what === 'melody' ? 'New melody: the 808, arp, lead and pads are rewritten, the drums kept' : 'New drums: same bounce, new ghosts, rolls and percs');
  if (!engine.playing) {
    engine.play();
    renderTransport();
  }
}

/* ---------------------------------- pads ----------------------------------- */

const PAD_KEYS = { KeyQ: 'stutter2', KeyB: 'stutter1', KeyV: 'tape' };
const padsHeld = new Set();

function padDown(pad) {
  if (padsHeld.has(pad)) return;
  padsHeld.add(pad);
  if (pad === 'tape') engine.pad({ tape: true });
  else engine.pad({ stutter: pad === 'stutter2' ? 2 : 1 });
  renderPads();
}

function padUp(pad) {
  if (!padsHeld.delete(pad)) return;
  if (pad === 'tape') engine.pad({ tape: false });
  else {
    // Let go of one stutter while holding the other: the held one carries on.
    const other = pad === 'stutter2' ? 'stutter1' : 'stutter2';
    engine.pad({ stutter: padsHeld.has(other) ? (other === 'stutter2' ? 2 : 1) : 0 });
  }
  renderPads();
}

function renderPads() {
  for (const b of document.querySelectorAll('.pad')) b.classList.toggle('is-down', padsHeld.has(b.dataset.pad));
}

/* -------------------------------- live play -------------------------------- */

const keys = new KeyboardInstrument({
  onNoteOn: (m, v, code) => playLive(code, song.data.current.channel, m, v),
  onNoteOff: (_m, code) => engine.liveOff(code),
  onState: (state) => renderKeyState(state),
  onRearm: () => engine.start()
});
keys.octave = ui.octave;
keys.attach();
trackFocus(keys);

/** Play a channel live: chords in chord mode, a one-shot on a drum. */
function playLive(id, channelId, midi, velocity) {
  const ch = song.channel(channelId);
  if (!ch) return;
  const notes = ui.chords && ch.kind === 'synth' ? chordFor(midi, ui.key, ui.scale) : [midi];
  engine.liveOn(id, ch.id, notes, velocity);
}

const midi = new MidiInput({
  onNoteOn: (m, v, info) => {
    // Pads on channel 10 play the drum channel for that drum; everything else plays the selected channel.
    const drum = info?.channel === 9 ? GM_TO_DRUM.get(m) : null;
    const target = drum ? song.channels.find((c) => c.kind === 'drum' && c.drum === drum) : null;
    if (target) engine.liveOn(`midi:${m}`, target.id, [ROOT], v);
    else playLive(`midi:${m}`, song.data.current.channel, m, v);
  },
  onNoteOff: (m) => engine.liveOff(`midi:${m}`),
  onSustain: () => {}
});

function buildKeybed() {
  const bed = $('keybed');
  bed.innerHTML = '';
  const make = (key, kind) => {
    const b = document.createElement('button');
    b.className = `key ${kind}`;
    b.dataset.code = key.code;
    b.tabIndex = -1;
    b.innerHTML = `<span class="key-cap">${key.label}</span><span class="key-note"></span>`;
    if (kind === 'black') b.style.setProperty('--after', String(key.after));
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      b.setPointerCapture(e.pointerId);
      engine.start();
      keys.pressVirtual(key.code);
    });
    const release = () => keys.releaseVirtual(key.code);
    b.addEventListener('pointerup', release);
    b.addEventListener('pointercancel', release);
    b.addEventListener('lostpointercapture', release);
    bed.appendChild(b);
  };
  WHITE_KEYS.forEach((k) => make(k, 'white'));
  BLACK_KEYS.forEach((k) => make(k, 'black'));
}

function refreshKeyLabels() {
  for (const b of document.querySelectorAll('#keybed .key')) {
    const m = keys.midiFor(b.dataset.code);
    const label = b.querySelector('.key-note');
    if (m === null) {
      label.textContent = '';
      continue;
    }
    label.textContent = ui.chords ? chordName(chordFor(m, ui.key, ui.scale)) : noteName(m).replace(/-?\d+$/, '');
  }
  $('octValue').textContent = `C${keys.octave}`;
  $('keyRow').classList.toggle('is-chords', ui.chords);
}

function renderKeyState(state) {
  renderFocusBadge(state);
  for (const b of document.querySelectorAll('#keybed .key')) b.classList.toggle('is-down', state.down.has(b.dataset.code));
  $('breakawayKey').dataset.state = state.captured ? 'captured' : 'released';
  $('breakawayTitle').textContent = state.captured ? 'Breakaway' : 'Re-arm';
  $('breakawaySub').textContent = state.captured ? 'release keyboard' : 'keyboard is yours';
  $('breakawayKbd').textContent = state.captured ? 'esc' : 'enter';
  $('keyRow').classList.toggle('is-released', !state.captured);
  if (state.octave !== ui.octave) {
    ui.octave = state.octave;
    saveUi();
    refreshKeyLabels();
  }
}

function setChords(on) {
  ui.chords = on;
  keys.releaseAll();
  saveUi();
  renderRollHead();
  refreshKeyLabels();
}

/* -------------------------------- shortcuts -------------------------------- */

function wireShortcuts() {
  window.addEventListener('keydown', (e) => {
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    const mod = e.ctrlKey || e.metaKey;
    // Function keys work whether or not the keyboard is captured: they're the windows.
    const f = { F4: () => newPattern(), F5: () => showView('playlist'), F6: () => showView('rack'), F7: () => showView('roll'), F8: () => toggleBrowser(), F9: () => showView('mixer') }[e.code];
    if (f) {
      e.preventDefault();
      f();
      return;
    }
    if (!keys.active) return;
    if (ui.view === 'roll' && roll.key(e)) return;
    if (mod) {
      if (e.code === 'KeyZ') {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if (e.code === 'KeyY') {
        e.preventDefault();
        redo();
      } else if (e.code === 'KeyS') {
        e.preventDefault();
        quickSave();
      } else if (e.code === 'KeyL') {
        e.preventDefault();
        setMode(song.data.mode === 'song' ? 'pattern' : 'song');
      }
      return;
    }
    if (e.altKey) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (!e.repeat) togglePlay();
    } else if (e.code === 'KeyR' && !e.repeat) {
      toggleRecord();
    } else if (e.code === 'KeyM' && !e.repeat) {
      toggleMetronome();
    } else if (e.code === 'KeyC' && !e.repeat) {
      setChords(!ui.chords);
    } else if (e.code === 'BracketLeft') {
      stepPattern(-1);
    } else if (e.code === 'BracketRight') {
      stepPattern(1);
    } else if (e.code === 'KeyN' && !e.repeat) {
      reroll('melody');
    } else if (PAD_KEYS[e.code]) {
      if (!e.repeat) padDown(PAD_KEYS[e.code]);
    }
  });
  // A space released on a focused button would click it too.
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space' && keys.active) e.preventDefault();
    if (PAD_KEYS[e.code]) padUp(PAD_KEYS[e.code]);
  });
  window.addEventListener('blur', () => [...padsHeld].forEach(padUp));
  document.addEventListener('pointerup', (e) => {
    const b = e.target.closest?.('button');
    if (b) b.blur();
  });
}

function toggleMetronome() {
  engine.metronome = !engine.metronome;
  ui.metronome = engine.metronome;
  saveUi();
  renderToolbar();
}

function toggleBrowser() {
  ui.browser = !ui.browser;
  saveUi();
  layout();
}

/* ---------------------------------- songs ---------------------------------- */

function replaceSong(next, id = null) {
  engine.stop();
  song = next;
  engine.sync(song);
  ui.songId = id;
  saveUi();
  roll.selected.clear();
  roll.scroll = null;
  saveSoon();
  renderAll();
  renderTransport();
}

async function quickSave() {
  openSongs();
  await saveCurrent();
}

async function saveCurrent() {
  const name = ($('saveName').value || song.data.name || 'Untitled').trim().slice(0, 80);
  try {
    song.data.name = name;
    const json = JSON.stringify(song.toJSON());
    const info = { name, saved: Date.now(), bpm: song.data.bpm, channels: song.channels.length, patterns: song.patterns.length };
    // Saving under the same name updates that song; a new name makes a new one.
    const existing = ui.songId !== null ? (await listSongs()).find((s) => s.id === ui.songId && s.name === name) : null;
    ui.songId = await saveSong(info, json, existing ? existing.id : null);
    saveUi();
    songsNote(`Saved “${name}”.`);
    renderToolbar();
    renderSongs();
  } catch (err) {
    songsNote(`Couldn't save: ${err.message ?? err}`, true);
  }
}

function songsNote(text, bad = false) {
  $('songsNote').textContent = text;
  $('songsNote').classList.toggle('is-bad', bad);
}

function openSongs() {
  $('songs').hidden = false;
  $('projectsBtn').setAttribute('aria-expanded', 'true');
  $('saveName').value = song.data.name;
  renderSongs();
}

function closeSongs() {
  $('songs').hidden = true;
  $('projectsBtn').setAttribute('aria-expanded', 'false');
}

async function renderSongs() {
  const list = $('songsList');
  let songs = [];
  try {
    songs = await listSongs();
  } catch (err) {
    songsNote(`The song library isn't available: ${err.message ?? err}`, true);
  }
  list.innerHTML = '';
  if (!songs.length) {
    const li = document.createElement('li');
    li.className = 'library-empty';
    li.textContent = 'No saved songs yet.';
    list.appendChild(li);
    return;
  }
  for (const entry of songs) {
    const li = document.createElement('li');
    li.className = 'library-item';
    const when = new Date(entry.saved).toLocaleString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    li.innerHTML = `<div class="lib-name"></div><div class="lib-info"></div>
      <div class="lib-actions"><button class="pill lib-load">Open</button><button class="pill lib-export" title="Save as a .prismbeat file">File</button><button class="pill lib-delete">Delete</button></div>`;
    li.querySelector('.lib-name').textContent = entry.name;
    li.querySelector('.lib-info').textContent = `${entry.channels} channels · ${entry.patterns} pattern${entry.patterns === 1 ? '' : 's'} · ${Math.round(entry.bpm)} BPM · ${when}`;
    li.querySelector('.lib-load').addEventListener('click', async () => {
      try {
        replaceSong(loadSong(await loadSongData(entry.id)), entry.id);
        songsNote(`Opened “${entry.name}”.`);
      } catch (err) {
        songsNote(`Couldn't open it: ${err.message ?? err}`, true);
      }
    });
    li.querySelector('.lib-export').addEventListener('click', async () => {
      download(new Blob([await loadSongData(entry.id)], { type: 'application/json' }), `${safeName(entry.name)}.prismbeat`);
    });
    const del = li.querySelector('.lib-delete');
    del.addEventListener('click', async () => {
      if (del.dataset.armed !== '1') {
        del.dataset.armed = '1';
        del.textContent = 'Sure?';
        setTimeout(() => { del.dataset.armed = ''; del.textContent = 'Delete'; }, 3000);
        return;
      }
      await deleteSong(entry.id);
      if (ui.songId === entry.id) ui.songId = null;
      songsNote(`Deleted “${entry.name}”.`);
      renderSongs();
    });
    list.appendChild(li);
  }
}

/** Plain ASCII: Chromium quietly renames a download whose name has anything else. */
function safeName(name) {
  return String(name).normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]+/g, ' ')
    .replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'PRISM';
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

/* ------------------------------ import / export ---------------------------- */

/** Every channel's notes for a MIDI file: the pattern once, or the whole song. */
function midiTracks(mode) {
  const byChannel = new Map();
  for (const ev of eventsBetween(song, mode, 0, song.period(mode))) {
    if (!byChannel.has(ev.channel)) byChannel.set(ev.channel, []);
    byChannel.get(ev.channel).push({ ...ev.note, start: ev.step, length: Math.min(ev.note.length, ev.room) });
  }
  let next = 0;
  return song.channels.filter((c) => byChannel.has(c.id)).map((c) => {
    const drum = c.kind === 'drum';
    // Synths take channels 1–9 and 11–16 (0–8, 10–15 here); 10 is for drums.
    let channel = 9;
    if (!drum) {
      channel = next < 9 ? next : next + 1;
      next = (next + 1) % 15;
    }
    const notes = byChannel.get(c.id).map((n) => (drum ? { ...n, midi: DRUMS[c.drum].gm, length: Math.min(n.length, 1) } : n));
    return { name: c.name, channel, notes };
  });
}

async function exportAs(kind, mode) {
  const label = mode === 'song' ? 'song' : song.currentPattern.name;
  const base = safeName(`${song.data.name} ${mode === 'song' ? '' : label}`);
  if (kind === 'mid') {
    const tracks = midiTracks(mode);
    if (!tracks.length) return toast('Nothing to export yet: add some notes', true);
    download(new Blob([encodeMidi({ name: song.data.name, bpm: song.data.bpm, tracks })], { type: 'audio/midi' }), `${base}.mid`);
    toast(`Exported the ${label} as MIDI`);
    return;
  }
  const btn = $('exportBtn');
  btn.textContent = 'Rendering…';
  btn.disabled = true;
  try {
    const buf = await engine.render(mode);
    download(encodeWav(buf.getChannelData(0), buf.getChannelData(1), buf.sampleRate), `${base}.wav`);
    toast(`Exported the ${label} as WAV (${(buf.length / buf.sampleRate).toFixed(1)} s)`);
  } catch (err) {
    toast(`Couldn't render: ${err.message ?? err}`, true);
  } finally {
    btn.textContent = 'Export ▾';
    btn.disabled = false;
  }
}

/** A MIDI file becomes a new pattern: drums onto drum channels, every other track a new synth channel. */
function importMidi(bytes, fileName) {
  const file = decodeMidi(bytes);
  const notes = file.tracks.flatMap((t) => t.notes);
  if (!notes.length) throw new Error('there are no notes in it');
  const end = Math.max(...notes.map((n) => n.start + n.length));
  const bars = PATTERN_BARS.find((b) => b * STEPS_PER_BAR >= end - 1e-6) ?? PATTERN_BARS[PATTERN_BARS.length - 1];
  const name = fileName.replace(/\.(mid|midi)$/i, '').slice(0, 40);
  const empty = song.patterns.every((p) => Object.values(p.notes).every((l) => !l.length));
  studio.edit(() => {
    const p = song.addPattern(name);
    p.bars = bars;
    for (const t of file.tracks) {
      if (t.channel === 9) {
        for (const n of t.notes) {
          const drum = GM_TO_DRUM.get(n.midi);
          if (!drum) continue;
          const ch = song.drumChannel(drum, ui.kit);
          song.addNote(p.id, ch.id, { ...n, midi: ROOT, length: Math.min(n.length, 1) });
        }
      } else {
        const ch = song.addChannel({ kind: 'synth', sound: 'keys', name: t.name.slice(0, 40) });
        for (const n of t.notes) song.addNote(p.id, ch.id, n);
        song.data.current.channel = ch.id;
      }
    }
    song.data.current.pattern = p.id;
    // A song with nothing in it yet takes the file's tempo.
    if (empty) song.data.bpm = Math.round(Math.min(240, Math.max(40, file.bpm)) * 10) / 10;
  });
  toast(`Imported ${file.tracks.length} track${file.tracks.length === 1 ? '' : 's'} as “${song.currentPattern.name}” (${bars} bar${bars > 1 ? 's' : ''})`);
}

async function importFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isMidi = bytes[0] === 0x4d && bytes[1] === 0x54 && bytes[2] === 0x68 && bytes[3] === 0x64;
  if (isMidi) importMidi(bytes, file.name);
  else {
    replaceSong(loadSong(new TextDecoder().decode(bytes)));
    toast(`Opened “${song.data.name}”`);
  }
}

/* ---------------------------------- toast ---------------------------------- */

let toastTimer = 0;
function toast(text, bad = false) {
  const t = $('toast');
  t.textContent = text;
  t.classList.toggle('is-bad', bad);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2600);
}

/* -------------------------------- backdrop --------------------------------- */

const backdrop = new DataCenter($('voidCanvas'));
let drumLevel = 0;
let lastHit = 0;

/** The mix's loudness and whether a drum just hit, for the backdrop. */
function drumHit(now) {
  const d = tapLevel(engine.drumTap);
  const hit = d > 0.3 && d > drumLevel * 1.35 + 0.08 && now - lastHit > 90;
  if (hit) lastHit = now;
  drumLevel = d;
  return hit;
}

/* -------------------------------- visualizer ------------------------------- */

const viz = new ScopeDisplay($('vizGrid'), $('vizBeam'));
viz.setGrid(false);
viz.fill = true;
viz.phosphor = PHOSPHORS.pink;
const circles = new LiveCircles(48000);
const melodyDriver = new Driver();
const drumDriver = new Driver();
const vizL = new Float32Array(2400);
const vizR = new Float32Array(2400);
const tapBuf = new Float32Array(2048);

function tapLevel(tap) {
  if (!tap) return 0;
  const n = tap.fftSize;
  tap.getFloatTimeDomainData(tapBuf.subarray(0, n));
  return levelFromDb(toDb(rms(tapBuf, 0, n)));
}

function drawViz(dt) {
  viz.resize();
  viz.fade(0.6);
  const now = engine.sounding();
  const m = melodyDriver.update({ level: tapLevel(engine.synthTap), midi: now.melody[0] ?? null }, dt);
  const d = drumDriver.update({ level: tapLevel(engine.drumTap) * 1.2, midi: null }, dt);
  circles.setTargets([m, d], now.melody.length ? pianoFrequency(now.melody[0]) : 110);
  circles.render(vizL, vizR, vizL.length);
  viz.drawMusic(vizL, vizR, vizL.length - 1, 1);
}

/* ---------------------------------- frame ---------------------------------- */

let last = performance.now();
let lastPos = '';

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const pos = engine.position();
  const mode = song.data.mode;
  if (ui.playlist) playlist.draw(mode === 'song' ? pos : null);
  if (ui.view === 'roll') roll.draw(mode === 'pattern' ? pos : null);
  if (ui.view === 'rack') rack.highlight(mode === 'pattern' ? pos : null);
  if (ui.view === 'mixer' && engine.rig) mixer.drawMeters(engine.rig.mixer.peaks(), dt);
  const text = formatPosition(pos ?? (mode === 'song' ? song.data.position : 0));
  if (text !== lastPos) {
    $('timeDisplay').textContent = text;
    lastPos = text;
  }
  if (ui.browser) drawViz(dt);
  backdrop.draw(dt, { level: tapLevel(engine.outTap), hit: drumHit(now) });
  $('startVeil').hidden = !engine.ctx || engine.ctx.state !== 'suspended';
  requestAnimationFrame(frame);
}

/* --------------------------------- storage --------------------------------- */

function read(key) {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

let saveTimer = 0;
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(SONG_KEY, JSON.stringify(song.toJSON())); } catch { /* not persisted */ }
  }, 300);
}

let uiTimer = 0;
function saveUi() {
  clearTimeout(uiTimer);
  uiTimer = setTimeout(() => {
    try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch { /* not persisted */ }
  }, 200);
}

/* ---------------------------------- wiring --------------------------------- */

function wire() {
  for (const b of $('modeSeg').children) b.addEventListener('click', () => setMode(b.dataset.mode));
  $('playBtn').addEventListener('click', togglePlay);
  $('stopBtn').addEventListener('click', stop);
  $('recBtn').addEventListener('click', toggleRecord);
  $('metroBtn').addEventListener('click', toggleMetronome);
  wireTempo();
  $('patternSelect').addEventListener('change', (e) => {
    studio.selectPattern(e.target.value);
    e.target.blur();
  });
  $('prevPattern').addEventListener('click', () => stepPattern(-1));
  $('nextPattern').addEventListener('click', () => stepPattern(1));
  $('newPattern').addEventListener('click', newPattern);
  $('clonePattern').addEventListener('click', () => studio.edit(() => {
    const p = song.clonePattern(song.data.current.pattern);
    if (p) song.data.current.pattern = p.id;
  }));
  const del = $('deletePattern');
  del.addEventListener('click', () => {
    if (song.patterns.length <= 1) return toast("A song needs at least one pattern", true);
    if (del.dataset.armed !== '1') {
      del.dataset.armed = '1';
      del.classList.add('is-armed');
      setTimeout(() => { del.dataset.armed = ''; del.classList.remove('is-armed'); }, 3000);
      return toast('Click ✕ again to delete this pattern (and its clips)');
    }
    del.dataset.armed = '';
    del.classList.remove('is-armed');
    studio.edit(() => song.removePattern(song.data.current.pattern));
  });
  for (const b of $('viewTabs').children) b.addEventListener('click', () => showView(b.dataset.view));
  for (const b of document.querySelectorAll('.win-toggle, .win-x')) b.addEventListener('click', () => showView(b.dataset.view));
  $('cynmixxBtn').addEventListener('click', (e) => makeBeat(e.ctrlKey || e.metaKey));
  $('ctaCynmixx').addEventListener('click', () => makeBeat());
  $('newMelodyBtn').addEventListener('click', () => reroll('melody'));
  $('newDrumsBtn').addEventListener('click', () => reroll('drums'));
  for (const b of document.querySelectorAll('.pad')) {
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      b.setPointerCapture(e.pointerId);
      padDown(b.dataset.pad);
    });
    const up = () => padUp(b.dataset.pad);
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('lostpointercapture', up);
  }
  $('undoBtn').addEventListener('click', undo);
  $('redoBtn').addEventListener('click', redo);
  $('volume').value = String(Math.round(ui.volume * 100));
  $('volume').addEventListener('input', (e) => {
    ui.volume = Number(e.target.value) / 100;
    engine.setVolume(ui.volume);
    saveUi();
  });

  // Export menu.
  const menu = $('exportMenu');
  $('exportBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
    $('exportBtn').setAttribute('aria-expanded', String(!menu.hidden));
  });
  document.addEventListener('click', () => {
    menu.hidden = true;
    $('exportBtn').setAttribute('aria-expanded', 'false');
  });
  for (const b of menu.querySelectorAll('[data-export]')) {
    b.addEventListener('click', () => {
      const [kind, mode] = b.dataset.export.split(':');
      exportAs(kind, mode);
    });
  }
  $('importBtn').addEventListener('click', () => $('importFile').click());
  $('openSongBtn').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      await importFile(file);
    } catch (err) {
      toast(`Couldn't open ${file.name}: ${err.message ?? err}`, true);
    }
  });

  // Songs drawer.
  $('projectsBtn').addEventListener('click', () => ($('songs').hidden ? openSongs() : closeSongs()));
  $('songsClose').addEventListener('click', closeSongs);
  $('saveForm').addEventListener('submit', (e) => {
    e.preventDefault();
    saveCurrent();
    $('saveName').blur();
  });
  const fresh = $('newSongBtn');
  fresh.addEventListener('click', () => {
    if (fresh.dataset.armed !== '1') {
      fresh.dataset.armed = '1';
      fresh.textContent = 'Sure? (unsaved changes go)';
      setTimeout(() => { fresh.dataset.armed = ''; fresh.textContent = 'New song'; }, 3000);
      return;
    }
    fresh.dataset.armed = '';
    fresh.textContent = 'New song';
    replaceSong(newSong());
    songsNote('A fresh song.');
  });

  // Piano roll header.
  for (const [label, steps] of SNAPS) {
    const b = document.createElement('button');
    b.dataset.snap = String(steps);
    b.textContent = label;
    b.title = `Snap to ${label} notes`;
    b.addEventListener('click', () => {
      ui.snap = steps;
      saveUi();
      renderRollHead();
    });
    $('rollSnap').appendChild(b);
  }
  KEY_NAMES.forEach((k, i) => {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = k;
    $('rollKey').appendChild(o);
  });
  for (const [id, sc] of Object.entries(SCALES)) {
    const o = document.createElement('option');
    o.value = id;
    o.textContent = sc.label;
    $('rollScale').appendChild(o);
  }
  if (!(ui.scale in SCALES)) ui.scale = 'major';
  const keyChanged = (e) => {
    ui.key = Number($('rollKey').value);
    ui.scale = $('rollScale').value;
    saveUi();
    refreshKeyLabels();
    e.target.blur();
  };
  $('rollKey').addEventListener('change', keyChanged);
  $('rollScale').addEventListener('change', keyChanged);
  $('rollChannel').addEventListener('change', (e) => {
    studio.selectChannel(e.target.value);
    roll.selected.clear();
    roll.reveal();
    e.target.blur();
  });
  for (const b of $('rollTools').children) {
    b.addEventListener('click', () => {
      roll.tool = ui.rollTool = b.dataset.tool;
      saveUi();
      renderRollHead();
    });
  }
  $('rollChords').addEventListener('click', () => setChords(!ui.chords));
  $('chordBtn').addEventListener('click', () => setChords(!ui.chords));
  $('rollGhosts').addEventListener('click', () => {
    ui.ghosts = !ui.ghosts;
    saveUi();
    renderRollHead();
  });
  $('recQuantize').addEventListener('click', () => {
    ui.recQuantize = !ui.recQuantize;
    saveUi();
    renderRollHead();
  });
  $('rollQuantize').addEventListener('click', () => studio.edit(() => {
    for (const n of song.notes(song.currentPattern.id, song.data.current.channel)) n.start = Math.max(0, Math.round(n.start / ui.snap) * ui.snap);
  }));

  $('octDown').addEventListener('click', () => keys.setOctave(keys.octave - 1));
  $('octUp').addEventListener('click', () => keys.setOctave(keys.octave + 1));
  $('breakawayKey').addEventListener('click', () => keys.toggleCapture());
  $('startBtn').addEventListener('click', () => engine.start());
  wireShortcuts();
}

/* ---------------------------------- start ---------------------------------- */

wireWindowChrome();
buildKeybed();
wire();
layout();
renderAll();
renderTransport();
renderKeyState(keys.state());
engine.start();
engine.sync(song);
midi.connect();
requestAnimationFrame(frame);
