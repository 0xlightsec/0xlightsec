/**
 * Performance effects on everything you hear, held down like pads:
 *
 *   Stutter   repeats the last whole slice (an eighth or a sixteenth) in time,
 *             the beat-repeat / Gross Beat move
 *   Tape stop the whole mix winds down like a turntable losing power
 *
 * Let go and the music is back exactly where it would have been: the real mix
 * keeps running underneath.
 *
 * The last few seconds of the mix are always kept in a ring, so a stutter can
 * repeat the slice that just finished, lined up with the beat grid. Every switch
 * crossfades over a few milliseconds, and each repeat is faded at its edges, so
 * nothing clicks.
 *
 * Pure code (no Web Audio), so the tests drive it directly.
 */

const RING_SECONDS = 4;
const XFADE = 128;  // samples to switch between dry and effect
const EDGE = 96;    // samples faded at each end of a repeated slice

export class PerfCore {
  constructor(sampleRate) {
    this.sr = sampleRate;
    this.size = Math.round(sampleRate * RING_SECONDS);
    this.ring = [new Float32Array(this.size), new Float32Array(this.size)];
    this.frame = 0;
    this.step = Math.round(sampleRate * 0.125); // a sixteenth; 120 bpm until told
    this.origin = 0;
    this.mode = 'off';  // the effect sounding (it keeps sounding while it fades out)
    this.active = false; // a pad is held
    this.wet = 0;        // 0 = dry, 1 = effect (crossfaded)
    this.slice = 0;
    this.repeatFrom = 0;
    this.gridAt = 0;
    this.tapeAt = 0;
    this.tapePos = 0;
    this.tapeLength = Math.round(sampleRate * 0.9);
  }

  /** The beat grid: a sixteenth in samples, and the frame of a downbeat. */
  setGrid(stepSamples, origin) {
    this.step = Math.max(16, stepSamples);
    this.origin = origin;
  }

  /** Repeat slices of `sixteenths` (2 = an eighth, 1 = a sixteenth); 0 lets go. */
  stutter(sixteenths, frame = this.frame) {
    if (!sixteenths) {
      if (this.mode === 'stutter') this.active = false;
      return;
    }
    const len = Math.max(64, Math.round(this.step * sixteenths));
    // The slice boundary at or before now; repeat the whole slice before it.
    const k = Math.floor((frame - this.origin) / len);
    this.gridAt = Math.round(this.origin + k * len);
    this.repeatFrom = this.gridAt - len;
    this.slice = len;
    this.mode = 'stutter';
    this.active = true;
  }

  /** Wind the mix down (true) or let it go again (false). */
  tape(on, frame = this.frame) {
    if (on) {
      this.mode = 'tape';
      this.active = true;
      this.tapeAt = frame;
      this.tapePos = frame;
    } else if (this.mode === 'tape') {
      this.active = false;
    }
  }

  read(ch, pos) {
    const ring = this.ring[ch];
    const i = Math.floor(pos);
    const t = pos - i;
    const a = ring[((i % this.size) + this.size) % this.size];
    const b = ring[(((i + 1) % this.size) + this.size) % this.size];
    return a + (b - a) * t;
  }

  /** Stereo in, stereo out. `frame`: the graph frame of the first sample. */
  process(inL, inR, outL, outR, n, frame = this.frame) {
    const size = this.size;
    for (let i = 0; i < n; i++) {
      const f = frame + i;
      const w = f % size;
      const l = inL ? inL[i] : 0;
      const r = inR ? inR[i] : l;
      this.ring[0][w] = l;
      this.ring[1][w] = r;

      let el = 0;
      let er = 0;
      if (this.mode === 'stutter') {
        const len = this.slice;
        const phase = ((f - this.gridAt) % len + len) % len;
        const g = Math.min(1, phase / EDGE, (len - phase) / EDGE);
        el = this.read(0, this.repeatFrom + phase) * g;
        er = this.read(1, this.repeatFrom + phase) * g;
      } else if (this.mode === 'tape') {
        const rate = Math.max(0, 1 - (f - this.tapeAt) / this.tapeLength);
        if (rate > 0) {
          el = this.read(0, this.tapePos) * Math.min(1, rate * 4);
          er = this.read(1, this.tapePos) * Math.min(1, rate * 4);
          this.tapePos += rate;
        }
      }
      if (this.active) this.wet = Math.min(1, this.wet + 1 / XFADE);
      else if (this.wet > 0) this.wet = Math.max(0, this.wet - 1 / XFADE);
      if (!this.active && this.wet === 0) this.mode = 'off';
      outL[i] = l + (el - l) * this.wet;
      outR[i] = r + (er - r) * this.wet;
    }
    this.frame = frame + n;
  }
}
