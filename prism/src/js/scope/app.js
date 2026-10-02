/**
 * Oscilloscope page: a wave generator on CH1, your voice on CH2.
 *
 * Play the generator from the computer keyboard or MIDI, turn on the mic and sing.
 * Y-T shows both signals against time, triggered so they stand still; X-Y plots
 * one against the other, so singing an interval over a held note draws its
 * Lissajous figure. The readout measures each channel and tells you how far your
 * voice sits from the nearest just interval above or below the wave.
 */

import { ScopeEngine, WAVEFORMS } from './engine.js';
import { ScopeDisplay, MiniTrace, CHANNEL_HUE, TRIGGER_DIV } from './display.js';
import { findTrigger, peakToPeak, rms, toDb } from './measure.js';
import { detectPitch } from '../io/audio-in.js';
import { KeyboardInstrument } from '../io/keyboard.js';
import { MidiInput } from '../io/midi.js';
import { noteName, freqToMidi, clamp } from '../theory/circle.js';
import { pianoFrequency } from '../theory/piano.js';
import { ratioForSemitones, intervalTitle } from '../theory/ratios.js';
import { nameChord } from '../theory/chords.js';
import { wireWindowChrome, renderFocusBadge, trackFocus } from '../chrome.js';

const $ = (id) => document.getElementById(id);
const VOLTS = [1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01, 0.005];   // per division, 1-2-5 like a real scope
const TIMES = [0.1, 0.2, 0.5, 1, 2, 5, 10];                 // ms per division
const CH_POSITION = { 1: 1.8, 2: -1.8 };                     // divisions above/below centre in Y-T
const WAVE_LABEL = { sine: 'sine', triangle: 'triangle', sawtooth: 'saw', square: 'square' };
const PITCH_WINDOW = 2048;
const VOICE_GATE = 0.003;       // rms below which there is no voice to track
const VOICE_CLARITY = 0.85;
const VOICE_HOLD_MS = 180;      // keep the last pitch briefly so the readout doesn't flicker
const STORE = 'prism.scope.v1';

const settings = {
  display: 'shapes',
  waveform: 'sawtooth',
  time: 4,
  ch1: 2,
  ch2: 4,
  trigger: 'auto',
  persist: 0.55,
  latch: false,
  volume: 0.4,
  octave: 4,
  velocity: 0.8,
  ...load()
};

const engine = new ScopeEngine();
const display = new ScopeDisplay($('grid'), $('beam'));
const mini1 = new MiniTrace($('ch1Mini'), CHANNEL_HUE[1]);
const mini2 = new MiniTrace($('ch2Mini'), CHANNEL_HUE[2]);

let running = true;
const voice = { hz: 0, clarity: 0, at: 0 };
let lastPitchAt = 0;
let lastReadoutAt = 0;
let triggered = false;
let autoTrigger = 1;
/** Volts per division Shapes is currently using for each channel (auto-fit). */
const fitScale = { 1: 0.2, 2: 0.05 };
const FIT_RADIUS = { single: 3.3, pair: 2.1 }; // divisions from centre to the shape's edge

/* --------------------------------- playing -------------------------------- */

function play(midi, velocity) {
  if (settings.latch && engine.voices.has(midi)) engine.noteOff(midi);
  else engine.noteOn(midi, velocity);
}

function release(midi) {
  if (!settings.latch) engine.noteOff(midi);
}

const keys = new KeyboardInstrument({
  onNoteOn: (m, v) => play(m, v),
  onNoteOff: (m) => release(m),
  onState: (state) => renderKeyState(state),
  onRearm: () => engine.ensure()
});
keys.octave = settings.octave;
keys.velocity = settings.velocity;
keys.attach();
trackFocus(keys);

const midi = new MidiInput({
  onNoteOn: (m, v) => play(m, v),
  onNoteOff: (m) => release(m),
  onSustain: () => {}
});

function renderKeyState(state) {
  renderFocusBadge(state);
  const btn = $('breakawayBtn');
  btn.dataset.state = state.captured ? 'captured' : 'released';
  btn.firstChild.textContent = state.captured ? 'Breakaway ' : 'Re-arm ';
  $('breakawayKbd').textContent = state.captured ? 'esc' : 'enter';
  $('octValue').textContent = `C${state.octave}`;
  settings.octave = state.octave;
  settings.velocity = state.velocity;
  save();
}

/* ------------------------------- measurement ------------------------------ */

function trackVoice(now) {
  if (!engine.micOn || now - lastPitchAt < 50) return;
  lastPitchAt = now;
  const buf = engine.buf2.subarray(engine.buf2.length - PITCH_WINDOW);
  if (rms(buf) < VOICE_GATE) return;
  const hit = detectPitch(buf, engine.sampleRate);
  if (!hit || hit.clarity < VOICE_CLARITY || hit.hz < 60 || hit.hz > 1500) return;
  // Smooth in the log domain so a glide moves evenly through the cents.
  voice.hz = voice.hz && now - voice.at < VOICE_HOLD_MS * 2 ? voice.hz * Math.pow(hit.hz / voice.hz, 0.5) : hit.hz;
  voice.clarity = hit.clarity;
  voice.at = now;
}

const voiceLive = (now) => engine.micOn && voice.hz > 0 && now - voice.at < VOICE_HOLD_MS;

/** A short window triggered on its own channel, for the small card traces. */
function miniWindow(buf, hz, fallbackMs) {
  const sr = engine.sampleRate;
  const span = clamp(hz > 0 ? (3 * sr) / hz : (fallbackMs / 1000) * sr, 48, buf.length / 4);
  const t = findTrigger(buf, { from: buf.length - span * 3, to: buf.length - span - 1, hysteresis: 0.004 });
  const start = t >= 0 ? t : buf.length - span;
  const { vpp } = peakToPeak(buf, Math.floor(start), Math.floor(start + span));
  return { start, span, gain: 1 / Math.max(0.02, (vpp / 2) * 1.15) };
}

/**
 * Shapes is a figure, not a measurement, so it fits each shape to its space. The
 * scale grows fast (so a louder chord never clips) and shrinks slowly (so a note
 * dying away doesn't make the figure pump back up).
 */
function fitted(ch, count, radiusDiv) {
  const buf = ch.buf;
  let peak = 0;
  for (let i = buf.length - count; i < buf.length; i++) {
    const a = Math.abs(buf[i]);
    if (a > peak) peak = a;
  }
  const target = Math.max(peak, 0.003) / radiusDiv;
  fitScale[ch.id] += (target - fitScale[ch.id]) * (target > fitScale[ch.id] ? 0.4 : 0.04);
  return { ...ch, voltsPerDiv: fitScale[ch.id] };
}

/* --------------------------------- readout -------------------------------- */

const fmtV = (v) => (v >= 1 ? `${v} V` : `${Math.round(v * 1000)} mV`);
const fmtT = (ms) => (ms >= 1 ? `${ms} ms` : `${Math.round(ms * 1000)} µs`);
const signed = (c) => `${c >= 0 ? '+' : '−'}${Math.abs(c).toFixed(0)}¢`;

function renderStatus() {
  $('stRun').textContent = running ? 'RUN' : 'STOP';
  $('stRun').classList.toggle('is-stopped', !running);
  $('runBtn').classList.toggle('is-stopped', !running);
  $('stMode').textContent = { shapes: 'SHAPES', xy: 'X–Y', yt: 'Y–T' }[settings.display];
  const fit = settings.display === 'shapes';
  $('stCh1').textContent = `CH1 ${fit ? 'FIT' : fmtV(VOLTS[settings.ch1])}`;
  $('stCh2').textContent = `CH2 ${fit ? 'FIT' : fmtV(VOLTS[settings.ch2])}`;
  $('stTime').textContent = `M ${fmtT(TIMES[settings.time])}`;
  $('ch1Scale').textContent = fmtV(VOLTS[settings.ch1]);
  $('ch2Scale').textContent = fmtV(VOLTS[settings.ch2]);
  $('timeValue').textContent = fmtT(TIMES[settings.time]);
}

function renderReadout(now, span) {
  const held = engine.held;

  // CH1 — the generator
  if (!held.length) {
    $('ch1Note').textContent = '—';
    $('ch1Hz').textContent = settings.latch ? 'latch on · tap a key' : 'play a key';
  } else if (held.length === 1) {
    $('ch1Note').textContent = noteName(held[0]);
    $('ch1Hz').textContent = `${pianoFrequency(held[0]).toFixed(2)} Hz · ${WAVE_LABEL[engine.waveform]}`;
  } else {
    const chord = nameChord(held);
    $('ch1Note').textContent = chord?.name ?? `${held.length} notes`;
    $('ch1Hz').textContent = `${held.map(noteName).join(' ')} · ${WAVE_LABEL[engine.waveform]}`;
  }
  const n = engine.buf1.length;
  const w = Math.min(n, Math.ceil(span));
  const p1 = peakToPeak(engine.buf1, n - w, n);
  $('ch1Vpp').textContent = held.length || p1.vpp > 0.001 ? `${p1.vpp.toFixed(3)} V` : '—';
  $('ch1Rms').textContent = held.length || p1.vpp > 0.001 ? `${toDb(rms(engine.buf1, n - w, n)).toFixed(1)} dBFS` : '—';

  // CH2 — the voice
  const live = voiceLive(now);
  const level = engine.micOn ? toDb(rms(engine.buf2, n - PITCH_WINDOW, n)) : null;
  if (!engine.micOn) {
    $('ch2Note').textContent = '—';
    $('ch2Hz').textContent = engine.micError === 'missing' ? 'no microphone found' : engine.micError ? 'mic access blocked' : 'mic off';
  } else if (live) {
    const m = freqToMidi(voice.hz);
    const near = Math.round(m);
    $('ch2Note').textContent = noteName(near);
    $('ch2Hz').textContent = `${voice.hz.toFixed(1)} Hz · ${signed((m - near) * 100)}`;
  } else {
    $('ch2Note').textContent = '—';
    $('ch2Hz').textContent = 'listening…';
  }
  $('ch2Level').textContent = level === null ? '—' : `${level.toFixed(1)} dBFS`;
  $('ch2Clarity').textContent = live ? `${Math.round(voice.clarity * 100)}%` : '—';

  renderInterval(held, live);
}

/** How far the voice sits from the nearest just interval above or below the wave. */
function renderInterval(held, live) {
  const needle = $('tuneNeedle');
  const set = (title, ratio, cents) => {
    $('ivTitle').textContent = title;
    $('ivRatio').textContent = ratio;
    $('ivCents').textContent = cents === null ? '—' : signed(cents);
    needle.classList.toggle('is-live', cents !== null);
    if (cents !== null) {
      needle.style.left = `${50 + clamp(cents, -50, 50)}%`;
      const a = Math.abs(cents);
      needle.classList.toggle('in-tune', a < 5);
      needle.classList.toggle('near', a >= 5 && a < 15);
      needle.classList.toggle('off', a >= 15);
    }
  };

  if (!live) {
    set(held.length ? 'Sing against the wave' : 'Play a note, then sing', '—', null);
    return;
  }
  if (!held.length) {
    // No reference note: act as a plain tuner against equal temperament.
    const m = freqToMidi(voice.hz);
    set('Tuner', noteName(Math.round(m)), (m - Math.round(m)) * 100);
    return;
  }

  const ref = pianoFrequency(held[0]);
  const semis = 12 * Math.log2(voice.hz / ref);
  const n = Math.round(semis);
  const [p, q] = ratioForSemitones(Math.abs(n));
  const just = n >= 0 ? p / q : q / p;
  const cents = 1200 * Math.log2(voice.hz / ref / just);
  const name = intervalTitle(0, Math.abs(n)).replace(/^THE /, '');
  const where = n === 0 ? '' : n > 0 ? ' above' : ' below';
  // Voice : wave, so a fifth above reads 3 : 2 and a fifth below 2 : 3.
  const ratio = n >= 0 ? `${p} : ${q}` : `${q} : ${p}`;
  set(`${n === 0 ? 'Unison' : name.toLowerCase()}${where}`, ratio, cents);
}

/* ---------------------------------- loop ---------------------------------- */

function frame(now) {
  display.resize();
  if (running) engine.capture();
  if (engine.ctx && running) trackVoice(now);

  display.fade(settings.persist);

  const sr = engine.sampleRate;
  const span = (TIMES[settings.time] * 10 * sr) / 1000;

  if (engine.ctx) {
    const ch1 = { id: 1, buf: engine.buf1, voltsPerDiv: VOLTS[settings.ch1], position: CH_POSITION[1], visible: true };
    const ch2 = { id: 2, buf: engine.buf2, voltsPerDiv: VOLTS[settings.ch2], position: CH_POSITION[2], visible: engine.micOn };

    if (settings.display === 'shapes') {
      // Each channel draws against itself a quarter of its own period later. The
      // period comes from what we know: the lowest held note, the tracked voice
      // pitch, or a short fixed delay when neither is known yet.
      const sr = engine.sampleRate;
      const held = engine.held;
      const live = voiceLive(now);
      const shapes = [];
      if (held.length) shapes.push([ch1, sr / (4 * pianoFrequency(held[0]))]);
      if (engine.micOn && (live || rms(engine.buf2, engine.buf2.length - PITCH_WINDOW) > VOICE_GATE)) {
        shapes.push([ch2, live ? sr / (4 * voice.hz) : sr * 0.0006]);
      }
      const offsets = shapes.length === 2 ? [-2.5, 2.5] : [0];
      const radius = shapes.length === 2 ? FIT_RADIUS.pair : FIT_RADIUS.single;
      const count = Math.round(span);
      shapes.forEach(([ch, delay], i) => display.drawShape(fitted(ch, count, radius), delay, count, offsets[i], 1));
      triggered = false;
    } else if (settings.display === 'xy') {
      display.drawXY(ch1, ch2, Math.round(span), 1);
      triggered = false;
    } else {
      // Auto follows whichever channel has signal, but only while running: a frozen
      // capture must not re-trigger because a key was pressed after it was taken.
      if (running) autoTrigger = engine.voices.size ? 1 : 2;
      const trigCh = settings.trigger === 'auto' ? autoTrigger : Number(settings.trigger);
      const src = trigCh === 1 ? ch1 : ch2;
      const pre = (span * TRIGGER_DIV) / 10;
      const t = findTrigger(src.buf, {
        level: 0,
        hysteresis: Math.max(0.002, src.voltsPerDiv * 0.08),
        from: Math.ceil(pre) + 1,
        to: src.buf.length - Math.ceil(span - pre) - 1
      });
      triggered = t >= 0;
      // Untriggered, fall back to free-running on the newest samples (AUTO mode).
      const start = triggered ? t - pre : src.buf.length - span;
      display.drawYT([ch1, ch2], start, span, 1);
      display.drawMarkers([ch1, ch2], trigCh, 0, 'yt');
      $('stTrigSrc').textContent = `T CH${trigCh} ↑ 0.00`;
    }

    const held = engine.held;
    const m1 = miniWindow(engine.buf1, held.length ? pianoFrequency(held[0]) : 0, 10);
    mini1.draw(held.length ? engine.buf1 : null, m1.start, m1.span, m1.gain);
    const live = voiceLive(now);
    const m2 = miniWindow(engine.buf2, live ? voice.hz : 0, 20);
    mini2.draw(engine.micOn ? engine.buf2 : null, m2.start, m2.span, m2.gain);
  }

  const st = $('stTrig');
  st.textContent = settings.display !== 'yt' ? '' : triggered ? "TRIG'D" : 'AUTO';
  $('stTrigSrc').hidden = settings.display !== 'yt';
  st.classList.toggle('is-trig', triggered && settings.display === 'yt');
  st.classList.toggle('is-auto', !triggered && settings.display === 'yt');

  if (now - lastReadoutAt > 80) {
    lastReadoutAt = now;
    if (engine.ctx) renderReadout(now, span);
    $('scopeHint').classList.toggle('is-hidden', engine.voices.size > 0 || engine.micOn);
  }

  requestAnimationFrame(frame);
}

/* --------------------------------- controls -------------------------------- */

function segment(id, attr, current, onPick) {
  const root = $(id);
  const paint = (v) => {
    for (const b of root.querySelectorAll('button')) b.classList.toggle('is-on', b.dataset[attr] === String(v));
  };
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    onPick(b.dataset[attr]);
    paint(b.dataset[attr]);
  });
  paint(current);
}

function setDisplay(mode) {
  settings.display = mode;
  for (const b of document.querySelectorAll('[data-display]')) {
    const on = b.dataset.display === mode;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-selected', String(on));
  }
  display.clear();
  $('xyNote').hidden = mode === 'yt';
  $('xyNote').textContent = mode === 'xy'
    ? 'CH1 → X · CH2 → Y · a sine on CH1 draws Lissajous figures'
    : 'each channel against itself ¼ period later · sine ○ · square □ · triangle ◇';
  renderStatus();
  save();
}

function step(key, delta, max) {
  settings[key] = clamp(settings[key] + delta, 0, max);
  renderStatus();
  save();
}

/**
 * Autoset, as on a bench scope: size each channel so its signal spans a few
 * divisions, and pick a timebase that shows a few periods of the lowest pitch.
 */
function autoset() {
  if (!engine.ctx) return;
  const n = engine.buf1.length;
  const recent = Math.min(n, Math.round(engine.sampleRate * 0.1));
  const fit = (buf) => {
    const { vpp } = peakToPeak(buf, n - recent, n);
    if (vpp < 0.002) return null;
    // Smallest step that keeps the trace inside its half of the dual-trace screen.
    const target = vpp / 3.4;
    let pick = 0;
    VOLTS.forEach((v, i) => { if (v >= target) pick = i; });
    return pick;
  };
  const c1 = fit(engine.buf1);
  const c2 = engine.micOn ? fit(engine.buf2) : null;
  if (c1 !== null) settings.ch1 = c1;
  if (c2 !== null) settings.ch2 = c2;

  const held = engine.held;
  const hz = held.length ? pianoFrequency(held[0]) : voiceLive(performance.now()) ? voice.hz : 0;
  if (hz > 0) {
    const targetMs = (4 / hz) * 1000 / 10; // about four periods across ten divisions
    let pick = TIMES.length - 1;
    for (let i = TIMES.length - 1; i >= 0; i--) if (TIMES[i] >= targetMs) pick = i;
    settings.time = pick;
  }
  display.clear();
  renderStatus();
  save();
}

function toggleRun() {
  running = !running;
  renderStatus();
}

function setLatch(on) {
  settings.latch = on;
  $('latchBtn').setAttribute('aria-pressed', String(on));
  if (!on) engine.allOff();
  save();
}

async function toggleMic() {
  const btn = $('micBtn');
  if (engine.micOn) {
    engine.stopMic();
    voice.hz = 0;
  } else {
    await engine.startMic();
  }
  btn.setAttribute('aria-pressed', String(engine.micOn));
  btn.textContent = engine.micOn ? 'Mic on' : engine.micError === 'missing' ? 'No mic found' : engine.micError ? 'Mic blocked' : 'Mic off';
}

function wire() {
  for (const b of document.querySelectorAll('[data-display]')) b.addEventListener('click', () => setDisplay(b.dataset.display));

  segment('waveSeg', 'wave', settings.waveform, (w) => {
    settings.waveform = w;
    engine.setWaveform(w);
    save();
  });
  segment('trigSeg', 'trig', settings.trigger, (t) => {
    settings.trigger = t;
    save();
  });

  // Steppers: "+" zooms in (smaller volts or time per division).
  $('timeDown').addEventListener('click', () => step('time', -1, TIMES.length - 1));
  $('timeUp').addEventListener('click', () => step('time', 1, TIMES.length - 1));
  $('ch1Down').addEventListener('click', () => step('ch1', -1, VOLTS.length - 1));
  $('ch1Up').addEventListener('click', () => step('ch1', 1, VOLTS.length - 1));
  $('ch2Down').addEventListener('click', () => step('ch2', -1, VOLTS.length - 1));
  $('ch2Up').addEventListener('click', () => step('ch2', 1, VOLTS.length - 1));

  $('persist').value = String(Math.round(settings.persist * 100));
  $('persist').addEventListener('input', (e) => { settings.persist = Number(e.target.value) / 100; save(); });
  $('volume').value = String(Math.round(settings.volume * 100));
  $('volume').addEventListener('input', (e) => { settings.volume = Number(e.target.value) / 100; engine.setVolume(settings.volume); save(); });

  $('runBtn').addEventListener('click', toggleRun);
  $('autosetBtn').addEventListener('click', () => { engine.ensure(); autoset(); });
  $('latchBtn').addEventListener('click', () => setLatch(!settings.latch));
  $('micBtn').addEventListener('click', toggleMic);
  $('octDown').addEventListener('click', () => keys.setOctave(keys.octave - 1));
  $('octUp').addEventListener('click', () => keys.setOctave(keys.octave + 1));
  $('breakawayBtn').addEventListener('click', () => { engine.ensure(); keys.toggleCapture(); });
  $('scopeMain').addEventListener('pointerdown', () => { engine.ensure(); keys.rearm(); });

  window.addEventListener('keydown', (e) => {
    if (!keys.active || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === 'Space') { e.preventDefault(); toggleRun(); }
    else if (e.code === 'Digit1') setDisplay('shapes');
    else if (e.code === 'Digit2') setDisplay('yt');
    else if (e.code === 'Digit3') setDisplay('xy');
    else if (e.code === 'F11') { e.preventDefault(); window.prism?.toggleFullscreen(); }
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

if (!WAVEFORMS.includes(settings.waveform)) settings.waveform = 'sawtooth';
if (!['shapes', 'yt', 'xy'].includes(settings.display)) settings.display = 'shapes';
engine.waveform = settings.waveform;
engine.volume = settings.volume;
wireWindowChrome();
wire();
setDisplay(settings.display);
setLatch(settings.latch);
renderKeyState(keys.state());
renderStatus();
midi.connect();
requestAnimationFrame(frame);
