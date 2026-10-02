/**
 * Audio for the oscilloscope page.
 *
 * One AudioContext feeds both channels so they stay sample-aligned, which the XY
 * display depends on: any lag between them would skew the figure.
 *
 *   CH1  wave generator voices -> bus -> analyser -> limiter -> speakers
 *   CH2  microphone -> analyser                    (never to the speakers: feedback)
 *
 * The generator is deliberately bare: one oscillator per note, no detune, filter
 * or reverb, so a saw on the scope is a saw. CH1's analyser sits before the limiter
 * so the trace shows the true waveform, not what the limiter does to it.
 */

import { pianoFrequency } from '../theory/piano.js';

export const WAVEFORMS = ['sine', 'triangle', 'sawtooth', 'square'];
const FFT = 16384;               // ~340 ms at 48 kHz: room for 100 ms windows plus trigger search
const ATTACK = 0.004;
const RELEASE = 0.06;
const VOICE_PEAK = 0.42;         // one note sits comfortably inside full scale

export class ScopeEngine {
  constructor() {
    this.ctx = null;
    this.voices = new Map();
    this.waveform = 'sawtooth';
    this.volume = 0.4;
    this.micStream = null;
    this.micOn = false;
  }

  get sampleRate() {
    return this.ctx?.sampleRate ?? 48000;
  }

  /** Created on the first gesture; browsers refuse audio before one. */
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    }
    const ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    this.ctx = ctx;

    this.bus = ctx.createGain();
    this.ch1 = ctx.createAnalyser();
    this.ch2 = ctx.createAnalyser();
    for (const a of [this.ch1, this.ch2]) {
      a.fftSize = FFT;
      a.smoothingTimeConstant = 0;
    }

    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -6;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.1;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;

    this.bus.connect(this.ch1);
    this.ch1.connect(this.limiter);
    this.limiter.connect(this.master);
    this.master.connect(ctx.destination);

    this.trim = ctx.createGain();
    this.trim.connect(this.ch2);

    this.buf1 = new Float32Array(FFT);
    this.buf2 = new Float32Array(FFT);
    return ctx;
  }

  setWaveform(type) {
    if (!WAVEFORMS.includes(type)) return;
    this.waveform = type;
    // Retune held notes in place, so you can watch the shape change under one note.
    for (const v of this.voices.values()) v.osc.type = type;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  noteOn(midi, velocity = 0.8) {
    const ctx = this.ensure();
    this.noteOff(midi, true);
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = this.waveform;
    osc.frequency.value = pianoFrequency(midi);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(VOICE_PEAK * velocity, now + ATTACK);
    osc.connect(gain).connect(this.bus);
    osc.start(now);
    this.voices.set(midi, { osc, gain, velocity });
  }

  noteOff(midi, immediate = false) {
    const v = this.voices.get(midi);
    if (!v) return;
    this.voices.delete(midi);
    const now = this.ctx.currentTime;
    const tail = immediate ? 0.005 : RELEASE;
    v.gain.gain.cancelScheduledValues(now);
    v.gain.gain.setValueAtTime(v.gain.gain.value, now);
    v.gain.gain.linearRampToValueAtTime(0, now + tail);
    v.osc.stop(now + tail + 0.02);
  }

  allOff() {
    for (const m of [...this.voices.keys()]) this.noteOff(m);
  }

  get held() {
    return [...this.voices.keys()].sort((a, b) => a - b);
  }

  async startMic() {
    this.ensure();
    if (this.micOn) return true;
    try {
      // Raw signal: echo cancellation, noise suppression and auto-gain all reshape
      // the waveform, which is the thing we are trying to look at.
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      });
    } catch (err) {
      // Tell "no microphone" apart from "not allowed": they need different fixes.
      this.micError = err?.name === 'NotFoundError' || err?.name === 'OverconstrainedError' ? 'missing' : 'blocked';
      return false;
    }
    this.micSource = this.ctx.createMediaStreamSource(this.micStream);
    this.micSource.connect(this.trim);
    this.micOn = true;
    this.micError = null;
    return true;
  }

  stopMic() {
    this.micSource?.disconnect();
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.micSource = null;
    this.micStream = null;
    this.micOn = false;
  }

  /** Refresh both channel buffers from the analysers. */
  capture() {
    if (!this.ctx) return false;
    this.ch1.getFloatTimeDomainData(this.buf1);
    this.ch2.getFloatTimeDomainData(this.buf2);
    return true;
  }
}
