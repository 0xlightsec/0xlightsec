/**
 * The beat: synthesised drums on a sixteen-step grid, scheduled a little ahead on
 * the audio clock so timing never depends on the page being responsive (the
 * classic "two clocks" scheduler: a coarse JS timer that books sample-accurate
 * Web Audio events).
 *
 * Patterns use one character per sixteenth: x = hit, o = accent, r = roll (two
 * quick hits in the step), . = rest. A part can be 16 steps (one bar) or 32 (two).
 * Each beat plays through a kit: how its kick, snare, clap, hats and crash are
 * voiced, so a lo-fi beat sounds dusty and a hyperpop one sounds blown out.
 */

const pad = (head, steps = 32) => head + '.'.repeat(steps - head.length);

export const KITS = {
  classic: { kick: { from: 150, to: 48, length: 0.42 }, snare: { body: 200, bright: 1400, length: 0.2, level: 0.55 }, hat: { cut: 7500, length: 0.045, level: 0.22 } },
  boom:    { kick: { from: 120, to: 42, length: 0.9 }, snare: { body: 200, bright: 1400, length: 0.2, level: 0.55 }, hat: { cut: 7500, length: 0.045, level: 0.22 } },
  lofi:    { kick: { from: 115, to: 46, length: 0.34, level: 0.75 }, snare: { body: 180, bright: 900, length: 0.16, level: 0.4 }, hat: { cut: 6000, length: 0.03, level: 0.14 }, tone: 4200, crackle: true },
  hyper:   { kick: { from: 190, to: 45, length: 0.7, drive: 0.6 }, snare: { body: 230, bright: 2200, length: 0.17, level: 0.6 }, hat: { cut: 9000, length: 0.035, level: 0.24 }, clap: { level: 0.55 } },
  rage:    { kick: { from: 130, to: 38, length: 1.15, drive: 0.55 }, snare: { body: 210, bright: 1800, length: 0.18, level: 0.55 }, hat: { cut: 8500, length: 0.04, level: 0.22 }, clap: { level: 0.5 } },
  club:    { kick: { from: 160, to: 50, length: 0.38 }, snare: { body: 220, bright: 1600, length: 0.15, level: 0.45 }, hat: { cut: 8000, length: 0.04, level: 0.2 }, clap: { level: 0.6 } },
  rock:    { kick: { from: 110, to: 55, length: 0.3, level: 1 }, snare: { body: 180, bright: 800, length: 0.3, level: 0.75 }, hat: { cut: 6000, length: 0.09, level: 0.16 }, crash: { length: 1.4, level: 0.22 } }
};

export const BEATS = {
  pulse: {
    label: 'Pulse', tempo: 122, kit: 'classic',
    kick:  'x...x...x...x...',
    snare: '....x.......x...',
    hat:   '..x...x...x...x.',
    swing: 0
  },
  groove: {
    label: 'Groove', tempo: 92, kit: 'classic',
    kick:  'x......x..x.....',
    snare: '....x.......x..x',
    hat:   'x.x.x.x.x.x.x.xo',
    swing: 0.14
  },
  trap: {
    label: 'Trap', tempo: 140, kit: 'boom',
    kick:  'x.....x...x.....',
    snare: '........x.......',
    hat:   'x.x.x.x.xrx.xxrr',
    swing: 0
  },
  lofi: {
    label: 'Lo-fi', tempo: 80, kit: 'lofi',
    kick:  'x.......x.x.....',
    snare: '....x.......x...',
    hat:   'x.x.x.x.x.x.x.xx',
    swing: 0.24
  },
  hyper: {
    label: 'Hyper', tempo: 160, kit: 'hyper',
    kick:  'x..x..x...x..x..',
    snare: '....x.......x...',
    clap:  '....x.......x...',
    hat:   'xrxxxrxxxrxrxxrr',
    swing: 0
  },
  rage: {
    label: 'Rage', tempo: 150, kit: 'rage',
    kick:  'x.....x.x.......',
    snare: '........x.......',
    clap:  '........x.......',
    hat:   'x.xrx.x.xrx.xxrr',
    swing: 0
  },
  jersey: {
    label: 'Jersey', tempo: 140, kit: 'club',
    kick:  'x..x..x.x..x.x..',
    clap:  '....x.......x...',
    hat:   '..x...x...x...x.',
    swing: 0
  },
  punk: {
    label: 'Punk', tempo: 168, kit: 'rock',
    kick:  'x.x.....x.x.....',
    snare: '....x.......x...',
    hat:   'x.x.x.x.x.x.x.x.',
    crash: pad('x'),
    swing: 0
  },
  grunge: {
    label: 'Grunge', tempo: 100, kit: 'rock',
    kick:  'x.....x.x.....x.',
    snare: '....x.......x...',
    hat:   'x.x.x.x.x.x.x.x.',
    crash: pad('x'),
    swing: 0.06
  }
};

export const PARTS = ['kick', 'snare', 'clap', 'hat', 'crash'];

export const STEPS = 16;
export const TEMPO_MIN = 60;
export const TEMPO_MAX = 175;

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
    // The kit's tone: wide open, or rolled off for lo-fi.
    this.tone = ctx.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.frequency.value = 20000;
    this.tone.Q.value = 0.5;
    this.tone.connect(this.out);
    this.out.connect(out);
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.curves = new Map();
    this.beat = null;
    this.kit = KITS.classic;
    this.bpm = 100;
    this.origin = 0;
    this.booked = 0; // time up to which steps are booked
    this.timer = 0;
    this.onStep = null;
    this.crackle = null;
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
    this.kit = KITS[beat.kit] ?? KITS.classic;
    this.tone.frequency.setTargetAtTime(this.kit.tone ?? 20000, now, 0.05);
    this.setCrackle(!!this.kit.crackle);
    if (!this.timer) this.timer = setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  stop() {
    this.beat = null;
    clearInterval(this.timer);
    this.timer = 0;
    this.setCrackle(false);
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
      for (const part of PARTS) {
        const pattern = beat[part];
        if (pattern) this.hit(pattern[k % pattern.length], t, (when, accent) => this[part](when, accent));
      }
      this.onStep?.(k % STEPS, t);
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

  /** A soft-clip curve, made once per amount. */
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

  noiseHit(t, { type = 'highpass', freq, q = 0.7, level, length, attack = 0.002 }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, level), t + attack);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + length);
    src.connect(f).connect(amp).connect(this.tone);
    src.start(t, Math.random() * 0.5);
    src.stop(t + length + 0.02);
  }

  kick(t, accent) {
    const ctx = this.ctx;
    const k = this.kit.kick;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.frequency.setValueAtTime(k.from, t);
    osc.frequency.exponentialRampToValueAtTime(k.to, t + Math.min(0.18, k.length * 0.25));
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(accent * (k.level ?? 1), t + 0.004);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + k.length);
    let node = osc.connect(amp);
    if (k.drive) {
      const shaper = ctx.createWaveShaper();
      shaper.curve = this.curve(k.drive);
      node = node.connect(shaper);
    }
    node.connect(this.tone);
    osc.start(t);
    osc.stop(t + k.length + 0.02);
  }

  snare(t, accent) {
    const ctx = this.ctx;
    const s = this.kit.snare;
    this.noiseHit(t, { freq: s.bright, level: s.level * accent, length: s.length });
    const body = ctx.createOscillator();
    body.frequency.setValueAtTime(s.body, t);
    body.frequency.exponentialRampToValueAtTime(s.body * 0.75, t + 0.08);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(0.4 * accent, t + 0.003);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    body.connect(amp).connect(this.tone);
    body.start(t);
    body.stop(t + 0.12);
  }

  /** Three quick bursts and a tail: hands, not a drum. */
  clap(t, accent) {
    const level = (this.kit.clap?.level ?? 0.5) * accent;
    for (let i = 0; i < 3; i++) this.noiseHit(t + i * 0.011, { type: 'bandpass', freq: 1300, q: 1.2, level, length: 0.03 });
    this.noiseHit(t + 0.033, { type: 'bandpass', freq: 1200, q: 0.9, level: level * 0.8, length: 0.2 });
  }

  hat(t, accent) {
    const h = this.kit.hat;
    const open = accent >= 1; // an accent opens the hat
    this.noiseHit(t, { freq: h.cut, level: h.level * accent, length: open ? 0.16 : h.length });
  }

  crash(t, accent) {
    const c = this.kit.crash ?? { length: 1.2, level: 0.2 };
    this.noiseHit(t, { freq: 4500, level: c.level * accent, length: c.length, attack: 0.004 });
  }

  /** Vinyl: a low hiss with dust pops, looping under a lo-fi beat. */
  setCrackle(on) {
    if (!on) {
      this.crackle?.stop();
      this.crackle = null;
      return;
    }
    if (this.crackle) return;
    const ctx = this.ctx;
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      lp += ((Math.random() * 2 - 1) - lp) * 0.08;
      d[i] = lp * 0.12;
      if (Math.random() < 0.0004) d[i] += (Math.random() < 0.5 ? -1 : 1) * (0.3 + Math.random() * 0.5); // a pop
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const g = ctx.createGain();
    g.gain.value = 0.35;
    src.connect(g).connect(this.out);
    src.start();
    this.crackle = src;
  }
}
