/**
 * Channel instruments for the beatmaker. A channel is either one of the synth
 * sounds (StudioSynth) or a drum, voiced by its kit. Every channel ends in its
 * own volume and pan, then goes to its mixer insert.
 *
 * Everything takes the audio context it's given, so the same code plays live and
 * renders offline for export. Notes are booked ahead on the audio clock; cancel()
 * silences whatever was booked when the transport stops.
 */

import { StudioSynth, SOUNDS } from '../studio/sounds.js';
import { KITS } from '../studio/drums.js';
import { levelGain } from '../studio/fx.js';
import { ROOT } from './model.js';

const noises = new WeakMap();

/** One second of white noise per context, shared by every drum. */
function noiseFor(ctx) {
  if (!noises.has(ctx)) {
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noises.set(ctx, buf);
  }
  return noises.get(ctx);
}

/**
 * Synthesised drums. `pitch` is a frequency ratio: notes above or below the root
 * tune the drum up or down, like a sampler.
 */
export class DrumSynth {
  constructor(ctx, out) {
    this.ctx = ctx;
    this.tone = ctx.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.Q.value = 0.5;
    this.tone.frequency.value = 20000;
    this.tone.connect(out);
    this.kit = KITS.classic;
    this.curves = new Map();
    this.booked = [];
  }

  setKit(name) {
    this.kit = KITS[name] ?? KITS.classic;
    this.tone.frequency.value = this.kit.tone ?? 20000;
  }

  /** Play a drum at time `at`; returns when it has finished sounding. */
  play(drum, at, velocity = 0.8, pitch = 1) {
    const sources = [];
    const voice = this[`v_${drum}`] ?? this.v_kick;
    const end = voice.call(this, at, Math.max(0.05, Math.min(1, velocity)), pitch, sources);
    this.booked.push({ start: at, end, sources });
    if (this.booked.length > 256) this.booked = this.booked.filter((b) => b.end > this.ctx.currentTime);
    return end;
  }

  /** A hit sounding right now (for the visualizer). */
  sounding(t) {
    return this.booked.some((b) => b.start <= t && t < Math.min(b.end, b.start + 0.15));
  }

  cancelBooked() {
    const now = this.ctx.currentTime;
    for (const b of this.booked) if (b.start > now) for (const s of b.sources) s.stop(now);
    this.booked = this.booked.filter((b) => b.start <= now && b.end > now);
  }

  curve(amount) {
    if (!this.curves.has(amount)) {
      const n = 1024;
      const c = new Float32Array(n);
      const g = 1 + 30 * amount * amount;
      for (let i = 0; i < n; i++) c[i] = Math.tanh(g * ((i / (n - 1)) * 2 - 1)) / Math.tanh(g);
      this.curves.set(amount, c);
    }
    return this.curves.get(amount);
  }

  env(at, peak, attack, length) {
    const amp = this.ctx.createGain();
    amp.gain.setValueAtTime(0.0001, at);
    amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), at + attack);
    amp.gain.exponentialRampToValueAtTime(0.0001, at + length);
    return amp;
  }

  noise(at, sources, { type = 'highpass', freq, q = 0.7, level, length, attack = 0.002 }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = noiseFor(ctx);
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = Math.min(18000, freq);
    f.Q.value = q;
    src.connect(f).connect(this.env(at, level, attack, length)).connect(this.tone);
    src.start(at, Math.random() * 0.5);
    src.stop(at + length + 0.02);
    sources.push(src);
    return at + length;
  }

  osc(at, sources, { type = 'sine', from, to, glide, level, length, drive = 0 }) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(from, at);
    if (to && to !== from) o.frequency.exponentialRampToValueAtTime(to, at + glide);
    let node = o.connect(this.env(at, level, 0.003, length));
    if (drive) {
      const shaper = ctx.createWaveShaper();
      shaper.curve = this.curve(drive);
      node = node.connect(shaper);
    }
    node.connect(this.tone);
    o.start(at);
    o.stop(at + length + 0.02);
    sources.push(o);
    return at + length;
  }

  v_kick(at, v, pitch, sources) {
    const k = this.kit.kick;
    return this.osc(at, sources, {
      from: k.from * pitch, to: k.to * pitch, glide: Math.min(0.18, k.length * 0.25),
      level: v * (k.level ?? 1), length: k.length, drive: k.drive ?? 0
    });
  }

  v_snare(at, v, pitch, sources) {
    const s = this.kit.snare;
    this.osc(at, sources, { from: s.body * pitch, to: s.body * 0.75 * pitch, glide: 0.08, level: 0.4 * v, length: 0.1 });
    return this.noise(at, sources, { freq: s.bright * pitch, level: s.level * v, length: s.length });
  }

  v_clap(at, v, pitch, sources) {
    const level = (this.kit.clap?.level ?? 0.5) * v;
    for (let i = 0; i < 3; i++) this.noise(at + i * 0.011, sources, { type: 'bandpass', freq: 1300 * pitch, q: 1.2, level, length: 0.03 });
    return this.noise(at + 0.033, sources, { type: 'bandpass', freq: 1200 * pitch, q: 0.9, level: level * 0.8, length: 0.2 });
  }

  v_hat(at, v, pitch, sources) {
    const h = this.kit.hat;
    return this.noise(at, sources, { freq: h.cut * pitch, level: h.level * v, length: h.length });
  }

  v_openhat(at, v, pitch, sources) {
    const h = this.kit.hat;
    return this.noise(at, sources, { freq: h.cut * 0.9 * pitch, level: h.level * 1.1 * v, length: 0.32 });
  }

  v_crash(at, v, pitch, sources) {
    const c = this.kit.crash ?? { length: 1.3, level: 0.2 };
    return this.noise(at, sources, { freq: 4500 * pitch, level: c.level * v, length: c.length, attack: 0.004 });
  }

  v_tom(at, v, pitch, sources) {
    this.noise(at, sources, { type: 'bandpass', freq: 900 * pitch, level: 0.08 * v, length: 0.03 });
    return this.osc(at, sources, { from: 190 * pitch, to: 95 * pitch, glide: 0.25, level: 0.75 * v, length: 0.45 });
  }

  v_rim(at, v, pitch, sources) {
    this.noise(at, sources, { type: 'bandpass', freq: 3500 * pitch, q: 2, level: 0.25 * v, length: 0.025 });
    return this.osc(at, sources, { type: 'triangle', from: 1750 * pitch, level: 0.35 * v, length: 0.035 });
  }
}

/**
 * One Channel Rack channel: its instrument, volume and pan. `tap` is an extra
 * output for measuring (the visualizer), outside the mix.
 */
export class Instrument {
  constructor(ctx, out, channel, tap = null) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.panner = ctx.createStereoPanner();
    this.out.connect(this.panner);
    this.dest = out;
    this.panner.connect(out);
    if (tap) this.panner.connect(tap);
    this.kind = null;
    this.update(channel, true);
  }

  /** Send the channel to a different mixer insert. */
  route(out) {
    if (out === this.dest) return;
    this.panner.disconnect(this.dest);
    this.panner.connect(out);
    this.dest = out;
  }

  update(ch, audible) {
    if (ch.kind !== this.kind) {
      this.cancel();
      this.synth = null;
      this.drums = null;
      this.kind = ch.kind;
      if (ch.kind === 'drum') this.drums = new DrumSynth(this.ctx, this.out);
      else this.synth = new StudioSynth(this.ctx, this.out);
    }
    if (this.synth) {
      if (this.synth.sound !== ch.sound && ch.sound in SOUNDS) {
        this.synth.allOff();
        this.synth.sound = ch.sound;
      }
      this.synth.shape = { ...ch.shape };
    } else {
      this.drum = ch.drum;
      this.drums.setKit(ch.kit);
    }
    const t = this.ctx.currentTime;
    this.out.gain.setTargetAtTime(audible ? levelGain(ch.volume) : 0, t, 0.01);
    this.panner.pan.setTargetAtTime(ch.pan, t, 0.01);
  }

  setTempo(bpm) {
    if (this.synth) this.synth.bpm = bpm;
  }

  /** Book a note: a synth plays it for `duration`; a drum is a one-shot, tuned by the note. */
  schedule(note, at, duration) {
    if (this.synth) this.synth.schedule(note.midi, note.velocity, at, duration);
    else this.drums.play(this.drum, at, note.velocity, Math.pow(2, (note.midi - ROOT) / 12));
  }

  /** Play live (keys, MIDI). Drums ignore the release. */
  noteOn(id, midis, velocity) {
    if (this.synth) this.synth.noteOn(id, midis, velocity);
    else this.drums.play(this.drum, this.ctx.currentTime, velocity, Math.pow(2, (midis[0] - ROOT) / 12));
  }

  noteOff(id) {
    this.synth?.noteOff(id);
  }

  /** Notes sounding at t (lowest first), for the visualizer. */
  sounding(t) {
    if (this.synth) return [...this.synth.held, ...this.synth.sounding(t)].sort((a, b) => a - b);
    return this.drums.sounding(t) ? [ROOT] : [];
  }

  cancel() {
    this.synth?.cancelBooked();
    this.synth?.allOff();
    this.drums?.cancelBooked();
  }

  dispose() {
    this.cancel();
    setTimeout(() => this.panner.disconnect(), 400); // let tails finish
  }
}
