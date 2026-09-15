/**
 * A small polyphonic Web Audio synth, so the computer keyboard and MIDI input
 * actually make sound. Built for latency, not realism: one filtered
 * two-oscillator voice per note, straight into a shared reverb/limiter bus.
 */

import { midiToFreq, clamp } from '../theory/circle.js';

const ATTACK = 0.006;
const DECAY = 0.18;
const SUSTAIN = 0.62;

export class Synth {
  constructor() {
    this.ctx = null;
    this.voices = new Map();
    this.waveform = 'sawtooth';
    this.volume = 0.5;
    this.space = 0.35;
    this.release = 0.32;
  }

  /** Lazily created: browsers only allow an AudioContext after a gesture. */
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    }
    const ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    this.ctx = ctx;

    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -10;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.18;

    this.master = ctx.createGain();
    this.master.gain.value = this.volume;

    this.dry = ctx.createGain();
    this.wet = ctx.createGain();
    this.wet.gain.value = this.space;
    this.dry.gain.value = 1;

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = buildImpulse(ctx, 2.4, 2.6);

    this.bus = ctx.createGain();
    this.bus.connect(this.dry);
    this.bus.connect(this.reverb);
    this.reverb.connect(this.wet);
    this.dry.connect(this.limiter);
    this.wet.connect(this.limiter);
    this.limiter.connect(this.master);
    this.master.connect(ctx.destination);

    return ctx;
  }

  get latencyMs() {
    if (!this.ctx) return 0;
    return (this.ctx.baseLatency ?? 0) * 1000 + (this.ctx.outputLatency ?? 0) * 1000;
  }

  setVolume(v) {
    this.volume = clamp(v, 0, 1);
    if (this.master) this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.02);
  }

  setSpace(v) {
    this.space = clamp(v, 0, 1);
    if (this.wet) this.wet.gain.setTargetAtTime(this.space, this.ctx.currentTime, 0.05);
  }

  noteOn(midi, velocity = 0.8) {
    const ctx = this.ensure();
    this.noteOff(midi, true);

    const now = ctx.currentTime;
    const freq = midiToFreq(midi);
    const peak = clamp(velocity, 0, 1) * 0.22;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(peak, now + ATTACK);
    gain.gain.setTargetAtTime(peak * SUSTAIN, now + ATTACK, DECAY);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(Math.min(freq * 10 + 900, 16000), now);
    filter.frequency.setTargetAtTime(Math.min(freq * 5 + 600, 11000), now + ATTACK, 0.5);
    filter.Q.value = 0.9;

    const oscA = ctx.createOscillator();
    const oscB = ctx.createOscillator();
    oscA.type = this.waveform;
    oscB.type = this.waveform;
    oscA.frequency.value = freq;
    oscB.frequency.value = freq;
    oscA.detune.value = -6;
    oscB.detune.value = 6;

    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = freq / 2;
    const subGain = ctx.createGain();
    subGain.gain.value = 0.28;

    oscA.connect(filter);
    oscB.connect(filter);
    sub.connect(subGain).connect(filter);
    filter.connect(gain).connect(this.bus);

    oscA.start(now);
    oscB.start(now);
    sub.start(now);

    this.voices.set(midi, { oscs: [oscA, oscB, sub], gain, filter });
  }

  noteOff(midi, immediate = false) {
    const voice = this.voices.get(midi);
    if (!voice) return;
    this.voices.delete(midi);
    const now = this.ctx.currentTime;
    const tail = immediate ? 0.01 : this.release;
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setValueAtTime(Math.max(voice.gain.gain.value, 0.0001), now);
    voice.gain.gain.exponentialRampToValueAtTime(0.0001, now + tail);
    for (const osc of voice.oscs) osc.stop(now + tail + 0.03);
  }

  allOff() {
    for (const midi of [...this.voices.keys()]) this.noteOff(midi);
  }
}

/** Noise burst with an exponential tail — a serviceable hall without a sample file. */
function buildImpulse(ctx, seconds, decay) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return buffer;
}
