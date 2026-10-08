/**
 * Studio effects: a row of knobs, each silent at zero (or, for Filter, at
 * centre), so an untouched knob never colours the sound, plus a level and a mute.
 *
 * The curve and mapping functions are pure, so the tests check them directly.
 */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const CURVE_SIZE = 4096;

/** Soft clipping: tanh with drive rising to ~31x, normalised so full scale stays full scale. */
export function driveCurve(amount, size = CURVE_SIZE) {
  const a = clamp(amount, 0, 1);
  if (a < 0.001) return null; // null curve = straight through
  const g = 1 + 30 * a * a;
  const norm = Math.tanh(g);
  const curve = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const x = (i / (size - 1)) * 2 - 1;
    curve[i] = Math.tanh(g * x) / norm;
  }
  return curve;
}

/** Bits left after crushing: 16 at zero down to 3 at full. */
export const crushBits = (amount) => Math.round(16 - 13 * clamp(amount, 0, 1));

/** Bit crushing: a staircase with 2^bits levels. */
export function crushCurve(amount, size = CURVE_SIZE) {
  const a = clamp(amount, 0, 1);
  if (a < 0.001) return null;
  const steps = 2 ** (crushBits(a) - 1);
  const curve = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const x = (i / (size - 1)) * 2 - 1;
    curve[i] = Math.round(x * steps) / steps;
  }
  return curve;
}

/** Clipper gain: none at zero, up to 8x (+18 dB) pushed into the ceiling at full. */
export const clipGain = (amount) => 1 + 7 * clamp(amount, 0, 1) ** 2;

/**
 * Clipping, the loud-808 move: gain into a ceiling. Straight up to a knee at
 * 0.85, then a quick tanh bend so the corner doesn't fizz, flat at full scale.
 */
export function clipCurve(amount, size = CURVE_SIZE) {
  const a = clamp(amount, 0, 1);
  if (a < 0.001) return null;
  const g = clipGain(a);
  const knee = 0.85;
  const curve = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const x = ((i / (size - 1)) * 2 - 1) * g;
    const m = Math.abs(x);
    curve[i] = Math.sign(x) * (m <= knee ? m : knee + (1 - knee) * Math.tanh((m - knee) / (1 - knee)));
  }
  return curve;
}

/**
 * Gate: a tempo-locked chopper, the ShaperBox / trance-gate move. Each
 * sixteenth opens for its first part and closes for the rest; the knob is how far
 * it closes. Times in seconds from the start of the step: [open, close, floor].
 */
export function gateShape(amount, stepDuration) {
  const a = clamp(amount, 0, 1);
  const open = Math.min(0.004, stepDuration * 0.1);
  const close = Math.max(open + 0.001, stepDuration * 0.55);
  return { open, close, fall: Math.min(0.006, Math.max(0.0005, stepDuration - close - 0.001)), floor: 1 - a };
}

/**
 * DJ filter on one knob: left of centre closes a low-pass (darker), right of
 * centre opens a high-pass (thinner), the middle is a dead zone that does
 * nothing. Both filters sweep exponentially, as the ear hears pitch.
 */
export function filterSetting(knob) {
  const x = clamp(knob, 0, 1);
  const DEAD = 0.04;
  let lp = 22000;
  let hp = 10;
  if (x < 0.5 - DEAD) lp = 22000 * Math.pow(150 / 22000, (0.5 - DEAD - x) / (0.5 - DEAD));
  if (x > 0.5 + DEAD) hp = 10 * Math.pow(5000 / 10, (x - 0.5 - DEAD) / (0.5 - DEAD));
  return { lp, hp };
}

/** Echo time: a dotted eighth at the tempo — the classic synced delay. */
export const echoSeconds = (bpm) => (60 / bpm) * 0.75;

/** Echo knob to send level and feedback: more knob, louder and longer repeats. */
export function echoSetting(knob) {
  const x = clamp(knob, 0, 1);
  return { send: x < 0.001 ? 0 : 0.25 + 0.55 * x, feedback: 0.2 + 0.45 * x };
}

/**
 * Tape knob: wow (a slow pitch drift), flutter (a fast one) and the top end
 * rolling off, like a worn cassette. Delay swing in seconds, and the tone cutoff.
 */
export function tapeSetting(knob) {
  const x = clamp(knob, 0, 1);
  return { wow: 0.0032 * x, flutter: 0.00028 * x, tone: 20000 * Math.pow(4200 / 20000, x) };
}

/** Knob positions an untouched chain starts from. */
export const FX_DEFAULTS = { drive: 0, crush: 0, filter: 0.5, echo: 0, space: 0.25, tape: 0, clip: 0, gate: 0, level: 0.8, mute: false };

/** Level knob to gain: the default position (0.8) is unity, the top is +2 dB. */
export const levelGain = (v) => clamp(v, 0, 1) * 1.25;

/**
 * One reverb for everything. Convolution is the expensive effect, so every
 * chain sends into this one hall instead of running its own.
 */
export class SpaceBus {
  constructor(ctx, out) {
    this.input = ctx.createGain();
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = impulse(ctx, 3.2, 2.8);
    this.input.connect(this.reverb).connect(out);
  }
}

/**
 * One set of effects: the live sound has one, and so does every loop layer, so
 * a layer keeps the effects it was made with however the knobs move later.
 *
 *   in ─▶ Drive ─▶ Crush ─▶ Filter ─▶ Tape ─▶ Clip ─▶ Gate ─▶ Level ─┬─────────▶ out
 *                                                              ├─▶ Echo ─▶ out
 *                                                              └─▶ Space bus (shared reverb)
 *
 * The gate is booked step by step by whoever keeps time (gateStep); with nobody
 * booking it, or the knob at zero, it stays open.
 */
export class FxChain {
  constructor(ctx, space, out) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.drive = ctx.createWaveShaper();
    this.crush = ctx.createWaveShaper();
    this.lp = ctx.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.Q.value = 2.5; // a little resonance: the sweep should be heard
    this.hp = ctx.createBiquadFilter();
    this.hp.type = 'highpass';
    this.hp.Q.value = 2.5;
    this.level = ctx.createGain();
    // Tape: a delay whose time swings slowly (wow) and quickly (flutter). Its
    // centre equals the swing, so at zero it's no delay at all.
    this.tapeDelay = ctx.createDelay(0.05);
    this.tapeDelay.delayTime.value = 0;
    this.wow = ctx.createOscillator();
    this.wow.frequency.value = 0.65;
    this.wowDepth = ctx.createGain();
    this.wowDepth.gain.value = 0;
    this.flutter = ctx.createOscillator();
    this.flutter.frequency.value = 6.3;
    this.flutterDepth = ctx.createGain();
    this.flutterDepth.gain.value = 0;
    // The swing reaches the delay only while Tape is up: a modulated delay costs
    // time every sample, and every strip has one.
    this.wow.connect(this.wowDepth);
    this.flutter.connect(this.flutterDepth);
    this.tapeOn = false;
    this.wow.start();
    this.flutter.start();
    this.tapeTone = ctx.createBiquadFilter();
    this.tapeTone.type = 'lowpass';
    this.tapeTone.frequency.value = 20000;
    this.tapeTone.Q.value = 0.5;
    this.clip = ctx.createWaveShaper();
    this.gate = ctx.createGain();
    this.input.connect(this.drive).connect(this.crush).connect(this.lp).connect(this.hp)
      .connect(this.tapeDelay).connect(this.tapeTone).connect(this.clip).connect(this.gate).connect(this.level);
    this.level.connect(out);

    // Echo: delay with a darkening feedback loop, so repeats fade like tape.
    this.echoSend = ctx.createGain();
    this.echoSend.gain.value = 0;
    this.delay = ctx.createDelay(4);
    this.feedback = ctx.createGain();
    this.echoTone = ctx.createBiquadFilter();
    this.echoTone.type = 'lowpass';
    this.echoTone.frequency.value = 3800;
    this.level.connect(this.echoSend).connect(this.delay).connect(this.echoTone).connect(this.feedback).connect(this.delay);
    this.echoTone.connect(out);

    this.spaceSend = ctx.createGain();
    this.spaceSend.gain.value = 0;
    this.level.connect(this.spaceSend).connect(space.input);

    this.values = { ...FX_DEFAULTS };
    this.setAll(FX_DEFAULTS);
    this.setTempo(100);
  }

  set(name, value) {
    if (name === 'drive') this.setDrive(value);
    else if (name === 'crush') this.setCrush(value);
    else if (name === 'filter') this.setFilter(value);
    else if (name === 'echo') this.setEcho(value);
    else if (name === 'space') this.setSpace(value);
    else if (name === 'tape') this.setTape(value);
    else if (name === 'clip') this.setClip(value);
    else if (name === 'gate') this.setGate(value);
    else if (name === 'level') this.setLevel(value);
    else if (name === 'mute') this.setMute(value);
  }

  /** Take on a whole set of knob positions (missing ones keep their defaults). */
  setAll(values) {
    for (const [name, v] of Object.entries({ ...FX_DEFAULTS, ...values })) this.set(name, v);
  }

  setDrive(v) {
    this.values.drive = v;
    this.drive.curve = driveCurve(v);
    this.drive.oversample = this.drive.curve ? '4x' : 'none';
  }

  setCrush(v) {
    this.values.crush = v;
    this.crush.curve = crushCurve(v);
  }

  setFilter(v) {
    this.values.filter = v;
    const { lp, hp } = filterSetting(v);
    const t = this.ctx.currentTime;
    this.lp.frequency.setTargetAtTime(lp, t, 0.03);
    this.hp.frequency.setTargetAtTime(hp, t, 0.03);
  }

  setEcho(v) {
    this.values.echo = v;
    const { send, feedback } = echoSetting(v);
    const t = this.ctx.currentTime;
    this.echoSend.gain.setTargetAtTime(send, t, 0.03);
    this.feedback.gain.setTargetAtTime(feedback, t, 0.03);
  }

  setSpace(v) {
    this.values.space = v;
    this.spaceSend.gain.setTargetAtTime(clamp(v, 0, 1) * 0.9, this.ctx.currentTime, 0.05);
  }

  setTape(v) {
    this.values.tape = v;
    const { wow, flutter, tone } = tapeSetting(v);
    const t = this.ctx.currentTime;
    const on = v >= 0.001;
    if (on && !this.tapeOn) {
      clearTimeout(this.tapeOff);
      this.wowDepth.connect(this.tapeDelay.delayTime);
      this.flutterDepth.connect(this.tapeDelay.delayTime);
    } else if (!on && this.tapeOn) {
      // Let the swing glide to nothing, then unplug it.
      clearTimeout(this.tapeOff);
      this.tapeOff = setTimeout(() => {
        if (this.tapeOn) return;
        this.wowDepth.disconnect();
        this.flutterDepth.disconnect();
      }, 400);
    }
    this.tapeOn = on;
    this.tapeDelay.delayTime.setTargetAtTime(wow + flutter, t, 0.05);
    this.wowDepth.gain.setTargetAtTime(wow, t, 0.05);
    this.flutterDepth.gain.setTargetAtTime(flutter, t, 0.05);
    this.tapeTone.frequency.setTargetAtTime(tone, t, 0.05);
  }

  setClip(v) {
    this.values.clip = v;
    this.clip.curve = clipCurve(v);
    this.clip.oversample = this.clip.curve ? '2x' : 'none';
  }

  setGate(v) {
    const was = this.values.gate;
    this.values.gate = v;
    if (v < 0.001 && was >= 0.001) this.gateOpen();
  }

  /** Book the gate for one step starting at `at` and lasting `duration` seconds. */
  gateStep(at, duration) {
    if (!(this.values.gate >= 0.001)) return;
    const { open, close, fall, floor } = gateShape(this.values.gate, duration);
    const g = this.gate.gain;
    g.setValueAtTime(floor, at);
    g.linearRampToValueAtTime(1, at + open);
    g.setValueAtTime(1, at + close);
    g.linearRampToValueAtTime(floor, at + close + fall);
  }

  /** Forget anything booked and open the gate (the transport stopped). */
  gateOpen() {
    const t = this.ctx.currentTime;
    this.gate.gain.cancelScheduledValues(t);
    this.gate.gain.setTargetAtTime(1, t, 0.01);
  }

  setLevel(v) {
    this.values.level = v;
    this.applyLevel();
  }

  setMute(on) {
    this.values.mute = !!on;
    this.applyLevel();
  }

  applyLevel() {
    const g = this.values.mute ? 0 : levelGain(this.values.level);
    this.level.gain.setTargetAtTime(g, this.ctx.currentTime, 0.015);
  }

  setTempo(bpm) {
    this.delay.delayTime.setTargetAtTime(echoSeconds(bpm), this.ctx.currentTime, 0.05);
  }
}

/** Noise with an exponential tail: a serviceable hall without a sample file. */
export function impulse(ctx, seconds, decay) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
  }
  return buffer;
}
