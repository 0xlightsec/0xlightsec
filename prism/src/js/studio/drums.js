/**
 * The beat: synthesised kick, snare and hats on a sixteen-step grid, scheduled a
 * little ahead on the audio clock so timing never depends on the page being
 * responsive (the classic "two clocks" scheduler: a coarse JS timer that books
 * sample-accurate Web Audio events).
 *
 * Patterns use one character per sixteenth: x = hit, o = accent, r = roll
 * (two quick hits in the step), . = rest.
 */

export const BEATS = {
  pulse: {
    label: 'Pulse',
    kick:  'x...x...x...x...',
    snare: '....x.......x...',
    hat:   '..x...x...x...x.',
    swing: 0
  },
  groove: {
    label: 'Groove',
    kick:  'x......x..x.....',
    snare: '....x.......x..x',
    hat:   'x.x.x.x.x.x.x.xo',
    swing: 0.14
  },
  trap: {
    label: 'Trap',
    kick:  'x.....x...x.....',
    snare: '........x.......',
    hat:   'x.x.x.x.xrx.xxrr',
    swing: 0,
    boom: true
  }
};

export const STEPS = 16;
export const TEMPO_MIN = 60;
export const TEMPO_MAX = 170;

export const stepSeconds = (bpm) => 60 / bpm / 4;
export const barSeconds = (bpm) => (60 / bpm) * 4;

/**
 * The steps whose (swung) start falls in [t0, t1): `origin` is the time of step
 * 0. Odd sixteenths are pushed late by `swing` of a step, like a drummer's lilt.
 */
export function stepsBetween(origin, bpm, swing, t0, t1) {
  const step = stepSeconds(bpm);
  const out = [];
  let k = Math.max(0, Math.floor((t0 - origin) / step) - 1);
  for (;; k++) {
    const t = origin + k * step + (k % 2 ? swing * step : 0);
    if (t >= t1) break;
    if (t >= t0) out.push({ k, t });
  }
  return out;
}

/**
 * The tempo, near the current one, at which a free loop is exactly 1, 2, 4 or 8
 * bars, so the beat can lock to a loop you've already made.
 */
export function fitTempo(loopSeconds, bpm) {
  let best = null;
  for (const bars of [1, 2, 4, 8]) {
    const t = (240 * bars) / loopSeconds;
    if (t < TEMPO_MIN || t > TEMPO_MAX) continue;
    if (best === null || Math.abs(t - bpm) < Math.abs(best - bpm)) best = t;
  }
  return best;
}

const LOOKAHEAD = 0.12; // seconds booked ahead
const TICK_MS = 25;

export class Drums {
  constructor(ctx, out) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0.9;
    this.out.connect(out);
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.beat = null;
    this.bpm = 100;
    this.origin = 0;
    this.booked = 0; // time up to which steps are booked
    this.timer = 0;
    this.onStep = null;
  }

  get playing() {
    return !!this.beat;
  }

  /** Start (or switch) a beat. Switching keeps the grid, so it stays in time. */
  play(name, at = null) {
    const beat = BEATS[name];
    if (!beat) return this.stop();
    const now = this.ctx.currentTime;
    if (!this.beat) {
      this.origin = at ?? now + 0.06;
      this.booked = this.origin;
    }
    this.beat = beat;
    if (!this.timer) this.timer = setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  stop() {
    this.beat = null;
    clearInterval(this.timer);
    this.timer = 0;
  }

  /** Change tempo without a jump: the grid pivots on the next step. */
  setTempo(bpm) {
    if (bpm === this.bpm) return;
    if (this.beat) {
      const now = Math.max(this.booked, this.ctx.currentTime);
      const k = Math.ceil((now - this.origin) / stepSeconds(this.bpm));
      const pivot = this.origin + k * stepSeconds(this.bpm);
      this.origin = pivot - k * stepSeconds(bpm);
    }
    this.bpm = bpm;
  }

  /** The time of the first downbeat at or after t. */
  nextDownbeat(t) {
    const bar = barSeconds(this.bpm);
    return this.origin + Math.ceil((t - this.origin) / bar - 1e-9) * bar;
  }

  tick() {
    if (!this.beat) return;
    const until = this.ctx.currentTime + LOOKAHEAD;
    const beat = this.beat;
    for (const { k, t } of stepsBetween(this.origin, this.bpm, beat.swing, this.booked, until)) {
      const s = k % STEPS;
      this.hit(beat.kick[s], t, (when, accent) => this.kick(when, accent, beat.boom));
      this.hit(beat.snare[s], t, (when, accent) => this.snare(when, accent));
      this.hit(beat.hat[s], t, (when, accent) => this.hat(when, accent));
      this.onStep?.(s, t);
    }
    this.booked = until;
  }

  hit(ch, t, play) {
    if (ch === 'x') play(t, 0.8);
    else if (ch === 'o') play(t, 1);
    else if (ch === 'r') {
      play(t, 0.6);
      play(t + stepSeconds(this.bpm) / 2, 0.5);
    }
  }

  kick(t, accent, boom) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    const length = boom ? 0.9 : 0.42;
    osc.frequency.setValueAtTime(boom ? 120 : 150, t);
    osc.frequency.exponentialRampToValueAtTime(boom ? 42 : 48, t + (boom ? 0.18 : 0.12));
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(accent, t + 0.004);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + length);
    osc.connect(amp).connect(this.out);
    osc.start(t);
    osc.stop(t + length + 0.02);
  }

  snare(t, accent) {
    const ctx = this.ctx;
    const noise = ctx.createBufferSource();
    noise.buffer = this.noise;
    const band = ctx.createBiquadFilter();
    band.type = 'highpass';
    band.frequency.value = 1400;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(0.55 * accent, t + 0.003);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    noise.connect(band).connect(amp).connect(this.out);
    noise.start(t, Math.random() * 0.5);
    noise.stop(t + 0.22);

    const body = ctx.createOscillator();
    body.frequency.setValueAtTime(200, t);
    body.frequency.exponentialRampToValueAtTime(150, t + 0.08);
    const bodyAmp = ctx.createGain();
    bodyAmp.gain.setValueAtTime(0.0001, t);
    bodyAmp.gain.exponentialRampToValueAtTime(0.4 * accent, t + 0.003);
    bodyAmp.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    body.connect(bodyAmp).connect(this.out);
    body.start(t);
    body.stop(t + 0.12);
  }

  hat(t, accent) {
    const ctx = this.ctx;
    const noise = ctx.createBufferSource();
    noise.buffer = this.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7500;
    const amp = ctx.createGain();
    const length = accent >= 1 ? 0.16 : 0.045; // an accent opens the hat
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(0.22 * accent, t + 0.002);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + length);
    noise.connect(hp).connect(amp).connect(this.out);
    noise.start(t, Math.random() * 0.5);
    noise.stop(t + length + 0.01);
  }
}
