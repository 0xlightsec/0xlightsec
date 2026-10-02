/**
 * Studio: sing to move the circles, and make music with one hand.
 *
 *   Voice   your mic drives the upper circle; on headphones you hear it with the FX
 *   Loop    one button: record, loop, add layers (Space); Undo, Redo and Clear
 *   Beat    pick a groove; loops snap to its bars
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
  volume: 0.8,
  fx: { ...FX_DEFAULTS },
  ...load()
};
if (!(settings.sound in SOUNDS)) settings.sound = 'keys';
settings.fx = { ...FX_DEFAULTS, ...settings.fx, mute: false };
settings.shape = { ...SHAPE_DEFAULT, ...settings.shape };
if (!(settings.lastBeat in BEATS)) settings.lastBeat = 'groove';

const engine = new StudioEngine();
engine.bpm = settings.bpm;
engine.volume = settings.volume;
engine.voiceToLoop = settings.voiceToLoop;

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
  if (!engine.micOn || now - lastPitchAt < 50) return;
  lastPitchAt = now;
  const buf = engine.buf2.subarray(n - PITCH_WINDOW);
  if (rms(buf) < VOICE_GATE) return;
  const hit = detectPitch(buf, engine.sampleRate);
  if (!hit || hit.clarity < 0.85 || hit.hz < 60 || hit.hz > 1500) return;
  voice.hz = voice.hz && now - voice.at < VOICE_HOLD_MS * 2 ? voice.hz * Math.pow(hit.hz / voice.hz, 0.5) : hit.hz;
  voice.at = now;
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
      b.textContent = p.label;
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
  $('fxWho').textContent = target === 'live' ? 'what you play' : `layer ${target + 1} only`;
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
  for (let i = 0; i < kept; i++) add(String(i + 1), i, `Layer ${i + 1}'s own effects`);
}

function setFx(name, value) {
  engine.setFx(fxTarget, name, value);
  if (fxTarget === 'live') {
    settings.fx[name] = value;
    save();
  }
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
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `PRISM song ${stamp}.${ext}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
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
  for (const b of $('beatSeg').querySelectorAll('button')) b.addEventListener('click', () => setBeat(b.dataset.beat));
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
    $('muteBtn').setAttribute('aria-pressed', String(on));
    renderLayers(engine.loop);
  });
  new Knob($('volumeKnob'), {
    label: 'Volume',
    value: settings.volume,
    def: 0.8,
    hue: 0,
    format: (v) => `${Math.round(v * 100)}%`,
    onChange: (v) => {
      settings.volume = v;
      engine.setVolume(v);
      save();
    }
  });

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
      if (e.code === 'KeyZ') {
        e.preventDefault();
        loop(e.shiftKey ? 'redo' : 'undo');
      } else if (e.code === 'KeyY') {
        e.preventDefault();
        loop('redo');
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
      loop('clear');
    } else if (e.code === 'KeyC' && !e.repeat) {
      setChords(!settings.chords);
    } else if (e.code === 'KeyB' && !e.repeat) {
      setBeat(engine.beatName ? '' : settings.lastBeat);
    } else if (digit && GROUPS[digit[1] - 1] && !e.repeat) {
      pickGroup(GROUPS[digit[1] - 1].id);
    }
  });
  // A space released on a focused button would click it too.
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space' && keys.active) e.preventDefault();
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
midi.connect();
boot();
requestAnimationFrame(frame);
