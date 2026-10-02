/**
 * Studio effects: five knobs, each silent at zero (or, for Filter, at centre),
 * so an untouched knob never colours the sound.
 *
 *   in ─▶ Drive ─▶ Crush ─▶ Filter ─┬───────────────▶ out
 *                                   ├─▶ Echo  ──────▶ out   (tempo-synced, feeds back)
 *                                   └─▶ Space ──────▶ out   (reverb)
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

export class FxChain {
  constructor(ctx) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();

    this.drive = ctx.createWaveShaper();
    this.drive.oversample = '4x';
    this.crush = ctx.createWaveShaper();
    this.lp = ctx.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.Q.value = 2.5; // a little resonance: the sweep should be heard
    this.hp = ctx.createBiquadFilter();
    this.hp.type = 'highpass';
    this.hp.Q.value = 2.5;

    this.input.connect(this.drive).connect(this.crush).connect(this.lp).connect(this.hp);
    this.hp.connect(this.output);

    // Echo: delay with a darkening feedback loop, so repeats fade like tape.
    this.echoSend = ctx.createGain();
    this.echoSend.gain.value = 0;
    this.delay = ctx.createDelay(4);
    this.feedback = ctx.createGain();
    this.echoTone = ctx.createBiquadFilter();
    this.echoTone.type = 'lowpass';
    this.echoTone.frequency.value = 3800;
    this.hp.connect(this.echoSend).connect(this.delay).connect(this.echoTone).connect(this.feedback).connect(this.delay);
    this.echoTone.connect(this.output);

    // Space: a generated hall.
    this.spaceSend = ctx.createGain();
    this.spaceSend.gain.value = 0;
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = impulse(ctx, 3.2, 2.8);
    this.hp.connect(this.spaceSend).connect(this.reverb).connect(this.output);

    this.values = { drive: 0, crush: 0, filter: 0.5, echo: 0, space: 0 };
    this.bpm = 100;
    this.setTempo(this.bpm);
    this.setFilter(0.5);
    this.setEcho(0);
  }

  set(name, value) {
    if (name === 'drive') this.setDrive(value);
    else if (name === 'crush') this.setCrush(value);
    else if (name === 'filter') this.setFilter(value);
    else if (name === 'echo') this.setEcho(value);
    else if (name === 'space') this.setSpace(value);
  }

  setDrive(v) {
    this.values.drive = v;
    this.drive.curve = driveCurve(v);
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

  setTempo(bpm) {
    this.bpm = bpm;
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
