/**
 * Studio: sing to move the circles, and make music with one hand.
 *
 *   Voice   your mic drives the upper circle; Pitch and Tune (hyperpop autotune)
 *           change what's recorded; on headphones you hear it with the FX
 *   Loop    one button: record, loop, add layers (Space); Undo, Redo and Clear
 *   Beat    nine grooves from lo-fi to hyperpop and punk; loops snap to its bars
 *   Pads    hold to stutter or tape-stop everything (Q, R, V)
 *   Roll    a piano roll (N): draw notes on a grid, played in time with its own
 *           sound and effects
 *   Loops   save and load whole loops in the app, or as .prism files
 *   Sound   twenty sounds in five groups, shaped with Tone, Attack and Release
 *   Keys    chord mode (one key = one chord that fits), key and octave
 *   Effects Drive, Crush, Filter, Echo, Space, Level — for what you play live, or
 *           for any one loop layer, which keeps its own settings
 *
 * The lower circle follows the music: keys, loop and beat.
 */

import { StudioEngine } from './engine.js';
import { SOUNDS, GROUPS, SHAPE_DEFAULT, KEY_NAMES, chordFor, chordName, shapeFactor } from './sounds.js';
import { BEATS, STEPS, TEMPO_MIN, TEMPO_MAX } from './drums.js';
import { filterSetting, crushBits, levelGain, FX_DEFAULTS } from './fx.js';
import { encodeProject, decodeProject, resample, defaultName, fileNameFor } from './project.js';
import { saveLoop, listLoops, loadLoop, deleteLoop } from './library.js';
import { PATTERN_BARS, SNAPS } from './roll.js';
import { RollView } from './roll-view.js';
import { Knob } from './knob.js';
import { ScopeDisplay, SpectrumView, PHOSPHORS } from '../scope/display.js';
import { Driver, levelFromDb } from '../scope/live.js';
import { rms, toDb } from '../scope/measure.js';
import { detectPitch } from '../io/audio-in.js';
import { KeyboardInstrument, WHITE_KEYS, BLACK_KEYS } from '../io/keyboard.js';
import { MidiInput } from '../io/midi.js';
import { noteName, freqToMidi } from '../theory/circle.js';
import { pianoFrequency } from '../theory/piano.js';
import { wireWindowChrome, renderFocusBadge, trackFocus } from '../chrome.js';

const $ = (id) => document.getElementById(id);
const STORE = 'prism.studio.v1';
const PITCH_WINDOW = 2048;
const VOICE_GATE = 0.004;
const VOICE_HOLD_MS = 200;
const FX_KNOBS = {
  drive:  { label: 'Drive',  hue: 340, format: (v) => (v < 0.005 ? 'off' : `${Math.round(v * 100)}%`) },
  crush:  { label: 'Crush',  hue: 285, format: (v) => (v < 0.005 ? 'off' : `${crushBits(v)} bit`) },
  filter: { label: 'Filter', hue: 196, def: 0.5, bipolar: true, format: formatFilter },
  echo:   { label: 'Echo',   hue: 160, format: (v) => (v < 0.005 ? 'off' : `${Math.round(v * 100)}%`) },
  space:  { label: 'Space',  hue: 255, format: (v) => (v < 0.005 ? 'off' : `${Math.round(v * 100)}%`) },
  tape:   { label: 'Tape',   hue: 28,  format: (v) => (v < 0.005 ? 'off' : `${Math.round(v * 100)}%`) },
  level:  { label: 'Level',  hue: 40,  def: FX_DEFAULTS.level, format: formatLevel }
};
const SHAPE_KNOBS = {
  tone:    { label: 'Tone',    hue: 48,  format: (v) => (Math.abs(v - 0.5) < 0.01 ? 'as is' : v < 0.5 ? 'darker' : 'brighter') },
  attack:  { label: 'Attack',  hue: 120, format: (v) => seconds(SOUNDS[settings.sound].env[0] * shapeFactor(v)) },
  release: { label: 'Release', hue: 200, format: (v) => seconds(SOUNDS[settings.sound].env[3] * shapeFactor(v)) }
};

const settings = {
  sound: 'keys',
  shape: { ...SHAPE_DEFAULT },
  chords: false,
  key: 0,
  octave: 4,
  velocity: 0.8,
  bpm: 96,
  lastBeat: 'groove',
  voiceToLoop: true,
  voicePitch: 0.5, // knob positions: centre = no shift
  voiceTune: 0,
  roll: null,
  volume: 0.8,
  fx: { ...FX_DEFAULTS },
  ...load()
};
if (!(settings.sound in SOUNDS)) settings.sound = 'keys';
settings.fx = { ...FX_DEFAULTS, ...settings.fx, mute: false };
settings.shape = { ...SHAPE_DEFAULT, ...settings.shape };
settings.roll = {
  pattern: { bars: 2, notes: [] },
  sound: 'pluck',
  snap: 1,
  toLoop: false,
  ...settings.roll,
  fx: { ...FX_DEFAULTS, space: 0.2, ...settings.roll?.fx }
};
if (!(settings.roll.sound in SOUNDS)) settings.roll.sound = 'pluck';
if (!SNAPS.some((s) => s.steps === settings.roll.snap)) settings.roll.snap = 1;
if (!(settings.lastBeat in BEATS)) settings.lastBeat = 'groove';

const engine = new StudioEngine();
engine.bpm = settings.bpm;
engine.volume = settings.volume;
engine.voiceToLoop = settings.voiceToLoop;
engine.pattern.load(settings.roll.pattern);

const display = new ScopeDisplay($('grid'), $('beam'));
display.setGrid(false);
display.fill = true;
display.phosphor = PHOSPHORS.pink;
const spectrum = new SpectrumView($('spectrum'));

/* ---------------------------------- keys ---------------------------------- */

/** Semitones the keyboard is shifted by for the chosen key, kept within ±6. */
const transpose = () => (settings.key > 6 ? settings.key - 12 : settings.key);

/** What a key plays: one note, or in chord mode the chord that fits the key. */
function notesFor(midi) {
  const m = midi + transpose();
  return settings.chords ? chordFor(m, settings.key) : [m];
}

let touched = false;
function play(id, midi, velocity) {
  engine.noteOn(id, notesFor(midi), velocity);
  touched = true;
}

const keys = new KeyboardInstrument({
  onNoteOn: (m, v, code) => play(code, m, v),
  onNoteOff: (_m, code) => engine.noteOff(code),
  onState: (state) => renderKeyState(state),
  onRearm: () => engine.start()
});
keys.octave = settings.octave;
keys.velocity = settings.velocity;
keys.attach();
trackFocus(keys);

const midi = new MidiInput({
  onNoteOn: (m, v) => play(`midi:${m}`, m, v),
  onNoteOff: (m) => engine.noteOff(`midi:${m}`),
  onSustain: () => {}
});

function buildKeybed() {
  const bed = $('keybed');
  bed.innerHTML = '';
  for (const key of WHITE_KEYS) bed.appendChild(makeKey(key, 'white'));
  for (const key of BLACK_KEYS) {
    const el = makeKey(key, 'black');
    el.style.setProperty('--after', String(key.after));
    bed.appendChild(el);
  }
}

function makeKey(key, kind) {
  const el = document.createElement('button');
  el.className = `key ${kind}`;
  el.dataset.code = key.code;
  el.tabIndex = -1;
  el.innerHTML = `<span class="key-cap">${key.label}</span><span class="key-note"></span>`;
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    engine.start();
    keys.pressVirtual(key.code);
  });
  const release = () => keys.releaseVirtual(key.code);
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
  el.addEventListener('lostpointercapture', release);
  return el;
}

/** Label each key with what it plays now: a note, or a chord name in chord mode. */
function refreshKeyLabels() {
  for (const el of document.querySelectorAll('.key')) {
    const m = keys.midiFor(el.dataset.code);
    const label = el.querySelector('.key-note');
    if (m === null) {
      label.textContent = '';
      continue;
    }
    const notes = notesFor(m);
    label.textContent = settings.chords ? chordName(notes) : noteName(notes[0]).replace(/-?\d+$/, '');
    el.title = settings.chords ? `${chordName(notes)} chord` : noteName(notes[0]);
  }
  $('keyRow').classList.toggle('is-chords', settings.chords);
  $('octValue').textContent = `C${keys.octave}`;
  $('keyValue').textContent = KEY_NAMES[settings.key];
}

function renderKeyState(state) {
  renderFocusBadge(state);
  for (const el of document.querySelectorAll('.key')) el.classList.toggle('is-down', state.down.has(el.dataset.code));
  const btn = $('breakawayKey');
  btn.dataset.state = state.captured ? 'captured' : 'released';
  $('breakawayTitle').textContent = state.captured ? 'Breakaway' : 'Re-arm';
  $('breakawaySub').textContent = state.captured ? 'release keyboard' : 'keyboard is yours';
  $('breakawayKbd').textContent = state.captured ? 'esc' : 'enter';
  $('keyRow').classList.toggle('is-released', !state.captured);
  if (state.octave !== settings.octave) {
    settings.octave = state.octave;
    refreshKeyLabels();
  }
  settings.velocity = state.velocity;
  save();
}

/* ---------------------------------- voice --------------------------------- */

const voice = { hz: 0, at: 0, level: 0 };
let lastPitchAt = 0;

function trackVoice(now) {
  const n = engine.buf2.length;
  voice.level = levelFromDb(toDb(rms(engine.buf2, n - 1024, n)));
  // Tune needs to follow every note quickly; the readout alone doesn't.
  if (!engine.micOn || now - lastPitchAt < (settings.voiceTune > 0 ? 20 : 50)) return;
  lastPitchAt = now;
  const buf = engine.buf2.subarray(n - PITCH_WINDOW);
  const hit = rms(buf) < VOICE_GATE ? null : detectPitch(buf, engine.sampleRate);
  if (hit && hit.clarity >= 0.85 && hit.hz >= 60 && hit.hz <= 1500) {
    voice.hz = voice.hz && now - voice.at < VOICE_HOLD_MS * 2 ? voice.hz * Math.pow(hit.hz / voice.hz, 0.5) : hit.hz;
    voice.at = now;
  }
  engine.updateVoice(voiceLive(now) ? voice.hz : 0, settings.key);
}

const pitchSemis = (v) => Math.round((v - 0.5) * 24);
let pitchKnob = null;
let tuneKnob = null;

function refreshVoiceKnobs() {
  pitchKnob?.set(settings.voicePitch, false);
  tuneKnob?.set(settings.voiceTune, false);
}

function setVoiceFx() {
  engine.setVoiceFx(pitchSemis(settings.voicePitch), settings.voiceTune);
  save();
}

const voiceLive = (now) => engine.micOn && voice.hz > 0 && now - voice.at < VOICE_HOLD_MS;

function renderVoice(now) {
  $('micMeter').style.height = `${Math.round(voice.level * 100)}%`;
  const live = voiceLive(now);
  const name = live ? noteName(Math.round(freqToMidi(voice.hz))) : '—';
  $('voiceNote').textContent = name;
  $('voiceHz').textContent = live ? `${voice.hz.toFixed(0)} Hz` : engine.micOn ? 'sing something' : 'mic off';
  $('voiceTag').textContent = live ? name : engine.micOn ? 'sing' : 'mic off';
}

function renderMic() {
  const state = $('micState');
  const retry = $('micBtn');
  if (engine.micOn) {
    state.textContent = engine.headphones ? 'listening · you hear yourself' : 'listening';
    retry.hidden = true;
  } else if (engine.micError === 'missing') {
    state.textContent = 'no microphone found';
    retry.hidden = false;
  } else if (engine.micError === 'blocked') {
    state.textContent = 'mic blocked — allow it in system privacy settings';
    retry.hidden = false;
  } else {
    state.textContent = 'mic starting…';
  }
}

async function startMic() {
  await engine.startMic();
  renderMic();
}

/* ---------------------------------- loop ---------------------------------- */

const LOOP_TEXT = {
  empty:     ['REC',  'Press to record'],
  full:      ['FULL', 'Every layer is used · undo or clear to add more'],
  recording: ['LOOP', 'Recording… press to loop it'],
  playing:   ['ADD',  'Looping · press to add a layer'],
  overdub:   ['KEEP', 'Adding a layer… press to keep it'],
  stopped:   ['PLAY', 'Stopped · press to play']
};

function renderLoop(st) {
  const btn = $('loopBtn');
  btn.dataset.state = st.state;
  const full = st.state === 'playing' && st.full;
  const [label, text] = LOOP_TEXT[full ? 'full' : st.state] ?? LOOP_TEXT.empty;
  $('loopLabel').textContent = label;
  $('loopState').textContent = text;
  const has = st.state !== 'empty';
  $('undoBtn').disabled = !has;
  $('redoBtn').disabled = !st.redo || st.state === 'recording' || st.state === 'overdub';
  $('clearBtn').disabled = !has && !st.redo;
  $('stopBtn').disabled = !(st.state === 'playing' || st.state === 'overdub' || st.state === 'stopped');
  $('stopBtn').textContent = st.state === 'stopped' ? 'Play' : 'Stop';
  renderLayers(st);
  $('loopLen').textContent = loopLength(st);
  renderTempo();
}

/** Layers you can pick: the kept ones (not a take or overdub still recording). */
const keptLayers = (st) => (st.state === 'overdub' ? st.layers - 1 : st.state === 'recording' ? 0 : st.layers);

/** One dot per layer: click one to give it its own effects. */
function renderLayers(st) {
  const kept = keptLayers(st);
  if (typeof fxTarget === 'number' && fxTarget >= kept) selectFxTarget('live');
  const dots = $('loopLayers');
  const n = Math.min(st.layers, 8);
  const key = `${n}|${st.state === 'overdub'}|${fxTarget}|${mutedLayers()}`;
  if (dots.dataset.key === key) return;
  dots.dataset.key = key;
  dots.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const dot = document.createElement('button');
    const recording = i >= kept;
    dot.className = 'layer-dot';
    dot.classList.toggle('is-new', recording);
    dot.classList.toggle('is-selected', fxTarget === i);
    dot.classList.toggle('is-muted', !recording && engine.fxValues(i).mute);
    dot.textContent = String(i + 1);
    dot.title = recording ? 'Recording this layer' : `Layer ${i + 1}: its own effects`;
    dot.disabled = recording;
    dot.addEventListener('click', () => selectFxTarget(fxTarget === i ? 'live' : i));
    dots.appendChild(dot);
  }
  renderFxTargets(kept);
}

const mutedLayers = () => (engine.layerFx ? engine.layerFx.map((c) => (c.values.mute ? 1 : 0)).join('') : '');

function loopLength(st) {
  const sr = engine.sampleRate;
  if (st.state === 'empty') return '';
  if (st.state === 'recording') return `${st.seconds.toFixed(1)} s`;
  const bars = engine.beatName ? (st.length / sr) / ((60 / engine.bpm) * 4) : 0;
  if (bars && Math.abs(bars - Math.round(bars)) < 0.01) return `${Math.round(bars)} bar${Math.round(bars) > 1 ? 's' : ''}`;
  return `${(st.length / sr).toFixed(1)} s`;
}

/** The ring, drawn from the audio clock every frame so it sweeps smoothly. */
function renderLoopRing() {
  const st = engine.loop;
  const ring = $('loopRing');
  let p = 0;
  if ((st.state === 'playing' || st.state === 'overdub') && st.length && engine.ctx) {
    const frame = engine.ctx.currentTime * engine.sampleRate;
    p = frame < st.start ? 0 : ((frame - st.start) % st.length) / st.length;
  } else if (st.state === 'recording') {
    // Recording to a beat: show where we are in the bar. Free: a full ring.
    p = engine.beatName ? beatPhase() : 1;
  } else if (st.state === 'stopped') p = 0;
  ring.style.strokeDashoffset = String(100 - p * 100);
}

function loop(cmd) {
  engine.loopCommand(cmd);
  touched = true;
}

/* ---------------------------------- beat ---------------------------------- */

let tempoKnob;
const stepQueue = [];
let currentStep = -1;

function beatPhase() {
  const d = engine.drums;
  if (!d?.playing) return 0;
  const bar = (60 / d.bpm) * 4;
  const t = engine.ctx.currentTime - d.origin;
  return t < 0 ? 0 : (t % bar) / bar;
}

function setBeat(name) {
  // A beat brings its own tempo, unless a loop already set one.
  if (name && name !== engine.beatName && !engine.hasLoop) engine.setTempo(BEATS[name].tempo);
  engine.setBeat(name || null);
  if (name) settings.lastBeat = name;
  for (const b of $('beatSeg').querySelectorAll('button')) b.classList.toggle('is-on', b.dataset.beat === (name || ''));
  if (!name) {
    stepQueue.length = 0;
    currentStep = -1;
  }
  settings.bpm = engine.bpm;
  renderTempo();
  save();
}

function renderTempo() {
  if (!tempoKnob) return;
  const v = (engine.bpm - TEMPO_MIN) / (TEMPO_MAX - TEMPO_MIN);
  if (Math.abs(v - tempoKnob.value) > 1e-4) tempoKnob.set(v, false);
  const locked = engine.tempoLocked;
  tempoKnob.el.classList.toggle('is-locked', locked);
  tempoKnob.el.title = locked ? 'The loop sets the tempo now. Clear the loop or stop the beat to change it.' : '';
}

function buildSteps() {
  const steps = $('steps');
  for (let i = 0; i < STEPS; i++) {
    const s = document.createElement('i');
    if (i % 4 === 0) s.className = 'is-downbeat';
    steps.appendChild(s);
  }
}

function renderSteps() {
  if (!engine.ctx) return;
  const now = engine.ctx.currentTime;
  while (stepQueue.length && stepQueue[0].t <= now) currentStep = stepQueue.shift().s;
  if (!engine.beatName) currentStep = -1;
  const lights = $('steps').children;
  for (let i = 0; i < lights.length; i++) lights[i].classList.toggle('is-now', i === currentStep);
}

/* ---------------------------------- sound --------------------------------- */

let shapeKnobs = {};

function setSound(name) {
  if (!(name in SOUNDS)) return;
  const changed = name !== settings.sound;
  settings.sound = name;
  engine.setSound(name);
  // A new sound starts as it was designed.
  if (changed) settings.shape = { ...SHAPE_DEFAULT };
  for (const [k, knob] of Object.entries(shapeKnobs)) {
    knob.set(settings.shape[k], false);
    engine.setShape(k, settings.shape[k]);
  }
  renderSoundPicker();
  save();
}

/** Group tabs, and the sounds of the current group. */
function renderSoundPicker() {
  const group = SOUNDS[settings.sound].group;
  for (const b of $('groupSeg').querySelectorAll('button')) b.classList.toggle('is-on', b.dataset.group === group);
  const list = $('soundList');
  if (list.dataset.group !== group) {
    list.dataset.group = group;
    list.innerHTML = '';
    for (const [id, p] of Object.entries(SOUNDS)) {
      if (p.group !== group) continue;
      const b = document.createElement('button');
      b.className = 'sound-chip';
      b.dataset.sound = id;
      b.textContent = p.short ?? p.label;
      b.title = p.label;
      b.addEventListener('click', () => setSound(id));
      list.appendChild(b);
    }
  }
  for (const b of list.children) b.classList.toggle('is-on', b.dataset.sound === settings.sound);
}

/** Pick a group: its first sound, or the next one if the group is already chosen. */
function pickGroup(group) {
  const ids = Object.keys(SOUNDS).filter((id) => SOUNDS[id].group === group);
  const at = ids.indexOf(settings.sound);
  setSound(at < 0 ? ids[0] : ids[(at + 1) % ids.length]);
}

function setChords(on) {
  settings.chords = on;
  keys.releaseAll();
  $('chordBtn').setAttribute('aria-pressed', String(on));
  refreshKeyLabels();
  save();
}

function setKey(k) {
  settings.key = ((k % 12) + 12) % 12;
  keys.releaseAll();
  refreshKeyLabels();
  save();
}

/* --------------------------------- effects -------------------------------- */

/** Whose effects the knobs turn: 'live' (what you play now) or a layer number. */
let fxTarget = 'live';
const fxKnobs = {};

function selectFxTarget(target) {
  fxTarget = target;
  const values = engine.fxValues(target);
  for (const [name, knob] of Object.entries(fxKnobs)) knob.set(values[name], false);
  $('muteBtn').setAttribute('aria-pressed', String(!!values.mute));
  $('muteBtn').hidden = target === 'live';
  $('fxPanel').classList.toggle('is-layer', target !== 'live');
  $('fxWho').textContent = target === 'live' ? 'what you play' : target === 'roll' ? 'the piano roll' : `layer ${target + 1} only`;
  renderFxTargets(keptLayers(engine.loop));
  $('loopLayers').dataset.key = ''; // repaint the dots with the new selection
  renderLayers(engine.loop);
}

function renderFxTargets(kept) {
  const seg = $('fxTarget');
  const key = `${kept}|${fxTarget}`;
  if (seg.dataset.key === key) return;
  seg.dataset.key = key;
  seg.innerHTML = '';
  const add = (label, target, title) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.title = title;
    b.classList.toggle('is-on', fxTarget === target);
    b.addEventListener('click', () => selectFxTarget(target));
    seg.appendChild(b);
  };
  add('Live', 'live', 'Effects on what you play now; new layers start with these');
  add('Roll', 'roll', "The piano roll's own effects");
  for (let i = 0; i < kept; i++) add(String(i + 1), i, `Layer ${i + 1}'s own effects`);
}

function setFx(name, value) {
  engine.setFx(fxTarget, name, value);
  if (fxTarget === 'live') settings.fx[name] = value;
  else if (fxTarget === 'roll') settings.roll.fx[name] = value;
  save();
}

function formatLevel(v) {
  const g = levelGain(v);
  if (g < 0.001) return 'silent';
  const db = 20 * Math.log10(g);
  return `${db >= 0 ? '+' : '−'}${Math.abs(db).toFixed(1)} dB`;
}

function seconds(t) {
  return t < 1 ? `${Math.round(t * 1000)} ms` : `${t.toFixed(1)} s`;
}

/* ---------------------------------- record -------------------------------- */

let recStarted = 0;

function toggleRecord() {
  const on = engine.toggleRecording();
  recStarted = on ? performance.now() : 0;
  $('recBtn').setAttribute('aria-pressed', String(on));
  if (!on) $('recLabel').textContent = 'Saving…';
}

engine.onRecorded = (blob) => {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  const ext = blob.type.includes('ogg') ? 'ogg' : 'webm';
  download(blob, `PRISM song ${stamp}.${ext}`);
  $('recLabel').textContent = 'Record song';
};

function renderRecord(now) {
  if (!recStarted) return;
  const s = Math.floor((now - recStarted) / 1000);
  $('recLabel').textContent = `Recording ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/* --------------------------------- circles -------------------------------- */

const musicDriver = new Driver();
const voiceDriver = new Driver();

function measureMusic() {
  const n = engine.buf1.length;
  const level = levelFromDb(toDb(rms(engine.buf1, n - 1024, n)));
  const held = engine.held;
  let m = held.length ? held[0] : null;
  if (m === null && level > 0.1 && !engine.beatName) {
    const hit = detectPitch(engine.buf1.subarray(n - PITCH_WINDOW), engine.sampleRate);
    if (hit && hit.clarity > 0.85 && hit.hz > 50 && hit.hz < 1000) m = freqToMidi(hit.hz);
  }
  return { level: held.length ? Math.max(level, 0.5) : level, midi: m };
}

function updateCircles(now, dt) {
  const music = measureMusic();
  const sung = { level: engine.micOn ? voice.level : 0, midi: voiceLive(now) ? freqToMidi(voice.hz) : null };
  const held = engine.held;
  const f = held.length ? pianoFrequency(held[0]) : 110;
  engine.sendLive([musicDriver.update(music, dt), voiceDriver.update(sung, dt)], f);
  if (sung.level > 0.25 || music.level > 0.2) touched = true;
}

/* ---------------------------------- frame --------------------------------- */

let lastFrame = performance.now();
let lastSlow = 0;

function frame(now) {
  const dt = Math.min((now - lastFrame) / 1000, 0.1);
  lastFrame = now;
  display.resize();
  display.fade(0.55);
  if (engine.snapshot()) {
    trackVoice(now);
    updateCircles(now, dt);
    const sr = engine.sampleRate;
    const count = Math.round(Math.min(8192, Math.max(256, dt * sr * 1.3)));
    const n = engine.bufL.length;
    if (rms(engine.bufL, n - count, n) + rms(engine.bufR, n - count, n) > 0.002) display.drawMusic(engine.bufL, engine.bufR, count, 1);
  }
  if (rollOpen()) rollView.draw();
  spectrum.update(engine.running ? engine.readSpectrum() : null, engine.sampleRate, dt);
  spectrum.draw();
  renderLoopRing();
  renderSteps();
  renderVoice(now);
  if (now - lastSlow > 120) {
    lastSlow = now;
    renderStatus();
    renderRecord(now);
    $('screenHint').classList.toggle('is-hidden', touched);
    $('startVeil').hidden = !engine.ctx || engine.ctx.state !== 'suspended';
  }
  requestAnimationFrame(frame);
}

function renderStatus() {
  const beat = engine.beatName ? `<b>${BEATS[engine.beatName].label.toUpperCase()}</b> ${engine.bpm.toFixed(0)} BPM` : 'NO BEAT';
  const sound = `${SOUNDS[settings.sound].label.toUpperCase()}${settings.chords ? ' CHORDS' : ''}`;
  const st = engine.loop;
  const loopText = st.state === 'empty' ? '' : ` · LOOP ${loopLength(st).toUpperCase()} · ${st.layers} LAYER${st.layers === 1 ? '' : 'S'}`;
  $('screenStatus').innerHTML = `${beat} · ${sound} · KEY ${KEY_NAMES[settings.key]}${loopText}`;
}

/* --------------------------------- controls -------------------------------- */

function formatFilter(v) {
  if (Math.abs(v - 0.5) < 0.04) return 'off';
  const { lp, hp } = filterSetting(v);
  const hz = (f) => (f >= 1000 ? `${(f / 1000).toFixed(1)}k` : `${Math.round(f)}`);
  return v < 0.5 ? `low ${hz(lp)}` : `high ${hz(hp)}`;
}

function wire() {
  // Sounds.
  for (const [i, g] of GROUPS.entries()) {
    const b = document.createElement('button');
    b.dataset.group = g.id;
    b.innerHTML = `${g.label}<kbd>${i + 1}</kbd>`;
    b.title = `${g.label} (${i + 1}; press again for the next one)`;
    b.addEventListener('click', () => pickGroup(g.id));
    $('groupSeg').appendChild(b);
  }
  for (const el of $('shapeKnobs').querySelectorAll('[data-shape]')) {
    const name = el.dataset.shape;
    const spec = SHAPE_KNOBS[name];
    shapeKnobs[name] = new Knob(el, {
      label: spec.label,
      value: settings.shape[name],
      def: 0.5,
      bipolar: true,
      small: true,
      hue: spec.hue,
      format: spec.format,
      onChange: (v) => {
        settings.shape[name] = v;
        engine.setShape(name, v);
        save();
      }
    });
  }
  $('chordBtn').addEventListener('click', () => setChords(!settings.chords));
  $('keyDown').addEventListener('click', () => setKey(settings.key - 1));
  $('keyUp').addEventListener('click', () => setKey(settings.key + 1));
  $('octDown').addEventListener('click', () => keys.setOctave(keys.octave - 1));
  $('octUp').addEventListener('click', () => keys.setOctave(keys.octave + 1));

  // Beat.
  const beatGrid = $('beatSeg');
  for (const [id, label] of [['', 'Off'], ...Object.entries(BEATS).map(([k, b]) => [k, b.label])]) {
    const b = document.createElement('button');
    b.dataset.beat = id;
    b.textContent = label;
    b.title = id ? `${label} · ${BEATS[id].tempo} BPM` : 'No beat';
    b.classList.toggle('is-on', id === '');
    b.addEventListener('click', () => setBeat(id));
    beatGrid.appendChild(b);
  }
  tempoKnob = new Knob($('tempoKnob'), {
    label: 'Tempo',
    value: (settings.bpm - TEMPO_MIN) / (TEMPO_MAX - TEMPO_MIN),
    def: (96 - TEMPO_MIN) / (TEMPO_MAX - TEMPO_MIN),
    hue: 320,
    format: (v) => `${Math.round(TEMPO_MIN + v * (TEMPO_MAX - TEMPO_MIN))} BPM`,
    onChange: (v) => {
      if (!engine.setTempo(TEMPO_MIN + v * (TEMPO_MAX - TEMPO_MIN))) {
        renderTempo(); // locked: spring back
        return;
      }
      settings.bpm = engine.bpm;
      save();
    }
  });
  buildSteps();

  // Loop.
  $('loopBtn').addEventListener('click', () => loop('press'));
  $('undoBtn').addEventListener('click', () => loop('undo'));
  $('redoBtn').addEventListener('click', () => loop('redo'));
  $('clearBtn').addEventListener('click', () => loop('clear'));
  $('stopBtn').addEventListener('click', () => loop('stop'));

  // Voice.
  $('phonesBtn').addEventListener('click', async () => {
    const on = !engine.headphones;
    $('phonesBtn').setAttribute('aria-pressed', String(on));
    await engine.setHeadphones(on);
    renderMic();
  });
  $('voiceLoopBtn').setAttribute('aria-pressed', String(settings.voiceToLoop));
  $('voiceLoopBtn').addEventListener('click', () => {
    settings.voiceToLoop = !settings.voiceToLoop;
    engine.setVoiceToLoop(settings.voiceToLoop);
    $('voiceLoopBtn').setAttribute('aria-pressed', String(settings.voiceToLoop));
    save();
  });
  $('micBtn').addEventListener('click', startMic);

  // Effects (for the live sound or the selected layer) and volume.
  for (const el of $('fxKnobs').querySelectorAll('[data-fx]')) {
    const name = el.dataset.fx;
    const spec = FX_KNOBS[name];
    fxKnobs[name] = new Knob(el, {
      label: spec.label,
      value: settings.fx[name] ?? spec.def ?? 0,
      def: spec.def ?? 0,
      bipolar: spec.bipolar,
      hue: spec.hue,
      format: spec.format,
      onChange: (v) => setFx(name, v)
    });
  }
  $('muteBtn').addEventListener('click', () => {
    if (fxTarget === 'live') return;
    const on = !engine.fxValues(fxTarget).mute;
    engine.setFx(fxTarget, 'mute', on);
    if (fxTarget === 'roll') {
      settings.roll.fx.mute = on;
      save();
    }
    $('muteBtn').setAttribute('aria-pressed', String(on));
    renderLayers(engine.loop);
  });
  $('volume').value = String(Math.round(settings.volume * 100));
  $('volume').addEventListener('input', (e) => {
    settings.volume = Number(e.target.value) / 100;
    engine.setVolume(settings.volume);
    save();
  });

  // Voice: Pitch and Tune.
  pitchKnob = new Knob($('pitchKnob'), {
    label: 'Pitch',
    value: settings.voicePitch,
    def: 0.5,
    bipolar: true,
    small: true,
    hue: 300,
    format: (v) => {
      const st = pitchSemis(v);
      return st === 0 ? 'off' : `${st > 0 ? '+' : '−'}${Math.abs(st)} st`;
    },
    onChange: (v) => {
      settings.voicePitch = v;
      setVoiceFx();
    }
  });
  tuneKnob = new Knob($('tuneKnob'), {
    label: 'Tune',
    value: settings.voiceTune,
    def: 0,
    small: true,
    hue: 175,
    format: (v) => (v < 0.01 ? 'off' : v > 0.97 ? 'hard' : `${Math.round(v * 100)}%`),
    onChange: (v) => {
      settings.voiceTune = v;
      setVoiceFx();
    }
  });

  // Performance pads: hold on screen, or Q / R / V.
  for (const b of $('pads').querySelectorAll('[data-pad]')) {
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
  window.addEventListener('keyup', (e) => {
    const pad = PAD_KEYS[e.code];
    if (pad) padUp(pad);
  });

  wireLibrary();
  wireRoll();

  $('recBtn').addEventListener('click', toggleRecord);
  $('breakawayKey').addEventListener('click', () => keys.toggleCapture());
  $('startBtn').addEventListener('click', boot);

  // Clicking a button shouldn't leave it focused: Space belongs to the looper.
  document.addEventListener('pointerup', (e) => {
    const b = e.target.closest?.('button');
    if (b && !b.classList.contains('knob-dial')) b.blur();
  });

  // Studio shortcuts, while the keyboard is the instrument's.
  window.addEventListener('keydown', (e) => {
    if (!keys.active || e.altKey) return;
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    // The usual undo and redo, alongside the studio's own keys.
    if (e.ctrlKey || e.metaKey) {
      // With the piano roll open, undo and redo are the roll's.
      if (e.code === 'KeyZ') {
        e.preventDefault();
        if (rollOpen()) rollHistory(e.shiftKey ? 'redo' : 'undo');
        else loop(e.shiftKey ? 'redo' : 'undo');
      } else if (e.code === 'KeyY') {
        e.preventDefault();
        if (rollOpen()) rollHistory('redo');
        else loop('redo');
      } else if (e.code === 'KeyS') {
        e.preventDefault();
        openLibrary(true);
      }
      return;
    }
    const digit = /^Digit([1-9])$/.exec(e.code);
    if (e.code === 'Space') {
      e.preventDefault();
      if (!e.repeat) loop('press');
    } else if (e.code === 'Backspace') {
      e.preventDefault();
      loop(e.shiftKey ? 'redo' : 'undo');
    } else if (e.code === 'Delete') {
      e.preventDefault();
      if (!rollOpen()) loop('clear'); // in the roll, notes are deleted with a right-click
    } else if (e.code === 'KeyN' && !e.repeat) {
      toggleRoll();
    } else if (e.code === 'KeyC' && !e.repeat) {
      setChords(!settings.chords);
    } else if (e.code === 'KeyB' && !e.repeat) {
      setBeat(engine.beatName ? '' : settings.lastBeat);
    } else if (PAD_KEYS[e.code]) {
      if (!e.repeat) padDown(PAD_KEYS[e.code]);
    } else if (digit && GROUPS[digit[1] - 1] && !e.repeat) {
      pickGroup(GROUPS[digit[1] - 1].id);
    }
  });
  // A space released on a focused button would click it too.
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space' && keys.active) e.preventDefault();
  });
}

/* -------------------------------- piano roll -------------------------------- */

const rollView = new RollView($('rollCanvas'), engine.pattern, {
  snap: () => settings.roll.snap,
  key: () => settings.key,
  chords: () => settings.chords,
  chordFor: (midi) => chordFor(midi, settings.key),
  playhead: () => engine.roll?.position() ?? null,
  preview: (midi, on) => engine.previewRoll(midi, on),
  changed: () => saveRoll()
});

const rollOpen = () => !$('roll').hidden;

function toggleRoll(open = !rollOpen()) {
  $('roll').hidden = !open;
  $('rollBtn').setAttribute('aria-pressed', String(open));
  $('pads').hidden = open;
  if (open) touched = true;
}

function saveRoll() {
  settings.roll.pattern = engine.pattern.toJSON();
  $('rollUndo').disabled = !engine.pattern.past.length;
  $('rollRedo').disabled = !engine.pattern.future.length;
  save();
}

function setRollPlaying(on) {
  engine.setRollPlaying(on);
  settings.roll.playing = on;
  $('rollPlay').setAttribute('aria-pressed', String(on));
  $('rollPlay').textContent = on ? '■ Stop' : '▶ Play';
}

function renderRollSegs() {
  for (const b of $('rollBars').children) b.classList.toggle('is-on', Number(b.dataset.bars) === engine.pattern.bars);
  for (const b of $('rollSnap').children) b.classList.toggle('is-on', Number(b.dataset.snap) === settings.roll.snap);
}

function applyRollSettings() {
  $('rollSound').value = settings.roll.sound;
  engine.setRollSound(settings.roll.sound);
  engine.setRollToLoop(settings.roll.toLoop);
  $('rollToLoop').setAttribute('aria-pressed', String(settings.roll.toLoop));
  engine.chain('roll').setAll(settings.roll.fx);
  renderRollSegs();
  saveRoll();
}

function wireRoll() {
  $('rollBtn').addEventListener('click', () => toggleRoll());
  $('rollClose').addEventListener('click', () => toggleRoll(false));
  $('rollPlay').addEventListener('click', () => setRollPlaying(!engine.rollPlaying));
  const select = $('rollSound');
  for (const g of GROUPS) {
    const group = document.createElement('optgroup');
    group.label = g.label;
    for (const [id, p] of Object.entries(SOUNDS)) {
      if (p.group !== g.id) continue;
      const o = document.createElement('option');
      o.value = id;
      o.textContent = p.label;
      group.appendChild(o);
    }
    select.appendChild(group);
  }
  select.addEventListener('change', () => {
    settings.roll.sound = select.value;
    engine.setRollSound(select.value);
    save();
    select.blur(); // give the keys back to the instrument
  });
  for (const bars of PATTERN_BARS) {
    const b = document.createElement('button');
    b.dataset.bars = String(bars);
    b.textContent = `${bars} bar${bars > 1 ? 's' : ''}`;
    b.addEventListener('click', () => {
      engine.pattern.checkpoint();
      engine.pattern.setBars(bars);
      engine.pattern.settle();
      renderRollSegs();
      saveRoll();
    });
    $('rollBars').appendChild(b);
  }
  for (const snap of SNAPS) {
    const b = document.createElement('button');
    b.dataset.snap = String(snap.steps);
    b.textContent = snap.label;
    b.title = `Snap to ${snap.label} notes`;
    b.addEventListener('click', () => {
      settings.roll.snap = snap.steps;
      renderRollSegs();
      save();
    });
    $('rollSnap').appendChild(b);
  }
  $('rollToLoop').addEventListener('click', () => {
    settings.roll.toLoop = !settings.roll.toLoop;
    engine.setRollToLoop(settings.roll.toLoop);
    $('rollToLoop').setAttribute('aria-pressed', String(settings.roll.toLoop));
    save();
  });
  $('rollQuantize').addEventListener('click', () => {
    engine.pattern.checkpoint();
    engine.pattern.quantize(settings.roll.snap);
    engine.pattern.settle();
    saveRoll();
  });
  $('rollUndo').addEventListener('click', () => rollHistory('undo'));
  $('rollRedo').addEventListener('click', () => rollHistory('redo'));
  const clear = $('rollClear');
  clear.addEventListener('click', () => {
    if (!clear.classList.contains('roll-clear-armed')) {
      clear.classList.add('roll-clear-armed');
      clear.textContent = 'Sure?';
      setTimeout(() => { clear.classList.remove('roll-clear-armed'); clear.textContent = 'Clear'; }, 3000);
      return;
    }
    clear.classList.remove('roll-clear-armed');
    clear.textContent = 'Clear';
    engine.pattern.checkpoint();
    engine.pattern.clear();
    engine.pattern.settle();
    saveRoll();
  });
}

function rollHistory(which) {
  if (engine.pattern[which]()) {
    renderRollSegs();
    saveRoll();
  }
}

/* ---------------------------------- pads ---------------------------------- */

const PAD_KEYS = { KeyQ: 'stutter2', KeyR: 'stutter1', KeyV: 'tape' };
const held = new Set();

function padDown(pad) {
  if (held.has(pad)) return;
  held.add(pad);
  if (pad === 'tape') engine.pad({ tape: true });
  else engine.pad({ stutter: pad === 'stutter2' ? 2 : 1 });
  $('pads').querySelector(`[data-pad="${pad}"]`)?.classList.add('is-held');
  touched = true;
}

function padUp(pad) {
  if (!held.delete(pad)) return;
  if (pad === 'tape') engine.pad({ tape: false });
  else if (![...held].some((p) => p.startsWith('stutter'))) engine.pad({ stutter: 0 });
  else engine.pad({ stutter: held.has('stutter2') ? 2 : 1 }); // the other stutter is still held
  $('pads').querySelector(`[data-pad="${pad}"]`)?.classList.remove('is-held');
}

/* --------------------------------- library --------------------------------- */

function libraryNote(text, bad = false) {
  const el = $('libraryNote');
  el.textContent = text;
  el.classList.toggle('is-bad', bad);
}

function openLibrary(saveNow = false) {
  const lib = $('library');
  lib.hidden = false;
  $('loopsBtn').setAttribute('aria-expanded', 'true');
  if (!$('saveName').value) $('saveName').value = defaultName();
  renderLibrary();
  if (saveNow) saveCurrent();
}

function closeLibrary() {
  $('library').hidden = true;
  $('loopsBtn').setAttribute('aria-expanded', 'false');
  document.activeElement?.blur?.();
}

/** Everything a saved loop needs besides its audio. */
function sessionNow() {
  return {
    sound: settings.sound,
    shape: { ...settings.shape },
    key: settings.key,
    chords: settings.chords,
    octave: keys.octave,
    liveFx: { ...settings.fx },
    voicePitch: settings.voicePitch,
    voiceTune: settings.voiceTune,
    roll: { ...settings.roll, pattern: engine.pattern.toJSON(), playing: engine.rollPlaying }
  };
}

async function saveCurrent() {
  if (!keptLayers(engine.loop)) {
    libraryNote('Record a loop first, then save it here.', true);
    return;
  }
  const name = ($('saveName').value || defaultName()).trim();
  try {
    const loop = await engine.exportLoop();
    if (!loop.layers.length) throw new Error('the loop is empty');
    const sr = engine.sampleRate;
    const meta = { name, saved: Date.now(), sampleRate: sr, length: loop.length, bpm: engine.bpm, beat: engine.beatName, session: sessionNow() };
    const bytes = encodeProject(meta, loop.layers, loop.layers.map((_, k) => engine.fxValues(k)));
    await saveLoop({ name, saved: meta.saved, seconds: loop.length / sr, bpm: engine.bpm, beat: engine.beatName, layers: loop.layers.length }, bytes);
    libraryNote(`Saved “${name}”.`);
    $('saveName').value = defaultName();
    renderLibrary();
  } catch (err) {
    libraryNote(`Couldn't save: ${err.message ?? err}`, true);
  }
}

/** Load a .prism file's bytes: the loop, its effects, beat, tempo and sound. */
async function openProject(bytes) {
  const { meta, layers, layerFx } = decodeProject(bytes);
  await engine.start();
  const sr = engine.sampleRate;
  const fitted = layers.map((l) => resample(l, meta.sampleRate || sr, sr));
  const length = fitted[0]?.length ?? 0;
  const ss = meta.session ?? {};

  // The sound you were playing.
  if (ss.sound in SOUNDS) setSound(ss.sound);
  if (ss.shape) {
    settings.shape = { ...SHAPE_DEFAULT, ...ss.shape };
    for (const [k, knob] of Object.entries(shapeKnobs)) {
      knob.set(settings.shape[k], false);
      engine.setShape(k, settings.shape[k]);
    }
  }
  if (Number.isInteger(ss.key)) setKey(ss.key);
  if (typeof ss.chords === 'boolean') setChords(ss.chords);
  if (Number.isInteger(ss.octave)) keys.setOctave(ss.octave);
  if (ss.liveFx) {
    settings.fx = { ...FX_DEFAULTS, ...ss.liveFx, mute: false };
    for (const [name, v] of Object.entries(settings.fx)) engine.setFx('live', name, v);
  }
  if (Number.isFinite(ss.voicePitch)) settings.voicePitch = ss.voicePitch;
  if (Number.isFinite(ss.voiceTune)) settings.voiceTune = ss.voiceTune;
  setVoiceFx();
  if (ss.roll) {
    settings.roll = { ...settings.roll, ...ss.roll, fx: { ...FX_DEFAULTS, ...ss.roll.fx } };
    if (!(settings.roll.sound in SOUNDS)) settings.roll.sound = 'pluck';
    engine.pattern.load(ss.roll.pattern);
    applyRollSettings();
  }

  // Beat and tempo first, so the loop lands on the beat's grid.
  const beat = meta.beat in BEATS ? meta.beat : null;
  engine.loadBeat(beat, meta.bpm);
  if (beat) settings.lastBeat = beat;
  for (const b of $('beatSeg').querySelectorAll('button')) b.classList.toggle('is-on', b.dataset.beat === (beat ?? ''));
  settings.bpm = engine.bpm;

  fitted.forEach((_, k) => engine.chain(k).setAll({ ...FX_DEFAULTS, ...layerFx[k] }));
  await engine.importLoop(fitted, length);
  if (ss.roll) setRollPlaying(!!ss.roll.playing);
  selectFxTarget('live');
  refreshVoiceKnobs();
  save();
  touched = true;
  return meta;
}

async function renderLibrary() {
  const list = $('libraryList');
  let loops = [];
  try {
    loops = await listLoops();
  } catch (err) {
    libraryNote(`The loop library isn't available: ${err.message ?? err}`, true);
  }
  list.innerHTML = '';
  if (!loops.length) {
    const li = document.createElement('li');
    li.className = 'library-empty';
    li.textContent = 'No saved loops yet.';
    list.appendChild(li);
    return;
  }
  for (const entry of loops) {
    const li = document.createElement('li');
    li.className = 'library-item';
    const when = new Date(entry.saved).toLocaleString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const beat = entry.beat ? `${BEATS[entry.beat]?.label ?? entry.beat} ${Math.round(entry.bpm)} BPM` : 'no beat';
    li.innerHTML = `<div class="lib-name"></div><div class="lib-info"></div>
      <div class="lib-actions"><button class="pill lib-load">Load</button><button class="pill lib-export" title="Save as a .prism file">File</button><button class="pill lib-delete">Delete</button></div>`;
    li.querySelector('.lib-name').textContent = entry.name;
    li.querySelector('.lib-info').textContent = `${entry.layers} layer${entry.layers === 1 ? '' : 's'} · ${entry.seconds.toFixed(1)} s · ${beat} · ${when}`;
    li.querySelector('.lib-load').addEventListener('click', async () => {
      try {
        await openProject(await loadLoop(entry.id));
        libraryNote(`Loaded “${entry.name}”.`);
      } catch (err) {
        libraryNote(`Couldn't load it: ${err.message ?? err}`, true);
      }
    });
    li.querySelector('.lib-export').addEventListener('click', async () => {
      const bytes = await loadLoop(entry.id);
      download(new Blob([bytes], { type: 'application/octet-stream' }), fileNameFor(entry.name));
    });
    const del = li.querySelector('.lib-delete');
    del.addEventListener('click', async () => {
      // Two clicks: a deleted loop is gone.
      if (del.dataset.armed !== '1') {
        del.dataset.armed = '1';
        del.textContent = 'Sure?';
        setTimeout(() => { del.dataset.armed = ''; del.textContent = 'Delete'; }, 3000);
        return;
      }
      await deleteLoop(entry.id);
      libraryNote(`Deleted “${entry.name}”.`);
      renderLibrary();
    });
    list.appendChild(li);
  }
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

function wireLibrary() {
  $('loopsBtn').addEventListener('click', () => ($('library').hidden ? openLibrary() : closeLibrary()));
  $('libraryClose').addEventListener('click', closeLibrary);
  $('saveForm').addEventListener('submit', (e) => {
    e.preventDefault();
    saveCurrent();
  });
  $('importBtn').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const meta = await openProject(bytes);
      // Keep it in the library too, so it's one click next time.
      await saveLoop({ name: meta.name || file.name, saved: Date.now(), seconds: meta.length / meta.sampleRate, bpm: meta.bpm, beat: meta.beat, layers: meta.layers.length }, bytes);
      libraryNote(`Opened “${meta.name || file.name}” and added it to your loops.`);
      renderLibrary();
    } catch (err) {
      libraryNote(`Couldn't open ${file.name}: ${err.message ?? err}`, true);
    }
  });
}

/* --------------------------------- storage --------------------------------- */

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? '{}');
  } catch {
    return {};
  }
}

let saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORE, JSON.stringify(settings)); } catch { /* not persisted */ }
  }, 300);
}

/* ---------------------------------- start ---------------------------------- */

async function boot() {
  await engine.start();
  if (engine.ctx.state === 'suspended') await engine.ctx.resume().catch(() => {});
  if (!engine.micOn) await startMic();
}

engine.onLoop = renderLoop;
engine.onStep = (s, t) => stepQueue.push({ s, t });

wireWindowChrome();
buildKeybed();
wire();
setSound(settings.sound);
setChords(settings.chords);
refreshKeyLabels();
renderKeyState(keys.state());
renderLoop(engine.loop);
renderMic();
for (const [name, v] of Object.entries(settings.fx)) engine.setFx('live', name, v);
selectFxTarget('live');
engine.setVolume(settings.volume);
engine.setVoiceFx(pitchSemis(settings.voicePitch), settings.voiceTune);
applyRollSettings();
midi.connect();
boot();
requestAnimationFrame(frame);
