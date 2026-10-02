/**
 * Looper core, run on the audio thread. One button, like a loop pedal:
 *
 *   empty ──press──▶ recording ──press──▶ playing ──press──▶ overdub ──press──▶ playing …
 *
 * Everything is placed on one clock, the audio graph's frame counter, in
 * "musical time": the moment in the graph that a sound was played against.
 *
 * - Latency: what arrives from the mic at frame F was sung against what the graph
 *   played `latency` frames earlier (output latency to your ears, input latency
 *   back), so it belongs at musical time F − latency. Takes and overdubs are both
 *   written there, so layers never drift later than the one before.
 * - Beat: with a grid (bar length and the frame of one downbeat) the loop starts
 *   on the downbeat nearest the press and lasts 1, 2, 4 or 8 whole bars, so it
 *   always lines up with the drums however sloppily the button is pressed. A short
 *   pre-roll is always being kept, so pressing a little late loses nothing.
 * - The loop keeps filling after the closing press until its last musical moment
 *   has arrived, so the end of a take (or a late press) isn't cut off.
 * - Each overdub is its own layer, so Undo removes just the last one.
 *
 * Pure code (no Web Audio), so the tests drive it directly.
 */

const SNAP_BARS = [1, 2, 4, 8];
const PRE_ROLL_SECONDS = 2.5;

const mod = (a, n) => ((a % n) + n) % n;

export class LoopCore {
  constructor(sampleRate, maxSeconds = 32) {
    this.sr = sampleRate;
    this.max = Math.round(sampleRate * maxSeconds);
    this.preSize = Math.round(sampleRate * PRE_ROLL_SECONDS);
    this.pre = new Float32Array(this.preSize); // ring of the latest input, always written
    this.preAt = 0;
    this.rec = new Float32Array(this.max + this.preSize);
    this.latency = 0;
    this.barSamples = 0; // 0 = free length (no beat)
    this.origin = 0;     // frame of any downbeat, when there is a beat
    this.frame = 0;      // graph frame at the start of the next sample
    this.clear();
  }

  clear() {
    this.state = 'empty';
    this.layers = [];
    this.overdubLayer = null;
    this.length = 0;
    this.start = 0;     // musical frame where the loop's first pass began
    this.recBase = 0;   // musical frame of rec[0]
    this.recLen = 0;
    this.fillEnd = 0;   // musical frame up to which the first layer is still filling
    this.pressedAt = 0;
  }

  /** Length the first take becomes: snapped to whole bars when there's a beat. */
  snap(samples) {
    if (!this.barSamples) return Math.min(this.max, Math.max(Math.round(this.sr * 0.25), samples));
    const bars = samples / this.barSamples;
    let best = SNAP_BARS[0];
    for (const b of SNAP_BARS) if (Math.abs(b - bars) < Math.abs(best - bars)) best = b;
    // Fall back to fewer bars if 8 of them would not fit.
    while (best > 1 && best * this.barSamples > this.max) best /= 2;
    return Math.min(this.max, Math.round(best * this.barSamples));
  }

  /** The downbeat nearest a frame, or the frame itself with no beat. */
  nearestDownbeat(frame) {
    if (!this.barSamples) return frame;
    return Math.round(this.origin + Math.round((frame - this.origin) / this.barSamples) * this.barSamples);
  }

  /** The one button. */
  press() {
    switch (this.state) {
      case 'empty':
        this.begin();
        break;
      case 'recording':
        this.close();
        break;
      case 'playing':
        this.state = 'overdub';
        this.overdubLayer = new Float32Array(this.length);
        break;
      case 'overdub':
        this.commitOverdub();
        this.state = 'playing';
        break;
      case 'stopped':
        this.restart();
        break;
    }
  }

  begin() {
    this.state = 'recording';
    this.pressedAt = this.frame;
    // Seed the take with the pre-roll, oldest sample first.
    const n = this.preSize;
    this.rec.set(this.pre.subarray(this.preAt), 0);
    this.rec.set(this.pre.subarray(0, this.preAt), n - this.preAt);
    this.recLen = n;
    this.recBase = this.frame - n - this.latency;
  }

  close() {
    const start = this.nearestDownbeat(this.pressedAt);
    const len = this.snap(this.frame - start);
    const layer = new Float32Array(len);
    const from = start - this.recBase;
    for (let j = 0; j < len; j++) {
      const k = from + j;
      if (k >= 0 && k < this.recLen) layer[j] = this.rec[k];
    }
    this.layers = [layer];
    this.length = len;
    this.start = start;
    this.fillEnd = start + len;
    this.state = 'playing';
  }

  commitOverdub() {
    if (this.overdubLayer) this.layers.push(this.overdubLayer);
    this.overdubLayer = null;
  }

  /** Remove the newest layer (or abandon the overdub in progress). */
  undo() {
    if (this.state === 'overdub') {
      this.overdubLayer = null;
      this.state = 'playing';
    } else if (this.state === 'recording' || this.layers.length <= 1) {
      this.clear();
    } else {
      this.layers.pop();
    }
  }

  /** Stop playback (keeping the loop) or start it again from the top. */
  toggleStop() {
    if (this.state === 'playing' || this.state === 'overdub') {
      this.commitOverdub();
      this.fillEnd = 0;
      this.state = 'stopped';
    } else if (this.state === 'stopped') {
      this.restart();
    }
  }

  /** Play from the top: now, or on the next downbeat when there's a beat. */
  restart() {
    let at = this.frame;
    if (this.barSamples) at = Math.round(this.origin + Math.ceil((at - this.origin) / this.barSamples) * this.barSamples);
    this.start = at;
    this.state = 'playing';
  }

  /** `frame`: the graph frame of input[0], when the host knows it. */
  process(input, output, n, frame = this.frame) {
    const layers = this.layers;
    const len = this.length;
    for (let i = 0; i < n; i++) {
      const f = frame + i;
      const x = input ? input[i] : 0;
      this.pre[this.preAt] = x;
      this.preAt = this.preAt + 1 === this.preSize ? 0 : this.preAt + 1;
      let out = 0;
      if (this.state === 'recording') {
        if (this.recLen < this.rec.length) this.rec[this.recLen++] = x;
        if (f - this.nearestDownbeat(this.pressedAt) >= this.max) {
          this.frame = f;
          this.close(); // hit the maximum: close it there
        }
      } else if (this.state === 'playing' || this.state === 'overdub') {
        const m = f - this.latency; // musical time of the sample arriving now
        if (m < this.fillEnd && m >= this.start) layers[0][m - this.start] = x;
        if (f >= this.start) {
          const p = mod(f - this.start, len);
          for (let l = 0; l < layers.length; l++) out += layers[l][p];
          if (this.overdubLayer && m >= this.fillEnd) {
            this.overdubLayer[mod(m - this.start, len)] += x;
            out += this.overdubLayer[p];
          }
        }
      }
      output[i] = out;
    }
    this.frame = frame + n;
  }

  status() {
    const f = this.frame;
    const playing = this.length && f >= this.start;
    return {
      state: this.state,
      layers: this.layers.length + (this.overdubLayer ? 1 : 0),
      progress: playing ? mod(f - this.start, this.length) / this.length : 0,
      seconds: this.state === 'recording'
        ? Math.max(0, f - this.nearestDownbeat(this.pressedAt)) / this.sr
        : this.length / this.sr,
      start: this.start,
      length: this.length
    };
  }
}
