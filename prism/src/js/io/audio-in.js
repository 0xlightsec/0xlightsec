/**
 * Microphone pitch tracking.
 *
 * Normalised square difference (an McLeod/YIN-style autocorrelation) over a short
 * time-domain window. This is monophonic by nature: it reports the strongest
 * fundamental it can find, which is right for voice, a solo instrument or a
 * whistled line. Chords should come in over MIDI or the computer keyboard.
 */

import { freqToMidi, clamp } from '../theory/circle.js';

const MIN_HZ = 65;    // C2
const MAX_HZ = 1400;  // ~F6
const CLARITY_GATE = 0.88;
const HOLD_FRAMES = 2;

export class AudioInput {
  constructor(handlers = {}) {
    this.handlers = handlers;
    this.ctx = null;
    this.stream = null;
    this.analyser = null;
    this.buffer = null;
    this.running = false;
    this.current = null;
    this.candidate = null;
    this.candidateFrames = 0;
    this.silentFrames = 0;
    this.sensitivity = 0.5;
    this.level = 0;
    this.status = 'idle';
  }

  get gate() {
    // sensitivity 0..1 -> rms threshold 0.030..0.003
    return 0.030 - 0.027 * clamp(this.sensitivity, 0, 1);
  }

  async start() {
    if (this.running) return true;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      });
    } catch (err) {
      this.status = 'denied';
      this.handlers.onStatus?.(this.status, err?.message);
      return false;
    }
    this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    const source = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0;
    source.connect(this.analyser);
    this.buffer = new Float32Array(this.analyser.fftSize);
    this.running = true;
    this.status = 'listening';
    this.handlers.onStatus?.(this.status);
    return true;
  }

  stop() {
    this.releaseCurrent();
    this.running = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close();
    this.ctx = null;
    this.stream = null;
    this.analyser = null;
    this.level = 0;
    this.status = 'idle';
    this.handlers.onStatus?.(this.status);
  }

  releaseCurrent() {
    if (this.current !== null) {
      this.handlers.onNoteOff?.(this.current);
      this.current = null;
    }
  }

  /** Call once per animation frame. */
  poll() {
    if (!this.running || !this.analyser) return;
    this.analyser.getFloatTimeDomainData(this.buffer);

    let sumSquares = 0;
    for (let i = 0; i < this.buffer.length; i++) sumSquares += this.buffer[i] * this.buffer[i];
    const rms = Math.sqrt(sumSquares / this.buffer.length);
    this.level = rms;

    if (rms < this.gate) {
      if (++this.silentFrames > 3) {
        this.releaseCurrent();
        this.candidate = null;
        this.candidateFrames = 0;
      }
      return;
    }
    this.silentFrames = 0;

    const result = detectPitch(this.buffer, this.ctx.sampleRate);
    if (!result || result.clarity < CLARITY_GATE) return;

    const midi = Math.round(freqToMidi(result.hz));
    if (midi < 24 || midi > 108) return;

    // Require the same note on consecutive frames before committing to it.
    if (midi === this.candidate) this.candidateFrames++;
    else {
      this.candidate = midi;
      this.candidateFrames = 1;
    }
    if (this.candidateFrames < HOLD_FRAMES) return;

    if (midi !== this.current) {
      this.releaseCurrent();
      this.current = midi;
      this.handlers.onNoteOn?.(midi, clamp(rms * 14, 0.15, 1), { hz: result.hz, clarity: result.clarity });
    }
  }
}

/** Normalised square difference; returns the first strong peak. */
export function detectPitch(buf, sampleRate) {
  const size = buf.length;
  const maxLag = Math.min(Math.floor(sampleRate / MIN_HZ), Math.floor(size / 2));
  const minLag = Math.max(2, Math.floor(sampleRate / MAX_HZ));

  const nsdf = new Float32Array(maxLag);
  for (let lag = minLag; lag < maxLag; lag++) {
    let acf = 0;
    let norm = 0;
    for (let i = 0; i < size - lag; i++) {
      acf += buf[i] * buf[i + lag];
      norm += buf[i] * buf[i] + buf[i + lag] * buf[i + lag];
    }
    nsdf[lag] = norm > 0 ? (2 * acf) / norm : 0;
  }

  // First peak past the first negative zero-crossing, above a relative threshold.
  let lag = minLag;
  while (lag < maxLag && nsdf[lag] > 0) lag++;

  let bestLag = -1;
  let bestVal = 0;
  for (; lag < maxLag - 1; lag++) {
    if (nsdf[lag] > nsdf[lag - 1] && nsdf[lag] >= nsdf[lag + 1] && nsdf[lag] > bestVal) {
      bestVal = nsdf[lag];
      bestLag = lag;
      if (bestVal > 0.97) break;
    }
  }
  if (bestLag < 0 || bestVal <= 0) return null;

  // Parabolic interpolation around the peak for sub-sample accuracy.
  const y0 = nsdf[bestLag - 1];
  const y1 = nsdf[bestLag];
  const y2 = nsdf[bestLag + 1];
  const denom = 2 * (2 * y1 - y0 - y2);
  const shift = denom !== 0 ? (y2 - y0) / denom : 0;
  const refined = bestLag + shift;

  return { hz: sampleRate / refined, clarity: y1 };
}
