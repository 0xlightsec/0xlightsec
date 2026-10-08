/**
 * The mixer: a master strip and inserts, FL style. Every channel plays into an
 * insert (or straight into the master); every insert plays into the master.
 *
 *   insert ─▶ Drive ─▶ Crush ─▶ Filter ─▶ Tape ─▶ Clip ─▶ Gate ─▶ fader ─▶ pan ─▶ master
 *                                                                 └─▶ Echo, and a send to the shared reverb
 *
 * The reverb is shared (convolution is the expensive effect) and comes back in
 * after the master's own effects, so even the master can send to it without
 * feeding back. Each strip has a meter.
 */

import { FxChain, SpaceBus } from '../studio/fx.js';
import { INSERTS } from './model.js';

export class Strip {
  constructor(ctx, space, out) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.panner = ctx.createStereoPanner();
    this.fx = new FxChain(ctx, space, this.panner);
    this.input.connect(this.fx.input);
    this.panner.connect(out);
    this.meter = ctx.createAnalyser();
    this.meter.fftSize = 512;
    this.panner.connect(this.meter);
    this.buf = new Float32Array(512);
  }

  /** Bring the strip in line with its settings, touching only what changed. */
  update(strip, audible) {
    const want = { ...strip.fx, level: strip.volume, mute: !audible };
    for (const [k, v] of Object.entries(want)) if (this.fx.values[k] !== v) this.fx.set(k, v);
    if (this.pan !== strip.pan) {
      this.pan = strip.pan;
      this.panner.pan.setTargetAtTime(strip.pan, this.ctx.currentTime, 0.01);
    }
  }

  /** Peak level of the last few milliseconds, 0..1+. */
  peak() {
    this.meter.getFloatTimeDomainData(this.buf);
    let p = 0;
    for (const v of this.buf) {
      const a = v < 0 ? -v : v;
      if (a > p) p = a;
    }
    return p;
  }
}

export class Mixer {
  constructor(ctx, out) {
    this.post = ctx.createGain();
    this.post.connect(out);
    this.space = new SpaceBus(ctx, this.post);
    this.master = new Strip(ctx, this.space, this.post);
    this.inserts = Array.from({ length: INSERTS }, () => new Strip(ctx, this.space, this.master.input));
  }

  /** Every strip, the master first. */
  get strips() {
    return [this.master, ...this.inserts];
  }

  strip(i) {
    return i === 0 ? this.master : this.inserts[i - 1] ?? this.master;
  }

  input(i) {
    return this.strip(i).input;
  }

  update(tracks) {
    const soloing = tracks.slice(1).some((t) => t.solo);
    tracks.forEach((t, i) => {
      const audible = i === 0 ? !t.mute : soloing ? t.solo && !t.mute : !t.mute;
      this.strip(i).update(t, audible);
    });
  }

  setTempo(bpm) {
    for (const s of this.strips) s.fx.setTempo(bpm);
  }

  /** Book the gates of the strips that use one, for a step at `at` lasting `duration`. */
  gateStep(at, duration) {
    for (const s of this.strips) s.fx.gateStep(at, duration);
  }

  /** Open every gate (the transport stopped). */
  gateOpen() {
    for (const s of this.strips) if (s.fx.values.gate >= 0.001) s.fx.gateOpen();
  }

  peaks() {
    return this.strips.map((s) => s.peak());
  }
}
