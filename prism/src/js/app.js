/**
 * PRISM — wiring.
 *
 * Input (MIDI / microphone / computer keyboard) feeds one voice model. Every frame
 * the sounding voices are analysed against the Circle of Fifths and the resulting
 * palette drives the stage, the wheel and the heads-up readout.
 */

import { analyze, tensionLabel, PALETTES } from './theory/harmony.js';
import { nameChord } from './theory/chords.js';
import { pitchClass, noteName, angleDelta, clamp, css } from './theory/circle.js';
import { Stage } from './render/stage.js';
import { Wheel } from './render/wheel.js';
import { Synth } from './io/synth.js';
import { MidiInput } from './io/midi.js';
import { AudioInput } from './io/audio-in.js';
import { KeyboardInstrument, WHITE_KEYS, BLACK_KEYS } from './io/keyboard.js';
import { wireWindowChrome, renderFocusBadge, trackFocus } from './chrome.js';

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'prism.settings.v1';

/* --------------------------------- state --------------------------------- */

const settings = {
  mode: 'crystal',
  palette: 'spectral',
  rotation: 0,
  brightness: 1,
  trail: 0.45,
  spin: 6,
  waveform: 'sawtooth',
  volume: 0.5,
  space: 0.35,
  release: 0.32,
  micSensitivity: 0.5,
  octave: 4,
  velocity: 0.8,
  ...loadSettings()
};

/** midi -> { midi, pc, velocity, gate, env, sources:Set, age } */
const voices = new Map();
let lastChordKey = '';
/** Notes that arrived this frame and still need their particle burst. */
const pendingStrikes = [];
let lastEventAt = 0;
let latencyMs = 0;
let fps = 0;
let sourceLabel = 'keyboard';

const stage = new Stage($('stage'));
const wheel = new Wheel($('wheel'));
const synth = new Synth();

/* --------------------------------- voices -------------------------------- */

function noteOn(midi, velocity, source) {
  if (midi < 0 || midi > 127) return;
  let v = voices.get(midi);
  if (!v) {
    v = { midi, pc: pitchClass(midi), velocity, gate: true, env: 0, sources: new Set(), age: 0 };
    voices.set(midi, v);
  }
  v.sources.add(source);
  v.gate = true;
  v.velocity = Math.max(v.velocity, velocity);
  v.age = 0;
  lastEventAt = performance.now();
  sourceLabel = source;
  synth.noteOn(midi, velocity);
  pendingStrikes.push(v);
}

function noteOff(midi, source) {
  const v = voices.get(midi);
  if (!v) return;
  v.sources.delete(source);
  if (v.sources.size) return;
  v.gate = false;
  synth.noteOff(midi);
}

function allNotesOff(source) {
  for (const [midi, v] of [...voices]) {
    if (source && !v.sources.has(source)) continue;
    noteOff(midi, source ?? [...v.sources][0]);
  }
}

function updateVoices(dt) {
  for (const [midi, v] of voices) {
    const target = v.gate ? 1 : 0;
    const rate = v.gate ? 30 : 1 / Math.max(settings.release, 0.05);
    v.env += (target - v.env) * Math.min(1, dt * rate);
    v.age += dt;
    if (!v.gate && v.env < 0.004) voices.delete(midi);
  }
}

/* ------------------------------- input wiring ----------------------------- */

const keys = new KeyboardInstrument({
  onNoteOn: (midi, velocity) => noteOn(midi, velocity, 'keyboard'),
  onNoteOff: (midi) => noteOff(midi, 'keyboard'),
  onState: (state) => renderKeyboardState(state),
  onBreakaway: () => {
    allNotesOff('keyboard');
    $('releaseVeil').hidden = false;
  },
  onRearm: () => {
    $('releaseVeil').hidden = true;
    synth.ensure();
  }
});
keys.octave = settings.octave;
keys.velocity = settings.velocity;
keys.attach();

const midi = new MidiInput({
  onNoteOn: (note, velocity) => noteOn(note, velocity, 'midi'),
  onNoteOff: (note) => noteOff(note, 'midi'),
  onSustained: () => {},
  onSustain: (down) => {
    if (!down) for (const [m, v] of [...voices]) if (v.sources.has('midi') && !midi.held.has(m)) noteOff(m, 'midi');
  },
  onStatus: (status, devices, detail) => renderMidiStatus(status, devices, detail)
});

const mic = new AudioInput({
  onNoteOn: (note, velocity) => {
    const v = voices.get(note);
    if (!v) {
      voices.set(note, { midi: note, pc: pitchClass(note), velocity, gate: true, env: 0, sources: new Set(['mic']), age: 0 });
      lastEventAt = performance.now();
      sourceLabel = 'mic';
      pendingStrikes.push(voices.get(note));
    } else {
      v.sources.add('mic');
      v.gate = true;
    }
  },
  onNoteOff: (note) => noteOff(note, 'mic'),
  onStatus: (status, detail) => renderMicStatus(status, detail)
});

/* --------------------------------- keybed -------------------------------- */

function buildKeybed() {
  const bed = $('keybed');
  bed.innerHTML = '';

  for (const key of WHITE_KEYS) {
    bed.appendChild(makeKey(key, 'white'));
  }
  for (const key of BLACK_KEYS) {
    const el = makeKey(key, 'black');
    el.style.setProperty('--after', String(key.after));
    bed.appendChild(el);
  }
  refreshKeyLabels();
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
    synth.ensure();
    keys.pressVirtual(key.code);
  });
  const release = () => keys.releaseVirtual(key.code);
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
  el.addEventListener('lostpointercapture', release);
  return el;
}

function refreshKeyLabels() {
  for (const el of document.querySelectorAll('.key')) {
    const midiNote = keys.midiFor(el.dataset.code);
    const label = el.querySelector('.key-note');
    if (label) label.textContent = midiNote === null ? '' : noteName(midiNote);
    el.title = midiNote === null ? '' : noteName(midiNote);
  }
  $('octValue').textContent = `C${keys.octave}`;
}

/** Paint the pressed keys with the colour the harmony engine assigned them. */
function paintKeys(analysis) {
  for (const el of document.querySelectorAll('.key')) {
    const code = el.dataset.code;
    const midiNote = keys.midiFor(code);
    const voice = midiNote === null ? null : voices.get(midiNote);
    const down = !!(voice && voice.gate);
    el.classList.toggle('is-down', down);
    if (down) {
      const color = analysis.colors.get(midiNote);
      if (color) {
        el.style.setProperty('--tint', css(color, 1));
        el.style.setProperty('--glow', css({ ...color, l: Math.min(color.l + 0.12, 0.92) }, 0.85));
        el.style.color = '';
      }
    } else {
      el.style.removeProperty('--tint');
      el.style.removeProperty('--glow');
    }
  }
}

/* ----------------------------- state rendering ---------------------------- */

function renderKeyboardState(state) {
  const breakaway = $('breakawayKey');
  renderFocusBadge(state);

  breakaway.dataset.state = state.captured ? 'captured' : 'released';
  $('breakawayTitle').textContent = state.captured ? 'Breakaway' : 'Re-arm';
  $('breakawaySub').textContent = state.captured ? 'release keyboard' : 'capture keyboard';
  $('breakawayKbd').textContent = state.captured ? 'esc' : 'enter';

  $('dock').classList.toggle('is-released', !state.captured);
  $('releaseVeil').hidden = state.captured;

  $('octValue').textContent = `C${state.octave}`;
  $('velocity').value = String(Math.round(state.velocity * 100));
  settings.octave = state.octave;
  settings.velocity = state.velocity;
  saveSettings();
}

function renderMidiStatus(status, devices, detail) {
  const el = $('midiStatus');
  const select = $('midiSelect');
  const messages = {
    connected: `MIDI: ${devices.length} device${devices.length === 1 ? '' : 's'}`,
    'no-devices': 'MIDI: no devices found',
    unsupported: 'MIDI: not supported in this build',
    denied: `MIDI: permission denied${detail ? ' — ' + detail : ''}`,
    unavailable: `MIDI: not available on this system${detail ? ' — ' + detail : ''}`,
    idle: 'MIDI: not connected'
  };
  el.textContent = messages[status] ?? `MIDI: ${status}`;
  el.classList.toggle('is-ok', status === 'connected');
  el.classList.toggle('is-bad', status === 'denied' || status === 'unsupported' || status === 'unavailable');

  const previous = select.value;
  select.innerHTML = '<option value="all">All devices</option>';
  for (const d of devices ?? []) {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = d.name || d.id;
    select.appendChild(opt);
  }
  if ([...select.options].some((o) => o.value === previous)) select.value = previous;
}

function renderMicStatus(status, detail) {
  const el = $('micStatus');
  const messages = {
    listening: 'Mic: listening',
    idle: 'Mic: off',
    denied: `Mic: permission denied${detail ? ' — ' + detail : ''}`
  };
  el.textContent = messages[status] ?? `Mic: ${status}`;
  el.classList.toggle('is-ok', status === 'listening');
  el.classList.toggle('is-bad', status === 'denied');
  $('micToggle').checked = status === 'listening';
}

function renderReadout(analysis, gated) {
  $('tensionFill').style.width = `${(analysis.tension * 100).toFixed(1)}%`;
  $('tensionValue').textContent = analysis.tension.toFixed(2);
  $('tensionLabel').textContent = gated.length ? tensionLabel(analysis.tension) : '—';

  const key = gated.map((v) => v.midi).sort((a, b) => a - b).join(',');
  if (key === lastChordKey) return;
  lastChordKey = key;

  const chord = nameChord(gated.map((v) => v.midi));
  $('chordName').textContent = chord ? chord.name : '—';
  $('chordQuality').textContent = chord ? chord.quality : 'silent';

  $('statVoices').textContent = String(gated.length);
  $('statSpan').textContent = String(analysis.span);
  $('statMean').textContent = analysis.meanDistance.toFixed(1);

  const hues = gated.map((v) => analysis.colors.get(v.midi)?.h).filter((h) => h !== undefined);
  let spread = 0;
  for (let i = 0; i < hues.length; i++)
    for (let j = i + 1; j < hues.length; j++) spread = Math.max(spread, Math.abs(angleDelta(hues[i], hues[j])));
  $('statSpread').textContent = `${Math.round(spread)}°`;

  const box = $('swatches');
  box.innerHTML = '';
  for (const v of [...gated].sort((a, b) => a.midi - b.midi)) {
    const color = analysis.colors.get(v.midi);
    if (!color) continue;
    const sw = document.createElement('div');
    sw.className = 'swatch';
    sw.style.background = css(color, 1);
    sw.style.color = css(color, 0.8);
    sw.title = `${noteName(v.midi)} · hue ${Math.round(color.h)}°`;
    box.appendChild(sw);
  }

  const mark = $('brandMark');
  if (gated.length) {
    mark.style.background = css({ h: analysis.centroidHue, s: clamp(0.2 + analysis.tension * 0.7), l: 0.62 }, 1);
    mark.style.boxShadow = `0 0 18px ${css({ h: analysis.centroidHue, s: 0.8, l: 0.6 }, 0.7)}`;
  } else {
    mark.style.background = '';
    mark.style.boxShadow = '';
  }
}

/** Title and ratio above the curve modes, rewritten only when the figure changes. */
let lastHarmonicKey = '';
function renderHarmonicHead() {
  const fig = stage.harmonic.current;
  if (!fig || (settings.mode !== 'lissajous' && settings.mode !== 'orbital') || fig.key === lastHarmonicKey) return;
  lastHarmonicKey = fig.key;
  $('harmonicTitle').textContent = fig.title;
  $('harmonicRatio').textContent = fig.ratioText;
}

/* --------------------------------- loop ---------------------------------- */

let lastFrame = performance.now();

function frame(now) {
  const dt = Math.min((now - lastFrame) / 1000, 0.1);
  lastFrame = now;
  fps += (1 / Math.max(dt, 0.0001) - fps) * 0.06;

  mic.poll();
  updateVoices(dt);

  const list = [...voices.values()];
  const gated = list.filter((v) => v.gate);
  const colorOpts = { palette: settings.palette, rotation: settings.rotation, brightness: settings.brightness };

  // The stage shows everything still sounding, release tails included...
  const analysis = analyze(
    list.map((v) => ({ midi: v.midi, weight: v.velocity * Math.max(v.env, 0.05) })),
    colorOpts
  );
  // ...while the readout, wheel and key caps describe only what is being held,
  // so the chord name and its numbers always agree with each other.
  const played = gated.length === list.length
    ? analysis
    : analyze(gated.map((v) => ({ midi: v.midi, weight: v.velocity })), colorOpts);

  while (pendingStrikes.length) stage.strike(pendingStrikes.shift(), analysis);

  stage.draw(list, analysis, dt);
  renderHarmonicHead();
  wheel.draw(new Set(gated.map((v) => v.pc)), played);
  renderReadout(played, gated);
  paintKeys(played);

  if (lastEventAt) {
    // Measured now, not from the rAF timestamp: that marks the start of the frame
    // and can predate an event that arrived while the frame was already running.
    latencyMs = Math.max(0, performance.now() - lastEventAt);
    lastEventAt = 0;
    $('latencyReadout').textContent = `${(latencyMs + synth.latencyMs).toFixed(1)} ms`;
    $('sourceReadout').textContent = sourceLabel;
  }
  $('fpsReadout').textContent = `${fps.toFixed(0)} fps`;

  requestAnimationFrame(frame);
}

/* --------------------------------- controls ------------------------------- */

function setMode(mode) {
  settings.mode = mode;
  stage.setMode(mode);
  $('stageWrap').classList.toggle('mode-field', mode === 'field');
  $('stageWrap').classList.toggle('mode-curve', mode === 'lissajous' || mode === 'orbital');
  for (const btn of document.querySelectorAll('.mode')) {
    const on = btn.dataset.mode === mode;
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-selected', String(on));
  }
  saveSettings();
}

function wireControls() {
  for (const btn of document.querySelectorAll('.mode')) {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  }

  const paletteSelect = $('paletteSelect');
  for (const [id, p] of Object.entries(PALETTES)) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = p.label;
    paletteSelect.appendChild(opt);
  }
  paletteSelect.value = settings.palette;
  paletteSelect.addEventListener('change', () => {
    settings.palette = paletteSelect.value;
    saveSettings();
  });

  $('rotation').addEventListener('input', (e) => {
    settings.rotation = Number(e.target.value);
    wheel.rotation = settings.rotation;
    $('rotationValue').textContent = `${settings.rotation}°`;
    saveSettings();
  });

  $('brightness').addEventListener('input', (e) => {
    settings.brightness = Number(e.target.value) / 100;
    stage.brightness = settings.brightness;
    $('brightnessValue').textContent = `${e.target.value}%`;
    saveSettings();
  });

  $('trail').addEventListener('input', (e) => {
    settings.trail = Number(e.target.value) / 100;
    stage.trail = settings.trail;
    $('trailValue').textContent = `${e.target.value}%`;
    saveSettings();
  });

  $('spin').addEventListener('input', (e) => {
    settings.spin = Number(e.target.value);
    stage.spin = settings.spin / 200;
    $('spinValue').textContent = (settings.spin / 200).toFixed(2);
    saveSettings();
  });

  $('waveform').addEventListener('change', (e) => {
    settings.waveform = e.target.value;
    synth.waveform = settings.waveform;
    saveSettings();
  });

  $('volume').addEventListener('input', (e) => {
    settings.volume = Number(e.target.value) / 100;
    synth.setVolume(settings.volume);
    $('volumeValue').textContent = `${e.target.value}%`;
    saveSettings();
  });

  $('space').addEventListener('input', (e) => {
    settings.space = Number(e.target.value) / 100;
    synth.setSpace(settings.space);
    $('spaceValue').textContent = `${e.target.value}%`;
    saveSettings();
  });

  $('release').addEventListener('input', (e) => {
    settings.release = Number(e.target.value) / 100;
    synth.release = settings.release;
    $('releaseValue').textContent = `${settings.release.toFixed(2)}s`;
    saveSettings();
  });

  $('velocity').addEventListener('input', (e) => keys.setVelocity(Number(e.target.value) / 100));
  $('octDown').addEventListener('click', () => { keys.setOctave(keys.octave - 1); refreshKeyLabels(); });
  $('octUp').addEventListener('click', () => { keys.setOctave(keys.octave + 1); refreshKeyLabels(); });

  $('midiConnect').addEventListener('click', () => midi.connect());
  $('midiSelect').addEventListener('change', (e) => midi.select(e.target.value));

  $('micToggle').addEventListener('change', async (e) => {
    if (e.target.checked) {
      const ok = await mic.start();
      if (!ok) e.target.checked = false;
    } else {
      mic.stop();
    }
  });
  $('micSensitivity').addEventListener('input', (e) => {
    settings.micSensitivity = Number(e.target.value) / 100;
    mic.sensitivity = settings.micSensitivity;
    saveSettings();
  });

  const settingsPanel = $('settings');
  $('settingsBtn').addEventListener('click', () => { settingsPanel.hidden = !settingsPanel.hidden; });
  $('settingsClose').addEventListener('click', () => { settingsPanel.hidden = true; });

  $('breakawayKey').addEventListener('click', () => { synth.ensure(); keys.toggleCapture(); });
  $('veilRearm').addEventListener('click', () => { synth.ensure(); keys.rearm(); });

  // Clicking the stage takes the keyboard back and unlocks audio.
  $('stageWrap').addEventListener('pointerdown', (e) => {
    if (e.target.closest('.hud')) return;
    synth.ensure();
    keys.rearm();
  });


  // App-level shortcuts that sit outside the note map.
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLElement && /input|select|textarea/i.test(e.target.tagName)) return;
    if (e.code === 'Digit1') setMode('crystal');
    else if (e.code === 'Digit2') setMode('field');
    else if (e.code === 'Digit3') setMode('prism');
    else if (e.code === 'Digit4') setMode('lissajous');
    else if (e.code === 'Digit5') setMode('orbital');
    else if (e.code === 'Backquote') { e.preventDefault(); $('app').classList.toggle('is-bare'); }
    else if (e.code === 'F11') { e.preventDefault(); window.prism?.toggleFullscreen(); }
    else return;
  });

  window.addEventListener('resize', () => { stage.resize(); wheel.resize(); });
  trackFocus(keys);
}

/* -------------------------------- settings -------------------------------- */

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

let saveTimer = 0;
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(settings));
    } catch { /* storage unavailable — settings just won't persist */ }
  }, 400);
}

function applySettings() {
  setMode(settings.mode);
  stage.brightness = settings.brightness;
  stage.trail = settings.trail;
  stage.spin = settings.spin / 200;
  wheel.rotation = settings.rotation;
  synth.waveform = settings.waveform;
  synth.volume = settings.volume;
  synth.space = settings.space;
  synth.release = settings.release;
  mic.sensitivity = settings.micSensitivity;

  $('rotation').value = String(settings.rotation);
  $('rotationValue').textContent = `${settings.rotation}°`;
  $('brightness').value = String(Math.round(settings.brightness * 100));
  $('brightnessValue').textContent = `${Math.round(settings.brightness * 100)}%`;
  $('trail').value = String(Math.round(settings.trail * 100));
  $('trailValue').textContent = `${Math.round(settings.trail * 100)}%`;
  $('spin').value = String(settings.spin);
  $('spinValue').textContent = (settings.spin / 200).toFixed(2);
  $('waveform').value = settings.waveform;
  $('volume').value = String(Math.round(settings.volume * 100));
  $('volumeValue').textContent = `${Math.round(settings.volume * 100)}%`;
  $('space').value = String(Math.round(settings.space * 100));
  $('spaceValue').textContent = `${Math.round(settings.space * 100)}%`;
  $('release').value = String(Math.round(settings.release * 100));
  $('releaseValue').textContent = `${settings.release.toFixed(2)}s`;
  $('micSensitivity').value = String(Math.round(settings.micSensitivity * 100));
  $('velocity').value = String(Math.round(settings.velocity * 100));
}

/* --------------------------------- start --------------------------------- */

wireWindowChrome();

buildKeybed();
wireControls();
applySettings();
renderKeyboardState(keys.state());
midi.connect();
requestAnimationFrame(frame);
